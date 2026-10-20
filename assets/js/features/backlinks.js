/* Sequence Studio — geri bağlantılar
 *
 * Açık diyagrama referans veren diyagramlar. Yalnızca böyle diyagram varsa üst barda diyagram adının
 * yanında küçük bir rozet görünür; tıklayınca liste açılır. Listeden açılan diyagramda buraya bağlanan
 * not seçilir ve önizlemedeki geri düğmesiyle dönülebilir.
 */
(function (Seq) {
  'use strict';
  const { $, I18N, M, S, T, docCode, dropdown, events, h, ico } = Seq.core;

  /** Kimlikler [A-Za-z0-9_-] olduğundan düzenli ifadeye doğrudan girer */
  const refLine = (id) => new RegExp('^\\s*%%\\s*@ref\\s+' + id + '(\\s+expand)?\\s*$', 'gm');

  /** id'li diyagrama bağlanan diyagramlar: [{ doc, count }] ada göre sıralı */
  function backlinksOf(id) {
    const re = refLine(id);
    return S.docs
      .filter((d) => d.id !== id)
      .map((d) => ({ doc: d, count: (docCode(d).match(re) || []).length }))
      .filter((x) => x.count)
      .sort((a, b) => a.doc.name.localeCompare(b.doc.name, I18N.getLang()));
  }

  let list = [];
  let panel = null;
  const btn = () => $('#btnBacklinks');

  function update() {
    list = S.doc ? backlinksOf(S.doc.id) : [];
    const b = btn();
    b.hidden = !list.length;
    b.lastChild.textContent = list.length;
    b.title = T('bl.title', { n: list.length });
    if (panel) { if (list.length) panel.refresh(); else panel.close(); }
  }

  function render(box) {
    box.append(h('div', { class: 'dd-head' },
      h('b', null, T('bl.head')),
      h('span', { class: 'dd-sum' }, T('bl.count', { n: list.length })),
      h('button', { class: 'icon-btn sm', title: T('common.close'), onclick: () => panel.close() }, ico('x'))));
    box.append(h('ul', null, list.map(({ doc, count }) => h('li', null,
      h('button', { class: 'dd-item bl-item', onclick: () => openFrom(doc.id) }, ico('link'),
        h('span', { class: 'bl-text' },
          h('b', null, doc.name),
          h('small', null, [Seq.search.folderPath(doc.folder) || T('folder.root'), count > 1 ? T('bl.refs', { n: count }) : null].filter(Boolean).join(' · '))))))));
  }
  function toggle() {
    if (panel) return panel.close();
    panel = dropdown(btn(), render, { label: T('bl.head'), onClose: () => { panel = null; } });
  }

  /** Bağlanan diyagramı açar (geri dönülebilir) ve oradaki, buraya bağlanan notu gösterir */
  function openFrom(id) {
    const here = S.doc && S.doc.id;
    if (panel) panel.close();
    Seq.refs.followRef(id);
    let note = null;
    M.walk(S.model.items, (it) => { if (!note && it.kind === 'note' && it.ref === here) note = it; });
    if (!note) return;
    if (Seq.layout.currentView() === 'code') Seq.code.selectCodeLine(note.line);
    else Seq.flow.reveal(note.uid);
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    btn().addEventListener('click', toggle);
    ['doc:opened', 'doc:deleted', 'docs:persisted'].forEach((e) => events.on(e, update));
  }

  Seq.backlinks = { init, backlinksOf, update };
})(window.Seq = window.Seq || {});
