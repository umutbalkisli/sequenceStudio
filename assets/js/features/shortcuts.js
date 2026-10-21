/* Sequence Studio — klavye kısayolları
 *
 * Genel kısayollar tek bir tabloda tanımlıdır; yeni kısayol eklemek için tabloya satır eklemek
 * (ya da başka bir modülden Seq.shortcuts.add çağırmak) yeterlidir. İlk eşleşen satır çalışır.
 *
 * Satır alanları:
 *   keys     — e.key değerleri (küçük harfle karşılaştırılır)
 *   mod      — true: ⌘ (Mac) / Ctrl gerekli, false: basılı olmamalı, yok: önemsiz. alt ve shift de aynı.
 *   typing   — false: bir metin alanına yazarken çalışmaz
 *   when()   — ek koşul; false dönerse satır atlanır
 *   run(e)   — işlem
 *   keepDefault — true ise tarayıcının varsayılan davranışı engellenmez
 *   global   — true ise her ekranda çalışır (diğerleri yalnızca akış düzenleyicide)
 */
(function (Seq) {
  'use strict';
  const { M, S, T, closeModal, el, isMac, toast } = Seq.core;

  const modalOpen = () => !el.modalRoot.hidden;
  /** Akış düzenleyicide seçili bir adım üzerinde çalışılıyor mu */
  const editingStep = () => Seq.layout.currentView() === 'builder' && !S.settings.editorCollapsed && !!S.selected && !modalOpen();

  /** Escape: en üstteki katmanı kapatır (pencere → tam ekran → açılır panel → odak/seçim) */
  function escape(e, typing) {
    if (modalOpen()) return closeModal();
    if (Seq.layout.panePreview.classList.contains('pseudo-fullscreen')) return Seq.layout.toggleFullscreen();
    if (!el.popover.hidden) return Seq.participants.closePopover();
    if (typing) e.target.blur();
    else Seq.flow.setSelected(null);
  }

  const table = [
    { keys: ['escape'], keepDefault: true, global: true, run: escape },
    { keys: ['z'], mod: true, alt: false, shift: false, run: () => Seq.editor.undo() },
    { keys: ['z'], mod: true, alt: false, shift: true, run: () => Seq.editor.redo() },
    { keys: ['y'], mod: true, alt: false, run: () => Seq.editor.redo() },
    { keys: ['s'], mod: true, alt: false, run: () => { Seq.editor.flushHistory(); Seq.docs.doSave(); toast(T('saved.toast')); } },
    { keys: ['e'], mod: true, alt: false, run: () => Seq.export.openExport() },
    { keys: ['k'], mod: true, alt: false, global: true, run: () => (Seq.search.isOpen() ? Seq.search.closeSearch() : Seq.search.openSearch()) },
    { keys: ['1'], mod: true, alt: false, run: () => Seq.layout.setView('builder') },
    { keys: ['2'], mod: true, alt: false, run: () => Seq.layout.setView('code') },
    { keys: ['b'], mod: true, alt: false, run: () => Seq.layout.setEditorCollapsed(!S.settings.editorCollapsed) },
    { keys: ['d'], mod: true, alt: false, when: () => Seq.layout.currentView() === 'builder' && !!S.selected, run: () => Seq.flow.duplicateNode(S.selected) },
    { keys: ['f'], mod: false, alt: false, typing: false, when: () => !modalOpen(), run: () => Seq.layout.toggleFullscreen() },
    { keys: ['p'], mod: false, alt: false, typing: false, when: () => !modalOpen(), run: () => Seq.present.open() },
    { keys: ['arrowup', 'arrowdown'], alt: true, when: editingStep, run: (e) => Seq.flow.moveNodeBy(S.selected, e.key === 'ArrowUp' ? -1 : 1) },
    {
      keys: ['delete', 'backspace'], typing: false,
      when: () => { if (!editingStep()) return false; const f = M.findNode(S.model, S.selected); return !!(f && f.node); },
      run: () => Seq.flow.deleteNode(S.selected),
    },
  ];

  /** Başka bir modülden kısayol ekler (tablodaki satırlarla aynı biçim). */
  function add(shortcut) { table.push(shortcut); }

  const flagOk = (want, has) => want === undefined || want === has;
  function matches(s, e, mod, typing) {
    return s.keys.includes(e.key.toLowerCase())
      && flagOk(s.mod, mod) && flagOk(s.alt, e.altKey) && flagOk(s.shift, e.shiftKey)
      && (s.global || document.body.classList.contains('screen-editor'))
      && (s.typing !== false || !typing)
      && (!s.when || s.when());
  }

  function onKeydown(e) {
    if (!e.key) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || !!e.target.isContentEditable;
    const s = table.find((x) => matches(x, e, mod, typing));
    if (!s) return;
    if (!s.keepDefault) e.preventDefault();
    s.run(e, typing);
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    document.addEventListener('keydown', onKeydown);
  }

  Seq.shortcuts = { init, add };
})(window.Seq = window.Seq || {});
