/* Sequence Studio — katılımcı seçici
 *
 * Aranabilir katılımcı açılır listesi (Türkçe duyarsız arama, klavye, yazılan adla hızlı ekleme).
 */
(function (Seq) {
  'use strict';
  const { $$, M, S, T, clamp, colorOf, el, h, ico, norm, oneLine, participantById } = Seq.core;

  let combo = null;
 // { btn, pop, close }
  function closeCombo(refocus) {
    if (!combo) return;
    const c = combo;
    combo = null;
    c.pop.remove();
    window.removeEventListener('resize', c.onAway);
    el.bscroll.removeEventListener('scroll', c.onAway);
    document.removeEventListener('pointerdown', c.onDown, true);
    if (refocus && c.btn.isConnected) c.btn.focus({ preventScroll: true });
  }
  /** Yazılan adla yeni katılımcı ekler (popover açmadan) ve kimliğini döner. */
  function quickCreateParticipant(name) {
    const label = name.trim();
    const p = { uid: M.uid(), id: Seq.participants.uniqueId(label), label, type: 'participant', boxId: null, implicit: false };
    S.model.participants.forEach((q) => { q.implicit = false; });
    S.model.participants.push(p);
    return p.id;
  }
  function openCombo(btn, value, allowEmpty, choose, initial) {
    closeCombo();
    const input = h('input', { class: 'pcombo-search', value: initial || '', placeholder: T('combo.search'), spellcheck: 'false', autocomplete: 'off', 'aria-label': T('combo.search') });
    const list = h('div', { class: 'pcombo-list', role: 'listbox' });
    const pop = h('div', { class: 'pcombo' }, input, list);
    let options = [], active = 0;

    const highlight = (text, q) => {
      if (!q) return text;
      const i = norm(text).indexOf(q);
      if (i < 0) return text;
      return [text.slice(0, i), h('mark', null, text.slice(i, i + q.length)), text.slice(i + q.length)];
    };
    const draw = () => {
      const q = norm(input.value.trim());
      const ps = S.model.participants.map((p) => ({ v: p.id, label: oneLine(p.label || p.id), id: p.id, c: colorOf(p.id) }));
      if (value && !ps.some((o) => o.v === value)) ps.push({ v: value, label: value, id: value, c: colorOf(value) });
      let shown = ps;
      if (q) {
        const rank = (o) => {
          const l = norm(o.label), i = norm(o.id);
          if (l.startsWith(q) || i.startsWith(q)) return 0;
          if (l.split(/\s+/).some((w) => w.startsWith(q))) return 1;
          if (l.includes(q) || i.includes(q)) return 2;
          return -1;
        };
        shown = ps.map((o) => [o, rank(o)]).filter(([, r]) => r >= 0).sort((a, b) => a[1] - b[1]).map(([o]) => o);
      }
      options = [];
      if (allowEmpty && !q) options.push({ v: '', label: '—', empty: true });
      options.push(...shown);
      const typed = input.value.trim();
      if (typed && !ps.some((o) => norm(o.label) === q || norm(o.id) === q)) options.push({ create: typed });
      // Açılışta mevcut değeri işaretle; aramada ilk sonucu
      active = q ? 0 : Math.max(0, options.findIndex((o) => o.v === value));
      list.innerHTML = '';
      if (!options.length) list.append(h('div', { class: 'pcombo-empty' }, T('combo.empty')));
      options.forEach((o, i) => {
        const row = o.create
          ? h('div', { class: 'pcombo-opt create', role: 'option' }, ico('plus'), h('span', { class: 'po-label' }, T('combo.create', { name: o.create })))
          : h('div', { class: 'pcombo-opt' + (o.v === value ? ' current' : ''), role: 'option', 'aria-selected': String(o.v === value) },
            h('span', { class: 'po-dot', style: o.empty ? null : `--pc:${o.c}` }),
            h('span', { class: 'po-label' }, highlight(o.label, q)),
            !o.empty && o.id !== o.label ? h('span', { class: 'po-id' }, o.id) : null);
        row.addEventListener('pointerdown', (e) => e.preventDefault()); // arama kutusu odağı kaybetmesin
        row.addEventListener('click', () => pick(i));
        row.addEventListener('pointermove', () => { if (active !== i) { active = i; mark(); } });
        list.append(row);
      });
      mark();
    };
    const mark = () => {
      $$('.pcombo-opt', list).forEach((r, i) => r.classList.toggle('active', i === active));
      const a = $$('.pcombo-opt', list)[active];
      if (a) a.scrollIntoView({ block: 'nearest' });
    };
    const pick = (i) => {
      const o = options[i];
      if (!o) return;
      const v = o.create ? quickCreateParticipant(o.create) : o.v;
      closeCombo();
      choose(v, !!o.create);
    };
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // genel kısayollar (Del, Enter, Esc…) devreye girmesin
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(options.length - 1, active + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); pick(active); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCombo(true); }
      else if (e.key === 'Tab') closeCombo();
    });

    document.body.append(pop);
    // Konum: düğmenin altında (sığmazsa üstünde); sabit konumlu olduğu için kaydırma alanında kesilmez
    const r = btn.getBoundingClientRect();
    const w = Math.max(r.width, 230);
    pop.style.width = w + 'px';
    pop.style.left = clamp(r.left, 8, window.innerWidth - w - 8) + 'px';
    draw();
    const ph = pop.offsetHeight;
    pop.style.top = (r.bottom + 4 + ph > window.innerHeight - 8 ? Math.max(8, r.top - 4 - ph) : r.bottom + 4) + 'px';
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);

    const onAway = () => closeCombo();
    const onDown = (e) => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeCombo(); };
    window.addEventListener('resize', onAway);
    el.bscroll.addEventListener('scroll', onAway, { passive: true });
    document.addEventListener('pointerdown', onDown, true);
    combo = { btn, pop, onAway, onDown };
  }

  function pSelect(value, onChange, allowEmpty) {
    const p = participantById(value);
    const btn = h('button', { type: 'button', class: 'pselect', title: T('participant'), 'aria-haspopup': 'listbox' },
      value ? oneLine(p ? p.label || p.id : value) : '—');
    btn.style.setProperty('--pc', value ? colorOf(value) : 'transparent');
    const choose = (v, created) => {
      if (v === value && !created) return;
      onChange(v);
      Seq.editor.commit();
      Seq.editor.flushHistory();
    };
    const open = (initial) => openCombo(btn, value, allowEmpty, choose, initial);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (combo && combo.btn === btn) closeCombo(); else open('');
    });
    // Odaktayken yazmaya başlamak aramayı o harfle açar
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(''); }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); open(e.key); }
    });
    return btn;
  }

  Seq.combo = { pSelect };
})(window.Seq = window.Seq || {});
