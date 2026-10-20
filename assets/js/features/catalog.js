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
  // Üst öğesi katalogda olmayan öğeler en üst düzeyde görünür
  const parentOf = (x) => (x.parent && itemById(x.parent) ? x.parent : null);
  /** Bir öğenin doğrudan alt öğeleri (parent boşsa en üst düzey) ada göre */
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
  /** id, of'un atası mı (ya da kendisi mi)? Taşımada döngüyü engeller */
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
  // Eşleştirme: kataloğa bağlı olmayan katılımcı hangi öğe olabilir?
  // 1) Görünen ad birebir aynı (ör. "Ledger DB" ↔ Veritabanı rolündeki "Ledger") → kesin
  // 2) Ekler çıkarılmış ad öğenin adıyla aynı (ör. "Ledger" ya da "Ledger Svc" + rol eki) → aday
  // Büyük/küçük harf, Türkçe karakter ve boşluk farkları önemsenmez. Diyagramda zaten bağlı olan öğe önerilmez.
  // ---------------------------------------------------------------------------
  const key = (s) => norm(oneLine(s)).replace(/\s+/g, ' ').trim();
  /** Döner: { items: [öğe], exact } ya da null */
  function matchesFor(p, model) {
    if (p.item || !S.catalog.length) return null;
    const taken = new Set(((model && model.participants) || []).map((q) => q.item).filter(Boolean));
    const free = S.catalog.filter((x) => !taken.has(x.id));
    const label = key(p.label || p.id);
    const exact = free.filter((x) => key(displayName(x)) === label);
    if (exact.length) return { items: exact, exact: true };
    const ownCore = key(Seq.roles.stripAffixes(p.label || p.id, Seq.roles.roleById(p.role)));
    const loose = free.filter((x) => key(x.name) === ownCore || key(Seq.roles.stripAffixes(p.label || p.id, Seq.roles.roleById(x.role))) === key(x.name));
    return loose.length ? { items: loose, exact: false } : null;
  }
  /** Tüm diyagramlarda bağlanabilecek katılımcılar: [{ doc, pid, label, items, exact }] */
  function collectMatches() {
    const out = [];
    S.docs.forEach((d) => {
      let m;
      try { m = M.parse(codeOf(d)); } catch { return; }
      m.participants.forEach((p) => {
        const r = matchesFor(p, m);
        if (r) out.push({ doc: d, pid: p.id, label: oneLine(p.label || p.id), items: r.items, exact: r.exact });
      });
    });
    return out.sort((a, b) => a.doc.name.localeCompare(b.doc.name, I18N.getLang()) || a.label.localeCompare(b.label, I18N.getLang()));
  }
  /** Seçilen eşleşmeleri uygular: [{ doc, pid, item }]. Döner: bağlanan katılımcı sayısı */
  function applyMatches(list) {
    let n = 0, current = false;
    const byDoc = new Map();
    list.forEach((x) => { if (!byDoc.has(x.doc.id)) byDoc.set(x.doc.id, { doc: x.doc, rows: [] }); byDoc.get(x.doc.id).rows.push(x); });
    byDoc.forEach(({ doc, rows }) => {
      const isCur = S.doc && doc.id === S.doc.id;
      const model = isCur ? S.model : M.parse(doc.code);
      let changed = false;
      rows.forEach(({ pid, item }) => {
        const x = itemById(item);
        const p = model.participants.find((q) => q.id === pid && !q.item);
        // Aynı öğe bu diyagramda başka bir katılımcıya bağlandıysa ikinci kez bağlanmaz
        if (!x || !p || model.participants.some((q) => q.item === x.id)) return;
        applyItem(p, x);
        changed = true;
        n++;
      });
      if (!changed) return;
      if (isCur) current = true;
      else { doc.code = M.serialize(model); doc.updated = Date.now(); }
    });
    if (current) { Seq.editor.commit(); Seq.editor.flushHistory(); }
    Seq.docs.persistDocs();
    return n;
  }
  /** Katılımcıyı öğeye bağlar (açık diyagramda) */
  function linkParticipant(p, x) {
    applyItem(p, x);
    Seq.editor.commit();
    Seq.editor.flushHistory();
    toast(T('cat.linked', { p: oneLine(p.label), item: pathLabel(x.id) }));
  }
  /** Denetim: "katalog öğesiyle eşleşiyor" bulgusu, metni ve "Bağla / Seç…" düğmesi */
  function registerLintUi() {
    Seq.lint.addRuleUi('catalogMatch', {
      ctx: { catalogMatch: (p) => { const m = matchesFor(p, S.model); return m ? m.items.map((x) => x.id) : []; } },
      describe: (x) => {
        const p = S.model.participants.find((q) => q.uid === x.uid);
        const name = oneLine(p ? p.label : x.params.p);
        return x.params.items.length === 1
          ? T('lint.catalogMatch', { p: name, item: pathLabel(x.params.items[0]) })
          : T('lint.catalogMatchN', { p: name, n: x.params.items.length });
      },
      fix: (x) => {
        const p = S.model.participants.find((q) => q.uid === x.uid);
        const items = x.params.items.map(itemById).filter(Boolean);
        if (!p || !items.length) return null;
        if (items.length === 1) return { label: T('cat.linkBtn'), run: () => linkParticipant(p, items[0]) };
        return { label: T('cat.chooseBtn'), run: (anchor) => openPicker(anchor, { only: items.map((i) => i.id), title: T('cat.pickTitle'), onPick: (it) => linkParticipant(p, it) }) };
      },
    });
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
  // Ağaç seçici (palet, katılımcı paneli, denetim): aranabilir; tıkla ya da katılımcı alanına sürükle
  // ---------------------------------------------------------------------------
  let picker = null;
  /**
   * opts: { onPick(item), draggable, title, only: [öğe id] (yalnızca bunlar ve ataları gösterilir) }
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
      let rows = all;
      if (opts.only) {
        const keep = new Set();
        opts.only.forEach((id) => pathOf(id).forEach((x) => keep.add(x.id)));
        rows = rows.filter(({ item }) => keep.has(item.id));
      }
      // Aramada eşleşen öğeler atalarıyla birlikte gösterilir
      if (nq) {
        const keep = new Set();
        all.forEach(({ item }) => { if (norm(displayName(item) + ' ' + (item.desc || '')).includes(nq)) pathOf(item.id).forEach((x) => keep.add(x.id)); });
        rows = rows.filter(({ item }) => keep.has(item.id));
      }
      if (!rows.length) {
        list.append(h('li', { class: 'dd-empty' }, ico('help'), T(S.catalog.length ? 'cat.noMatch' : 'cat.empty')));
        return;
      }
      rows.forEach(({ item, depth }) => {
        const r = Seq.roles.roleById(item.role);
        const pickable = !opts.only || opts.only.includes(item.id);
        const hit = (nq ? norm(displayName(item) + ' ' + (item.desc || '')).includes(nq) : true) && pickable;
        const row = h('button', {
          class: 'dd-item cp-item' + (!hit ? ' dim' : ''), style: `padding-left:${8 + depth * 16}px;--c:${r ? r.color : 'var(--muted)'}`,
          title: item.desc || null, draggable: opts.draggable ? 'true' : null, 'data-id': item.id,
          disabled: pickable ? null : true, // aday olmayan atalar yalnızca bağlam için gösterilir
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
    const role = roleSelect(r0.id);
    // Önerilen ad: seçili rolün ekleri çıkarılmış ad ("Ledger DB" + rol " DB" → "Ledger"); elle yazılınca dokunulmaz
    const suggest = () => oneLine(Seq.roles.stripAffixes(p.label, Seq.roles.roleById(role.value))).trim();
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
  /**
   * opts: { match: true } → doğrudan "Eşleşenleri bağla" görünümüyle açılır
   */
  function buildPanel(opts) {
    const panel = h('div', { class: 'catalog-panel' });
    const showTree = () => { panel.innerHTML = ''; panel.append(buildTree(showMatch)); };
    const showMatch = () => { panel.innerHTML = ''; panel.append(buildMatchView(showTree)); };
    if (opts && opts.match) showMatch(); else showTree();
    return panel;
  }

  /** "Eşleşenleri bağla": tüm diyagramlardaki eşleşmeleri gözden geçirip seçilenleri bağlar */
  function buildMatchView(back) {
    const rows = collectMatches();
    const box = h('div', { class: 'cat-match' });
    const count = h('span', { class: 'dim-info' });
    const apply = h('button', { class: 'btn primary sm' }, ico('link'), h('span'));
    const state = rows.map((r) => ({ r, on: r.items.length === 1, item: r.items.length === 1 ? r.items[0].id : '' }));
    const update = () => {
      const n = state.filter((s) => s.on && s.item).length;
      apply.lastChild.textContent = T('cat.matchApply', { n });
      apply.disabled = !n || null;
      count.textContent = T('cat.matchSum', { n: rows.length, m: new Set(rows.map((r) => r.doc.id)).size });
    };
    box.append(h('div', { class: 'cat-match-head' },
      h('button', { class: 'btn ghost sm', onclick: back }, '← ', T('cat.title')),
      h('b', null, T('cat.matchTitle')), count));
    box.append(h('p', { class: 'roles-intro' }, T('cat.matchIntro')));
    if (!rows.length) box.append(h('p', { class: 'dd-empty ok' }, ico('check'), T('cat.matchNone')));
    let lastDoc = null;
    const list = h('div', { class: 'cat-match-list' });
    state.forEach((s) => {
      if (s.r.doc !== lastDoc) { lastDoc = s.r.doc; list.append(h('div', { class: 'cm-doc' }, ico('file'), s.r.doc.name)); }
      const cb = h('input', { type: 'checkbox' });
      cb.checked = s.on;
      cb.addEventListener('change', () => { s.on = cb.checked; update(); });
      let target;
      if (s.r.items.length === 1) {
        target = h('span', { class: 'cm-target' }, ico('layers'), pathLabel(s.r.items[0].id),
          h('span', { class: 'cm-kind' + (s.r.exact ? ' exact' : '') }, T(s.r.exact ? 'cat.matchExact' : 'cat.matchLoose')));
      } else {
        // Belirsiz: kullanıcı seçer; seçilmeden bağlanmaz
        const sel = h('select', { class: 'select sm' }, h('option', { value: '' }, T('cat.matchChoose', { n: s.r.items.length })),
          s.r.items.map((x) => h('option', { value: x.id }, pathLabel(x.id))));
        sel.addEventListener('change', () => { s.item = sel.value; s.on = !!sel.value; cb.checked = s.on; update(); });
        target = h('span', { class: 'cm-target' }, sel);
      }
      list.append(h('label', { class: 'cm-row', 'data-doc': s.r.doc.id, 'data-pid': s.r.pid }, cb, h('span', { class: 'cm-label' }, s.r.label), h('span', { class: 'cm-arrow' }, '→'), target));
    });
    box.append(list);
    apply.addEventListener('click', () => {
      const n = applyMatches(state.filter((s) => s.on && s.item).map((s) => ({ doc: s.r.doc, pid: s.r.pid, item: s.item })));
      toast(T('cat.matchDone', { n }));
      events.emit('catalog:changed');
      back();
    });
    if (rows.length) box.append(h('div', { class: 'roles-foot' }, h('div', { class: 'row', style: 'flex:none' }), h('div', { class: 'row', style: 'flex:none' }, apply)));
    update();
    return box;
  }

  /** Ağaç görünümü; onMatch: "Eşleşenleri bağla" görünümüne geçiş */
  function buildTree(onMatch) {
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
    const matchCount = collectMatches().length;
    return h('div', null,
      h('p', { class: 'roles-intro' }, T('cat.intro')),
      tree,
      h('div', { class: 'roles-foot' },
        h('div', { class: 'row', style: 'flex:none' },
          h('button', { class: 'btn sm', onclick: () => addItem(null) }, ico('plus'), T('cat.add')),
          h('button', { class: 'btn sm ghost', title: T('cat.matchTitleHint'), disabled: !matchCount || null, onclick: onMatch },
            ico('link'), T('cat.matchBtn'), matchCount ? h('span', { class: 'cat-count' }, String(matchCount)) : null)),
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
    registerLintUi();
  }

  Seq.catalog = {
    init, adoptItems, applyItem, buildPanel, childrenOf, displayName, itemById, linkParticipant, matchesFor, openPicker, openSaveDialog,
    pathLabel, pathOf, saveCatalog, stripKnownDefs, unknownItems, usageOf, withDefs,
  };
})(window.Seq = window.Seq || {});
