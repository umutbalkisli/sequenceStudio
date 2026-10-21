/* Sequence Studio — diyagramlar
 *
 * Diyagram oluşturma/açma/silme, kalıcı kayıt (Seq.repo) ve kapanışta veri kaybını önleyen acil kayıt.
 */
(function (Seq) {
  'use strict';
  const { LS, M, S, T, debounce, el, events, store, toast, tplL } = Seq.core;

  // ---------------------------------------------------------------------------
  // Belgeler
  // ---------------------------------------------------------------------------
  const newDocId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // Depolama hatası bildirimi (art arda gelen hatalarda tek bildirim)
  let lastStorageErr = 0;
  function storageError(err) {
    console.error('[storage]', err);
    if (Date.now() - lastStorageErr < 5000) return;
    lastStorageErr = Date.now();
    const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message || err)));
    toast(T(quota ? 'storage.full' : 'storage.error'), 'err');
  }
  /** Diyagram ve klasörleri kaydeder (IndexedDB'de yalnızca değişenler yazılır). */
  function persistDocs() {
    Seq.repo.saveDocs(S.docs).catch(storageError);
    Seq.repo.saveFolders(S.folders).catch(storageError);
    store.set(LS.cur, S.doc && S.doc.id);
    events.emit('docs:persisted');
  }
  /**
   * IndexedDB yazmaları asenkron olduğundan sayfa kapanırken son değişiklik yetişmeyebilir: açık diyagram
   * senkron olarak localStorage'a da yazılır; sonraki açılışta kayıtlı sürümden yeniyse uygulanır.
   */
  const RESCUE_KEY = 'seqstudio.rescue';
  function writeRescue() {
    if (!S.doc) return;
    // Kod editörü modele gecikmeli aktarılır: kapanırken editördeki son metni al
    if (el.code.value !== S.code) Seq.editor.applyCode(el.code.value, 'code');
    if (S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
    store.set(RESCUE_KEY, S.doc);
    persistDocs();
    events.emit('doc:leaving', { doc: S.doc });
  }
  function applyRescue() {
    const r = store.get(RESCUE_KEY, null);
    if (!r || !r.id) return;
    const d = S.docs.find((x) => x.id === r.id);
    if (!d) S.docs.unshift(r);
    // Kayıtlı hâlden eski değilse ve farklıysa uygula (içerik dışı değişiklikler de — ör. yoksayılan roller — zamanı değiştirmez)
    else if ((r.updated || 0) >= (d.updated || 0) && JSON.stringify(r) !== JSON.stringify(d)) Object.assign(d, r);
    else { localStorage.removeItem(RESCUE_KEY); return; }
    Seq.repo.saveDocs(S.docs).then(() => localStorage.removeItem(RESCUE_KEY)).catch(storageError);
  }
  // Kayıt göstergesi: düzenleme beklerken ve depo yazarken "Kaydediliyor…", yazma bitince "Kaydedildi", hata olursa uyarı.
  // Depo durumu "repo:status" olayıyla gelir (bulut sürümünde senkronizasyon durumu da aynı yoldan gösterilir).
  let editPending = false;
  function showSaveState(state) {
    el.saveState.classList.toggle('dirty', state === 'saving');
    el.saveState.classList.toggle('error', state === 'error');
    el.saveState.lastChild.textContent = T(state === 'saving' ? 'tb.saving' : state === 'error' ? 'tb.saveError' : 'tb.saved');
  }
  const doSave = debounce(() => {
    editPending = false;
    if (!S.doc) return;
    if (S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
    persistDocs();
    events.emit('doc:saved', { doc: S.doc });
    if (Seq.repo.status() !== 'saving') showSaveState(Seq.repo.status());
  }, 500);
  function scheduleSave() {
    editPending = true;
    showSaveState('saving');
    doSave();
  }

  function createDoc(name, code, open, folder) {
    // Salt okunur çalışma alanında yeni akış oluşturulmaz (boş çalışma alanında açılış için geçici akış hariç)
    if (S.docs.length && !Seq.workspace.editable()) return null;
    // Kodda elle girilmiş aktivasyon işaretleri varsa onlara dokunma
    const d = { id: newDocId(), name: uniqueDocName(name), code, updated: Date.now(), autoAct: !M.hasManualActivation(M.parse(code)) };
    if (folder) d.folder = folder;
    S.docs.unshift(d);
    persistDocs();
    if (open !== false) openDoc(d.id);
    events.emit('doc:created', { doc: d, open });
    return d;
  }
  function uniqueDocName(name) {
    name = (name || T('doc.untitled')).trim();
    let n = name, k = 2;
    while (S.docs.some((d) => d.name === n)) n = name + ' (' + k++ + ')';
    return n;
  }
  function openDoc(id) {
    if (S.doc && S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
    if (S.doc) events.emit('doc:leaving', { doc: S.doc });
    const d = S.docs.find((x) => x.id === id) || S.docs[0];
    S.doc = d;
    S.selected = null;
    S.collapsed.clear();
    el.docName.value = d.name;
    S.zoom.auto = true;
    if (d.autoAct === undefined) d.autoAct = !M.hasManualActivation(M.parse(d.code));
    // Tembel yayılım: katalog/rol/akış adı değişiklikleri akış açılırken uygulanır (salt okunurda yalnızca bellekte)
    const code = Seq.reconcile.docCode(d);
    if (code !== d.code && Seq.workspace.can('edit')) d.code = code;
    Seq.editor.applyCode(code, 'load');
    Seq.editor.refreshAutoAct('load');
    Seq.editor.resetHistory();
    persistDocs();
    events.emit('doc:opened', { doc: d });
  }
  /** Diyagramı siler. opts.confirmed: onay sorulmaz (toplu silmede onay bir kez alınır) */
  function deleteDoc(id, opts) {
    const d = S.docs.find((x) => x.id === id);
    if (!d || !Seq.workspace.editable() || (!(opts && opts.confirmed) && !confirm(T('doc.confirmDelete', { name: d.name })))) return;
    S.docs = S.docs.filter((x) => x.id !== id);
    if (!S.docs.length) createDoc(T('doc.untitled'), tplL(window.SeqTemplates[0]).code, false);
    if (S.doc.id === id) { S.doc = null; openDoc(S.docs[0].id); }
    persistDocs();
    events.emit('doc:deleted', { id });
  }

  let nameBefore = null;

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    events.on('repo:status', ({ state }) => { if (!editPending) showSaveState(state); });
    el.docName.addEventListener('input', () => {
      if (!S.doc) return;
      S.doc.name = el.docName.value.trim() || T('doc.untitled');
      S.doc.updated = Date.now();
      persistDocs();
    });
    el.docName.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.docName.blur(); });
    el.docName.addEventListener('focus', () => { nameBefore = S.doc && S.doc.name; });
    el.docName.addEventListener('change', () => {
      if (S.doc && nameBefore !== S.doc.name) events.emit('doc:renamed', { id: S.doc.id, from: nameBefore, to: S.doc.name });
      nameBefore = S.doc && S.doc.name;
    });
    window.addEventListener('beforeunload', writeRescue);
    window.addEventListener('pagehide', writeRescue);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeRescue(); });
  }

  Seq.docs = { init, applyRescue, createDoc, deleteDoc, doSave, newDocId, openDoc, persistDocs, scheduleSave, storageError, uniqueDocName };
})(window.Seq = window.Seq || {});
