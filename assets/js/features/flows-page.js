/* Sequence Studio — akışlar sayfası (belge kütüphanesi)
 *
 * "#/flows": solda klasör ağacı, sağda akış tablosu. Arama, klasöre ve kullandığı katalog öğesine göre süzme,
 * sıralama, toplu taşıma/silme; yeni akış, şablon, içe aktarma; klasör oluşturma, yeniden adlandırma,
 * dışa aktarma ve silme. Bir akışa tıklayınca düzenleyici ("#/flows/<id>") açılır.
 * "#/flows?folder=<id>" sayfayı o klasör seçili açar (düzenleyicideki yol göstergesi buraya bağlanır).
 */
(function (Seq) {
  'use strict';
  const { $, I18N, M, S, T, debounce, docCode, el, h, ico, norm, oneLine, saveSettings, timeAgo, tplL } = Seq.core;

  // folder: null = tümü, '' = klasörsüz, id = klasör (alt klasörleriyle)
  const state = { folder: null, q: '', item: '', selected: new Set(), renaming: null };
  let root = null, side = null, table = null, bulk = null;
  const sort = () => S.settings.flowsSort || { key: 'updated', dir: -1 };

  // Katılımcı sayısı ve bağlı katalog öğeleri (koda göre önbellekli)
  const info = new Map();
  function infoOf(d) {
    const code = docCode(d);
    const c = info.get(d.id);
    if (c && c.code === code) return c;
    let parts = 0, items = new Set(), steps = 0;
    try {
      const m = M.parse(code);
      parts = m.participants.length;
      m.participants.forEach((p) => { if (p.item) items.add(p.item); });
      M.walk(m.items, (it) => { if (it.kind === 'message' || it.kind === 'note') steps++; });
    } catch { /* bozuk kod: sayılar 0 */ }
    const v = { code, parts, items, steps };
    info.set(d.id, v);
    return v;
  }
  const pathOf = (folderId) => Seq.search.folderPath(folderId);
  /** Son düzenleyen (kayıt üstverisinden) */
  const byOf = (d) => { const m = Seq.repo.meta('doc', d.id); return m && m.updatedBy ? ' · ' + Seq.user.label(m.updatedBy) : ''; };

  // ---------------------------------------------------------------------------
  // İskelet
  // ---------------------------------------------------------------------------
  function build() {
    root = $('#flowsScreen');
    root.innerHTML = '';
    const search = h('input', { class: 'input', type: 'search', placeholder: T('flows.searchPh'), spellcheck: 'false', value: state.q });
    search.addEventListener('input', debounce(() => { state.q = search.value; renderTable(); }, 120));
    const itemSel = h('select', { class: 'select sm', title: T('flows.itemFilterTitle') }, h('option', { value: '' }, T('flows.anyItem')),
      Seq.catalog.flatTree().filter(({ item }) => !Seq.catalog.isGroup(item))
        .map(({ item, depth }) => h('option', { value: item.id }, '  '.repeat(depth) + oneLine(Seq.catalog.displayName(item)))));
    itemSel.value = state.item;
    itemSel.addEventListener('change', () => { state.item = itemSel.value; renderTable(); });
    side = h('aside', { class: 'fp-side' });
    table = h('div', { class: 'fp-table', role: 'table' });
    bulk = h('div', { class: 'fp-bulk', hidden: true });
    root.append(
      h('div', { class: 'page-head' },
        h('h1', null, ico('file'), T('flows.title')),
        h('span', { class: 'page-sum', id: 'flowsSum' }),
        h('div', { class: 'page-actions' },
          h('button', { class: 'btn ghost sm edit-only', onclick: () => Seq.help.openTemplates() }, ico('layout'), T('tb.templates')),
          h('button', { class: 'btn ghost sm edit-only', onclick: () => el.fileInput.click() }, ico('upload'), T('tb.import')),
          h('button', { class: 'btn primary sm edit-only', id: 'flowsNew', onclick: newFlow }, ico('plus'), T('flows.new')))),
      h('div', { class: 'fp-body' },
        side,
        h('main', { class: 'fp-main' },
          h('div', { class: 'fp-filters' }, search, itemSel),
          bulk, table)));
  }
  /** Adresle gelen klasör seçimi (yol göstergesinden): bilinmeyen klasörde tüm akışlar */
  function pickFolder(id) {
    if (id === undefined) return;
    state.folder = id === '' ? '' : Seq.folders.folderById(id) ? id : null;
    state.selected.clear();
  }
  /** Yeni akış: seçili klasörde oluşturulur ve düzenleyicide açılır */
  function newFlow() {
    const folder = state.folder && Seq.folders.folderById(state.folder) ? state.folder : undefined;
    Seq.docs.createDoc(T('doc.untitled'), tplL(window.SeqTemplates[0]).code, true, folder);
  }

  // Verinin imzası: sayfa kendi değişikliğinden sonra zaten çizildiyse olayla gelen ikinci çizim atlanır
  let lastSig = '';
  const sig = () => S.docs.map((d) => d.id + ':' + d.updated + ':' + (d.folder || '') + ':' + d.name).join('|') + '#' + JSON.stringify(S.folders) + '#' + S.catalog.length;
  function render() {
    if (!root) return;
    lastSig = sig();
    $('#flowsSum').textContent = T('flows.sum', { n: S.docs.length, m: S.folders.length });
    renderSide();
    renderTable();
  }
  // Gecikmeli yeniden çizim; klasör adı yazılırken yapılmaz (yazılan metin kaybolmasın)
  // Sürükleme sürerken de ertelenir (bırakma hedefi yerinde kalsın)
  let dragging = false;
  const renderSoon = debounce(() => { if (Seq.router.screen() !== 'flows' || state.renaming || sig() === lastSig) return; if (dragging) { renderSoon(); return; } render(); }, 120);

  // ---------------------------------------------------------------------------
  // Klasör ağacı
  // ---------------------------------------------------------------------------
  function renderSide() {
    side.innerHTML = '';
    const pick = (f) => { state.folder = f; state.selected.clear(); render(); };
    const node = (label, icon, n, key, extra) => {
      const b = h('button', { class: 'fp-folder' + (state.folder === key ? ' active' : ''), 'data-folder': key == null ? '*' : key, onclick: () => pick(key) },
        extra || null, ico(icon), h('span', { class: 'fp-fname' }, label), h('small', null, String(n)));
      dropTarget(b, key || null);
      return b;
    };
    const unfiled = S.docs.filter((d) => !d.folder || !Seq.folders.folderById(d.folder)).length;
    side.append(node(T('flows.all'), 'file', S.docs.length, null), node(T('flows.unfiled'), 'folder', unfiled, ''));
    const tree = h('div', { class: 'fp-tree' });
    const walk = (parentId, depth) => Seq.folders.childFolders(parentId).forEach((f) => {
      const kids = Seq.folders.childFolders(f.id).length;
      const caret = kids ? h('span', { class: 'cp-caret' + (f.collapsed ? '' : ' open') }, ico('chevron')) : h('span', { class: 'cp-caret' });
      if (kids) caret.addEventListener('click', (e) => { e.stopPropagation(); f.collapsed = !f.collapsed; Seq.docs.persistDocs(); renderSide(); });
      let row;
      if (state.renaming === f.id) {
        const inp = h('input', { class: 'input sm fp-rename', value: f.name });
        const done = (save) => {
          if (state.renaming !== f.id) return;
          state.renaming = null;
          if (save) Seq.folders.renameFolder(f.id, inp.value);
          render();
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
        inp.addEventListener('blur', () => done(true));
        row = h('div', { class: 'fp-folder renaming', style: `--depth:${depth}` }, caret, ico('folder'), inp);
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
      } else {
        row = node(f.name, 'folder', Seq.folders.folderDocCount(f.id), f.id, caret);
        row.style.setProperty('--depth', depth);
        row.addEventListener('dblclick', () => { state.renaming = f.id; renderSide(); });
        // Klasör başka bir klasöre (ya da "Tüm akışlar"a bırakılınca köke) taşınabilir
        row.draggable = true;
        row.addEventListener('dragstart', (e) => { dragging = true; e.dataTransfer.setData('text/x-folder', f.id); e.dataTransfer.effectAllowed = 'move'; });
        row.addEventListener('dragend', () => { dragging = false; });
      }
      tree.append(row);
      if (!f.collapsed) walk(f.id, depth + 1);
    });
    walk(null, 1);
    side.append(tree);
    // Seçili klasörün işlemleri
    const f = state.folder && Seq.folders.folderById(state.folder);
    side.append(h('div', { class: 'fp-side-actions' },
      h('button', { class: 'btn sm ghost', onclick: () => { const nf = Seq.folders.createFolder(f ? f.id : null); if (!nf) return; state.folder = nf.id; state.renaming = nf.id; render(); } }, ico('folderPlus'), T(f ? 'flows.newSubfolder' : 'folder.newShort')),
      f ? h('button', { class: 'btn sm ghost', onclick: () => { state.renaming = f.id; renderSide(); } }, ico('edit'), T('flows.rename')) : null,
      f ? h('button', { class: 'btn sm ghost', onclick: () => Seq.folderExport.openFolderExport(f.id) }, ico('download'), T('flows.exportFolder')) : null,
      f ? h('button', { class: 'btn sm ghost danger', onclick: () => { const up = f.parent || null; Seq.folders.deleteFolder(f.id); if (!Seq.folders.folderById(f.id)) { state.folder = up; render(); } } }, ico('trash'), T('flows.deleteFolder')) : null));
  }
  /** Akış satırları ve klasörler klasörlere sürüklenip bırakılabilir (döngü oluşturan taşıma reddedilir) */
  function dropTarget(node, folderId) {
    const accepts = (e) => e.dataTransfer.types.includes('text/x-flow') || (e.dataTransfer.types.includes('text/x-folder') && folderId !== '');
    node.addEventListener('dragover', (e) => { if (accepts(e)) { e.preventDefault(); node.classList.add('drop-into'); } });
    node.addEventListener('dragleave', () => node.classList.remove('drop-into'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      dragging = false;
      node.classList.remove('drop-into');
      const fid = e.dataTransfer.getData('text/x-folder');
      if (fid) { if (fid !== folderId) Seq.folders.moveFolder(fid, folderId || null); render(); return; }
      const ids = (e.dataTransfer.getData('text/x-flow') || '').split(',').filter(Boolean);
      ids.forEach((id) => Seq.folders.moveDoc(id, folderId === '' ? null : folderId));
      render();
    });
  }

  // ---------------------------------------------------------------------------
  // Tablo
  // ---------------------------------------------------------------------------
  function visibleDocs() {
    const nq = norm(state.q.trim());
    const itemSet = state.item ? window.SeqC4.subtree(S.catalog, state.item) : null;
    return S.docs.filter((d) => {
      if (state.folder === '' && d.folder && Seq.folders.folderById(d.folder)) return false;
      if (state.folder && !(d.folder && Seq.folders.isWithin(d.folder, state.folder))) return false;
      if (itemSet && ![...infoOf(d).items].some((i) => itemSet.has(i))) return false;
      if (nq && !norm(d.name + ' ' + pathOf(d.folder)).includes(nq)) return false;
      return true;
    });
  }
  function renderTable() {
    table.innerHTML = '';
    const { key, dir } = sort();
    const docs = visibleDocs();
    const val = (d) => (key === 'name' ? d.name : key === 'folder' ? pathOf(d.folder) : key === 'parts' ? infoOf(d).parts : d.updated || 0);
    docs.sort((a, b) => {
      const x = val(a), y = val(b);
      return (typeof x === 'string' ? x.localeCompare(y, I18N.getLang()) : x - y) * dir;
    });
    state.selected.forEach((id) => { if (!docs.some((d) => d.id === id)) state.selected.delete(id); });
    const all = h('input', { type: 'checkbox', title: T('flows.selectAll') });
    all.checked = docs.length > 0 && docs.every((d) => state.selected.has(d.id));
    all.addEventListener('change', () => { docs.forEach((d) => (all.checked ? state.selected.add(d.id) : state.selected.delete(d.id))); renderTable(); });
    const th = (k, label) => {
      const b = h('button', { class: 'fp-th' + (key === k ? ' sorted' : ''), onclick: () => { S.settings.flowsSort = { key: k, dir: key === k ? -dir : (k === 'updated' || k === 'parts' ? -1 : 1) }; saveSettings(); renderTable(); } },
        label, key === k ? h('span', { class: 'fp-dir' }, dir > 0 ? '↑' : '↓') : null);
      return b;
    };
    table.append(h('div', { class: 'fp-row fp-head', role: 'row' }, all, th('name', T('flows.colName')), th('folder', T('flows.colFolder')), th('parts', T('flows.colParts')), th('updated', T('flows.colUpdated')), h('span')));
    if (!docs.length) table.append(h('p', { class: 'dd-empty' }, ico('help'), T(S.docs.length ? 'flows.noMatch' : 'flows.empty')));
    docs.forEach((d) => {
      const inf = infoOf(d);
      const cb = h('input', { type: 'checkbox', 'aria-label': d.name });
      cb.checked = state.selected.has(d.id);
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => { if (cb.checked) state.selected.add(d.id); else state.selected.delete(d.id); renderBulk(); row.classList.toggle('checked', cb.checked); });
      const row = h('div', { class: 'fp-row' + (state.selected.has(d.id) ? ' checked' : '') + (S.doc && S.doc.id === d.id ? ' current' : ''), role: 'row', draggable: 'true', tabindex: '0', 'data-id': d.id },
        cb,
        h('span', { class: 'fp-name' }, ico('logo'), h('b', null, d.name), inf.items.size ? h('small', { class: 'fp-items', title: T('flows.itemsTitle') }, ico('layers'), String(inf.items.size)) : null),
        h('span', { class: 'fp-path' }, pathOf(d.folder) || '—'),
        h('span', { class: 'fp-num' }, String(inf.parts)),
        h('span', { class: 'fp-time', title: new Date(d.updated || 0).toLocaleString(I18N.getLang()) + byOf(d) }, timeAgo(d.updated)),
        h('span', { class: 'fp-row-actions' },
          h('button', { class: 'icon-btn sm', title: T('flows.duplicate'), onclick: (e) => { e.stopPropagation(); duplicate(d); } }, ico('copy')),
          h('button', { class: 'icon-btn sm del', title: T('delete'), onclick: (e) => { e.stopPropagation(); Seq.docs.deleteDoc(d.id); render(); } }, ico('trash'))));
      row.addEventListener('click', () => Seq.router.openFlow(d.id));
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') Seq.router.openFlow(d.id); });
      row.addEventListener('dragend', () => { dragging = false; });
      row.addEventListener('dragstart', (e) => {
        dragging = true;
        const ids = state.selected.has(d.id) ? [...state.selected] : [d.id];
        e.dataTransfer.setData('text/x-flow', ids.join(','));
        e.dataTransfer.effectAllowed = 'move';
      });
      table.append(row);
    });
    renderBulk();
  }
  function duplicate(d) {
    const copy = Seq.docs.createDoc(d.name + T('flows.copySuffix'), docCode(d), false, d.folder);
    if (!copy) return;
    info.delete(copy.id);
    render();
  }

  /** Toplu işlemler: seçili akışları taşı / sil */
  function renderBulk() {
    const n = state.selected.size;
    bulk.hidden = !n;
    if (!n) return;
    bulk.innerHTML = '';
    const move = h('select', { class: 'select sm' }, h('option', { value: '__' }, T('flows.moveTo')), h('option', { value: '' }, T('flows.unfiled')),
      Seq.folders.folderTree(null).map(({ f, depth }) => h('option', { value: f.id }, '  '.repeat(depth) + f.name)));
    move.addEventListener('change', () => {
      if (move.value === '__') return;
      [...state.selected].forEach((id) => Seq.folders.moveDoc(id, move.value || null));
      state.selected.clear();
      render();
    });
    bulk.append(h('b', null, T('flows.selected', { n })), move,
      h('button', { class: 'btn sm danger', onclick: () => {
        if (!confirm(T('flows.confirmDelete', { n }))) return;
        [...state.selected].forEach((id) => Seq.docs.deleteDoc(id, { confirmed: true }));
        state.selected.clear();
        render();
      } }, ico('trash'), T('delete')),
      h('button', { class: 'btn sm ghost', onclick: () => { state.selected.clear(); renderTable(); } }, T('flows.clearSel')));
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    Seq.router.register({
      id: 'flows', nav: 'flows', pattern: /^flows$/, params: (m, q) => ({ folder: q.folder }),
      mount: (p) => { $('#flowsScreen').hidden = false; pickFolder(p.folder); build(); render(); },
      update: (p) => { pickFolder(p.folder); render(); },
      unmount: () => { $('#flowsScreen').hidden = true; state.renaming = null; },
    });
    ['docs:persisted', 'doc:deleted', 'catalog:changed'].forEach((e) => Seq.core.events.on(e, renderSoon));
  }

  Seq.flowsPage = { init, render };
})(window.Seq = window.Seq || {});
