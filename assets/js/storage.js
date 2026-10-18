/* Sequence Studio — kalıcı depolama (IndexedDB)
 *
 * Diyagramlar IndexedDB'de diyagram başına ayrı kayıt olarak tutulur; her kayıtta yalnızca değişen
 * diyagramlar yazılır (localStorage'daki ~5 MB sınırı ve "her seferinde tüm listeyi yaz" maliyeti kalkar).
 * Klasörler ve roller aynı veritabanında anahtar-değer kaydı olarak durur. Ayarlar ve son açık diyagram
 * küçük ve açılışta senkron gerektiğinden localStorage'da kalır (app.js).
 *
 * İlk açılışta eski localStorage verisi IndexedDB'ye taşınır, geri okunarak doğrulanır ve eski veri
 * silinmez, "seqstudio.legacy.*" adıyla güvenlik kopyası olarak saklanır.
 * IndexedDB açılamazsa (bazı gizli pencereler, eski tarayıcılar) localStorage ile çalışmaya devam edilir.
 */
(function () {
  'use strict';

  const DB_NAME = 'sequence-studio';
  const DB_VERSION = 1;
  const LS = { docs: 'seqstudio.docs', folders: 'seqstudio.folders', roles: 'seqstudio.roles', migrated: 'seqstudio.storage' };
  const LEGACY = (k) => k.replace('seqstudio.', 'seqstudio.legacy.');

  const lsGet = (k, def) => { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('aborted')); });

  function openDb() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('IndexedDB unavailable'));
      let r;
      try { r = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { return rej(e); }
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IndexedDB blocked'));
    });
  }

  let db = null;
  let mode = 'local';
  // Son yazılan hâller: yalnızca değişenleri yazmak için (id → JSON)
  const docCache = new Map();
  const kvCache = new Map();
  // Yazmalar sırayla yapılır; hata olursa sonraki yazmalar yine denenir
  let chain = Promise.resolve();
  const enqueue = (fn) => (chain = chain.then(fn, fn));

  async function readAllIdb() {
    const tx = db.transaction(['docs', 'kv'], 'readonly');
    const [docs, folders, roles, migrated] = await Promise.all([
      req(tx.objectStore('docs').getAll()),
      req(tx.objectStore('kv').get('folders')),
      req(tx.objectStore('kv').get('roles')),
      req(tx.objectStore('kv').get('migrated')),
    ]);
    return { docs: docs || [], folders: folders || [], roles: roles == null ? null : roles, migrated: !!migrated };
  }

  /** Eski localStorage verisini IndexedDB'ye taşır; geri okuyarak doğrular. */
  async function migrateFromLocal() {
    const docs = lsGet(LS.docs, null);
    const folders = lsGet(LS.folders, []);
    const roles = lsGet(LS.roles, null);
    const tx = db.transaction(['docs', 'kv'], 'readwrite');
    if (Array.isArray(docs)) docs.forEach((d) => d && d.id && tx.objectStore('docs').put(d));
    tx.objectStore('kv').put(folders || [], 'folders');
    if (roles) tx.objectStore('kv').put(roles, 'roles');
    tx.objectStore('kv').put(Date.now(), 'migrated');
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
   * Depolamayı açar ve tüm veriyi döner: { mode, docs, folders, roles, migrated }.
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
      data.docs.forEach((d) => docCache.set(d.id, JSON.stringify(d)));
      kvCache.set('folders', JSON.stringify(data.folders));
      if (data.roles) kvCache.set('roles', JSON.stringify(data.roles));
      data.docs.sort((a, b) => (b.updated || 0) - (a.updated || 0));
      return { mode, docs: data.docs, folders: data.folders, roles: data.roles, migrated };
    } catch (err) {
      // Yedek yol: localStorage
      console.warn('[storage] IndexedDB kullanılamıyor, localStorage ile devam ediliyor:', err);
      db = null;
      mode = 'local';
      const docs = lsGet(LS.docs, null) || lsGet(LEGACY(LS.docs), []);
      return { mode, docs, folders: lsGet(LS.folders, null) || lsGet(LEGACY(LS.folders), []), roles: lsGet(LS.roles, null) || lsGet(LEGACY(LS.roles), null), migrated: null, error: String(err && err.message || err) };
    }
  }

  /** Diyagram listesini kaydeder: yalnızca değişen/eklenen diyagramlar yazılır, silinenler kaldırılır. */
  function saveDocs(docs) {
    if (mode !== 'idb') return Promise.resolve(lsSet(LS.docs, docs) ? true : Promise.reject(new Error('quota')));
    const puts = [], seen = new Set();
    docs.forEach((d) => {
      seen.add(d.id);
      const j = JSON.stringify(d);
      if (docCache.get(d.id) !== j) puts.push([d, j]);
    });
    const dels = Array.from(docCache.keys()).filter((id) => !seen.has(id));
    if (!puts.length && !dels.length) return chain;
    // Önbellek hemen güncellenir: aynı değişiklik ikinci kez kuyruğa girmesin
    puts.forEach(([d, j]) => docCache.set(d.id, j));
    dels.forEach((id) => docCache.delete(id));
    const copies = puts.map(([, j]) => JSON.parse(j));
    return enqueue(async () => {
      const tx = db.transaction('docs', 'readwrite');
      const st = tx.objectStore('docs');
      copies.forEach((d) => st.put(d));
      dels.forEach((id) => st.delete(id));
      try { await done(tx); } catch (e) {
        // Başarısız yazmalar bir sonraki kayıtta tekrar denensin
        copies.forEach((d) => docCache.delete(d.id));
        throw e;
      }
    });
  }

  /** Klasörler, roller gibi küçük kayıtlar (değişmediyse yazılmaz). */
  function saveKV(key, value) {
    if (mode !== 'idb') return Promise.resolve(lsSet(LS[key] || ('seqstudio.' + key), value));
    const j = JSON.stringify(value);
    if (kvCache.get(key) === j) return chain;
    kvCache.set(key, j);
    return enqueue(async () => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(JSON.parse(j), key);
      try { await done(tx); } catch (e) { kvCache.delete(key); throw e; }
    });
  }

  /** Bekleyen tüm yazmaların bitmesini bekler. */
  const flush = () => chain;

  /** Kaydedilen verinin yaklaşık boyutu (bayt, UTF-8 varsayımıyla JSON uzunluğu) */
  function dataSize() {
    if (mode !== 'idb') {
      let n = 0;
      ['docs', 'folders', 'roles'].forEach((k) => { const v = localStorage.getItem(LS[k]); if (v) n += v.length; });
      return n;
    }
    let n = 0;
    docCache.forEach((j) => { n += j.length; });
    kvCache.forEach((j) => { n += j.length; });
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

  window.SeqStorage = { init, saveDocs, saveKV, flush, estimate, requestPersist, get mode() { return mode; } };
})();
