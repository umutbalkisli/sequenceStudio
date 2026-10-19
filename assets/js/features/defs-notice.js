/* Sequence Studio — tanımsız rol ve katalog öğesi bilgi çubuğu
 *
 * Dışarıdan gelen bir diyagram (link, dosya, yedek) bu tarayıcıda olmayan roller ya da katalog öğeleri
 * kullanıyorsa editörün üstünde tek bir bilgi çubuğu gösterir: "Ekle" kütüphaneye/kataloğa alır,
 * "Yoksay" o diyagram için bir daha sormaz.
 */
(function (Seq) {
  'use strict';
  const { $, S, T, add, events, h, ico, oneLine, toast } = Seq.core;

  function check() {
    const box = $('#notice');
    if (!box) return;
    if (!S.doc) { box.hidden = true; return; }
    const roles = Seq.roles.unknownRoles(S.model, S.doc);
    const items = Seq.catalog.unknownItems(S.model, S.doc);
    if (!roles.length && !items.length) { box.hidden = true; return; }
    const roleOf = (id) => Seq.roles.roleById(id) || roles.find((r) => r.id === id);
    const chip = (name, r) => h('span', { class: 'rp-chip', style: r ? `--c:${r.color}` : null }, ico('t-' + (r ? r.type : 'participant')), name);
    const parts = [];
    if (items.length) parts.push(T('defs.items', { n: items.length }));
    if (roles.length) parts.push(T('defs.roles', { n: roles.length }));
    box.innerHTML = '';
    add(box,
      ico('help'),
      h('div', { class: 'nt-text' },
        h('b', null, T('defs.unknown', { what: parts.join(T('defs.and')) })),
        h('span', { class: 'nt-chips' },
          items.map((x) => chip(oneLine(Seq.roles.composeLabel(roleOf(x.role), x.name)), roleOf(x.role))),
          roles.map((r) => chip(r.name, r)))),
      h('div', { class: 'nt-actions' },
        h('button', { class: 'btn primary sm', onclick: () => {
          Seq.roles.adoptRoles(roles);
          Seq.catalog.adoptItems(items);
          // Tanımlar artık kütüphanede: koddaki "@roledef/@itemdef" satırlarına gerek yok
          let strip = false;
          [['roleDefs', roles], ['itemDefs', items]].forEach(([key, defs]) => {
            if (!S.model[key]) return;
            defs.forEach((d) => { if (S.model[key][d.id]) { delete S.model[key][d.id]; strip = true; } });
            if (!Object.keys(S.model[key]).length) delete S.model[key];
          });
          if (strip) { Seq.editor.commit(); Seq.editor.flushHistory(); } else Seq.flow.renderBuilder();
          box.hidden = true;
          toast(T('defs.added', { n: roles.length + items.length }));
        } }, ico('plus'), T('defs.addBtn')),
        h('button', { class: 'btn ghost sm', onclick: () => {
          S.doc.ignoredRoles = (S.doc.ignoredRoles || []).concat(roles.map((r) => r.id));
          S.doc.ignoredItems = (S.doc.ignoredItems || []).concat(items.map((x) => x.id));
          Seq.docs.persistDocs();
          box.hidden = true;
        } }, T('roles.ignore'))));
    box.hidden = false;
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    events.on('doc:opened', check);
  }

  Seq.defsNotice = { init, check };
})(window.Seq = window.Seq || {});
