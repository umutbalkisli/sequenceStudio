/* Sequence Studio — katalog ve roller penceresi
 *
 * Katalog (kimdir) ve roller (nasıl görünür) tek pencerede, iki sekmede düzenlenir. Sekmelerin içeriğini
 * kendi modülleri üretir (Seq.catalog.buildPanel, Seq.roles.buildPanel).
 */
(function (Seq) {
  'use strict';
  const { T, h, ico, openModal } = Seq.core;

  const TABS = [
    { id: 'catalog', icon: 'layers', label: 'lib.catalog', build: () => Seq.catalog.buildPanel() },
    { id: 'roles', icon: 'shapes', label: 'lib.roles', build: () => Seq.roles.buildPanel() },
  ];

  /** Pencereyi açar. tab: 'catalog' | 'roles' */
  function open(tab) {
    let current = TABS.find((t) => t.id === tab) || TABS[0];
    const content = h('div', { class: 'lib-content' });
    const seg = h('div', { class: 'seg lib-tabs', role: 'tablist' });
    const draw = () => {
      seg.innerHTML = '';
      TABS.forEach((t) => seg.append(h('button', {
        class: t === current ? 'active' : '', role: 'tab', 'aria-selected': String(t === current), 'data-tab': t.id,
        onclick: () => { if (t !== current) { current = t; draw(); } },
      }, ico(t.icon), T(t.label))));
      content.innerHTML = '';
      content.append(current.build());
    };
    draw();
    openModal(T('lib.title'), h('div', { class: 'library' }, seg, content), true);
  }

  Seq.library = { open };
})(window.Seq = window.Seq || {});
