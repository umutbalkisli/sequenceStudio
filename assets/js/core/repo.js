/* Sequence Studio — depo (repository)
 *
 * Özelliklerin kalıcı veriye eriştiği tek kapı. Altta bir bağdaştırıcı (adapter) çalışır; yerel sürümde
 * IndexedDB bağdaştırıcısı (core/storage.js, window.SeqStorage). Bulut sürümü aynı sözleşmeyi uygulayan bir
 * sunucu bağdaştırıcısı ekler; özellik modülleri değişmez.
 *
 * Bağdaştırıcı sözleşmesi:
 *   init() → { mode, workspace, docs, folders, roles, catalog, migrated }
 *   save(type, list)            type: 'doc' | 'folder' | 'role' | 'catalog' — yalnızca değişen öğeler yazılır
 *   meta(type, id) → { rev, createdAt, createdBy, updatedAt, updatedBy, deleted? } | null
 *   deleted(type) → [id]        silme izi bırakmış öğeler;  liveIds(type);  pos(type, id) → depodaki sıra
 *   saveWorkspace(ws), listVersions(docId), addVersion(v, keepAuto), deleteVersion(vid, docId), deleteVersionsOf(docId)
 *   setActor(userId), onStatus(fn(state, err)), status(), onRemote(fn(type, records)), onStale(fn),
 *   flush(), estimate(), requestPersist(), mode
 *
 * Yazma birleştirme: aynı koleksiyona art arda gelen kayıtlar kısa bir süre (COALESCE_MS) bekletilip tek yazmada
 * birleştirilir (ör. ad alanında her tuş ayrı bir revizyon/istek olmasın). Sayfa gizlenirken/kapanırken bekleyenler
 * hemen yazılır.
 *
 * Yetki: düzenleme yetkisi yoksa içerik, yönetim yetkisi yoksa çalışma alanı kaydı yazılmaz.
 * Olaylar: "repo:status" { state: 'saving' | 'saved' | 'error', error? } — kayıt durumu;
 *          "repo:remote" { type, records } — başka sekmede (bulutta: başka kullanıcıda) yapılan değişiklik;
 *          "repo:stale" — veritabanı başka sekmede yükseltildi, sayfa yenilenmeli.
 */
(function (Seq) {
  'use strict';
  const { events } = Seq.core;
  const A = window.SeqStorage;
  const COALESCE_MS = 400;

  // --- Bekletilen yazmalar (koleksiyon başına son liste) ---
  const queued = new Map(); // type → { list, timer, waiters }
  let state = 'saved';
  function setState(s, error) {
    if (s === state && !error) return;
    state = s;
    events.emit('repo:status', { state: s, error });
  }
  // Bağdaştırıcı "kaydedildi" dese de bekleyen yazma varsa durum "kaydediliyor" kalır
  A.onStatus((s, error) => setState(s === 'saved' && queued.size ? 'saving' : s, error));
  const settle = () => { if (!queued.size) setState(A.status()); };

  function flushType(type) {
    const q = queued.get(type);
    if (!q) return Promise.resolve();
    queued.delete(type);
    clearTimeout(q.timer);
    return A.save(type, q.list).then(
      (v) => { q.waiters.forEach((w) => w.res(v)); settle(); },
      (e) => { q.waiters.forEach((w) => w.rej(e)); settle(); });
  }
  /** Bekleyen tüm yazmaları hemen başlatır */
  const flushQueued = () => Promise.all([...queued.keys()].map(flushType));
  function queue(type, list) {
    let q = queued.get(type);
    if (!q) { q = { waiters: [] }; queued.set(type, q); }
    q.list = list;
    clearTimeout(q.timer);
    q.timer = setTimeout(() => flushType(type), COALESCE_MS);
    setState('saving');
    return new Promise((res, rej) => q.waiters.push({ res, rej }));
  }
  window.addEventListener('pagehide', flushQueued);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushQueued(); });

  // --- Dışarıdan gelen değişiklikler ---
  A.onRemote((type, records) => events.emit('repo:remote', { type, records }));
  A.onStale(() => events.emit('repo:stale'));

  const can = (perm) => !Seq.workspace || Seq.workspace.can(perm);
  /** Yetki gerektiren yazma: yetki yoksa hiçbir şey yazılmaz */
  const write = (perm, fn) => (...a) => (can(perm) ? fn(...a) : Promise.resolve(false));

  /** Depoyu açar; yazan kullanıcıyı bağdaştırıcıya bildirir */
  function load() {
    A.setActor(Seq.user.id());
    return A.init();
  }

  Seq.repo = {
    load,
    saveDocs: write('edit', (list) => queue('doc', list)),
    saveFolders: write('edit', (list) => queue('folder', list)),
    saveRoles: write('edit', (list) => queue('role', list)),
    saveCatalog: write('edit', (list) => queue('catalog', list)),
    saveWorkspace: write('admin', (ws) => A.saveWorkspace(ws)),
    meta: (type, id) => A.meta(type, id),
    /** Silinmiş öğeler: depodaki silme izleri ve bekletilen yazmada listeden çıkmış olanlar */
    deleted(type) {
      const q = queued.get(type);
      if (!q) return A.deleted(type);
      const keep = new Set((q.list || []).map((x) => x.id));
      return A.deleted(type).concat(A.liveIds(type).filter((id) => !keep.has(id)));
    },
    pos: (type, id) => A.pos(type, id),
    /** Koleksiyonda henüz yazılmamış (bekletilen) değişiklik var mı */
    pending: (type) => queued.has(type),
    versions: {
      list: (docId) => flushQueued().then(() => A.listVersions(docId)),
      add: write('edit', (v, keepAuto) => A.addVersion(Object.assign({ by: Seq.user.id() }, v), keepAuto)),
      remove: write('edit', (vid, docId) => A.deleteVersion(vid, docId)),
      removeAllOf: write('edit', (docId) => A.deleteVersionsOf(docId)),
    },
    /** Bekleyen tüm yazmalar bitince çözülür */
    flush: () => flushQueued().then(() => A.flush()),
    estimate: () => A.estimate(),
    requestPersist: () => A.requestPersist(),
    /** Son kayıt durumu: 'saving' | 'saved' | 'error' */
    status: () => state,
    get mode() { return A.mode; },
  };
})(window.Seq = window.Seq || {});
