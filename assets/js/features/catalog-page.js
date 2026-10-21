/* Sequence Studio — katalog sayfası
 *
 * "#/catalog" (genel bakış), "#/catalog/<id>" (öğe ayrıntısı), "#/catalog?match=1" (eşleşenleri bağla).
 * Solda aranabilir, türe göre süzülebilen, açılıp kapanan ve sürükleyerek düzenlenen ağaç; sağda seçili öğenin
 * formu, kullanıldığı akışlar, gelen/giden ilişkileri ve alt öğeleri. Veri işlemleri Seq.catalog'dadır.
 */
(function (Seq) {
  'use strict';
  const { $, I18N, M, S, T, debounce, docCode, h, ico, norm, oneLine, saveSettings, toast } = Seq.core;
  const C4 = () => window.SeqC4;
  const cat = () => Seq.catalog;

  const state = { id: null, match: false, q: '', kind: '' };
  let root = null, side = null, main = null, treeBox = null;

  const collapsed = () => new Set(S.settings.catCollapsed || []);
  function setCollapsed(id, on) {
    const c = collapsed();
    if (on) c.add(id); else c.delete(id);
    S.settings.catCollapsed = [...c];
    saveSettings();
  }
  const iconOf = (x) => {
    if (cat().isGroup(x)) return h('span', { class: 'role-icon group sm' }, ico('folder'));
    const lk = cat().lookOf(x);
    return h('span', { class: 'role-icon sm', style: `--c:${lk.color}` }, ico('t-' + lk.type));
  };
  const nameOf = (x) => oneLine(cat().displayName(x));
  const go = (path) => Seq.router.go(path);

  // ---------------------------------------------------------------------------
  // İskelet
  // ---------------------------------------------------------------------------
  function build() {
    root = $('#catalogScreen');
    root.innerHTML = '';
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      try { toast(T('cat.imported', { n: await cat().importFile(f) })); render(); } catch { toast(T('cat.importFailed'), 'err'); }
    });
    const search = h('input', { class: 'input', type: 'search', placeholder: T('cat.searchPh'), spellcheck: 'false' });
    search.addEventListener('input', debounce(() => { state.q = search.value; renderTree(); }, 120));
    const kinds = h('div', { class: 'seg sm cp-kinds' }, [''].concat(C4().KINDS).map((k) => {
      const b = h('button', { class: k === state.kind ? 'active' : '', 'data-kind': k }, k ? T('c4.' + k) : T('cat.allKinds'));
      b.addEventListener('click', () => { state.kind = k; kinds.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); renderTree(); });
      return b;
    }));
    treeBox = h('div', { class: 'cp-tree', role: 'tree' });
    side = h('aside', { class: 'cp-side' }, h('div', { class: 'cp-filters' }, search, kinds), treeBox);
    main = h('main', { class: 'cp-main' });
    root.append(
      h('div', { class: 'page-head' },
        h('h1', null, ico('layers'), T('cat.title')),
        h('span', { class: 'page-sum', id: 'catSum' }),
        h('div', { class: 'page-actions' },
          h('button', { class: 'btn ghost sm edit-only', id: 'catMatchBtn', onclick: () => go('catalog?match=1') }, ico('link'), h('span')),
          h('button', { class: 'btn ghost sm edit-only', onclick: () => fileIn.click() }, ico('upload'), T('role.import')),
          h('button', { class: 'btn ghost sm', onclick: () => cat().exportFile() }, ico('download'), T('role.export')),
          h('button', { class: 'btn primary sm edit-only', id: 'catNew', onclick: () => addItem(null) }, ico('plus'), T('cat.add')),
          fileIn)),
      h('div', { class: 'cp-body' }, side, main));
  }

  function addItem(parent) {
    const x = cat().createItem({ parent });
    if (!x) return;
    if (parent) setCollapsed(parent, false);
    go('catalog/' + encodeURIComponent(x.id));
    setTimeout(() => { const n = main.querySelector('.cp-name'); if (n) { n.focus(); n.select(); } }, 0);
  }

  // Verinin imzası: sayfa kendi değişikliğinden sonra zaten çizildiyse olayla gelen ikinci çizim atlanır
  let lastSig = '';
  const sig = () => JSON.stringify(S.catalog) + '#' + S.docs.map((d) => d.id + ':' + d.updated).join('|') + '#' + (S.roles || []).length;
  function render() {
    if (!root) return;
    lastSig = sig();
    const n = S.catalog.length;
    $('#catSum').textContent = T('cat.sum', { n, k: S.catalog.filter((x) => !cat().isGroup(x)).length });
    const pending = cat().collectMatches().length;
    const mb = $('#catMatchBtn');
    mb.lastChild.textContent = pending ? T('cat.matchBtnN', { n: pending }) : T('cat.matchBtn');
    mb.disabled = !pending || null;
    mb.classList.toggle('attn', pending > 0);
    renderTree();
    renderMain();
  }
  const renderSoon = debounce(() => { if (Seq.router.screen() === 'catalog' && sig() !== lastSig) render(); }, 150);

  // ---------------------------------------------------------------------------
  // Ağaç
  // ---------------------------------------------------------------------------
  let dragId = null;
  function renderTree() {
    treeBox.innerHTML = '';
    const all = cat().flatTree();
    const nq = norm(state.q.trim());
    const hitOf = (x) => (!nq || norm(nameOf(x) + ' ' + (x.desc || '') + ' ' + x.id).includes(nq)) && (!state.kind || cat().kindOf(x) === state.kind);
    const filtering = !!(nq || state.kind);
    let rows = all;
    if (filtering) {
      const keep = new Set();
      all.forEach(({ item }) => { if (hitOf(item)) cat().pathOf(item.id).forEach((x) => keep.add(x.id)); });
      rows = all.filter(({ item }) => keep.has(item.id));
    } else {
      // Kapalı dalların altı gizlenir
      const closed = collapsed();
      const hidden = new Set();
      rows = all.filter(({ item }) => {
        const p = cat().parentOf(item);
        if (p && (closed.has(p) || hidden.has(p))) { hidden.add(item.id); return false; }
        return true;
      });
    }
    if (!S.catalog.length) {
      treeBox.append(h('p', { class: 'dd-empty' }, ico('help'), T('cat.emptyHint')));
      return;
    }
    if (!rows.length) { treeBox.append(h('p', { class: 'dd-empty' }, ico('help'), T('cat.noMatch'))); return; }
    const closed = collapsed();
    rows.forEach(({ item: x, depth }) => {
      const kids = cat().childrenOf(x.id).length;
      const open = filtering || !closed.has(x.id);
      const caret = kids ? h('button', { class: 'cp-caret' + (open ? ' open' : ''), title: T(open ? 'cat.collapse' : 'cat.expand'), tabindex: '-1' }, ico('chevron')) : h('span', { class: 'cp-caret' });
      if (kids && !filtering) caret.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(x.id, open); renderTree(); });
      const warn = cat().placementWarning(x);
      const row = h('div', {
        class: 'cp-row' + (state.id === x.id ? ' selected' : '') + (filtering && !hitOf(x) ? ' dim' : ''),
        role: 'treeitem', 'aria-selected': String(state.id === x.id), tabindex: '0', draggable: 'true',
        'data-id': x.id, style: `--depth:${depth}`, title: x.desc || null,
      }, caret, iconOf(x), h('span', { class: 'cp-label' }, nameOf(x)),
      warn ? h('span', { class: 'cp-warn', title: warn }, ico('critical')) : null,
      h('small', { class: 'cp-kind' }, T('c4.' + cat().kindOf(x))));
      row.addEventListener('click', () => go('catalog/' + encodeURIComponent(x.id)));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') row.click(); });
      // Sürükle-bırak: bir öğenin üstüne bırakınca onun altına taşınır
      row.addEventListener('dragstart', (e) => { dragId = x.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.id); row.classList.add('dragging'); treeBox.classList.add('dragging'); });
      row.addEventListener('dragend', () => { dragId = null; row.classList.remove('dragging'); treeBox.classList.remove('dragging'); treeBox.querySelectorAll('.drop-into').forEach((n) => n.classList.remove('drop-into')); });
      row.addEventListener('dragover', (e) => { if (!dragId || dragId === x.id || cat().isAncestor(dragId, x.id)) return; e.preventDefault(); row.classList.add('drop-into'); });
      row.addEventListener('dragleave', () => row.classList.remove('drop-into'));
      row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('drop-into'); if (dragId && cat().moveItem(dragId, x.id)) { setCollapsed(x.id, false); render(); } });
      treeBox.append(row);
    });
    const rootZone = h('div', { class: 'cat-root-zone' }, T('cat.dropRoot'));
    rootZone.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); rootZone.classList.add('over'); } });
    rootZone.addEventListener('dragleave', () => rootZone.classList.remove('over'));
    rootZone.addEventListener('drop', (e) => { e.preventDefault(); rootZone.classList.remove('over'); if (dragId && cat().moveItem(dragId, null)) render(); });
    treeBox.append(rootZone);
  }

  // ---------------------------------------------------------------------------
  // Sağ panel
  // ---------------------------------------------------------------------------
  function renderMain() {
    main.innerHTML = '';
    if (state.match) { main.append(cat().buildMatchView(() => go('catalog'))); return; }
    const x = cat().itemById(state.id);
    if (!x) { main.append(overview()); return; }
    main.append(detail(x));
  }

  function overview() {
    const counts = C4().KINDS.map((k) => [k, S.catalog.filter((x) => cat().kindOf(x) === k).length]);
    const box = h('div', { class: 'cp-overview' });
    if (!S.catalog.length) {
      box.append(h('div', { class: 'cp-empty' }, ico('layers'), h('h2', null, T('cat.emptyTitle')), h('p', null, T('cat.intro')),
        h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn primary', onclick: () => addItem(null) }, ico('plus'), T('cat.add')))));
      return box;
    }
    box.append(h('p', { class: 'roles-intro' }, T('cat.intro')));
    box.append(h('div', { class: 'cp-stats' }, counts.map(([k, n]) => h('button', {
      class: 'cp-stat', onclick: () => { state.kind = k; root.querySelectorAll('.cp-kinds button').forEach((b) => b.classList.toggle('active', b.dataset.kind === k)); renderTree(); },
    }, h('b', null, String(n)), h('span', null, T('c4.' + k))))));
    const warns = S.catalog.filter((x) => cat().placementWarning(x));
    if (warns.length) {
      box.append(h('h3', null, ico('critical'), T('cat.warnings', { n: warns.length })),
        h('ul', { class: 'cp-list' }, warns.map((x) => h('li', null, h('a', { href: '#/catalog/' + encodeURIComponent(x.id) }, iconOf(x), h('span', null, nameOf(x)), h('small', null, cat().placementWarning(x)))))));
    }
    box.append(h('p', { class: 'note-line' }, ico('help'), T('cat.note')));
    return box;
  }

  /** Öğenin (ve alt öğelerinin) diyagramlardan türeyen ilişkileri: giden / gelen, karşı uç öğe bazında */
  function relationsOf(x) {
    const docs = S.docs.map((d) => { try { return { id: d.id, model: M.parse(docCode(d)) }; } catch { return null; } }).filter(Boolean);
    const rels = C4().relations(S.catalog, docs);
    const inside = C4().subtree(S.catalog, x.id);
    const out = new Map(), inc = new Map();
    const add = (map, other, r) => {
      if (!map.has(other)) map.set(other, new Map());
      const m = map.get(other);
      r.labels.forEach((l) => m.set(l.text, (m.get(l.text) || 0) + l.n));
    };
    rels.forEach((r) => {
      const a = inside.has(r.from), b = inside.has(r.to);
      if (a && !b) add(out, r.to, r);
      else if (!a && b) add(inc, r.from, r);
    });
    const list = (map) => [...map].map(([id, m]) => ({ id, texts: [...m].sort((p, q) => q[1] - p[1]).map(([t, n]) => t + (n > 1 ? ' ×' + n : '')) }))
      .sort((p, q) => nameOf(cat().itemById(p.id)).localeCompare(nameOf(cat().itemById(q.id)), I18N.getLang()));
    return { out: list(out), inc: list(inc) };
  }

  /** Mimaride hangi düzeyde gösterilecek: içi olan sistem/konteyner kendisi, değilse içinde durduğu üst öğe */
  function archFocusOf(x) {
    const hasKids = S.catalog.some((y) => y.id !== x.id && cat().pathOf(y.id).some((a) => a.id === x.id) && !cat().isGroup(y));
    if (hasKids && !cat().isGroup(x)) return x.id;
    const up = cat().pathOf(x.id).slice(0, -1).reverse().find((a) => !cat().isGroup(a));
    return up ? up.id : null;
  }

  function detail(x) {
    const box = h('div', { class: 'cp-detail' });
    const group = cat().isGroup(x);
    // Konum: üst öğeler
    const path = cat().pathOf(x.id);
    box.append(h('nav', { class: 'cp-path' },
      h('a', { href: '#/catalog' }, T('cat.title')),
      path.slice(0, -1).flatMap((a) => [h('span', { class: 'crumb-sep' }, '›'), h('a', { href: '#/catalog/' + encodeURIComponent(a.id) }, nameOf(a))])));
    const title = h('h2', { class: 'cp-title' }, iconOf(x), h('span', null, nameOf(x)), h('span', { class: 'cp-badge' }, T('c4.' + cat().kindOf(x))));
    box.append(title);
    const warn = cat().placementWarning(x);
    if (warn) box.append(h('p', { class: 'cat-warn' }, ico('critical'), warn));

    // Form: tür → ad → rol → üst öğe → açıklama
    const kind = cat().kindSelect(cat().kindOf(x), true);
    kind.addEventListener('change', () => { cat().updateItem(x.id, { kind: kind.value }); render(); });
    const name = h('input', { class: 'input cp-name', value: x.name, spellcheck: 'false' });
    name.addEventListener('input', () => { cat().updateItem(x.id, { name: name.value }); title.children[1].textContent = nameOf(x); shown.textContent = group ? '' : T('cat.willShow', { name: nameOf(x) }); });
    const role = cat().roleSelect(x.role);
    role.addEventListener('change', () => { cat().updateItem(x.id, { role: role.value }); render(); });
    const parent = cat().parentSelect(cat().parentOf(x), x.id);
    parent.addEventListener('change', () => { if (cat().moveItem(x.id, parent.value || null)) render(); });
    const desc = h('textarea', { class: 'input', rows: 2, placeholder: T('cat.descPh') });
    desc.value = x.desc || '';
    desc.addEventListener('input', () => cat().updateItem(x.id, { desc: desc.value.trim() }));
    const shown = h('small', null, group ? '' : T('cat.willShow', { name: nameOf(x) }));
    box.append(h('div', { class: 'cp-form' },
      h('label', null, T('cat.kind')), kind,
      h('label', null, T('cat.name')), h('div', null, name, shown),
      group ? null : h('label', null, T('cat.role')), group ? null : h('div', null, role, h('small', null, T('cat.roleHint'))),
      h('label', null, T('cat.parent')), parent,
      h('label', null, T('cat.desc')), desc));

    const focus = archFocusOf(x);
    box.append(h('div', { class: 'cp-actions' },
      h('button', { class: 'btn sm edit-only', onclick: () => addItem(x.id) }, ico('plus'), T('cat.addChild')),
      group ? null : h('a', { class: 'btn sm', href: '#/architecture' + (focus ? '/' + encodeURIComponent(focus) : '') }, ico('layers'), T('cat.showInArch')),
      h('button', { class: 'btn sm danger edit-only', onclick: () => {
        const used = cat().usageOf(x.id).length, kids = cat().childrenOf(x.id).length;
        if ((used || kids) && !confirm(T('cat.confirmDelete', { name: x.name, n: used, k: kids }))) return;
        const up = cat().parentOf(x);
        cat().removeItem(x.id);
        go(up ? 'catalog/' + encodeURIComponent(up) : 'catalog');
      } }, ico('trash'), T('delete'))));

    // Kullanıldığı akışlar
    if (!group) {
      const usage = cat().usageOf(x.id);
      box.append(h('h3', null, ico('file'), T('cat.usedIn', { n: usage.length })));
      box.append(usage.length ? h('ul', { class: 'cp-list' }, usage.map(({ doc, labels }) => h('li', null, h('button', {
        class: 'link-row', onclick: () => {
          Seq.router.openFlow(doc.id);
          const p = S.model.participants.find((q) => q.item === x.id);
          if (p) Seq.participants.revealCard(p.uid);
        },
      }, ico('file'), h('span', null, doc.name), h('small', null, labels.join(', '))))))
        : h('p', { class: 'dim-info' }, T('cat.notUsed')));
    }
    // İlişkiler (diyagramlardan türetilir)
    const rel = relationsOf(x);
    const relList = (items) => h('ul', { class: 'cp-list' }, items.map((r) => {
      const y = cat().itemById(r.id);
      return h('li', null, h('a', { href: '#/catalog/' + encodeURIComponent(r.id) }, iconOf(y), h('span', null, nameOf(y)), h('small', null, r.texts.slice(0, 3).join(', ') + (r.texts.length > 3 ? ' …' : ''))));
    }));
    box.append(h('h3', null, ico('next'), T('cat.outgoing', { n: rel.out.length })), rel.out.length ? relList(rel.out) : h('p', { class: 'dim-info' }, T('cat.noRelations')));
    box.append(h('h3', null, ico('prev'), T('cat.incoming', { n: rel.inc.length })), rel.inc.length ? relList(rel.inc) : h('p', { class: 'dim-info' }, T('cat.noRelations')));
    // Alt öğeler
    const kids = cat().childrenOf(x.id);
    if (kids.length) {
      box.append(h('h3', null, ico('layers'), T('cat.children', { n: kids.length })),
        h('ul', { class: 'cp-list' }, kids.map((k) => h('li', null, h('a', { href: '#/catalog/' + encodeURIComponent(k.id) }, iconOf(k), h('span', null, nameOf(k)), h('small', null, T('c4.' + cat().kindOf(k))))))));
    }
    return box;
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    const show = (p) => {
      state.id = p.id; state.match = p.match;
      if (state.id) cat().pathOf(state.id).slice(0, -1).forEach((a) => setCollapsed(a.id, false)); // seçili öğe görünür olsun
      render();
      const sel = treeBox && treeBox.querySelector('.cp-row.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
    };
    Seq.router.register({
      id: 'catalog', nav: 'catalog', pattern: /^catalog(?:\/([^/]+))?$/,
      params: (m, q) => ({ id: m[1] ? decodeURIComponent(m[1]) : null, match: q.match === '1' }),
      mount: (p) => { $('#catalogScreen').hidden = false; build(); show(p); },
      update: show,
      unmount: () => { $('#catalogScreen').hidden = true; },
    });
    // Başka yerden (palet seçicisi, mimari, içe alma) katalog değişince sayfa güncellenir; yazarken odağı bozmamak için
    // ayrıntı formu yeniden çizilmez, yalnızca ağaç ve özet
    Seq.core.events.on('catalog:changed', () => {
      if (Seq.router.screen() !== 'catalog' || !root) return;
      if (main.contains(document.activeElement) && document.activeElement.matches('input, textarea, select')) { renderTreeSoon(); return; }
      renderSoon();
    });
  }
  const renderTreeSoon = debounce(() => { if (treeBox && sig() !== lastSig) { lastSig = sig(); renderTree(); } }, 150);

  Seq.catalogPage = { init, render };
})(window.Seq = window.Seq || {});
