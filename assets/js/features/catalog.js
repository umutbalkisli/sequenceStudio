/* Sequence Studio — katılımcı kataloğu
 *
 * Diyagramlarda tekrar kullanılan somut katılımcıların global hiyerarşisi (C4 modeli gibi: ör. Ödeme sistemi
 * › Ledger › Ledger DB). Rol "nasıl görünür" sorusunu, katalog öğesi "kimdir" sorusunu yanıtlar:
 *
 *   diyagramdaki katılımcı → katalog öğesi → rol
 *
 * Öğe: { id, name, kind, role, parent?, desc? } — kind C4 türüdür: group (yalnızca düzenleme; çizilmez, katılımcı
 * olamaz), person, system, container, component. Rol isteğe bağlıdır: seçilirse görünüm (şekil, renk, ön/son ek)
 * rolden, seçilmezse türden gelir (lookOf). Üst öğe de katılımcı olabilir (bir diyagramda sistem tek kutu, başka
 * birinde içindekiler).
 * Yerleşim kuralları (ör. bileşen bir konteynerin içinde) zorlanmaz, katalog penceresinde uyarı olarak gösterilir.
 * Öğeye bağlı katılımcının adı öğenin (ekleriyle) adıdır; diyagramda değiştirilmediği sürece öğeyi izler.
 * Kodda: "%% @item id" (katılımcıdan önce), dışarı taşınan tanım "%% @itemdef id {json}".
 */
(function (Seq) {
  'use strict';
  const { I18N, M, S, T, closeModal, debounce, downloadBlob, dropdown, events, h, ico, norm, oneLine, openModal, toast } = Seq.core;

  const saveCatalog = () => { Seq.palette.renderPalette(); events.emit('catalog:changed'); return Seq.repo.saveCatalog(S.catalog).catch(Seq.docs.storageError); };
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
  /** Öğenin görünen adı: rolün ön/son ekleriyle (gruplarda yalnızca ad) */
  const displayName = (x) => (x.kind === 'group' ? x.name : Seq.roles.composeLabel(Seq.roles.roleById(x.role), x.name));

  // --- C4 türü ---
  const C4 = () => window.SeqC4;
  const roleType = (id) => { const r = Seq.roles.roleById(id); return r ? r.type : ''; };
  /** Öğenin türü (türü olmayan eski öğede yerinden tahmin edilir) */
  const kindOf = (x) => (x && C4().KINDS.includes(x.kind) ? x.kind : C4().levelOf(C4().index(S.catalog), x, roleType(x.role)));
  const isGroup = (x) => kindOf(x) === 'group';
  // Rolü olmayan öğenin görünümü türden gelir
  const KIND_LOOK = {
    person: { type: 'actor', color: '#6c7cff' }, system: { type: 'participant', color: '#3a8dde' },
    container: { type: 'participant', color: '#2fa5c9' }, component: { type: 'participant', color: '#20b8a6' },
    group: { type: 'participant', color: '#8a93a6' },
  };
  /** Öğenin görünümü: { type, color, role } — rol varsa rolden, yoksa C4 türünden */
  function lookOf(x) {
    const r = Seq.roles.roleById(x.role);
    return r ? { type: r.type, color: r.color, role: r } : Object.assign({ role: null }, KIND_LOOK[kindOf(x)] || KIND_LOOK.system);
  }
  /** Görünümü katılımcıya yazar */
  function applyLook(p, x) {
    const lk = lookOf(x);
    if (lk.role) p.role = lk.role.id; else delete p.role;
    p.type = lk.type;
    p.color = lk.color;
  }
  /** Yeni öğenin varsayılan türü: üst öğeye ve rolüne göre */
  const defaultKindFor = (parentId, roleId) => C4().defaultKind(parentId && itemById(parentId) ? kindOf(itemById(parentId)) : null, roleType(roleId));
  /** Türü olmayan öğelere bugünkü yerlerine göre tür yazar (eski kataloglar, içe alınanlar). Değiştiyse true */
  function fillKinds() {
    const ix = C4().index(S.catalog);
    const missing = S.catalog.filter((x) => !C4().KINDS.includes(x.kind));
    const kinds = missing.map((x) => C4().levelOf(ix, x, roleType(x.role)));
    missing.forEach((x, i) => { x.kind = kinds[i]; });
    return missing.length > 0;
  }
  /** Açılışta bir kez: eski kataloğa türleri yazar */
  function migrate() { if (fillKinds()) saveCatalog(); }
  /** Yerleşim uyarısı metni (uygunsa null) */
  function placementWarning(x) {
    const ok = C4().placementIssue(kindOf(x), parentOf(x) ? kindOf(itemById(parentOf(x))) : null);
    if (!ok) return null;
    return T('cat.place.' + kindOf(x));
  }
  const kindSelect = (value, withGroup) => {
    const sel = h('select', { class: 'select cat-kind', title: T('cat.kindTitle') },
      C4().KINDS.filter((k) => withGroup || k !== 'group').map((k) => h('option', { value: k }, T('c4.' + k))));
    sel.value = value;
    return sel;
  };
  /** id, of'un atası mı (ya da kendisi mi)? Taşımada döngüyü engeller */
  const isAncestor = (id, of) => pathOf(of).some((x) => x.id === id);
  const uniqueItemId = (name) => Seq.core.uniqueId(name, 'item', itemById);
  /** Tüm alt öğeler (derinlik öncelikli, ağaç sırasıyla) ve derinlikleri */
  function flatTree(parentId = null, depth = 0, out = []) {
    childrenOf(parentId).forEach((x) => { out.push({ item: x, depth }); flatTree(x.id, depth + 1, out); });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Katılımcıya uygulama ve değişikliklerin yayılması
  // ---------------------------------------------------------------------------
  /** Öğeyi katılımcıya bağlar: görünüm (rolden ya da türden) ve ad öğeden gelir. */
  function applyItem(p, x) {
    p.item = x.id;
    applyLook(p, x);
    p.label = displayName(x);
    p.implicit = false;
    if (p.autoId) {
      const nid = Seq.participants.uniqueId(p.label, p.uid);
      Seq.participants.renameRefs(p.id, nid);
      p.id = nid;
    }
  }
  const markerOf = (id) => new RegExp('^\\s*%%\\s*@item\\s+' + id + '\\s*$', 'm');
  const codeOf = (d) => Seq.core.docCode(d);
  /**
   * Öğe değişikliği yerleşti/öğe silindi: eski hâl öğenin geçmişine yazılır, açık akış hemen uyarlanır.
   * Diğer akışlar yeniden yazılmaz; açılırken ya da okunurken uyarlanır (bkz. reconcile.js).
   */
  function settleItem(old, cur) {
    if (Seq.reconcile.itemChanged(old, cur)) saveCatalog();
    Seq.reconcile.current(cur ? null : { goneItems: [old.id] });
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
    const free = S.catalog.filter((x) => !taken.has(x.id) && !isGroup(x));
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
    if (!Seq.workspace.editable()) return 0;
    let n = 0, current = false;
    const byDoc = new Map();
    list.forEach((x) => { if (!byDoc.has(x.doc.id)) byDoc.set(x.doc.id, { doc: x.doc, rows: [] }); byDoc.get(x.doc.id).rows.push(x); });
    byDoc.forEach(({ doc, rows }) => {
      const isCur = S.doc && doc.id === S.doc.id;
      const model = isCur ? S.model : M.parse(codeOf(doc));
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
    if (!Seq.workspace.editable()) return;
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
  const itemDef = (x) => Object.assign({ name: x.name, kind: kindOf(x), role: x.role }, x.parent ? { parent: x.parent } : {}, x.desc ? { desc: x.desc } : {});
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
        kind: C4().KINDS.includes(d.kind) ? d.kind : undefined,
        role: typeof d.role === 'string' && d.role ? d.role : (p && p.role) || undefined,
        parent: typeof d.parent === 'string' && d.parent ? d.parent : null,
        desc: typeof d.desc === 'string' && d.desc.trim() ? d.desc.trim() : undefined,
      });
      if (d.parent) visit(d.parent, null);
    };
    model.participants.forEach((p) => visit(p.item, p));
    return [...out.values()].map((x) => { ['desc', 'kind', 'role'].forEach((k) => { if (!x[k]) delete x[k]; }); return x; });
  }
  function adoptItems(defs) {
    if (!defs.length) return;
    S.catalog = S.catalog.concat(defs.filter((x) => !itemById(x.id)));
    fillKinds();
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
        const lk = lookOf(item);
        const pickable = !isGroup(item) && (!opts.only || opts.only.includes(item.id));
        const hit = (nq ? norm(displayName(item) + ' ' + (item.desc || '')).includes(nq) : true) && pickable;
        const row = h('button', {
          class: 'dd-item cp-item' + (!hit ? ' dim' : ''), style: `padding-left:${8 + depth * 16}px;--c:${lk.color}`,
          title: item.desc || null, draggable: opts.draggable ? 'true' : null, 'data-id': item.id,
          disabled: pickable ? null : true, // aday olmayan atalar yalnızca bağlam için gösterilir
          onclick: () => { close(); opts.onPick(item); },
        }, ico(isGroup(item) ? 'folder' : 't-' + lk.type), h('span', { class: 'cp-name' }, oneLine(displayName(item))),
          h('small', null, [T('c4.' + kindOf(item)), lk.role && lk.role.name].filter(Boolean).join(' · ')));
        if (opts.draggable && pickable) {
          row.addEventListener('dragstart', (e) => Seq.flow.startDrag(e, { kind: 'newPart', type: lk.type, role: item.role, item: item.id }));
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
        h('button', { class: 'icon-btn sm', title: T('cat.manage'), onclick: () => { close(); Seq.router.go('catalog'); } }, ico('edit'))));
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
  /** Rol seçimi; ilk seçenek "rol yok" (görünüm türden gelir) */
  const roleSelect = (value) => {
    const sel = h('select', { class: 'select cat-role', title: T('cat.roleTitle') }, h('option', { value: '' }, T('cat.noRole')),
      (S.roles || []).map((r) => h('option', { value: r.id }, r.name)));
    sel.value = value && Seq.roles.roleById(value) ? value : '';
    return sel;
  };
  function openSaveDialog(p) {
    // Rol önerisi: katılımcının rolü, yoksa aynı şekildeki ilk rol, o da yoksa rolsüz
    const r0 = Seq.roles.roleById(p.role) || (S.roles || []).find((r) => r.type === p.type) || null;
    const role = roleSelect(r0 ? r0.id : '');
    // Önerilen ad: seçili rolün ekleri çıkarılmış ad ("Ledger DB" + rol " DB" → "Ledger"); elle yazılınca dokunulmaz
    const suggest = () => oneLine(Seq.roles.stripAffixes(p.label, Seq.roles.roleById(role.value))).trim();
    const name = h('input', { class: 'input' });
    name.value = suggest();
    let nameTouched = false;
    name.addEventListener('input', () => { nameTouched = true; });
    const parent = parentSelect('');
    parent.classList.add('cat-parent');
    // Tür: üst öğeye ve role göre önerilir; elle seçilince dokunulmaz
    const kind = kindSelect(defaultKindFor(null, role.value), false);
    let kindTouched = false;
    kind.addEventListener('change', () => { kindTouched = true; refreshWarn(); });
    const warn = h('small', { class: 'cat-warn' });
    const refreshWarn = () => {
      const pk = parent.value && itemById(parent.value) ? kindOf(itemById(parent.value)) : null;
      warn.textContent = C4().placementIssue(kind.value, pk) ? T('cat.place.' + kind.value) : '';
    };
    const suggestKind = () => { if (!kindTouched) kind.value = defaultKindFor(parent.value, role.value); refreshWarn(); };
    parent.addEventListener('change', suggestKind);
    role.addEventListener('change', suggestKind);
    const desc = h('input', { class: 'input', placeholder: T('cat.descPh') });
    const preview = h('small', { class: 'cs-preview' });
    const refresh = () => { preview.textContent = T('cat.willShow', { name: oneLine(Seq.roles.composeLabel(Seq.roles.roleById(role.value), name.value.trim() || '…')) }); };
    name.addEventListener('input', refresh);
    role.addEventListener('change', () => { if (!nameTouched) name.value = suggest(); refresh(); });
    refresh();
    refreshWarn();
    const save = () => {
      const n = name.value.trim();
      if (!n) return name.focus();
      const x = { id: uniqueItemId(n), name: n, kind: kind.value, parent: parent.value || null };
      if (role.value) x.role = role.value;
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
      h('div', { class: 'field' }, h('label', null, T('cat.kind')), kind, warn),
      h('div', { class: 'field' }, h('label', null, T('cat.name')), name, preview),
      h('div', { class: 'field' }, h('label', null, T('cat.role')), role, h('small', null, T('cat.roleHint'))),
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
  // Öğe işlemleri (katalog sayfası ve diğer ekranlar bunları kullanır)
  // Değişiklikler gecikmeli olarak tüm diyagramlara yayılır: ilk değişiklikten önceki tanım saklanır,
  // kısa bir bekleyişten sonra eski → yeni farkı bağlı katılımcılara uygulanır.
  // ---------------------------------------------------------------------------
  const snaps = new Map();
  const pendingIds = new Set();
  const flushPending = debounce(() => {
    pendingIds.forEach((id) => {
      const old = snaps.get(id);
      if (old) settleItem(old, itemById(id) || null);
      snaps.delete(id);
    });
    pendingIds.clear();
  }, 300);
  /** Değişiklik öncesi tanımı saklar ve yayılımı planlar */
  function willChange(x, fn) {
    if (!snaps.has(x.id)) snaps.set(x.id, { ...x });
    fn();
    saveCatalog();
    pendingIds.add(x.id);
    flushPending();
  }
  /** Öğeyi günceller. patch: { name?, kind?, role?, desc? } — boş rol/açıklama alanı kaldırır */
  function updateItem(id, patch) {
    if (!Seq.workspace.editable()) return null;
    const x = itemById(id);
    if (!x) return null;
    willChange(x, () => {
      Object.keys(patch).forEach((k) => {
        const v = patch[k];
        if ((k === 'role' || k === 'desc') && !v) delete x[k];
        else if (k === 'name') x.name = String(v).trim() || x.id;
        else x[k] = v;
      });
    });
    return x;
  }
  /** Yeni öğe; tür verilmezse üst öğeye göre önerilir */
  function createItem(opts) {
    if (!Seq.workspace.editable()) return null;
    opts = opts || {};
    const name = (opts.name || T('cat.newName')).trim();
    const x = { id: uniqueItemId(name), name, kind: opts.kind || defaultKindFor(opts.parent, opts.role || ''), parent: opts.parent || null };
    if (opts.role) x.role = opts.role;
    if (opts.desc) x.desc = opts.desc;
    S.catalog = S.catalog.concat([x]);
    saveCatalog();
    return x;
  }
  /** Öğeyi siler; alt öğeleri bir üst düzeye çıkar, bağlı katılımcıların katalog bağlantısı kalkar */
  function removeItem(id) {
    if (!Seq.workspace.editable()) return;
    const x = itemById(id);
    if (!x) return;
    willChange(x, () => {
      childrenOf(x.id).forEach((k) => { k.parent = x.parent || null; });
      S.catalog = S.catalog.filter((y) => y !== x);
    });
  }
  /** Öğeyi başka bir üst öğenin altına (ya da en üste) taşır; döngü oluşturacaksa false */
  function moveItem(id, parent) {
    if (!Seq.workspace.editable()) return false;
    const x = itemById(id);
    if (!x || (parent && isAncestor(id, parent))) return false;
    if ((x.parent || null) === (parent || null)) return true;
    x.parent = parent || null;
    saveCatalog();
    return true;
  }
  /** Katalog dosyası: öğeler ve kullandıkları roller (başka tarayıcıda eksiksiz içe alınabilsin) */
  function exportFile() {
    const roles = [...new Set(S.catalog.map((x) => x.role))].map((id) => Seq.roles.roleById(id)).filter(Boolean);
    downloadBlob(new Blob([JSON.stringify({ catalog: S.catalog, roles }, null, 2)], { type: 'application/json' }), 'sequence-studio-catalog.json');
  }
  /** Katalog dosyasını içe alır (aynı kimlikli öğeler güncellenir). Döner: içe alınan öğe sayısı */
  async function importFile(file) {
    const data = JSON.parse(await file.text());
    const arr = Array.isArray(data) ? data : data.catalog || [];
    if (!Array.isArray(data) && Array.isArray(data.roles)) Seq.roles.adoptRoles(data.roles.filter((r) => r && r.id && !Seq.roles.roleById(r.id)));
    let n = 0;
    arr.forEach((x) => {
      if (!x || !/^[A-Za-z0-9_-]+$/.test(x.id || '') || typeof x.name !== 'string') return;
      const it = itemDef(x);
      it.id = x.id;
      const i = S.catalog.findIndex((y) => y.id === x.id);
      if (i >= 0) willChange(S.catalog[i], () => { S.catalog[i] = it; });
      else S.catalog.push(it);
      n++;
    });
    fillKinds();
    saveCatalog();
    return n;
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

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    S.catalog = [];
    registerLintUi();
  }

  Seq.catalog = {
    init, adoptItems, applyItem, applyLook, buildMatchView, childrenOf, collectMatches, createItem, displayName, exportFile, flatTree, importFile, isAncestor,
    isGroup, itemById, kindOf, kindSelect, linkParticipant, lookOf, matchesFor, migrate, moveItem, openPicker, openSaveDialog, parentOf, parentSelect,
    pathLabel, pathOf, placementWarning, removeItem, roleSelect, saveCatalog, stripKnownDefs, unknownItems, updateItem, usageOf, withDefs,
  };
})(window.Seq = window.Seq || {});
