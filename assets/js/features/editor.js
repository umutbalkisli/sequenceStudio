/* Sequence Studio — düzenleme oturumu
 *
 * Kod ↔ model akışı (applyCode, commit), otomatik aktivasyonun yeniden hesaplanması ve geri al/yinele geçmişi.
 */
(function (Seq) {
  'use strict';
  const { M, S, T, el, toast } = Seq.core;

  // ---------------------------------------------------------------------------
  // Çekirdek: kod <-> model akışı
  // ---------------------------------------------------------------------------
  function applyCode(code, src) {
    S.code = code;
    if (src !== 'builder') {
      S.model = M.parse(code);
      Seq.flow.renderBuilder();
    }
    if (src !== 'code' && el.code.value !== code) el.code.value = code;
    Seq.code.updateEditorDecor();
    syncMeta();
    Seq.preview.scheduleRender();
    Seq.docs.scheduleSave();
    if (src !== 'history' && src !== 'load') scheduleHistory();
  }

  /** Builder modeli değiştirdikten sonra çağrılır. */
  function commit(opts) {
    opts = opts || {};
    if (isAutoAct()) M.inferActivations(S.model);
    applyCode(M.serialize(S.model), 'builder');
    if (opts.rerender !== false) Seq.flow.renderBuilder();
  }

  /** Belge için otomatik aktivasyon açık mı? (varsayılan: açık) */
  const isAutoAct = () => !!S.doc && S.doc.autoAct !== false;
  /** Otomatik moddaysa aktivasyonları yeniden hesaplar; kod değiştiyse uygular. */
  function refreshAutoAct(src) {
    if (!isAutoAct() || !M.inferActivations(S.model)) return false;
    applyCode(M.serialize(S.model), src || 'builder');
    Seq.flow.renderBuilder();
    return true;
  }

  function syncMeta() {
    el.autonum.checked = !!S.model.autonumber;
    el.autoAct.checked = isAutoAct();
    if (document.activeElement !== el.title && el.title.value !== (S.model.title || '')) el.title.value = S.model.title || '';
  }

  // ---------------------------------------------------------------------------
  // Geçmiş (undo / redo)
  // ---------------------------------------------------------------------------
  const H = S.hist;
  function scheduleHistory() { clearTimeout(H.timer); H.timer = setTimeout(flushHistory, 450); }
  function flushHistory() {
    clearTimeout(H.timer); H.timer = null;
    if (H.stack[H.i] === S.code) return;
    H.stack = H.stack.slice(0, H.i + 1);
    H.stack.push(S.code);
    if (H.stack.length > 300) H.stack.shift();
    H.i = H.stack.length - 1;
    updateUndoUi();
  }
  function resetHistory() { H.stack = [S.code]; H.i = 0; updateUndoUi(); }
  function undo() { flushHistory(); if (H.i <= 0) return; H.i--; applyCode(H.stack[H.i], 'history'); updateUndoUi(); }
  function redo() { flushHistory(); if (H.i >= H.stack.length - 1) return; H.i++; applyCode(H.stack[H.i], 'history'); updateUndoUi(); }
  function updateUndoUi() { el.undo.disabled = H.i <= 0; el.redo.disabled = H.i >= H.stack.length - 1; }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    // ---------------------------------------------------------------------------
    // Üst bar ve kontroller
    // ---------------------------------------------------------------------------
    el.undo.addEventListener('click', undo);
    el.redo.addEventListener('click', redo);
    el.autoAct.addEventListener('change', () => {
      if (!S.doc) return;
      S.doc.autoAct = el.autoAct.checked;
      Seq.docs.persistDocs();
      // Kapatılınca otomatik düzeltme satırları sıradan (elle düzenlenebilir) aktivasyonlara dönüşür
      if (!el.autoAct.checked) M.walk(S.model.items, (it) => { delete it.auto; });
      // Açılınca hesapla; kapatılınca mevcut işaretler kalır ve elle düzenlenebilir olur
      commit();
      flushHistory();
      toast(T(el.autoAct.checked ? 'act.autoOnToast' : 'act.autoOffToast'));
    });
    el.autonum.addEventListener('change', () => { S.model.autonumber = el.autonum.checked; if (!el.autonum.checked) S.model.autonumberArgs = ''; commit(); flushHistory(); });
    el.title.addEventListener('input', () => { S.model.title = el.title.value.trim(); commit({ rerender: false }); });
    el.title.addEventListener('blur', flushHistory);
  }

  Seq.editor = { init, applyCode, commit, flushHistory, isAutoAct, redo, refreshAutoAct, resetHistory, undo };
})(window.Seq = window.Seq || {});
