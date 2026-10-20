/* Sequence Studio — katılımcı kataloğu
 *
 * Diyagramlarda tekrar kullanılan somut katılımcıların global hiyerarşisi (C4 modeli gibi: ör. Ödeme sistemi
 * › Ledger › Ledger DB). Rol "nasıl görünür" sorusunu, katalog öğesi "kimdir" sorusunu yanıtlar:
 *
 *   diyagramdaki katılımcı → katalog öğesi → rol
 *
 * Öğe: { id, name, role, parent?, desc? } — rol zorunludur; görünüm (şekil, renk, ön/son ek) her zaman rolden
 * gelir. Bir üst öğe de katılımcı olarak kullanılabilir (bir diyagramda sistem tek kutu, başka birinde içindekiler).
 * Öğeye bağlı katılımcının adı öğenin (ekleriyle) adıdır; diyagramda değiştirilmediği sürece öğeyi izler.
 * Kodda: "%% @item id" (katılımcıdan önce), dışarı taşınan tanım "%% @itemdef id {json}".
 */
(function (Seq) {
  'use strict';
  const { $$, I18N, M, S, T, closeModal, debounce, downloadBlob, dropdown, events, h, ico, norm, oneLine, openModal, toast } = Seq.core;

  const saveCatalog = () => { Seq.palette.renderPalette(); events.emit('catalog:changed'); return window.SeqStorage.saveKV('catalog', S.catalog).catch(Seq.docs.storageError); };
  const itemById = (id) => id && S.catalog.find((x) => x.id === id);
  const sortByName = (a, b) => a.name.localeCompare(b.name, I18N.getLang());
  /** Bir öğenin doğrudan alt öğeleri (parent boşsa en üst düzey) ada göre */
  // (üst öğesi katalogda olmayan öğeler en üst düzeyde görünür)
  const parentOf = (x) => (x.parent && itemById(x.parent) ? x.parent : null);
  const childrenOf = (parentId) => S.catalog.filter((x) => parentOf(x) === (parentId || null)).sort(sortByName);
  /** Kökten öğeye yol: [kök, …, öğe] */
  function pathOf(id) {
    const out = [];
    for (let x = itemById(id), guard = 0; x && guard < 50; x = itemById(x.parent), guard++) out.unshift(x);
    return out;
  }
  const pathLabel = (id) => pathOf(id).map(displayName).join(' › ');
  /** Öğenin görünen adı: rolün ön/son ekleriyle */
  const displayName = (x) => Seq.roles.composeLabel(Seq.roles.roleById(x.role), x.name);
  /** id, newParent'ın atası mı (ya da kendisi mi)? Taşımada döngüyü engeller */
  const isAncestor = (id, of) => pathOf(of).some((x) => x.id === id);
  function uniqueItemId(name) {
    const base = M.slugify(name).toLowerCase() || 'item';
    let id = base, k = 2;
    while (itemById(id)) id = base + '-' + k++;
    return id;
  }
  /** Tüm alt öğeler (derinlik öncelikli, ağaç sırasıyla) ve derinlikleri */
  function flatTree(parentId = null, depth = 0, out = []) {
    childrenOf(parentId).forEach((x) => { out.push({ item: x, depth }); flatTree(x.id, depth + 1, out); });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Katılımcıya uygulama ve değişikliklerin yayılması
  // ---------------------------------------------------------------------------
  /** Öğeyi katılımcıya bağlar: rol, görünüm ve ad öğeden gelir. */
  function applyItem(p, x) {
    const r = Seq.roles.roleById(x.role);
    p.item = x.id;
    if (r) { p.role = r.id; p.type = r.type; p.color = r.color; }
    p.label = displayName(x);
    p.implicit = false;
    if (p.autoId) {
      const nid = Seq.participants.uniqueId(p.label, p.uid);
      Seq.participants.renameRefs(p.id, nid);
      p.id = nid;
    }
  }
  const markerOf = (id) => new RegExp('^\\s*%%\\s*@item\\s+' + id + '\\s*$', 'm');
  const codeOf = (d) => (S.doc && d.id === S.doc.id ? S.code : d.code);
  /** Öğe değişti/silindi: bağlı katılımcıları tüm diyagramlarda güncelle (adı değiştirilmemişse yeni adı izler). */
  function updateItemEverywhere(old, cur) {
    const oldLabel = Seq.roles.composeLabel(Seq.roles.roleById(old.role), old.name);
    const transform = (model) => {
      let changed = false;
      model.participants.forEach((p) => {
        if (p.item !== old.id) return;
        changed = true;
        if (!cur) { delete p.item; return; }
        const follows = p.label === oldLabel;
        const r = Seq.roles.roleById(cur.role);
        if (r) { p.role = r.id; p.type = r.type; p.color = r.color; }
        if (follows) p.label = displayName(cur);
      });
      return changed;
    };
    S.docs.forEach((d) => {
      if (S.doc && d.id === S.doc.id) return;
      if (!markerOf(old.id).test(d.code)) return;
      const m = M.parse(d.code);
      if (transform(m)) d.code = M.serialize(m);
    });
    Seq.docs.persistDocs();
    if (transform(S.model)) Seq.editor.commit();
  }
  /** Öğenin kullanıldığı diyagramlar ve oradaki katılımcı adları: [{ doc, labels }] */
  function usageOf(id) {
    const marker = markerOf(id);
    return S.docs.filter((d) => marker.test(codeOf(d)))
      .map((d) => ({ doc: d, labels: M.parse(codeOf(d)).participants.filter((p) => p.item === id).map((p) => oneLine(p.label)) }))
      .sort((a, b) => a.doc.name.localeCompare(b.doc.name, I18N.getLang()));
  }

  // ---------------------------------------------------------------------------
  // Dışarı taşınan tanımlar ve içe alma
  // ---------------------------------------------------------------------------
  const itemDef = (x) => Object.assign({ name: x.name, role: x.role }, x.parent ? { parent: x.parent } : {}, x.desc ? { desc: x.desc } : {});
  /**
   * Dışarı çıkan koda (paylaşım linki, .mmd/.txt) kullanılan rol ve katalog öğelerinin tanımlarını ekler.
   * Öğelerin üst öğeleri ve onların rolleri de eklenir (hiyerarşi başka çalışma alanında kurulabilsin).
   */
  function withDefs(code) {
    code = Seq.roles.withRoleDefs(code);
    let m;
    try { m = M.parse(code); } catch { return code; }
    const ids = new Set();
    m.participants.forEach((p) => { if (itemById(p.item)) pathOf(p.item).forEach((x) => ids.add(x.id)); });
    if (!ids.size) return code;
    m.itemDefs = Object.assign({}, m.itemDefs);
    m.roleDefs = Object.assign({}, m.roleDefs);
    ids.forEach((id) => {
      const x = itemById(id);
      m.itemDefs[id] = itemDef(x);
      const rd = Seq.roles.roleDefOf(x.role);
      if (rd && !m.roleDefs[x.role]) m.roleDefs[x.role] = rd;
    });
    if (!Object.keys(m.roleDefs).length) delete m.roleDefs;
    return M.serialize(m);
  }
  /** Dışarıdan gelen kodda katalogda/kütüphanede zaten olan tanımları atar. */
  function stripKnownDefs(code) {
    code = Seq.roles.stripKnownRoleDefs(code);
    if (!/@itemdef\b/.test(code)) return code;
    let m;
    try { m = M.parse(code); } catch { return code; }
    if (!m.itemDefs) return code;
    Object.keys(m.itemDefs).forEach((id) => { if (itemById(id)) delete m.itemDefs[id]; });
    if (!Object.keys(m.itemDefs).length) delete m.itemDefs;
    return M.serialize(m);
  }
  /** Modelde kullanılan ama katalogda olmayan (yoksayılmamış) öğeler ve tanımlı üst öğeleri */
  function unknownItems(model, doc) {
    const ignored = (doc && doc.ignoredItems) || [];
    const defs = model.itemDefs || {};
    const out = new Map();
    const visit = (id, p) => {
      if (!id || out.has(id) || itemById(id) || ignored.includes(id)) return;
      const d = defs[id] || {};
      const base = p ? Seq.roles.baseName(p) : '';
      out.set(id, {
        id,
        name: typeof d.name === 'string' && d.name.trim() ? d.name.trim() : oneLine(base).trim() || Seq.roles.prettyId(id),
        role: typeof d.role === 'string' && d.role ? d.role : (p && p.role) || (S.roles[0] && S.roles[0].id),
        parent: typeof d.parent === 'string' && d.parent ? d.parent : null,
        desc: typeof d.desc === 'string' && d.desc.trim() ? d.desc.trim() : undefined,
      });
      if (d.parent) visit(d.parent, null);
    };
    model.participants.forEach((p) => visit(p.item, p));
    return [...out.values()].map((x) => { if (!x.desc) delete x.desc; return x; });
  }
  function adoptItems(defs) {
    if (!defs.length) return;
    S.catalog = S.catalog.concat(defs.filter((x) => !itemById(x.id)));
    saveCatalog();
  }

  // ---------------------------------------------------------------------------
  // Ağaç seçici (palet ve katılımcı paneli): aranabilir; tıkla ya da katılımcı alanına sürükle
  // ---------------------------------------------------------------------------
  let picker = null;
  /**
   * opts: { onPick(item), draggable, title }
   */
  function openPicker(anchor, opts) {
    if (picker) { const same = picker.anchor === anchor; picker.close(); if (same) return; }
    let q = '';
    const input = h('input', { class: 'input cp-search', placeholder: T('cat.searchPh'), spellcheck: 'false' });
    const list = h('ul', { class: 'cp-list' });
    const draw = () => {
      list.innerHTML = '';
      const all = flatTree();
      const nq = norm(q.trim());
      // Aramada eşleşen öğeler atalarıyla birlikte gösterilir
      let rows = all;
      if (nq) {
        const keep = new Set();
        all.forEach(({ item }) => { if (norm(displayName(item) + ' ' + (item.desc || '')).includes(nq)) pathOf(item.id).forEach((x) => keep.add(x.id)); });
        rows = all.filter(({ item }) => keep.has(item.id));
      }
      if (!rows.length) {
        list.append(h('li', { class: 'dd-empty' }, ico('help'), T(S.catalog.length ? 'cat.noMatch' : 'cat.empty')));
        return;
      }
      rows.forEach(({ item, depth }) => {
        const r = Seq.roles.roleById(item.role);
        const hit = nq && norm(displayName(item) + ' ' + (item.desc || '')).includes(nq);
        const row = h('button', {
          class: 'dd-item cp-item' + (nq && !hit ? ' dim' : ''), style: `padding-left:${8 + depth * 16}px;--c:${r ? r.color : 'var(--muted)'}`,
          title: item.desc || null, draggable: opts.draggable ? 'true' : null, 'data-id': item.id,
          onclick: () => { close(); opts.onPick(item); },
        }, ico('t-' + (r ? r.type : 'participant')), h('span', { class: 'cp-name' }, oneLine(displayName(item))), h('small', null, r ? r.name : '?'));
        if (opts.draggable) {
          row.addEventListener('dragstart', (e) => Seq.flow.startDrag(e, { kind: 'newPart', type: r ? r.type : 'participant', role: item.role, item: item.id }));
          row.addEventListener('dragend', (e) => { Seq.flow.endDrag(e); close(); });
        }
        list.append(h('li', null, row));
      });
    };
    input.addEventListener('input', () => { q = input.value; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = list.querySelector('.cp-item:not(.dim)'); if (first) first.click(); }
    });
    const dd = dropdown(anchor, (box) => {
      box.append(h('div', { class: 'dd-head' }, h('b', null, opts.title || T('cat.title')),
        h('span', { class: 'dd-sum' }),
        h('button', { class: 'icon-btn sm', title: T('cat.manage'), onclick: () => { close(); Seq.library.open('catalog'); } }, ico('edit'))));
      box.append(input, list);
      draw();
    }, { class: 'catalog-picker', label: T('cat.title'), onClose: () => { picker = null; } });
    const close = () => dd.close();
    picker = { anchor, close };
    setTimeout(() => input.focus(), 0);
  }

  // ---------------------------------------------------------------------------
  // "Kataloğa kaydet": diyagramdaki katılımcıdan öğe oluşturma
  // ---------------------------------------------------------------------------
  /** Üst öğe seçimi: girintili ağaç listesi (exclude: kendisi ve alt öğeleri seçilemez) */
  function parentSelect(value, exclude) {
    const sel = h('select', { class: 'select' }, h('option', { value: '' }, T('cat.topLevel')),
      flatTree().filter(({ item }) => !(exclude && isAncestor(exclude, item.id)))
        .map(({ item, depth }) => h('option', { value: item.id }, '  '.repeat(depth) + oneLine(displayName(item)))));
    sel.value = value || '';
    return sel;
  }
  const roleSelect = (value) => {
    const sel = h('select', { class: 'select' }, S.roles.map((r) => h('option', { value: r.id }, r.name)));
    sel.value = value || (S.roles[0] && S.roles[0].id) || '';
    return sel;
  };
  function openSaveDialog(p) {
    if (!S.roles.length) return toast(T('cat.needRole'), 'err');
    const r0 = Seq.roles.roleById(p.role) || S.roles.find((r) => r.type === p.type) || S.roles[0];
    // Önerilen ad: seçili rolün ekleri çıkarılmış ad ("Ledger DB" + rol " DB" → "Ledger"); elle yazılınca dokunulmaz
    const suggest = () => oneLine(Seq.roles.stripAffixes(p.label, Seq.roles.roleById(role.value))).trim();
    const role = roleSelect(r0.id);
    const name = h('input', { class: 'input' });
    name.value = suggest();
    let nameTouched = false;
    name.addEventListener('input', () => { nameTouched = true; });
    const parent = parentSelect('');
    const desc = h('input', { class: 'input', placeholder: T('cat.descPh') });
    const preview = h('small', { class: 'cs-preview' });
    const refresh = () => { preview.textContent = T('cat.willShow', { name: oneLine(Seq.roles.composeLabel(Seq.roles.roleById(role.value), name.value.trim() || '…')) }); };
    name.addEventListener('input', refresh);
    role.addEventListener('change', () => { if (!nameTouched) name.value = suggest(); refresh(); });
    refresh();
    const save = () => {
      const n = name.value.trim();
      if (!n) return name.focus();
      const x = { id: uniqueItemId(n), name: n, role: role.value, parent: parent.value || null };
      if (desc.value.trim()) x.desc = desc.value.trim();
      S.catalog = S.catalog.concat([x]);
      saveCatalog();
      applyItem(p, x);
      Seq.editor.commit();
      Seq.editor.flushHistory();
      closeModal();
      toast(T('cat.saved', { name: pathLabel(x.id) }));
    };
    const body = h('div', { class: 'cat-save' },
      h('div', { class: 'field' }, h('label', null, T('cat.name')), name, preview),
      h('div', { class: 'field' }, h('label', null, T('cat.role')), role),
      h('div', { class: 'field' }, h('label', null, T('cat.parent')), parent, h('small', null, T('cat.parentHint'))),
      h('div', { class: 'field' }, h('label', null, T('cat.desc')), desc),
      h('div', { class: 'export-actions' }, h('div', { class: 'left' }), h('div', { class: 'right' },
        h('button', { class: 'btn ghost', onclick: closeModal }, T('cancel')),
        h('button', { class: 'btn primary', onclick: save }, ico('plus'), T('cat.saveBtn')))));
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    Seq.participants.closePopover();
    openModal(T('cat.saveTitle'), body);
    setTimeout(() => { name.focus(); name.select(); }, 0);
  }

  // ---------------------------------------------------------------------------
  // Katalog paneli (Katalog ve roller penceresinin "Katalog" sekmesi): ağaç, sürükleyerek taşıma
  // ---------------------------------------------------------------------------
  function buildPanel() {
    // Değişiklikler gecikmeli olarak tüm diyagramlara yayılır; eski tanım "snap" içinde tutulur
    const snap = new Map(S.catalog.map((x) => [x.id, { ...x }]));
    const pending = new Set();
    const flush = debounce(() => {
      pending.forEach((id) => {
        const old = snap.get(id);
        const cur = itemById(id);
        if (old) updateItemEverywhere(old, cur || null);
        if (cur) snap.set(id, { ...cur }); else snap.delete(id);
      });
      pending.clear();
    }, 300);
    const changed = (x) => { saveCatalog(); pending.add(x.id); flush(); };

    let usagePanel = null;
    const openUsage = (btn, x) => {
      if (usagePanel) return usagePanel.close();
      const list = usageOf(x.id);
      usagePanel = dropdown(btn, (box) => {
        box.append(h('div', { class: 'dd-head' }, h('b', null, oneLine(displayName(x))), h('span', { class: 'dd-sum' }, T('cat.usageN', { n: list.length }))));
        box.append(h('ul', null, list.map(({ doc, labels }) => h('li', null,
          h('button', { class: 'dd-item bl-item', onclick: () => { usagePanel.close(); showUsage(doc.id, x.id); } }, ico('file'),
            h('span', { class: 'bl-text' }, h('b', null, doc.name), h('small', null, labels.join(', '))))))));
      }, { onClose: () => { usagePanel = null; } });
    };

    const tree = h('div', { class: 'cat-tree' });
    let dragId = null;
    const moveTo = (id, parent) => {
      const x = itemById(id);
      if (!x || (parent && isAncestor(id, parent)) || (x.parent || null) === (parent || null)) return;
      x.parent = parent || null;
      saveCatalog();
      render();
    };
    const render = () => {
      tree.innerHTML = '';
      const rows = flatTree();
      if (!rows.length) tree.append(h('p', { class: 'dd-empty' }, ico('help'), T('cat.emptyHint')));
      rows.forEach(({ item: x, depth }) => {
        const r = Seq.roles.roleById(x.role);
        const icon = h('span', { class: 'role-icon', style: `--c:${r ? r.color : 'var(--muted)'}` }, ico('t-' + (r ? r.type : 'participant')));
        const shown = h('small', { class: 'role-example' });
        const refresh = () => {
          const rr = Seq.roles.roleById(x.role);
          icon.style.setProperty('--c', rr ? rr.color : 'var(--muted)');
          icon.innerHTML = '';
          icon.append(ico('t-' + (rr ? rr.type : 'participant')));
          shown.textContent = rr && (rr.prefix || rr.suffix) ? T('cat.willShow', { name: oneLine(displayName(x)) }) : '';
        };
        const name = h('input', { class: 'input', value: x.name, placeholder: T('cat.name') });
        name.addEventListener('input', () => { x.name = name.value.trim() || x.id; refresh(); changed(x); });
        const role = roleSelect(x.role);
        role.addEventListener('change', () => { x.role = role.value; refresh(); changed(x); });
        const desc = h('input', { class: 'input', value: x.desc || '', placeholder: T('cat.descPh') });
        desc.addEventListener('input', () => { if (desc.value.trim()) x.desc = desc.value.trim(); else delete x.desc; saveCatalog(); });
        const used = usageOf(x.id).length;
        const usage = used ? h('button', { class: 'cat-usage link', title: T('cat.usageTitle') }, T('cat.usageN', { n: used }))
          : h('span', { class: 'cat-usage' }, T('cat.usageN', { n: 0 }));
        if (used) usage.addEventListener('click', () => openUsage(usage, x));
        const addChild = h('button', { class: 'icon-btn sm', title: T('cat.addChild') }, ico('plus'));
        addChild.addEventListener('click', () => addItem(x.id));
        const del = h('button', { class: 'icon-btn sm del', title: T('delete') }, ico('trash'));
        del.addEventListener('click', () => {
          const kids = childrenOf(x.id);
          if ((used || kids.length) && !confirm(T('cat.confirmDelete', { name: x.name, n: used, k: kids.length }))) return;
          kids.forEach((k) => { k.parent = x.parent || null; });
          S.catalog = S.catalog.filter((y) => y !== x);
          changed(x);
          render();
        });
        const handle = h('span', { class: 'handle', title: T('cat.dragHint') }, ico('grip'));
        refresh();
        const row = h('div', { class: 'cat-row', 'data-id': x.id, style: `--depth:${depth}`, draggable: 'true' },
          handle, icon, h('div', { class: 'cat-name' }, name, shown), role, desc, usage, h('div', { class: 'cat-actions' }, addChild, del));
        // Sürükle-bırak: bir öğenin üstüne bırakınca onun altına taşınır
        row.addEventListener('dragstart', (e) => {
          if (e.target.closest('input, select')) { e.preventDefault(); return; }
          dragId = x.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.id); row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => { dragId = null; row.classList.remove('dragging'); $$('.cat-row.drop-into', tree).forEach((el) => el.classList.remove('drop-into')); rootZone.classList.remove('over'); });
        row.addEventListener('dragover', (e) => {
          if (!dragId || dragId === x.id || isAncestor(dragId, x.id)) return;
          e.preventDefault(); row.classList.add('drop-into');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-into'));
        row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('drop-into'); if (dragId) moveTo(dragId, x.id); });
        tree.append(row);
      });
      tree.append(rootZone);
    };
    const rootZone = h('div', { class: 'cat-root-zone' }, T('cat.dropRoot'));
    rootZone.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); rootZone.classList.add('over'); } });
    rootZone.addEventListener('dragleave', () => rootZone.classList.remove('over'));
    rootZone.addEventListener('drop', (e) => { e.preventDefault(); rootZone.classList.remove('over'); if (dragId) moveTo(dragId, null); });

    function addItem(parent) {
      if (!S.roles.length) return toast(T('cat.needRole'), 'err');
      const base = T('cat.newName');
      const x = { id: uniqueItemId(base), name: base, role: S.roles[0].id, parent: parent || null };
      S.catalog = S.catalog.concat([x]);
      saveCatalog();
      render();
      const inp = tree.querySelector(`.cat-row[data-id="${x.id}"] .cat-name .input`);
      if (inp) { inp.focus(); inp.select(); inp.scrollIntoView({ block: 'nearest' }); }
    }

    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        const arr = Array.isArray(data) ? data : data.catalog || [];
        let n = 0;
        arr.forEach((x) => {
          if (!x || !/^[A-Za-z0-9_-]+$/.test(x.id || '') || typeof x.name !== 'string' || typeof x.role !== 'string') return;
          const it = itemDef(x);
          it.id = x.id;
          const i = S.catalog.findIndex((y) => y.id === x.id);
          if (i >= 0) { if (!snap.has(x.id)) snap.set(x.id, { ...S.catalog[i] }); S.catalog[i] = it; } else S.catalog.push(it);
          changed(it);
          n++;
        });
        if (!Array.isArray(data) && Array.isArray(data.roles)) Seq.roles.adoptRoles(data.roles.filter((r) => r && r.id && !Seq.roles.roleById(r.id)));
        render();
        toast(T('cat.imported', { n }));
      } catch { toast(T('cat.importFailed'), 'err'); }
    });

    render();
    return h('div', { class: 'catalog-panel' },
      h('p', { class: 'roles-intro' }, T('cat.intro')),
      tree,
      h('div', { class: 'roles-foot' },
        h('div', { class: 'row', style: 'flex:none' },
          h('button', { class: 'btn sm', onclick: () => addItem(null) }, ico('plus'), T('cat.add'))),
        h('div', { class: 'row', style: 'flex:none' },
          h('button', { class: 'btn sm ghost', onclick: () => {
            // Öğelerle birlikte kullandıkları roller de dosyaya girer (başka tarayıcıda eksiksiz içe alınabilsin)
            const roles = [...new Set(S.catalog.map((x) => x.role))].map((id) => Seq.roles.roleById(id)).filter(Boolean);
            downloadBlob(new Blob([JSON.stringify({ catalog: S.catalog, roles }, null, 2)], { type: 'application/json' }), 'sequence-studio-catalog.json');
          } }, ico('download'), T('role.export')),
          h('button', { class: 'btn sm ghost', onclick: () => fileIn.click() }, ico('upload'), T('role.import')),
          fileIn)),
      h('p', { class: 'note-line' }, ico('help'), T('cat.note')));
  }
  /** Diyagramı açar ve öğeye bağlı ilk katılımcıyı gösterir */
  function showUsage(docId, itemId) {
    closeModal();
    if (!S.doc || S.doc.id !== docId) Seq.docs.openDoc(docId);
    const p = S.model.participants.find((x) => x.item === itemId);
    if (p) Seq.participants.revealCard(p.uid);
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    S.catalog = [];
  }

  Seq.catalog = {
    init, adoptItems, applyItem, buildPanel, childrenOf, displayName, itemById, openPicker, openSaveDialog, pathLabel, pathOf,
    saveCatalog, stripKnownDefs, unknownItems, usageOf, withDefs,
  };
})(window.Seq = window.Seq || {});
