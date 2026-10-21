/* Sequence Studio — palet
 *
 * Katalog/roller ve akış adımları paleti (katılımcı tipleri katılımcı panelinde seçilir); grup genişliklerini dengeleme ve kompakt mod.
 */
(function (Seq) {
  'use strict';
  const { $, $$, M, S, T, el, h, ico, saveSettings } = Seq.core;

  // ---------------------------------------------------------------------------
  // Palet
  // ---------------------------------------------------------------------------
  const TYPE_LABEL = Object.fromEntries(M.PARTICIPANT_TYPES.map((t) => [t.v, t.label]));

  function renderPalette() {
    el.palS.innerHTML = '';
    el.palR.innerHTML = '';
    // Katalog: tek düğme, aranabilir ağaç açar (öğeler palete çip olarak dökülmez)
    const catBtn = h('button', { class: 'chip cat-open', title: T('cat.paletteTitle') }, ico('layers'), T('cat.title'),
      (S.catalog || []).length ? h('span', { class: 'cat-count' }, String(S.catalog.length)) : null, ico('chevron'));
    catBtn.addEventListener('click', () => Seq.catalog.openPicker(catBtn, {
      draggable: true, onPick: (x) => Seq.participants.addParticipant(null, null, null, x.id),
    }));
    el.palR.append(catBtn, h('span', { class: 'pal-sep' }));
    (S.roles || []).forEach((r) => {
      const chip = h('div', { class: 'chip role-chip', draggable: 'true', title: r.name + ' — ' + T('pal.clickOrDrag'), style: `--c:${r.color}` }, ico('t-' + r.type), r.name);
      chip.addEventListener('click', () => Seq.participants.addParticipant(r.type, null, r.id));
      chip.addEventListener('dragstart', (e) => Seq.flow.startDrag(e, { kind: 'newPart', type: r.type, role: r.id }));
      chip.addEventListener('dragend', Seq.flow.endDrag);
      el.palR.append(chip);
    });
    el.palR.append(h('button', { class: 'chip chip-edit', title: T('role.manage'), onclick: Seq.roles.openRoles }, ico('edit'), (S.roles || []).length ? null : T('role.manageShort')));
    requestAnimationFrame(() => { if (typeof balancePalette === 'function') balancePalette(); });
    Seq.steps.list().forEach((s) => {
      const chip = h('div', { class: 'chip', draggable: 'true', title: (M.BLOCK_TYPES[s.id] ? T('block.' + s.id) + ' — ' : '') + T('pal.clickOrDragFlow'), style: `--c:${s.color}` }, ico(s.icon), T('step.' + s.id));
      chip.addEventListener('click', () => Seq.flow.addStep(s.id));
      chip.addEventListener('dragstart', (e) => Seq.flow.startDrag(e, { kind: 'newStep', type: s.id }));
      chip.addEventListener('dragend', Seq.flow.endDrag);
      el.palS.append(chip);
    });
  }

  // Palet şeridi: gruplar içerikleriyle orantılı genişlikte; isteğe bağlı kompakt (tek satır)
  const paletteEl = $('#palette');
  const btnPalToggle = $('#btnPalToggle');
  // Grupları, hepsi en az satıra sığacak şekilde genişliklendirir: her grup için "R satır için
  // gereken en küçük genişlik" çip kaydırması simüle edilerek bulunur; toplamın sığdığı en küçük
  // R seçilir, kalan alan gruplara orantılı dağıtılır.
  const CHIP_GAP = 5;
  function rowsAt(ws, W) {
    let rows = 1, line = 0;
    for (const w of ws) {
      if (line && line + CHIP_GAP + w > W) { rows++; line = w; } else line += (line ? CHIP_GAP : 0) + w;
    }
    return rows;
  }
  function minWidthFor(ws, R) {
    let lo = Math.max(...ws), hi = ws.reduce((a, w) => a + w + CHIP_GAP, 0);
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rowsAt(ws, mid) <= R) hi = mid; else lo = mid + 1; }
    return lo;
  }
  function balancePalette() {
    const groups = $$(':scope > .pal-group', paletteEl);
    const widths = groups.map((g) => $$('.chip', g).map((c) => c.getBoundingClientRect().width));
    if (widths.some((ws) => !ws.length || ws.some((w) => !w))) return; // görünmüyor; ResizeObserver tekrar çağırır
    const frame = groups.map((g) => { const cs = getComputedStyle(g); return parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth); });
    const avail = groups.reduce((a, g, i) => a + g.getBoundingClientRect().width - frame[i], 0);
    let need = null;
    for (let R = 1; R <= 8; R++) {
      const mins = widths.map((ws) => minWidthFor(ws, R));
      if (mins.reduce((a, w) => a + w, 0) <= avail - 1 || R === 8) { need = mins; break; }
    }
    groups.forEach((g, i) => { g.style.flex = `${need[i]} 1 ${Math.ceil(need[i] + frame[i] + 1)}px`; });
    requestAnimationFrame(markPalOverflow);
  }
  // Kompakt modda yatay taşan grupları işaretle (sağ kenar solması; sona kaydırınca kalkar)
  function markPalOverflow() {
    $$('.pal-items', paletteEl).forEach((it) => {
      it.classList.toggle('overflowing', it.scrollWidth > it.clientWidth + 1);
      it.classList.toggle('at-end', it.scrollLeft + it.clientWidth >= it.scrollWidth - 2);
    });
  }

  function applyPalCompact() {
    const on = !!S.settings.palCompact;
    paletteEl.classList.toggle('compact', on);
    btnPalToggle.title = T(on ? 'pal.expand' : 'pal.compact');
    btnPalToggle.setAttribute('aria-expanded', String(!on));
    requestAnimationFrame(markPalOverflow);
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    $$('.pal-items', paletteEl).forEach((it) => it.addEventListener('scroll', markPalOverflow, { passive: true }));
    if (window.ResizeObserver) new ResizeObserver(() => balancePalette()).observe(paletteEl);
    btnPalToggle.addEventListener('click', () => { S.settings.palCompact = !S.settings.palCompact; saveSettings(); applyPalCompact(); });
    applyPalCompact();
  }

  Seq.palette = { init, TYPE_LABEL, applyPalCompact, renderPalette };
})(window.Seq = window.Seq || {});
