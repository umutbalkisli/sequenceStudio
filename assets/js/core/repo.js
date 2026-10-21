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
 *   deleted(type) → [id]        silme izi bırakmış öğeler
 *   saveWorkspace(ws), listVersions(docId), addVersion(v, keepAuto), deleteVersion(vid, docId), deleteVersionsOf(docId)
 *   setActor(userId), onStatus(fn(state, err)), flush(), estimate(), requestPersist(), mode
 *
 * Yetki: çalışma alanında düzenleme yetkisi yoksa (salt okunur) yazmalar yapılmaz.
 * Kayıt durumu "repo:status" olayıyla yayılır: { state: 'saving' | 'saved' | 'error', error? }.
 */
(function (Seq) {
  'use strict';
  const { events } = Seq.core;
  const A = window.SeqStorage;

  let state = 'saved';
  A.onStatus((s, error) => { state = s; events.emit('repo:status', { state: s, error }); });

  const writable = () => !Seq.workspace || Seq.workspace.can('edit');
  /** Yazma işlemi: salt okunur çalışma alanında hiçbir şey yazılmaz */
  const write = (fn) => (...a) => (writable() ? fn(...a) : Promise.resolve(false));

  /** Depoyu açar; yazan kullanıcıyı bağdaştırıcıya bildirir */
  function load() {
    A.setActor(Seq.user.id());
    return A.init();
  }

  Seq.repo = {
    load,
    saveDocs: write((list) => A.save('doc', list)),
    saveFolders: write((list) => A.save('folder', list)),
    saveRoles: write((list) => A.save('role', list)),
    saveCatalog: write((list) => A.save('catalog', list)),
    saveWorkspace: write((ws) => A.saveWorkspace(ws)),
    meta: (type, id) => A.meta(type, id),
    deleted: (type) => A.deleted(type),
    versions: {
      list: (docId) => A.listVersions(docId),
      add: write((v, keepAuto) => A.addVersion(Object.assign({ by: Seq.user.id() }, v), keepAuto)),
      remove: write((vid, docId) => A.deleteVersion(vid, docId)),
      removeAllOf: write((docId) => A.deleteVersionsOf(docId)),
    },
    flush: () => A.flush(),
    estimate: () => A.estimate(),
    requestPersist: () => A.requestPersist(),
    /** Son kayıt durumu: 'saving' | 'saved' | 'error' */
    status: () => state,
    get mode() { return A.mode; },
  };
})(window.Seq = window.Seq || {});
