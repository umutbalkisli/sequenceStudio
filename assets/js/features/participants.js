/* Sequence Studio — katılımcılar
 *
 * Katılımcı kartları, ekleme/silme/sıralama, düzenleme paneli (ad, rol, tip, renk, grup) ve bağlantı noktasından mesaj çizme.
 */
(function (Seq) {
  'use strict';
  const { $, $$, M, PCOLORS, S, T, add, clamp, colorOf, el, h, ico, multiline, toast } = Seq.core;

  // ---------------------------------------------------------------------------
  // Katılımcılar
  // ---------------------------------------------------------------------------
  function uniqueId(base, exceptUid) {
    base = M.slugify(base);
    let id = base, k = 2;
    while (S.model.participants.some((p) => p.id === id && p.uid !== exceptUid)) id = base + k++;
    return id;
  }

  function addParticipant(type, index, roleId, itemId) {
    const x = Seq.catalog.itemById(itemId);
    if (x) {
      // Aynı katalog öğesi diyagramda zaten varsa yenisi eklenmez, mevcut kart gösterilir
      const had = S.model.participants.find((q) => q.item === x.id);
      if (had) { revealCard(had.uid); toast(T('cat.alreadyIn', { name: had.label })); return had; }
      roleId = x.role;
    }
    const r = Seq.roles.roleById(roleId);
    // Ekli rollerde çekirdek "Yeni" olur (Yeni Service → yazınca Order Service); eksizse rolün adı
    const core = r ? (r.prefix || r.suffix ? T('role.newBase') : r.name) : T('newp.' + type);
    const taken = (b) => S.model.participants.some((p) => p.label === Seq.roles.composeLabel(r, b));
    let base = core, n = 2;
    while (taken(base)) base = core + ' ' + n++;
    const lbl = Seq.roles.composeLabel(r, base);
    const p = { uid: M.uid(), id: uniqueId(lbl), label: lbl, type: r ? r.type : type, boxId: null, implicit: false, autoId: true };
    if (r) { p.role = r.id; p.color = r.color; }
    if (x) Seq.catalog.applyItem(p, x);
    S.model.participants.forEach((q) => { q.implicit = false; });
    if (index == null || index > S.model.participants.length) S.model.participants.push(p);
    else S.model.participants.splice(index, 0, p);
    Seq.editor.commit();
    const card = el.participants.querySelector(`[data-uid="${p.uid}"]`);
    // Katalog öğesinin adı hazırdır; düzenleyici açılmaz, kart vurgulanır
    if (x) revealCard(p.uid);
    else if (card) openParticipantEditor(p, card, true);
    return p;
  }

  /** Katılımcı kartını görünür kılar ve kısaca vurgular */
  function revealCard(uid) {
    const card = el.participants.querySelector(`.pcard[data-uid="${uid}"]`);
    if (!card) return false;
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
    return true;
  }

  function renderParticipants() {
    const box = el.participants;
    box.innerHTML = '';
    const boxes = new Map(S.model.boxes.map((b) => [b.id, b]));
    S.model.participants.forEach((p, i) => {
      const c = p.color || PCOLORS[i % PCOLORS.length];
      const bx = p.boxId && boxes.get(p.boxId);
      const card = h('div', {
        class: 'pcard' + (S.selectedP === p.uid ? ' selected' : ''), draggable: 'true', 'data-uid': p.uid,
        style: `--c:${c};` + (bx ? `--box:${bx.color && bx.color !== 'transparent' ? bx.color : 'var(--border-strong)'}` : ''),
        title: Seq.palette.TYPE_LABEL[p.type] + ' · ' + T('pcard.title'),
      },
      bx ? h('span', { class: 'pc-box-tag' }, bx.label || 'Grup') : null,
      h('span', { class: 'pc-icon' }, ico('t-' + p.type)),
      h('div', { class: 'pc-text' },
        h('div', { class: 'pc-label' }, p.label || p.id),
        h('div', { class: 'pc-sub' }, p.id + (p.implicit ? ' · ' + T('pcard.auto') : ''))),
      h('button', { class: 'pc-handle', title: T('pcard.handle'), onpointerdown: (e) => startLink(e, p) }));
      card.addEventListener('click', (e) => { if (!e.target.closest('.pc-handle')) openParticipantEditor(p, card); });
      card.addEventListener('dragstart', (e) => {
        if (S.linking) { e.preventDefault(); return; }
        Seq.flow.startDrag(e, { kind: 'part', uid: p.uid });
        setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); Seq.flow.endDrag(); });
      box.append(card);
    });
    box.append(h('button', { class: 'pcard-add', onclick: () => addParticipant('participant') }, ico('plus'), T('pcard.add')));
    el.partCount.textContent = S.model.participants.length;
  }

  // Katılımcı alanına bırakma (sıralama + paletten ekleme)
  let pMarker = null;
  function pDropIndex(e) {
    const cards = $$('.pcard', el.participants).filter((c) => !c.classList.contains('dragging'));
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top) return { i, ref: cards[i] };
      if (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2) return { i, ref: cards[i] };
    }
    return { i: cards.length, ref: $('.pcard-add', el.participants) };
  }

  function clearPMarker() { if (pMarker) pMarker.remove(); pMarker = null; el.participants.classList.remove('drop-active'); }

  /** Bir katılımcı bir gruba aitse, grubun diğer üyeleriyle yan yana durmasını sağlar. */
  function fixBoxContiguity(p) {
    const arr = S.model.participants;
    if (!p.boxId) return;
    const members = arr.filter((q) => q.boxId === p.boxId);
    if (members.length < 2) return;
    const idx = arr.indexOf(p);
    const neighborsOk = (arr[idx - 1] && arr[idx - 1].boxId === p.boxId) || (arr[idx + 1] && arr[idx + 1].boxId === p.boxId);
    if (neighborsOk) return;
    arr.splice(idx, 1);
    const last = arr.map((q) => q.boxId).lastIndexOf(p.boxId);
    arr.splice(last + 1, 0, p);
  }

  function renameRefs(oldId, newId) {
    if (oldId === newId) return;
    M.walk(S.model.items, (it) => {
      if (it.kind === 'message') { if (it.from === oldId) it.from = newId; if (it.to === oldId) it.to = newId; }
      else if (it.kind === 'note') it.targets = it.targets.map((t) => (t === oldId ? newId : t));
      else if (it.kind === 'activation' && it.participant === oldId) it.participant = newId;
    });
  }
  function countRefs(id) {
    let n = 0;
    M.walk(S.model.items, (it) => {
      if ((it.kind === 'message' && (it.from === id || it.to === id)) || (it.kind === 'note' && it.targets.includes(id)) || (it.kind === 'activation' && it.participant === id)) n++;
    });
    return n;
  }
  function deleteParticipant(p) {
    const n = countRefs(p.id);
    if (n && !confirm(T('p.confirmDelete', { name: p.label, n }))) return false;
    S.model.participants = S.model.participants.filter((q) => q !== p);
    const prune = (items) => {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === 'message' && (it.from === p.id || it.to === p.id)) items.splice(i, 1);
        else if (it.kind === 'activation' && it.participant === p.id) items.splice(i, 1);
        else if (it.kind === 'note') {
          it.targets = it.targets.filter((t) => t !== p.id);
          if (!it.targets.length) items.splice(i, 1);
        } else if (it.kind === 'block') it.branches.forEach((b) => prune(b.items));
      }
    };
    prune(S.model.items);
    S.model.boxes = S.model.boxes.filter((b) => S.model.participants.some((q) => q.boxId === b.id));
    Seq.editor.commit();
    return true;
  }

  // Katılımcı düzenleme popover'ı
  const BOX_COLORS = [
    { v: '', name: 'none' },
    { v: 'rgba(108, 124, 255, 0.10)', name: 'blue' },
    { v: 'rgba(32, 184, 166, 0.12)', name: 'teal' },
    { v: 'rgba(47, 191, 127, 0.12)', name: 'green' },
    { v: 'rgba(240, 160, 32, 0.14)', name: 'orange' },
    { v: 'rgba(236, 90, 143, 0.12)', name: 'pink' },
    { v: 'rgba(138, 147, 166, 0.15)', name: 'gray' },
  ];

  function openParticipantEditor(p, anchor, focusLabel) {
    S.selectedP = p.uid;
    $$('.pcard', el.participants).forEach((c) => c.classList.toggle('selected', c.dataset.uid === p.uid));
    const pop = el.popover;
    pop.innerHTML = '';
    const touch = () => { p.implicit = false; };

    const role = Seq.roles.roleById(p.role);
    // Rol yeniden çizimi: kart yeniden oluştuğu için güncel kartı çapa al
    const reopen = () => {
      const card = el.participants.querySelector(`[data-uid="${p.uid}"]`);
      openParticipantEditor(p, card || anchor);
    };
    // Ad alanı: rolün ön/son eki sabit etiket olarak görünür, yalnızca çekirdek ad düzenlenir
    const labelIn = multiline(h('textarea', { class: 'input', rows: 1, value: role ? Seq.roles.baseName(p) : p.label, placeholder: T('pe.labelPh') }));
    const labelField = role && (role.prefix || role.suffix)
      ? h('div', { class: 'affix-input' },
        role.prefix ? h('span', { class: 'affix', title: T('role.prefix') }, role.prefix, role.prefixBreak ? h('span', { class: 'affix-br', title: T('role.breakAfter') }, '↵') : null) : null,
        labelIn,
        role.suffix ? h('span', { class: 'affix', title: T('role.suffix') }, role.suffixBreak ? h('span', { class: 'affix-br', title: T('role.breakBefore') }, '↵') : null, role.suffix) : null)
      : labelIn;
    const idIn = h('input', { class: 'input', value: p.id, spellcheck: 'false', style: 'font-family:var(--mono)' });
    const idHint = h('small', null, T('pe.idHint'));

    labelIn.addEventListener('input', () => {
      touch();
      const r = Seq.roles.roleById(p.role);
      p.label = labelIn.value.trim() ? Seq.roles.composeLabel(r, labelIn.value.trim()) : p.id;
      if (p.autoId) {
        const nid = uniqueId(p.label || 'P', p.uid);
        renameRefs(p.id, nid);
        p.id = nid;
        idIn.value = nid;
      }
      Seq.editor.commit();
    });
    idIn.addEventListener('input', () => {
      const v = idIn.value.trim();
      const invalid = !v || /[\s:;,<>@#+\-]/.test(v) || /^(participant|actor|end|as|loop|alt|else|opt|par|and|note|box|rect|critical|break|option)$/i.test(v);
      const dup = S.model.participants.some((q) => q.id === v && q !== p);
      idIn.style.borderColor = invalid || dup ? 'var(--danger)' : '';
      idHint.textContent = T(invalid ? 'pe.idInvalid' : dup ? 'pe.idDup' : 'pe.idHint');
      idHint.style.color = invalid || dup ? 'var(--danger)' : '';
      if (invalid || dup) return;
      touch();
      p.autoId = false;
      const wasLabelId = p.label === p.id;
      renameRefs(p.id, v);
      p.id = v;
      if (wasLabelId) { p.label = v; labelIn.value = v; }
      Seq.editor.commit();
    });

    const typeGrid = h('div', { class: 'type-grid' });
    M.PARTICIPANT_TYPES.forEach((t) => {
      const b = h('button', { class: 'type-opt' + (p.type === t.v ? ' active' : ''), title: T('type.' + t.v) }, ico('t-' + t.v), t.label);
      b.addEventListener('click', () => {
        touch(); p.type = t.v;
        const hadRole = !!p.role;
        delete p.role; delete p.item; // elle değişiklik → rol ve katalog bağlantısı kopar
        $$('.type-opt', typeGrid).forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        Seq.editor.commit();
        if (hadRole) reopen();
      });
      typeGrid.append(b);
    });

    // Grup (box)
    const boxSel = h('select', { class: 'select' });
    const boxRow = h('div', { class: 'row', style: 'margin-top:6px' });
    const fillBoxSel = () => {
      boxSel.innerHTML = '';
      boxSel.append(h('option', { value: '' }, T('pe.noBox')));
      S.model.boxes.forEach((b) => boxSel.append(h('option', { value: b.id }, b.label || T('pe.unnamedBox'))));
      boxSel.append(h('option', { value: '__new' }, T('pe.newBox')));
      boxSel.value = p.boxId || '';
    };
    const fillBoxRow = () => {
      boxRow.innerHTML = '';
      const b = S.model.boxes.find((x) => x.id === p.boxId);
      if (!b) return;
      const bl = h('input', { class: 'input', value: b.label, placeholder: T('pe.boxName') });
      bl.addEventListener('input', () => { b.label = bl.value; fillBoxSelLabels(); Seq.editor.commit(); });
      const bc = h('select', { class: 'select' });
      const known = BOX_COLORS.some((c) => c.v === (b.color || ''));
      BOX_COLORS.forEach((c) => bc.append(h('option', { value: c.v }, T('color.' + c.name))));
      if (!known) bc.append(h('option', { value: b.color }, b.color));
      bc.value = b.color || '';
      bc.addEventListener('change', () => { b.color = bc.value; Seq.editor.commit(); });
      boxRow.append(bl, bc);
    };
    const fillBoxSelLabels = () => { $$('option', boxSel).forEach((o) => { const b = S.model.boxes.find((x) => x.id === o.value); if (b) o.textContent = b.label || T('pe.unnamedBox'); }); };
    boxSel.addEventListener('change', () => {
      touch();
      if (boxSel.value === '__new') {
        const b = { id: M.uid(), label: T('pe.boxDefault', { n: S.model.boxes.length + 1 }), color: BOX_COLORS[1].v };
        S.model.boxes.push(b);
        p.boxId = b.id;
      } else p.boxId = boxSel.value || null;
      S.model.participants.forEach((q) => { q.implicit = false; });
      fixBoxContiguity(p);
      S.model.boxes = S.model.boxes.filter((b) => S.model.participants.some((q) => q.boxId === b.id));
      Seq.editor.commit();
      fillBoxSel(); fillBoxRow();
    });
    fillBoxSel(); fillBoxRow();

    // Renk: hazır renkler + özel renk + otomatik (sıraya göre). Kodda "%% @color #hex" olarak saklanır.
    const colorField = h('div', { class: 'pe-colors' });
    const fillColors = () => {
      colorField.innerHTML = '';
      const setColor = (c) => {
        touch();
        if (c) p.color = c; else delete p.color;
        const hadRole = !!p.role;
        delete p.role; delete p.item; // elle değişiklik → rol ve katalog bağlantısı kopar
        Seq.editor.commit();
        Seq.editor.flushHistory();
        if (hadRole) reopen(); else fillColors();
      };
      const cur = colorOf(p.id);
      const custom = h('input', { type: 'color', value: cur, title: T('block.colorCustom') });
      custom.addEventListener('change', () => setColor(custom.value.toLowerCase()));
      add(colorField,
        h('div', { class: 'swatches' }, PCOLORS.map((c) => h('button', {
          class: 'swatch' + (p.color === c ? ' active' : ''), style: `background:${c}`, title: c, onclick: () => setColor(c),
        }))),
        h('label', { class: 'cm-custom' }, custom, h('span', null, T('block.colorCustom'))),
        p.color ? h('button', { class: 'btn ghost sm', onclick: () => setColor(null) }, T('pe.colorAuto')) : null);
    };
    fillColors();

    // Katalog: bağlıysa yol + değiştir/kaldır; değilse katalogdan seç / kataloğa kaydet
    const item = Seq.catalog.itemById(p.item);
    const relink = (x) => { Seq.catalog.applyItem(p, x); Seq.editor.commit(); Seq.editor.flushHistory(); reopen(); };
    const pickBtn = h('button', { class: 'rp-edit' }, ico('layers'), T(item ? 'cat.change' : 'cat.pick'));
    pickBtn.addEventListener('click', () => Seq.catalog.openPicker(pickBtn, { onPick: relink, title: T('cat.pickTitle') }));
    const itemField = h('div', { class: 'role-pick' },
      item ? h('span', { class: 'rp-chip active cat-path', style: `--c:${p.color || 'var(--accent)'}`, title: item.desc || null }, ico('layers'), Seq.catalog.pathLabel(item.id)) : null,
      p.item && !item ? h('span', { class: 'rp-chip active unknown', title: T('cat.unknown') }, '@' + p.item) : null,
      pickBtn,
      p.item ? h('button', { class: 'rp-edit', title: T('cat.unlinkTitle'), onclick: () => { delete p.item; Seq.editor.commit(); Seq.editor.flushHistory(); reopen(); } }, ico('x'), T('cat.unlink'))
        : h('button', { class: 'rp-edit', title: T('cat.saveFromTitle'), onclick: () => Seq.catalog.openSaveDialog(p) }, ico('plus'), T('cat.saveFrom')),
      item && item.desc ? h('small', { class: 'cat-desc-line' }, item.desc) : null);

    // Rol seçimi (katalog öğesine bağlıysa rol öğeden gelir, burada değiştirilmez)
    const roleChips = item ? h('div', { class: 'role-pick' },
      role ? h('span', { class: 'rp-chip active', style: `--c:${role.color}` }, ico('t-' + role.type), role.name) : null,
      h('small', { class: 'cat-desc-line' }, T('cat.roleFromItem'))) : h('div', { class: 'role-pick' },
      h('button', { class: 'rp-chip' + (!p.role ? ' active' : ''), onclick: () => {
        if (!p.role) return;
        delete p.role; // görünüm ve ad olduğu gibi kalır
        Seq.editor.commit(); Seq.editor.flushHistory(); reopen();
      } }, T('role.none')),
      (S.roles || []).map((r) => h('button', {
        class: 'rp-chip' + (p.role === r.id ? ' active' : ''), style: `--c:${r.color}`, title: r.name,
        onclick: () => { if (p.role === r.id) return; Seq.roles.applyRole(p, r); Seq.editor.commit(); Seq.editor.flushHistory(); reopen(); },
      }, ico('t-' + r.type), r.name)),
      p.role && !role ? h('span', { class: 'rp-chip active unknown', title: T('role.unknown') }, '@' + p.role) : null,
      h('button', { class: 'rp-edit', onclick: () => { closePopover(); Seq.roles.openRoles(); } }, T('role.manageEllipsis')));
    const custom = h('details', { class: 'pe-custom', open: p.role ? null : true },
      h('summary', null, T('pe.customize')),
      p.role ? h('small', { class: 'pe-custom-hint' }, T('role.detachHint')) : null,
      h('div', { class: 'field' }, h('label', null, T('pe.type')), typeGrid),
      h('div', { class: 'field' }, h('label', null, T('pe.color')), colorField));

    pop.append(
      h('div', { class: 'pop-title' }, T('pe.title'), h('button', { class: 'icon-btn sm', onclick: closePopover }, ico('x'))),
      h('div', { class: 'field' }, h('label', null, T('pe.label')), labelField),
      h('div', { class: 'field' }, h('label', null, T('pe.catalog')), itemField),
      h('div', { class: 'field' }, h('label', null, T('pe.role')), roleChips),
      h('div', { class: 'field' }, h('label', null, T('pe.id')), idIn, idHint),
      custom,
      h('div', { class: 'field' }, h('label', null, T('pe.box')), boxSel, boxRow),
      h('div', { class: 'pop-actions' },
        h('button', { class: 'btn danger sm', onclick: () => { if (deleteParticipant(p)) closePopover(); } }, ico('trash'), T('delete')),
        h('div', { class: 'row', style: 'flex:none' },
          h('button', { class: 'btn sm', title: T('pe.addMsgTitle'), onclick: () => { closePopover(); Seq.flow.addMessageFrom(p.id); } }, ico('message'), T('pe.addMsg')),
          h('button', { class: 'btn primary sm', onclick: closePopover }, T('pe.done')))),
    );
    showPopover(anchor);
    if (focusLabel) setTimeout(() => { labelIn.focus(); labelIn.select(); }, 30);
  }

  function showPopover(anchor) {
    const pop = el.popover;
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = clamp(r.left, 10, innerWidth - pw - 10);
    let y = r.bottom + 8;
    if (y + ph > innerHeight - 10) y = Math.max(10, r.top - ph - 8);
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
  }
  function closePopover() {
    if (el.popover.hidden) return;
    el.popover.hidden = true;
    S.selectedP = null;
    $$('.pcard.selected', el.participants).forEach((c) => c.classList.remove('selected'));
    Seq.editor.flushHistory();
  }

  // Bağlantı noktasından sürükleyerek mesaj oluşturma
  function startLink(e, p) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    closePopover();
    S.linking = true;
    const r = e.currentTarget.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    let target = null, maxDist = 0;
    el.overlay.classList.add('show');
    const draw = (x1, y1) => {
      const dx = x1 - x0;
      el.linkPath.setAttribute('d', `M${x0},${y0} C${x0 + dx * 0.5},${y0 - 30} ${x1 - dx * 0.5},${y1 - 30} ${x1},${y1}`);
    };
    draw(x0, y0);
    const move = (ev) => {
      maxDist = Math.max(maxDist, Math.hypot(ev.clientX - x0, ev.clientY - y0));
      draw(ev.clientX, ev.clientY);
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const card = hit && hit.closest('.pcard');
      if (target && target !== card) target.classList.remove('link-target');
      target = card || null;
      if (target && (target.dataset.uid !== p.uid || maxDist > 60)) target.classList.add('link-target');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.overlay.classList.remove('show');
      S.linking = false;
      if (!target) return;
      target.classList.remove('link-target');
      const tp = S.model.participants.find((q) => q.uid === target.dataset.uid);
      if (!tp || (tp === p && maxDist <= 60)) return;
      const node = { uid: M.uid(), kind: 'message', from: p.id, to: tp.id, arrow: '->>', act: '', text: '' };
      Seq.flow.insertNode(node);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    el.participants.addEventListener('dragover', (e) => {
      if (!S.drag || (S.drag.kind !== 'part' && S.drag.kind !== 'newPart')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = S.drag.kind === 'part' ? 'move' : 'copy';
      el.participants.classList.add('drop-active');
      const { ref } = pDropIndex(e);
      if (!pMarker) pMarker = h('div', { class: 'p-drop-marker' });
      if (pMarker.nextSibling !== ref) el.participants.insertBefore(pMarker, ref);
    });
    el.participants.addEventListener('dragleave', (e) => {
      if (!el.participants.contains(e.relatedTarget)) clearPMarker();
    });
    el.participants.addEventListener('drop', (e) => {
      if (!S.drag) return;
      e.preventDefault();
      const { i } = pDropIndex(e);
      const d = S.drag;
      clearPMarker();
      if (d.kind === 'newPart') { addParticipant(d.type, i, d.role, d.item); return; }
      if (d.kind === 'part') {
        const arr = S.model.participants;
        const from = arr.findIndex((p) => p.uid === d.uid);
        if (from < 0) return;
        // i, sürüklenen kart hariç listedeki indekstir
        const [p] = arr.splice(from, 1);
        arr.splice(i, 0, p);
        arr.forEach((q) => { q.implicit = false; });
        fixBoxContiguity(p);
        Seq.editor.commit();
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!el.popover.hidden && !el.popover.contains(e.target) && !(e.target.closest && e.target.closest('.pcard'))) closePopover();
    });
  }

  Seq.participants = { init, addParticipant, clearPMarker, closePopover, renameRefs, renderParticipants, revealCard, uniqueId };
})(window.Seq = window.Seq || {});
