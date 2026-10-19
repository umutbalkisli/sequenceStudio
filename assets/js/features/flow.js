/* Sequence Studio — akış
 *
 * Akış adımlarının oluşturulması ve çizimi (mesaj, not, referans, aktivasyon, blok), seçim, sürükle-bırak,
 * ton ve blok rengi seçicileri, çok satırlı metin alanları.
 */
(function (Seq) {
  'use strict';
  const { $$, I18N, M, S, T, TONE_COLORS, add, debounce, el, events, fitTextarea, h, ico, multiline, oneLine, participantById, toast } = Seq.core;

  // ---------------------------------------------------------------------------
  // Akış adımları
  // ---------------------------------------------------------------------------
  const branchPh = (type) => (['loop', 'alt', 'opt', 'par', 'par_over', 'critical', 'break', 'rect'].includes(type) ? T('ph.' + (type === 'par_over' ? 'par' : type)) : T('ph.label'));
  const BRANCH_LABEL = { else: 'Else', and: 'And', option: 'Option' };
  const RECT_SWATCHES = ['rgba(108, 124, 255, 0.12)', 'rgba(47, 191, 127, 0.14)', 'rgba(240, 160, 32, 0.16)', 'rgba(236, 90, 143, 0.14)', 'rgba(138, 147, 166, 0.16)'];
  const actLabel = (act) => T(act === '+' ? 'act.plus' : act === '-' ? 'act.minus' : 'act.none');

  function insertionPoint() {
    const f = S.selected && M.findNode(S.model, S.selected);
    if (f) {
      if (f.branch) return { list: f.branch.items, index: f.branch.items.length };
      return { list: f.list, index: f.index + 1 };
    }
    return { list: S.model.items, index: S.model.items.length };
  }

  function addStep(kind, list, index) {
    const node = Seq.steps.create(kind);
    if (node === false) return null; // adım türü kendi uyarısını gösterdi
    if (!node) { toast(T('err.needParticipant'), 'err'); return null; }
    insertNode(node, list, index);
    return node;
  }
  function addMessageFrom(id) {
    const P = S.model.participants;
    const i = P.findIndex((p) => p.id === id);
    const to = (P[i + 1] || P[i - 1] || P[i]).id;
    insertNode({ uid: M.uid(), kind: 'message', from: id, to, arrow: '->>', act: '', text: '' });
  }

  function insertNode(node, list, index) {
    if (!list) { const ip = insertionPoint(); list = ip.list; index = ip.index; }
    list.splice(index == null ? list.length : index, 0, node);
    S.selected = node.uid;
    Seq.editor.commit();
    Seq.editor.flushHistory();
    focusStep(node.uid);
  }

  function focusStep(nodeUid) {
    requestAnimationFrame(() => {
      const row = el.flow.querySelector(`[data-uid="${nodeUid}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const inp = row.querySelector('.text-input');
      if (inp) { inp.focus({ preventScroll: true }); if (inp.select && inp.value) inp.select(); }
    });
  }

  function deleteNode(nodeUid) {
    const f = M.findNode(S.model, nodeUid);
    if (!f || !f.node) return;
    const next = f.list[f.index + 1] || f.list[f.index - 1];
    f.list.splice(f.index, 1);
    S.selected = next ? next.uid : null;
    Seq.editor.commit();
    Seq.editor.flushHistory();
  }
  function duplicateNode(nodeUid) {
    const f = M.findNode(S.model, nodeUid);
    if (!f || !f.node) return;
    const c = M.cloneWithNewUids(f.node);
    f.list.splice(f.index + 1, 0, c);
    S.selected = c.uid;
    Seq.editor.commit();
    Seq.editor.flushHistory();
    focusStep(c.uid);
  }
  function moveNodeBy(nodeUid, delta) {
    const f = M.findNode(S.model, nodeUid);
    if (!f || !f.node) return;
    let j = f.index + delta;
    while (f.list[j] && f.list[j].auto) j += delta;
    if (j < 0 || j >= f.list.length) return;
    f.list.splice(f.index, 1);
    f.list.splice(j, 0, f.node);
    Seq.editor.commit();
    focusRow(nodeUid);
  }
  function focusRow(nodeUid) {
    requestAnimationFrame(() => {
      const row = el.flow.querySelector(`[data-uid="${nodeUid}"]`);
      if (row) row.scrollIntoView({ block: 'nearest' });
    });
  }

  /**
   * Adımı (ya da blok kolunu) görünür kılar: daraltılmış ata blokları açar, seçer, ortalar ve kısaca vurgular.
   * focusText: adımın metin alanına odaklan.
   */
  function reveal(uid, opts) {
    let changed = false;
    const path = [];
    const visit = (items) => items.some((it) => {
      if (it.uid === uid) return true;
      if (it.kind !== 'block') return false;
      path.push(it);
      if (it.branches.some((br) => br.uid === uid || visit(br.items))) return true;
      path.pop();
      return false;
    });
    if (!visit(S.model.items)) return false;
    path.forEach((b) => { if (S.collapsed.has(b.uid)) { S.collapsed.delete(b.uid); changed = true; } });
    if (changed) renderBuilder();
    setSelected(uid);
    const row = el.flow.querySelector(`[data-uid="${uid}"], [data-branch="${uid}"]`);
    if (!row) return false;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
    const inp = opts && opts.focusText && row.querySelector('.text-input');
    if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 250);
    return true;
  }

  function setSelected(id) {
    S.selected = id;
    $$('.step.selected, .empty-list.selected, .branch.selected', el.flow).forEach((x) => x.classList.remove('selected'));
    if (!id) return;
    const row = el.flow.querySelector(`[data-uid="${id}"]`);
    if (row) row.classList.add('selected');
    const br = el.flow.querySelector(`[data-branch="${id}"]`);
    if (br) {
      br.classList.add('selected');
      const empty = br.querySelector(':scope > .step-list > .empty-list');
      if (empty) empty.classList.add('selected');
    }
  }

  // --- Render ---
  const listReg = new Map();

  /**
   * Yeniden çizim sırasında kaydırma konumunu korur. İçerik bir anlığına boşaldığında konum 0'a
   * düşer; geri yükleme, builder'ın "smooth" kaydırması yüzünden animasyonlu olmasın diye anlık yapılır.
   */
  function keepScroll(fn) {
    const sc = el.bscroll;
    const st = sc.scrollTop;
    sc.style.scrollBehavior = 'auto';
    try { fn(); } finally {
      sc.scrollTop = st;
      sc.style.scrollBehavior = '';
    }
  }
  function renderBuilder() {
    keepScroll(() => { Seq.participants.renderParticipants(); renderFlow(); });
  }

  function renderFlow() {
    listReg.clear();
    const counter = { n: 0 };
    el.flow.innerHTML = '';
    el.flow.append(renderList(S.model.items, 'root', counter));
    let steps = 0;
    M.walk(S.model.items, (it) => { if (!it.auto) steps++; });
    el.stepCount.textContent = steps;
    if (S.selected) setSelected(S.selected);
    events.emit('builder:rendered');
  }

  function renderList(items, listId, counter) {
    listReg.set(listId, items);
    const list = h('div', { class: 'step-list' + (listId === 'root' ? ' root' : ''), 'data-list': listId });
    if (!items.some((it) => !it.auto)) {
      if (listId === 'root') {
        list.append(h('div', { class: 'empty-list flow-empty' }, ico('blocks'), h('b', null, T('flow.empty')),
          h('span', null, T(S.model.participants.length >= 2 ? 'flow.emptyHintLink' : 'flow.emptyHintAdd'))));
      } else {
        list.append(h('div', { class: 'empty-list' + (S.selected === listId ? ' selected' : ''), 'data-select-branch': listId }, T('flow.dropHere')));
      }
    }
    items.forEach((it) => list.append(renderStep(it, counter)));
    return list;
  }

  function stepShell(it, cls) {
    return h('div', { class: `step ${cls}` + (S.selected === it.uid ? ' selected' : ''), 'data-uid': it.uid });
  }
  function handleEl() { return h('div', { class: 'handle', title: T('drag') }, ico('grip')); }
  function actionsEl(it, extra) {
    return h('div', { class: 'step-actions' },
      extra || null,
      h('button', { class: 'icon-btn', title: T('duplicateKey'), onclick: () => duplicateNode(it.uid) }, ico('copy')),
      h('button', { class: 'icon-btn del', title: T('deleteKey'), onclick: () => deleteNode(it.uid) }, ico('trash')));
  }
  /**
   * Metin alanı: "mono" olanlar tek satırlık input, diğerleri içeriğe göre büyüyen
   * textarea. Satır sonları Mermaid'e <br/> olarak yazılır. Yeni satır: Alt+Enter
   * (her yerde) ve Shift+Enter (opts.shiftNewline !== false iken; mesajda Shift+Enter
   * yanıt eklediği için kapalı). Düz Enter satır eklemez; alanın kendi davranışı çalışır.
   */
  function textInput(value, placeholder, onInput, cls, opts) {
    if (cls === 'mono') {
      const inp = h('input', { class: 'text-input mono', value: value || '', placeholder, spellcheck: 'false' });
      inp.addEventListener('input', () => { onInput(inp.value); Seq.editor.commit({ rerender: false }); });
      inp.addEventListener('blur', Seq.editor.flushHistory);
      return inp;
    }
    const ta = h('textarea', { class: 'text-input' + (cls ? ' ' + cls : ''), rows: 1, value: value || '', placeholder, spellcheck: 'false' });
    multiline(ta, opts);
    ta.addEventListener('input', () => { onInput(ta.value); Seq.editor.commit({ rerender: false }); });
    ta.addEventListener('blur', Seq.editor.flushHistory);
    return ta;
  }

  // Panel genişliği değişince satır kaymaları değişir → yükseklikleri yeniden hesapla
  const refitAll = debounce(() => $$('textarea.text-input, textarea.input').forEach(fitTextarea), 60);

  function renderStep(it, counter) {
    switch (it.kind) {
      case 'message': return renderMessage(it, counter);
      case 'note': return it.ref != null ? renderRef(it) : renderNote(it);
      // Otomatik aktivasyonun ürettiği düzeltme satırları gizli tutulur; DOM'da
      // yer almaları sürükle-bırak indekslerinin modelle hizalı kalmasını sağlar.
      case 'activation': return it.auto ? h('div', { class: 'step auto-act', hidden: true, 'data-uid': it.uid }) : renderActivation(it);
      case 'block': return renderBlock(it, counter);
      default: return renderRaw(it);
    }
  }

  function renderMessage(it, counter) {
    counter.n++;
    const row = stepShell(it, 'step-message' + (it.arrow.startsWith('--') || it.arrow.startsWith('<<--') ? ' reply' : ''));
    if (it.tone && TONE_COLORS[it.tone]) { row.classList.add('toned'); row.style.setProperty('--c', TONE_COLORS[it.tone]); }
    const aSel = h('select', { class: 'aselect', title: T('arrow.title') });
    M.ARROWS.forEach((a) => aSel.append(h('option', { value: a.v }, a.glyph + '  ' + T('arrow.' + a.v))));
    if (!M.ARROWS.some((a) => a.v === it.arrow)) aSel.append(h('option', { value: it.arrow }, it.arrow));
    aSel.value = it.arrow;
    // Seçili değerde sadece glifi göster
    const shortLabel = () => { $$('option', aSel).forEach((o) => { const a = M.ARROWS.find((x) => x.v === o.value); o.textContent = a ? (o.selected ? a.glyph : a.glyph + '  ' + T('arrow.' + a.v)) : o.value; }); };
    aSel.addEventListener('focus', () => $$('option', aSel).forEach((o) => { const a = M.ARROWS.find((x) => x.v === o.value); if (a) o.textContent = a.glyph + '  ' + T('arrow.' + a.v); }));
    aSel.addEventListener('blur', shortLabel);
    aSel.addEventListener('change', () => { it.arrow = aSel.value; Seq.editor.commit(); Seq.editor.flushHistory(); });
    shortLabel();

    let actBtn = null;
    if (Seq.editor.isAutoAct()) {
      // Otomatik mod: hesaplanan başlangıç / bitişi salt okunur rozet olarak göster
      if (it.act) {
        const who = participantById(it.act === '+' ? it.to : it.from);
        const name = oneLine(who ? who.label || who.id : (it.act === '+' ? it.to : it.from));
        actBtn = h('span', { class: 'act-badge ' + (it.act === '+' ? 'start' : 'end'), title: T(it.act === '+' ? 'act.autoStart' : 'act.autoEnd', { name }) },
          ico('activate'), h('span', { class: 'act-name' }, (it.act === '+' ? '▶ ' : '■ ') + name));
      }
    } else {
      actBtn = h('button', { class: 'act-btn' + (it.act === '+' ? ' on' : it.act === '-' ? ' off' : ''), title: actLabel(it.act) + ' — ' + T('act.click') },
        ico('activate'), it.act === '+' ? '+' : it.act === '-' ? '−' : '');
      actBtn.addEventListener('click', () => { it.act = it.act === '' ? '+' : it.act === '+' ? '-' : ''; Seq.editor.commit(); Seq.editor.flushHistory(); });
    }

    const txt = textInput(it.text, T('ph.message'), (v) => { it.text = v; }, null, { shiftNewline: false });
    txt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        S.selected = it.uid;
        const reply = e.shiftKey
          ? { uid: M.uid(), kind: 'message', from: it.to, to: it.from, arrow: it.arrow.startsWith('--') ? '->>' : '-->>', act: '', text: it.arrow.startsWith('--') ? '' : Seq.steps.REPLY_TEXT }
          : { uid: M.uid(), kind: 'message', from: it.from, to: it.to, arrow: it.arrow, act: '', text: '' };
        insertNode(reply);
      }
    });
    add(row, 
      handleEl(),
      S.model.autonumber ? h('span', { class: 'num' }, counter.n) : null,
      h('div', { class: 'route' },
        Seq.combo.pSelect(it.from, (v) => { it.from = v; }),
        aSel,
        Seq.combo.pSelect(it.to, (v) => { it.to = v; })),
      toneBtn(it),
      txt,
      actBtn,
      actionsEl(it, h('button', { class: 'icon-btn', title: T('swap'), onclick: () => { [it.from, it.to] = [it.to, it.from]; Seq.editor.commit(); Seq.editor.flushHistory(); } }, ico('swap'))),
    );
    return row;
  }

  /** Mesaj tonu seçici: küçük renkli nokta → menü (Varsayılan / Başarılı / Hata / Uyarı / Bilgi) */
  function toneBtn(it) {
    const btn = h('button', { class: 'tone-btn' + (it.tone ? ' on' : ''), title: T('tone.title') + (it.tone ? ': ' + T('tone.' + it.tone) : ''),
      style: it.tone ? `--tc:${TONE_COLORS[it.tone]}` : null });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = btn.parentNode.querySelector('.tone-menu');
      closeColorMenus();
      if (open) return;
      const set = (v) => {
        if (v) it.tone = v; else delete it.tone;
        closeColorMenus();
        Seq.editor.commit(); Seq.editor.flushHistory();
      };
      const menu = h('div', { class: 'color-menu tone-menu', onclick: (ev) => ev.stopPropagation() },
        [''].concat(M.TONES).map((v) => h('button', { class: 'tm-opt' + ((it.tone || '') === v ? ' current' : ''), onclick: () => set(v) },
          h('span', { class: 'tm-dot', style: v ? `--tc:${TONE_COLORS[v]}` : null }),
          h('span', { class: 'tm-line', style: v ? `--tc:${TONE_COLORS[v]}` : null }),
          T(v ? 'tone.' + v : 'tone.none'))));
      btn.after(menu);
      // Noktanın altına hizala (satır dışına taşmadan)
      const row = btn.closest('.step-message');
      menu.style.left = Math.max(0, Math.min(btn.offsetLeft - 8, row.clientWidth - menu.offsetWidth - 4)) + 'px';
    });
    return btn;
  }

  /** Referans adımı: başka bir diyagrama bağlanan not (Mermaid'de "Note over") */
  function renderRef(it) {
    const target = S.docs.find((d) => d.id === it.ref);
    const row = stepShell(it, 'step-note step-ref' + (target ? '' : ' ref-broken'));
    const sel = h('select', { class: 'mini-select ref-select', title: T('ref.target') });
    if (!target) sel.append(h('option', { value: it.ref }, T('ref.missing')));
    // Diyagramlar klasör yollarına göre gruplu
    const groups = new Map();
    S.docs.filter((d) => d !== S.doc).sort((a, b) => a.name.localeCompare(b.name, I18N.getLang())).forEach((d) => {
      const path = Seq.search.folderPath(d.folder) || T('folder.root');
      if (!groups.has(path)) groups.set(path, []);
      groups.get(path).push(d);
    });
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], I18N.getLang())).forEach(([path, ds]) =>
      sel.append(h('optgroup', { label: path }, ds.map((d) => h('option', { value: d.id }, d.name)))));
    sel.value = it.ref;
    sel.addEventListener('change', () => {
      const old = S.docs.find((d) => d.id === it.ref);
      const nd = S.docs.find((d) => d.id === sel.value);
      // Etiket boşsa ya da eski hedefin adıysa (elle değiştirilmemişse) yeni hedefin adını al
      if (nd && (!String(it.text).trim() || (old && it.text === old.name))) it.text = nd.name;
      it.ref = sel.value;
      Seq.editor.commit(); Seq.editor.flushHistory();
    });
    add(row,
      handleEl(),
      h('span', { class: 'kind-badge' }, ico('link'), T('badge.ref')),
      Seq.combo.pSelect(it.targets[0], (v) => { it.targets[0] = v; }),
      // İkinci katılımcı isteğe bağlı: yalnızca "Genişlet" ile ya da zaten iki katılımcılı referanslarda
      it.targets[1]
        ? Seq.combo.pSelect(it.targets[1], (v) => { it.targets = v ? [it.targets[0], v] : [it.targets[0]]; }, true)
        : h('button', { class: 'ref-span', title: T('ref.spanTitle'), onclick: () => {
          const P = S.model.participants;
          const i = P.findIndex((p) => p.id === it.targets[0]);
          const next = P[i + 1] || P[i - 1];
          if (!next) return;
          it.targets = [it.targets[0], next.id];
          Seq.editor.commit(); Seq.editor.flushHistory();
        } }, ico('plus'), T('ref.span')),
      sel,
      textInput(it.text, T('ph.refLabel'), (v) => { it.text = v; }),
      h('button', { class: 'icon-btn ref-open', title: T('ref.open'), disabled: !target || null, onclick: () => Seq.refs.followRef(it.ref) }, ico('external')),
      actionsEl(it),
    );
    return row;
  }

  function renderNote(it) {
    const row = stepShell(it, 'step-note');
    const pos = h('select', { class: 'mini-select', title: T('note.pos') },
      h('option', { value: 'right of' }, T('note.right')), h('option', { value: 'left of' }, T('note.left')), h('option', { value: 'over' }, T('note.over')));
    pos.value = it.position;
    pos.addEventListener('change', () => { it.position = pos.value; if (pos.value !== 'over') it.targets = it.targets.slice(0, 1); Seq.editor.commit(); Seq.editor.flushHistory(); });
    add(row, 
      handleEl(),
      h('span', { class: 'kind-badge' }, ico('note'), T('badge.note')),
      pos,
      Seq.combo.pSelect(it.targets[0], (v) => { it.targets[0] = v; }),
      it.position === 'over' ? Seq.combo.pSelect(it.targets[1] || '', (v) => { it.targets = v ? [it.targets[0], v] : [it.targets[0]]; }, true) : null,
      textInput(it.text, T('ph.note'), (v) => { it.text = v; }),
      actionsEl(it),
    );
    return row;
  }

  function renderActivation(it) {
    const row = stepShell(it, 'step-activation');
    const act = h('select', { class: 'mini-select' }, h('option', { value: 'activate' }, T('activation.on')), h('option', { value: 'deactivate' }, T('activation.off')));
    act.value = it.action;
    act.addEventListener('change', () => { it.action = act.value; Seq.editor.commit(); Seq.editor.flushHistory(); });
    add(row, handleEl(), h('span', { class: 'kind-badge' }, ico('activate'), T('badge.activation')), act, Seq.combo.pSelect(it.participant, (v) => { it.participant = v; }), h('span', { style: 'flex:1' }), actionsEl(it));
    return row;
  }

  function renderRaw(it) {
    const row = stepShell(it, 'step-raw');
    add(row, handleEl(), h('span', { class: 'kind-badge' }, ico('raw'), T('badge.raw')), textInput(it.text, T('ph.raw'), (v) => { it.text = v; }, 'mono'), actionsEl(it));
    return row;
  }

  function renderBlock(it, counter) {
    const def = M.BLOCK_TYPES[it.type] || { label: it.type, branch: 'and' };
    const branchKw = it.type === 'par_over' ? 'and' : def.branch;
    const collapsed = S.collapsed.has(it.uid);
    const node = h('div', { class: `step block block-${it.type}` + (S.selected === it.uid ? ' selected' : '') + (collapsed ? ' collapsed' : ''), 'data-uid': it.uid, style: it.color && it.type !== 'rect' ? `--c:${it.color}` : null });
    const b0 = it.branches[0];

    let labelEl;
    if (it.type === 'rect') {
      labelEl = h('div', { class: 'row', style: 'flex:1 1 160px; gap:6px' },
        h('div', { class: 'swatches' }, RECT_SWATCHES.map((c) => h('button', { class: 'swatch', style: `background:${c}`, title: c, onclick: () => { b0.label = c; Seq.editor.commit(); Seq.editor.flushHistory(); } }))),
        textInput(b0.label, branchPh('rect'), (v) => { b0.label = v; }, 'mono'));
    } else {
      labelEl = textInput(b0.label, branchPh(it.type), (v) => { b0.label = v; });
    }

    let inner = 0;
    M.walk(it.branches.flatMap((b) => b.items), () => { inner++; });
    const head = h('div', { class: 'block-head' },
      handleEl(),
      h('span', { class: 'kind-badge' }, ico(it.type === 'par_over' ? 'par' : it.type), def.label),
      it.type !== 'rect' ? blockColorBtn(it) : null,
      labelEl,
      collapsed ? h('span', { class: 'collapsed-info' }, T('block.steps', { n: inner })) : null,
      branchKw ? h('button', { class: 'add-branch', title: T('block.addBranch', { kw: branchKw }), onclick: () => {
        const br = { uid: M.uid(), label: branchKw === 'else' ? T('bd.else') : '', items: [] };
        it.branches.push(br);
        S.collapsed.delete(it.uid);
        S.selected = br.uid;
        Seq.editor.commit(); Seq.editor.flushHistory();
      } }, ico('plus'), BRANCH_LABEL[branchKw]) : null,
      h('div', { class: 'step-actions' },
        h('button', { class: 'icon-btn collapse-btn', title: T(collapsed ? 'expand' : 'collapse'), onclick: () => { collapsed ? S.collapsed.delete(it.uid) : S.collapsed.add(it.uid); keepScroll(renderFlow); } }, ico('collapse')),
        h('button', { class: 'icon-btn', title: T('unwrap'), onclick: () => unwrapBlock(it.uid) }, ico('fit')),
        h('button', { class: 'icon-btn', title: T('duplicateKey'), onclick: () => duplicateNode(it.uid) }, ico('copy')),
        h('button', { class: 'icon-btn del', title: T('delete'), onclick: () => { if (inner && !confirm(T('block.confirmDelete', { n: inner }))) return; deleteNode(it.uid); } }, ico('trash'))),
    );
    node.append(head);

    it.branches.forEach((br, idx) => {
      if (idx > 0) {
        add(node, h('div', { class: 'branch-head' },
          h('span', { class: 'kind-badge' }, BRANCH_LABEL[branchKw] || 'Else'),
          textInput(br.label, branchKw === 'else' ? T('ph.else') : T('ph.label'), (v) => { br.label = v; }),
          h('div', { class: 'step-actions', style: 'opacity:1' },
            h('button', { class: 'icon-btn del', title: T('branch.delete'), onclick: () => {
              it.branches[idx - 1].items.push(...br.items);
              it.branches.splice(idx, 1);
              Seq.editor.commit(); Seq.editor.flushHistory();
            } }, ico('x')))));
      }
      const brEl = h('div', { class: 'branch', 'data-branch': br.uid });
      brEl.append(renderList(br.items, br.uid, counter));
      node.append(brEl);
    });
    return node;
  }

  // Blok rengi: hazır renkler + özel renk + varsayılana dön. Kodda "%% @color #hex" olarak saklanır.
  const BLOCK_SWATCHES = ['#f0a020', '#f97a3c', '#f05252', '#ec5a8f', '#9b6bff', '#6c7cff', '#3aa0ff', '#1fb5c9', '#2fbf7f', '#8a93a6'];
  function closeColorMenus() { $$('.color-menu').forEach((m) => m.remove()); }

  function blockColorBtn(it) {
    const setColor = (c) => {
      if (c) it.color = c; else delete it.color;
      closeColorMenus();
      Seq.editor.commit();
      Seq.editor.flushHistory();
    };
    const btn = h('button', { class: 'block-color' + (it.color ? ' custom' : ''), title: T('block.color') });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = btn.parentNode.querySelector('.color-menu');
      closeColorMenus();
      if (open) return;
      const custom = h('input', { type: 'color', value: it.color || getComputedStyle(btn).getPropertyValue('--c').trim() || '#6c7cff' });
      custom.addEventListener('change', () => setColor(custom.value.toLowerCase()));
      const menu = h('div', { class: 'color-menu', onclick: (ev) => ev.stopPropagation() },
        h('div', { class: 'swatches' }, BLOCK_SWATCHES.map((c) => h('button', {
          class: 'swatch' + (it.color === c ? ' active' : ''), style: `background:${c}`, title: c, onclick: () => setColor(c),
        }))),
        h('div', { class: 'cm-row' },
          h('label', { class: 'cm-custom' }, custom, h('span', null, T('block.colorCustom'))),
          it.color ? h('button', { class: 'btn ghost sm', onclick: () => setColor(null) }, T('block.colorReset')) : null));
      btn.after(menu);
    });
    return btn;
  }

  function unwrapBlock(nodeUid) {
    const f = M.findNode(S.model, nodeUid);
    if (!f || !f.node) return;
    const items = f.node.branches.flatMap((b) => b.items);
    f.list.splice(f.index, 1, ...items);
    S.selected = items[0] ? items[0].uid : null;
    Seq.editor.commit();
    Seq.editor.flushHistory();
  }

  // ---------------------------------------------------------------------------
  // Sürükle-bırak (akış)
  // ---------------------------------------------------------------------------
  function startDrag(e, data) {
    S.drag = data;
    e.dataTransfer.effectAllowed = data.kind === 'newStep' || data.kind === 'newPart' ? 'copy' : 'move';
    try { e.dataTransfer.setData('text/plain', data.type || data.uid || ''); } catch (_) { /* yok say */ }
  }
  function endDrag() {
    S.drag = null;
    clearDropLine();
    Seq.participants.clearPMarker();
    $$('.step.dragging').forEach((x) => { x.classList.remove('dragging'); x.draggable = false; });
  }

  let dropLine = null, dropTarget = null;
  function clearDropLine() { if (dropLine) dropLine.remove(); dropLine = null; dropTarget = null; }

  function findDropTarget(e) {
    let c = e.target.closest('.branch, .step-list');
    if (!c || !el.flow.contains(c)) c = el.flow.querySelector('.step-list.root');
    const list = c.classList.contains('branch') ? c.querySelector(':scope > .step-list') : c;
    const listId = list.dataset.list;
    // Bir bloğu kendi içine bırakmayı engelle
    if (S.drag.kind === 'step') {
      const dragged = el.flow.querySelector(`[data-uid="${S.drag.uid}"]`);
      if (dragged && dragged.contains(list)) return null;
    }
    const kids = $$(':scope > .step', list);
    let index = kids.length, ref = null;
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { index = i; ref = kids[i]; break; }
    }
    return { list, listId, index, ref };
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    if (window.ResizeObserver) new ResizeObserver(refitAll).observe(el.flow);
    document.addEventListener('pointerdown', (e) => {
      if (!(e.target.closest && e.target.closest('.color-menu, .block-color, .tone-btn'))) closeColorMenus();
    });
    // Akış alanında seçim
    el.flow.addEventListener('focusin', (e) => {
      const row = e.target.closest('[data-uid]');
      if (row && S.selected !== row.dataset.uid) setSelected(row.dataset.uid);
    });
    el.flow.addEventListener('pointerdown', (e) => {
      const t = e.target;
      const sb = t.closest('[data-select-branch]');
      if (sb) { setSelected(sb.dataset.selectBranch); return; }
      // Kolun boş alanına tıklandı → eklemeler bu kolun sonuna yapılır
      if (t.classList.contains('branch') || (t.classList.contains('step-list') && !t.classList.contains('root'))) {
        setSelected(t.closest('.branch').dataset.branch);
        return;
      }
      const row = t.closest('[data-uid]');
      setSelected(row ? row.dataset.uid : null);
    });
    // Tutamaçtan basınca satırı sürüklenebilir yap
    el.flow.addEventListener('mousedown', (e) => {
      const hd = e.target.closest('.handle');
      if (!hd) return;
      const row = hd.closest('.step');
      row.draggable = true;
      const off = () => { if (!S.drag) row.draggable = false; window.removeEventListener('mouseup', off); };
      window.addEventListener('mouseup', off);
    });
    el.flow.addEventListener('dragstart', (e) => {
      const row = e.target;
      if (!(row instanceof HTMLElement) || !row.classList.contains('step')) return;
      startDrag(e, { kind: 'step', uid: row.dataset.uid });
      e.dataTransfer.setDragImage(row, 20, 20);
      setTimeout(() => row.classList.add('dragging'), 0);
    });
    el.flow.addEventListener('dragend', endDrag);
    el.flow.addEventListener('dragover', (e) => {
      if (!S.drag || (S.drag.kind !== 'step' && S.drag.kind !== 'newStep')) return;
      const t = findDropTarget(e);
      if (!t) { clearDropLine(); return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = S.drag.kind === 'step' ? 'move' : 'copy';
      dropTarget = t;
      if (!dropLine) dropLine = h('div', { class: 'drop-line' });
      const ref = t.ref || null;
      if (dropLine.parentNode !== t.list || dropLine.nextSibling !== ref) t.list.insertBefore(dropLine, ref);
    });
    el.flow.addEventListener('dragleave', (e) => { if (!el.flow.contains(e.relatedTarget)) clearDropLine(); });
    el.flow.addEventListener('drop', (e) => {
      if (!S.drag || !dropTarget) return;
      e.preventDefault();
      const { listId, index } = dropTarget;
      const target = listReg.get(listId);
      const d = S.drag;
      clearDropLine();
      if (!target) return;
      if (d.kind === 'newStep') { addStep(d.type, target, index); return; }
      if (d.kind === 'step') {
        const f = M.findNode(S.model, d.uid);
        if (!f || !f.node) return;
        let idx = index;
        if (f.list === target && f.index < index) idx--;
        f.list.splice(f.index, 1);
        target.splice(idx, 0, f.node);
        S.selected = f.node.uid;
        Seq.editor.commit();
        Seq.editor.flushHistory();
      }
    });
  }

  Seq.flow = { init, addMessageFrom, addStep, deleteNode, duplicateNode, endDrag, focusRow, insertNode, moveNodeBy, renderBuilder, reveal, setSelected, startDrag };
})(window.Seq = window.Seq || {});
