/* Sequence Studio — kalıcı depolama (IndexedDB)
 *
 * Bu dosya yerel depolama bağdaştırıcısıdır; özellikler doğrudan buraya değil Seq.repo'ya (core/repo.js) konuşur.
 * Bulut sürümünde aynı sözleşmeyi bir sunucu bağdaştırıcısı uygular.
 *
 * Öğe bazlı saklama (veritabanı sürüm 4): akışlar, klasörler, roller ve katalog öğeleri "entities" deposunda
 * öğe başına ayrı kayıttır; yalnızca değişen öğe yazılır (lib/changeset.js):
 *
 *   { key: "<ws>|<tür>|<id>", ws, type: 'doc'|'folder'|'role'|'catalog', id, pos, data, meta }
 *   meta = { rev, createdAt, createdBy, updatedAt, updatedBy, deleted? }
 *
 * Silinen öğe kaldırılmaz, silme izi (deleted: true) bırakır: senkronizasyon başka cihaza silindiğini bildirebilsin,
 * diğer akışlar silinen katalog öğesine/role bağlıysa açıldıklarında bağ kaldırılabilsin (tembel yayılım).
 *
 * Çalışma alanı: tüm kayıtlar bir çalışma alanına aittir (ws). Çalışma alanının kendisi (ad, tür, yetki, diyagram
 * görünümü ayarları) kv deposundaki "workspaces" listesindedir. Yerel sürümde tek ve sabit bir çalışma alanı vardır
 * ("local"). Kişisel ayarlar ve son açık diyagram küçük ve açılışta senkron gerektiğinden localStorage'da kalır.
 *
 * Sekmeler arası bildirim: başarılı her yazmadan sonra diğer sekmelere hangi kayıtların değiştiği duyurulur
 * (BroadcastChannel). Alan sekme kayıtları veritabanından okur, kendi "son yazılan hâl"ini günceller (eski hâlin
 * üstüne yazmasın) ve onRemote dinleyicilerine iletir. Bulut bağdaştırıcısında aynı yol sunucudan gelen
 * değişiklikleri taşır.
 *
 * Yükseltmeler tek bir sürüm geçişi işleminde yapılır (yarım kalırsa hiçbiri uygulanmaz):
 *   2: sürüm geçmişi ("versions"), 3: çalışma alanı, 4: öğe bazlı kayıtlar ("docs" deposu ve kv listeleri taşınır).
 * İlk açılışta eski localStorage verisi IndexedDB'ye taşınır, geri okunarak doğrulanır; eski veri silinmez,
 * "seqstudio.legacy.*" adıyla güvenlik kopyası olarak saklanır.
 * IndexedDB açılamazsa (bazı gizli pencereler, eski tarayıcılar) localStorage ile, üstverisiz düz listelerle
 * çalışmaya devam edilir.
 */
(function () {
  'use strict';

  const C = window.SeqChangeset;
  const DB_NAME = 'sequence-studio';
  const DB_VERSION = 4;
  const LOCAL_WS = 'local';
  // Koleksiyonlar: tür → eski kv/localStorage anahtarı; akışların sırası anlamsızdır (en son güncellenen önde gösterilir)
  const TYPES = { doc: { key: 'docs', ordered: false }, folder: { key: 'folders' }, role: { key: 'roles' }, catalog: { key: 'catalog' } };
  const LIST_TYPES = ['folder', 'role', 'catalog'];
  const wsKey = (ws, key) => 'ws:' + ws + ':' + key;
  const ekey = (ws, type, id) => ws + '|' + type + '|' + id;
  let currentWs = LOCAL_WS;
  const LS = { docs: 'seqstudio.docs', folders: 'seqstudio.folders', roles: 'seqstudio.roles', catalog: 'seqstudio.catalog', migrated: 'seqstudio.storage' };
  const LS_WS = 'seqstudio.workspace';
  const LEGACY = (k) => k.replace('seqstudio.', 'seqstudio.legacy.');

  const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('aborted')); });
  const record = (ws, type, p) => Object.assign({ key: ekey(ws, type, p.id), ws, type }, p);
  /** Yükseltilen/taşınan veri için ilk üstveri (yazan bilinmiyor) */
  const firstMeta = (t) => ({ rev: 1, createdAt: t, createdBy: '', updatedAt: t, updatedBy: '' });

  function openDb() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      let r;
      try { r = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return rej(e); }
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        if (!db.objectStoreNames.contains('versions')) {
          const vs = db.createObjectStore('versions', { keyPath: 'vid' });
          vs.createIndex('docId', 'docId');
        }
        if (!db.objectStoreNames.contains('entities')) {
          const es = db.createObjectStore('entities', { keyPath: 'key' });
          es.createIndex('ws', 'ws');
        }
        if (db.objectStoreNames.contains('docs')) upgradeToEntities(db, r.transaction);
      };
      let blockedTimer = null;
      r.onsuccess = () => {
        clearTimeout(blockedTimer);
        const d = r.result;
        // Başka sekme daha yeni bir sürüme yükseltmek istiyor: bağlantıyı bırak (yükseltme beklemesin), kullanıcıya bildir
        d.onversionchange = () => { d.close(); db = null; staleFns.forEach((fn) => fn()); };
        res(d);
      };
      r.onerror = () => { clearTimeout(blockedTimer); rej(r.error); };
      // Eski sürümün açık bir sekmesi yükseltmeyi bekletiyor: o sekme bağlantıyı bırakınca devam edilir; çok uzarsa vazgeçilir
      r.onblocked = () => { blockedTimer = setTimeout(() => rej(new Error('IndexedDB blocked')), 15000); };
    });
  }

  /**
   * Sürüm 4 yükseltmesi (aynı işlem içinde): "docs" deposundaki akışlar ve kv'deki listeler (çalışma alanı öncesi
   * kapsamsız anahtarlar dahil) öğe kayıtlarına taşınır; eski depo ve anahtarlar kaldırılır.
   */
  function upgradeToEntities(db, tx) {
    const now = Date.now();
    const es = tx.objectStore('entities');
    const kv = tx.objectStore('kv');
    tx.objectStore('docs').getAll().onsuccess = (e) => {
      (e.target.result || []).forEach((d) => {
        if (!d || !d.id) return;
        const ws = d.workspaceId || LOCAL_WS;
        d.workspaceId = ws;
        es.put(record(ws, 'doc', { id: d.id, pos: 0, data: d, meta: firstMeta(d.updated || d.created || now) }));
      });
      db.deleteObjectStore('docs');
    };
    LIST_TYPES.forEach((type) => {
      const key = TYPES[type].key;
      const put = (list) => {
        if (!Array.isArray(list)) return;
        list.forEach((x, i) => { if (x && x.id != null) es.put(record(LOCAL_WS, type, { id: x.id, pos: i, data: x, meta: firstMeta(now) })); });
        // Tüm rolleri silmiş kullanıcıya hazır roller yeniden eklenmesin
        if (type === 'role') kv.put(true, wsKey(LOCAL_WS, 'rolesInit'));
      };
      kv.get(wsKey(LOCAL_WS, key)).onsuccess = (ev) => {
        if (ev.target.result !== undefined) put(ev.target.result);
        else kv.get(key).onsuccess = (ev2) => put(ev2.target.result);
        kv.delete(wsKey(LOCAL_WS, key));
        kv.delete(key);
      };
    });
  }

  let db = null;
  let mode = 'local';
  let actor = '';
  // Son yazılan hâller (tür → Map(id → { json, pos, meta })): yalnızca değişenleri yazmak için
  const states = { doc: new Map(), folder: new Map(), role: new Map(), catalog: new Map() };
  let rolesInit = false;

  // ---- Kayıt durumu: 'saving' | 'saved' | 'error' (Seq.repo "repo:status" olayı olarak yayar) ----
  // Veri yazması başarısız olduysa durum, bir sonraki başarılı veri yazmasına kadar 'error' kalır
  // (arada başarılı olan sürüm geçmişi yazması hatayı örtmesin).
  const listeners = [];
  let pending = 0;
  let failed = false;
  const status = (s, err) => listeners.forEach((fn) => { try { fn(s, err); } catch (e) { /* dinleyici hatası yazmayı bozmasın */ } });
  // Yazmalar sırayla yapılır; hata olursa sonraki yazmalar yine denenir
  let chain = Promise.resolve();
  function enqueue(fn, isData) {
    if (++pending === 1) status('saving');
    const p = chain.then(() => fn());
    chain = p.then(() => {
      if (isData) failed = false;
      if (--pending === 0) status(failed ? 'error' : 'saved');
    }, (e) => { failed = true; --pending; status('error', e); });
    return p;
  }
  /** localStorage yedek yolunda yazma; durum hemen bildirilir */
  function lsSave(k, v) {
    if (lsSet(k, v)) { status('saved'); return Promise.resolve(true); }
    const e = new Error('quota');
    status('error', e);
    return Promise.reject(e);
  }

  /** Bir çalışma alanının tüm verisi; okunan kayıtlar son yazılan hâl olarak tutulur. */
  async function readAllIdb(ws = currentWs) {
    const tx = db.transaction(['entities', 'kv'], 'readonly');
    const kv = tx.objectStore('kv');
    const [recs, migrated, workspaces, rInit] = await Promise.all([
      req(tx.objectStore('entities').index('ws').getAll(ws)),
      req(kv.get('migrated')),
      req(kv.get('workspaces')),
      req(kv.get(wsKey(ws, 'rolesInit'))),
    ]);
    const by = { doc: [], folder: [], role: [], catalog: [] };
    (recs || []).forEach((r) => { if (by[r.type]) by[r.type].push(r); });
    const items = {};
    Object.keys(by).forEach((t) => { const o = C.fromRecords(by[t]); states[t] = o.state; items[t] = o.items; });
    rolesInit = !!rInit;
    return {
      docs: items.doc, folders: items.folder, catalog: items.catalog,
      // Hiç kaydedilmemişse null: hazır roller eklensin
      roles: states.role.size || rolesInit ? items.role : null,
      migrated: !!migrated, workspaces: Array.isArray(workspaces) ? workspaces : [],
    };
  }
  const defaultWorkspace = () => ({ id: LOCAL_WS, kind: 'local', name: '', role: 'owner', createdAt: Date.now(), meta: { rev: 1, updatedAt: Date.now(), updatedBy: actor } });

  /** Eski localStorage verisini IndexedDB'ye taşır; geri okuyarak doğrular. */
  async function migrateFromLocal() {
    const docs = lsGet(LS.docs, null);
    const folders = lsGet(LS.folders, []);
    const roles = lsGet(LS.roles, null);
    const now = Date.now();
    const tx = db.transaction(['entities', 'kv'], 'readwrite');
    const es = tx.objectStore('entities');
    if (Array.isArray(docs)) docs.forEach((d) => d && d.id && es.put(record(LOCAL_WS, 'doc', { id: d.id, pos: 0, data: Object.assign({ workspaceId: LOCAL_WS }, d), meta: firstMeta(d.updated || now) })));
    (folders || []).forEach((f, i) => f && f.id && es.put(record(LOCAL_WS, 'folder', { id: f.id, pos: i, data: f, meta: firstMeta(now) })));
    if (Array.isArray(roles)) {
      roles.forEach((r, i) => r && r.id && es.put(record(LOCAL_WS, 'role', { id: r.id, pos: i, data: r, meta: firstMeta(now) })));
      tx.objectStore('kv').put(true, wsKey(LOCAL_WS, 'rolesInit'));
    }
    tx.objectStore('kv').put(now, 'migrated');
    await done(tx);
    const back = await readAllIdb();
    const want = Array.isArray(docs) ? docs.filter((d) => d && d.id).length : 0;
    if (back.docs.length < want) throw new Error('migration verify failed: ' + back.docs.length + '/' + want);
    // Doğrulandı: eski veri silinmez, güvenlik kopyası olarak yeniden adlandırılır
    [LS.docs, LS.folders, LS.roles].forEach((k) => {
      const raw = localStorage.getItem(k);
      if (raw != null) { try { localStorage.setItem(LEGACY(k), raw); localStorage.removeItem(k); } catch (e) { /* kopya yazılamazsa orijinal kalır */ } }
    });
    lsSet(LS.migrated, 'idb');
    return { count: want };
  }

  /**
   * Depolamayı açar ve etkin çalışma alanının verisini döner: { mode, workspace, docs, folders, roles, catalog, migrated }.
   * Yerel sürümde çalışma alanı tektir: yoksa oluşturulur, kullanıcı yenisini açamaz.
   * docs son güncellemeye göre yeniden eskiye sıralıdır.
   */
  async function init() {
    let migrated = null;
    try {
      db = await openDb();
      mode = 'idb';
      let data = await readAllIdb();
      if (!data.migrated) {
        // localStorage'da hiç veri yoksa (yeni kullanıcı) taşıma yalnızca işaret koyar
        migrated = await migrateFromLocal();
        data = await readAllIdb();
      }
      let workspace = data.workspaces.find((w) => w.id === LOCAL_WS);
      if (!workspace) { workspace = defaultWorkspace(); await putWorkspaces(data.workspaces.concat([workspace])); }
      currentWs = workspace.id;
      data.docs.sort((a, b) => (b.updated || 0) - (a.updated || 0));
      return { mode, workspace, docs: data.docs, folders: data.folders, roles: data.roles, catalog: data.catalog, migrated };
    } catch (err) {
      // Yedek yol: localStorage
      console.warn('[storage] IndexedDB kullanılamıyor, localStorage ile devam ediliyor:', err);
      db = null;
      mode = 'local';
      const docs = lsGet(LS.docs, null) || lsGet(LEGACY(LS.docs), []);
      const workspace = lsGet(LS_WS, null) || defaultWorkspace();
      lsSet(LS_WS, workspace);
      return { mode, workspace, docs, folders: lsGet(LS.folders, null) || lsGet(LEGACY(LS.folders), []), roles: lsGet(LS.roles, null) || lsGet(LEGACY(LS.roles), null), catalog: lsGet(LS.catalog, []), migrated: null, error: String(err && err.message || err) };
    }
  }

  /**
   * Bir koleksiyonun güncel listesini kaydeder (tür: doc | folder | role | catalog). Yalnızca eklenen/değişen öğeler
   * yazılır (rev artar, updatedAt/updatedBy), listeden çıkanlar silme izi bırakır.
   */
  function save(type, list) {
    const T = TYPES[type];
    if (!T) return Promise.reject(new Error('unknown collection: ' + type));
    list = list || [];
    // Her akış etkin çalışma alanına bağlıdır
    if (type === 'doc') list.forEach((d) => { if (!d.workspaceId) d.workspaceId = currentWs; });
    if (mode !== 'idb') return lsSave(LS[T.key], list);
    const ws = currentWs;
    const prev = states[type];
    const { puts, next } = C.diff(prev, list, { now: Date.now(), by: actor, ordered: T.ordered });
    const flagRoles = type === 'role' && !rolesInit;
    if (!puts.length && !flagRoles) return chain;
    // Durum hemen güncellenir: aynı değişiklik ikinci kez kuyruğa girmesin
    states[type] = next;
    if (flagRoles) rolesInit = true;
    return enqueue(async () => {
      const tx = db.transaction(['entities', 'kv'], 'readwrite');
      const es = tx.objectStore('entities');
      puts.forEach((p) => es.put(record(ws, type, p)));
      if (flagRoles) tx.objectStore('kv').put(true, wsKey(ws, 'rolesInit'));
      try { await done(tx); } catch (e) {
        // Başarısız yazmalar bir sonraki kayıtta tekrar denensin
        puts.forEach((p) => { const old = prev.get(p.id); if (old) states[type].set(p.id, old); else states[type].delete(p.id); });
        if (flagRoles) rolesInit = false;
        throw e;
      }
      announce({ ws, type, ids: puts.map((p) => p.id) });
    }, true);
  }

  /** Öğenin üstverisi (rev, oluşturan, son güncelleyen…); bilinmiyorsa null */
  const meta = (type, id) => { const s = states[type] && states[type].get(id); return s ? Object.assign({}, s.meta) : null; };
  /** Silme izi bırakmış öğe kimlikleri (tembel yayılım: diğer akışlardaki bağlar açılırken kaldırılır) */
  const deleted = (type) => (states[type] ? C.deletedIds(states[type]) : []);

  // ---- Çalışma alanları ----
  function putWorkspaces(list) {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(list, 'workspaces');
    return done(tx);
  }
  /**
   * Çalışma alanı kaydını (ad, görünüm ayarları) günceller. Kayıt da üstveri taşır (rev, updatedAt, updatedBy);
   * revizyon depodaki hâlden artırılır. Döner: yazılan kayıt.
   */
  function saveWorkspace(ws) {
    const copy = JSON.parse(JSON.stringify(ws));
    if (mode !== 'idb') return lsSave(LS_WS, copy);
    return enqueue(async () => {
      const tx = db.transaction('kv', 'readwrite');
      const kv = tx.objectStore('kv');
      const list = (await req(kv.get('workspaces'))) || [];
      const i = list.findIndex((w) => w.id === copy.id);
      const prevRev = i >= 0 && list[i].meta ? list[i].meta.rev || 0 : 0;
      copy.meta = { rev: prevRev + 1, updatedAt: Date.now(), updatedBy: actor };
      if (i >= 0) list[i] = copy; else list.push(copy);
      kv.put(list, 'workspaces');
      await done(tx);
      announce({ ws: copy.id, type: 'workspace' });
      return copy;
    }, true);
  }

  // ---- Sekmeler arası bildirim ----
  const remoteFns = [];
  const staleFns = [];
  let channel = null;
  try { if (window.BroadcastChannel) channel = new BroadcastChannel('sequence-studio'); } catch (e) { /* desteklenmiyor */ }
  function announce(msg) { if (channel) { try { channel.postMessage(msg); } catch (e) { /* yok */ } } }
  /** Başka sekmenin yazdığı kayıtları okur, son yazılan hâli günceller ve dinleyicilere iletir */
  async function receive(msg) {
    if (!db || mode !== 'idb' || !msg || msg.ws !== currentWs) return;
    if (msg.type === 'workspace') {
      const list = await req(db.transaction('kv').objectStore('kv').get('workspaces'));
      const w = (list || []).find((x) => x.id === currentWs);
      if (w) remoteFns.forEach((fn) => fn('workspace', [w]));
      return;
    }
    if (!TYPES[msg.type] || !Array.isArray(msg.ids) || !msg.ids.length) return;
    const st = db.transaction('entities').objectStore('entities');
    const recs = (await Promise.all(msg.ids.map((id) => req(st.get(ekey(currentWs, msg.type, id)))))).filter(Boolean);
    const states2 = states[msg.type];
    recs.forEach((r) => {
      // Bu sekmenin son yazdığı hâl de iletilir: buradaki yazılmamış değişiklik onunla karşılaştırılarak anlaşılır
      const old = states2.get(r.id);
      r.prevJson = old ? old.json : null;
      states2.set(r.id, { json: r.data == null ? null : JSON.stringify(r.data), pos: r.pos || 0, meta: r.meta });
    });
    if (recs.length) remoteFns.forEach((fn) => fn(msg.type, recs));
  }
  if (channel) channel.onmessage = (e) => { chain = chain.then(() => receive(e.data)).catch((err) => console.warn('[storage] sync', err)); };

  // ---- Sürüm geçmişi ----
  // Kayıt: { vid, ws, docId, ts, code, name, kind: 'auto' | 'manual' | 'restore', label?, by? }
  // IndexedDB yoksa localStorage'da diyagram başına az sayıda sürüm tutulur.
  const LS_VERSIONS = 'seqstudio.versions';
  const LOCAL_VERSION_CAP = 10;
  const sortVersions = (a) => a.sort((x, y) => y.ts - x.ts);

  async function listVersions(docId) {
    if (mode !== 'idb') return sortVersions(((lsGet(LS_VERSIONS, {}) || {})[docId] || []).slice());
    await chain;
    const tx = db.transaction('versions', 'readonly');
    return sortVersions(await req(tx.objectStore('versions').index('docId').getAll(docId)) || []);
  }
  /** Sürüm ekler; otomatik sürümlerden en yeni `keepAuto` tanesi tutulur (elle kaydedilenler silinmez). */
  function addVersion(v, keepAuto) {
    if (mode !== 'idb') {
      const all = lsGet(LS_VERSIONS, {}) || {};
      const list = sortVersions([v].concat(all[v.docId] || []));
      let autos = 0;
      all[v.docId] = list.filter((x) => x.kind !== 'auto' || ++autos <= Math.min(keepAuto, LOCAL_VERSION_CAP));
      return lsSet(LS_VERSIONS, all) ? Promise.resolve(v) : Promise.reject(new Error('quota'));
    }
    return enqueue(async () => {
      const tx = db.transaction('versions', 'readwrite');
      const st = tx.objectStore('versions');
      st.put(Object.assign({ ws: currentWs }, v));
      const list = sortVersions(await req(st.index('docId').getAll(v.docId)) || []);
      let autos = 0;
      list.forEach((x) => { if (x.kind === 'auto' && ++autos > keepAuto) st.delete(x.vid); });
      await done(tx);
      return v;
    });
  }
  function deleteVersion(vid, docId) {
    if (mode !== 'idb') {
      const all = lsGet(LS_VERSIONS, {}) || {};
      all[docId] = (all[docId] || []).filter((x) => x.vid !== vid);
      lsSet(LS_VERSIONS, all);
      return Promise.resolve();
    }
    return enqueue(async () => { const tx = db.transaction('versions', 'readwrite'); tx.objectStore('versions').delete(vid); await done(tx); });
  }
  /** Diyagram silinince sürümleri de silinir. */
  function deleteVersionsOf(docId) {
    if (mode !== 'idb') {
      const all = lsGet(LS_VERSIONS, {}) || {};
      delete all[docId];
      lsSet(LS_VERSIONS, all);
      return Promise.resolve();
    }
    return enqueue(async () => {
      const tx = db.transaction('versions', 'readwrite');
      const st = tx.objectStore('versions');
      const keys = await req(st.index('docId').getAllKeys(docId));
      (keys || []).forEach((k) => st.delete(k));
      await done(tx);
    });
  }

  /** Bekleyen tüm yazmaların bitmesini bekler. */
  const flush = () => chain;

  /** Kaydedilen verinin yaklaşık boyutu (bayt, UTF-8 varsayımıyla JSON uzunluğu) */
  function dataSize() {
    let n = 0;
    if (mode !== 'idb') {
      Object.values(TYPES).forEach((t) => { const v = localStorage.getItem(LS[t.key]); if (v) n += v.length; });
      return n;
    }
    Object.values(states).forEach((m) => m.forEach((s) => { if (s.json) n += s.json.length; }));
    return n;
  }

  /** Kullanılan alan ve kalıcılık durumu. */
  async function estimate() {
    const out = { mode, usage: null, quota: null, persisted: null, dataSize: dataSize() };
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        out.usage = e.usage; out.quota = e.quota;
      }
      if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
    } catch (e) { /* desteklenmiyor */ }
    if (mode !== 'idb' || out.usage == null) {
      // localStorage: yaklaşık boyut (UTF-16)
      let n = 0;
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += (k.length + (localStorage.getItem(k) || '').length) * 2; } } catch (e) { /* yok */ }
      if (mode !== 'idb') { out.usage = n; out.quota = 5 * 1024 * 1024; }
    }
    return out;
  }

  /** Tarayıcıdan kalıcı depolama ister (verilirse disk dolunca bile otomatik silinmez). */
  async function requestPersist() {
    try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* yok */ }
    return false;
  }

  window.SeqStorage = {
    init, save, meta, deleted, saveWorkspace, flush, estimate, requestPersist, LOCAL_WS, DB_VERSION,
    get workspaceId() { return currentWs; },
    /** Yazan kullanıcı (createdBy/updatedBy) */
    setActor(id) { actor = id || ''; },
    onStatus(fn) { listeners.push(fn); },
    /**
     * Başka sekmeden (bulutta: sunucudan) gelen kayıtlar: fn(type, records). Kayıtta prevJson, bu sekmenin o öğe
     * için son yazdığı hâldir. type 'workspace' ise kayıt çalışma alanıdır.
     */
    onRemote(fn) { remoteFns.push(fn); },
    /** Veritabanı başka sekmede yükseltildi; bu sekme artık yazamaz, yenilenmeli */
    onStale(fn) { staleFns.push(fn); },
    /** Yazma durumu: 'saving' | 'saved' | 'error' */
    status: () => (pending ? 'saving' : failed ? 'error' : 'saved'),
    /** Depoda silinmemiş öğe kimlikleri */
    liveIds(type) { return states[type] ? [...states[type]].filter(([, v]) => !v.meta.deleted).map(([id]) => id) : []; },
    /** Öğenin depodaki sırası (bilinmiyorsa Infinity) */
    pos(type, id) { const s = states[type] && states[type].get(id); return s ? s.pos : Infinity; },
    listVersions, addVersion, deleteVersion, deleteVersionsOf,
    get mode() { return mode; },
  };
})();
