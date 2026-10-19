/* Sequence Studio — yerleşim
 *
 * Görsel/Kod görünümü, panel boyutlandırma, tam ekran, editörü gizleme ve katılımcıları üste sabitleme.
 */
(function (Seq) {
  'use strict';
  const { $, $$, S, T, clamp, el, icon, saveSettings } = Seq.core;

  // ---------------------------------------------------------------------------
  // Görünüm sekmeleri
  // ---------------------------------------------------------------------------
  const currentView = () => S.settings.view;
  function setView(v) {
    if (v !== 'builder' && v !== 'code') v = 'builder';
    // Koddan builder'a geçerken bekleyen değişiklikleri uygula
    if (v === 'builder' && el.code.value !== S.code) Seq.editor.applyCode(el.code.value, 'code');
    if (v === 'builder') Seq.editor.refreshAutoAct();
    S.settings.view = v;
    saveSettings();
    $$('button', el.viewSeg).forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    el.viewBuilder.classList.toggle('active', v === 'builder');
    el.viewCode.classList.toggle('active', v === 'code');
    document.body.classList.toggle('view-code', v === 'code');
    $('#builderMeta').style.visibility = v === 'builder' ? 'visible' : 'hidden';
    if (v === 'code') {
      Seq.code.updateEditorDecor();
      // Gecikmeli odak: arada başka bir alan (ör. ⌘K arama) odaklandıysa odağı çalma
      setTimeout(() => { const a = document.activeElement; if (!a || a === document.body || a.closest('#viewSeg')) el.code.focus({ preventScroll: true }); }, 0);
    }
  }

  // Katılımcılar bölümü: varsayılan olarak üstte sabit
  const partSection = $('#partSection');
  const btnPin = $('#btnPinParts');
  function applyPin() {
    const on = S.settings.pinParts !== false;
    partSection.classList.toggle('pinned', on);
    btnPin.classList.toggle('on', on);
    btnPin.setAttribute('aria-pressed', String(on));
    btnPin.title = T(on ? 'pin.off' : 'pin.on');
    updateStuck();
  }
  // Gölge yalnızca bölüm gerçekten üste yapıştığında
  function updateStuck() {
    const on = partSection.classList.contains('pinned');
    partSection.classList.toggle('stuck', on && partSection.getBoundingClientRect().top <= el.bscroll.getBoundingClientRect().top + 1 && el.bscroll.scrollTop > 0);
  }

  // --- Önizleme tam ekran ---
  const panePreview = $('#panePreview');
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isFullscreen = () => fsElement() === panePreview || panePreview.classList.contains('pseudo-fullscreen');
  function updateFullscreenUi() {
    const on = isFullscreen();
    const b = $('#btnFullscreen');
    b.innerHTML = icon(on ? 'minimize' : 'maximize');
    b.dataset.i18nTitle = on ? 'fs.exit' : 'fs.enter';
    b.title = T(b.dataset.i18nTitle);
    S.zoom.auto = true;
    requestAnimationFrame(Seq.preview.fitView);
  }
  function toggleFullscreen() {
    if (isFullscreen()) {
      if (panePreview.classList.contains('pseudo-fullscreen')) { panePreview.classList.remove('pseudo-fullscreen'); updateFullscreenUi(); }
      else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    Seq.participants.closePopover();
    const req = panePreview.requestFullscreen || panePreview.webkitRequestFullscreen;
    const fallback = () => { panePreview.classList.add('pseudo-fullscreen'); updateFullscreenUi(); };
    if (!req) return fallback();
    try {
      const p = req.call(panePreview);
      if (p && p.catch) p.catch(fallback);
    } catch (e) { fallback(); }
  }

  /** Sol editör panelini gizler / gösterir; çizim yeni alana sığdırılır. */
  function setEditorCollapsed(collapsed) {
    S.settings.editorCollapsed = !!collapsed;
    saveSettings();
    $('#workspace').classList.toggle('editor-collapsed', !!collapsed);
    document.body.classList.toggle('editor-hidden', !!collapsed);
    if (collapsed) Seq.participants.closePopover();
    S.zoom.auto = true;
    requestAnimationFrame(Seq.preview.fitView);
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    el.viewSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });
    // ---------------------------------------------------------------------------
    // Panel boyutlandırma
    // ---------------------------------------------------------------------------
    (function setupResizer() {
      const rz = $('#resizer');
      const pane = $('#paneEditor');
      if (S.settings.editorW) pane.style.width = S.settings.editorW + 'px';
      rz.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        rz.setPointerCapture(e.pointerId);
        rz.classList.add('dragging');
        const x0 = e.clientX, w0 = pane.offsetWidth;
        const move = (ev) => {
          const w = clamp(w0 + ev.clientX - x0, 380, window.innerWidth - 360);
          pane.style.width = w + 'px';
        };
        const up = () => {
          rz.removeEventListener('pointermove', move);
          rz.classList.remove('dragging');
          S.settings.editorW = pane.offsetWidth;
          saveSettings();
          if (S.zoom.auto) Seq.preview.fitView();
        };
        rz.addEventListener('pointermove', move);
        rz.addEventListener('pointerup', up, { once: true });
      });
      rz.addEventListener('dblclick', () => { pane.style.width = ''; S.settings.editorW = null; saveSettings(); });
    })();
    el.bscroll.addEventListener('scroll', updateStuck, { passive: true });
    btnPin.addEventListener('click', () => { S.settings.pinParts = !(S.settings.pinParts !== false); saveSettings(); applyPin(); });
    applyPin();
    $('#btnFullscreen').addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', updateFullscreenUi);
    document.addEventListener('webkitfullscreenchange', updateFullscreenUi);
    $('#btnCollapse').addEventListener('click', () => setEditorCollapsed(true));
    $('#btnExpand').addEventListener('click', () => setEditorCollapsed(false));
  }

  Seq.layout = { init, applyPin, currentView, panePreview, setEditorCollapsed, setView, toggleFullscreen };
})(window.Seq = window.Seq || {});
