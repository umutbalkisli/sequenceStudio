/* Sequence Studio — lejant
 *
 * Diyagramda kullanılan roller ve ok renkleri için önizleme/dışa aktarma lejantı.
 */
(function (Seq) {
  'use strict';
  const { M, T, TONE_COLORS, colorOf, hexToRgb, mix } = Seq.core;

  // ---------------------------------------------------------------------------
  // Lejant: diyagramda kullanılan roller ve ok renkleri (önizlemede ve dışa aktarımlarda, altta)
  // ---------------------------------------------------------------------------
  function legendItems(model) {
    const items = [], seen = new Set();
    model.participants.forEach((p) => {
      if (!p.role || seen.has(p.role)) return;
      seen.add(p.role);
      const r = Seq.roles.roleById(p.role) || (model.roleDefs || {})[p.role];
      items.push({ kind: 'role', name: (r && r.name) || Seq.roles.prettyId(p.role), type: (r && r.type) || p.type, color: (r && r.color) || p.color || colorOf(p.id, model) });
    });
    const tones = new Set();
    M.walk(model.items, (it) => { if (it.kind === 'message' && it.tone) tones.add(it.tone); });
    M.TONES.filter((t) => tones.has(t)).forEach((t) => items.push({ kind: 'tone', name: T('tone.' + t), color: TONE_COLORS[t] }));
    return items;
  }
  function addLegend(svg, model) {
    if (!svg || Seq.workspace.get('legend') === false) return;
    const items = legendItems(model);
    if (!items.length) return;
    const vbA = svg.getAttribute('viewBox');
    if (!vbA) return;
    let [vx, vy, vw, vh] = vbA.split(/[\s,]+/).map(Number);
    const bg = Seq.theme.PAPER_BG[Seq.theme.mmThemeName()] || '#ffffff';
    const dark = hexToRgb(bg).reduce((a, v) => a + v, 0) < 384;
    const ink = dark ? '#c4cad8' : '#4b5368', frameC = dark ? '#384157' : '#d8dce6';
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs, style) => { const e = document.createElementNS(NS, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); Object.assign(e.style, style || {}); return e; };
    const g = mk('g', { class: 'seq-legend' });
    svg.append(g);
    const PAD = 10, ROW = 22, GAP = 18, ICON = 16, maxW = Math.max(vw - 32, 420);
    // Öğeleri satırlara yerleştir (metin genişliği ölçülerek)
    const rows = [[]];
    let x = 0, widest = 0;
    items.forEach((it) => {
      const ig = mk('g', { class: 'lg-item', 'data-kind': it.kind, 'data-color': it.color, 'data-type': it.type || '' });
      if (it.kind === 'role') {
        ig.append(mk('rect', { class: 'lg-chip', x: 0, y: -ICON / 2, width: ICON, height: ICON, rx: 4 }, { fill: mix(it.color, bg, dark ? 0.32 : 0.18), stroke: it.color, strokeWidth: '1px' }));
        // xmlns olmadan ayrıştırılan öğe SVG ad alanında olmaz ve çizilmez
        const src = window.SeqIcons.icon('t-' + it.type).replace(/currentColor/g, it.color).replace(' class="ic"', ' xmlns="http://www.w3.org/2000/svg"');
        const icon = document.importNode(new DOMParser().parseFromString(src, 'image/svg+xml').documentElement, true);
        icon.setAttribute('x', 2); icon.setAttribute('y', -ICON / 2 + 2); icon.setAttribute('width', ICON - 4); icon.setAttribute('height', ICON - 4);
        ig.append(icon);
      } else {
        ig.append(mk('line', { class: 'lg-tone', x1: 0, y1: 0, x2: ICON - 3, y2: 0 }, { stroke: it.color, strokeWidth: '2px' }));
        ig.append(mk('polygon', { points: `${ICON - 6},-4 ${ICON},0 ${ICON - 6},4` }, { fill: it.color, stroke: 'none' }));
      }
      const t = mk('text', { class: 'lg-text', x: ICON + 6, y: 0, 'dominant-baseline': 'central' }, { fill: ink, fontSize: '12px', fontFamily: Seq.theme.FONT });
      t.textContent = it.name;
      ig.append(t);
      g.append(ig);
      const w = ICON + 6 + t.getComputedTextLength();
      if (x > 0 && x + w > maxW) { rows.push([]); x = 0; }
      rows[rows.length - 1].push({ ig, x, w });
      x += w + GAP;
      widest = Math.max(widest, x - GAP);
    });
    const fw = widest + PAD * 2, fh = rows.length * ROW + PAD * 2 - (ROW - ICON);
    // Dar diyagramlarda lejant sığsın diye genişlet
    if (fw + 16 > vw) { const extra = fw + 16 - vw; vx -= extra / 2; vw += extra; }
    const fx = vx + (vw - fw) / 2, fy = vy + vh + 6;
    g.insertBefore(mk('rect', { class: 'lg-frame', x: fx, y: fy, width: fw, height: fh, rx: 8 }, { fill: dark ? mix(frameC, bg, 0.25) : '#ffffff', stroke: frameC, strokeWidth: '1px' }), g.firstChild);
    rows.forEach((row, ri) => row.forEach(({ ig, x: ix }) => ig.setAttribute('transform', `translate(${fx + PAD + ix}, ${fy + PAD + ICON / 2 + ri * ROW})`)));
    const nh = vh + 6 + fh + 10;
    const oldW = parseFloat(svg.getAttribute('width')), oldH = parseFloat(svg.getAttribute('height'));
    svg.setAttribute('viewBox', `${vx} ${vy} ${vw} ${nh}`);
    if (oldH && !/%/.test(svg.getAttribute('height'))) svg.setAttribute('height', oldH * nh / vh);
    if (oldW && !/%/.test(svg.getAttribute('width')) && vw !== +vbA.split(/[\s,]+/)[2]) svg.setAttribute('width', oldW * vw / +vbA.split(/[\s,]+/)[2]);
    if (svg.style.maxWidth) svg.style.maxWidth = vw + 'px';
  }

  function init() {
    Seq.preview.addDecorator('legend', (svg, c) => addLegend(svg, c.renderModel || c.model), 50);
  }

  Seq.legend = { init, addLegend };
})(window.Seq = window.Seq || {});
