/* Sequence Studio — önizleme renkleri
 *
 * Önizleme SVG'sinde katılımcı, blok ve ok tonu renklerini uygular (dışa aktarımlara da yansır).
 */
(function (Seq) {
  'use strict';
  const { $, $$, M, S, TONE_COLORS, colorOf, hexToRgb, mix } = Seq.core;

  /**
   * Önizlemedeki katılımcı başlıklarını, lifeline'ları ve aktivasyon çubuklarını
   * builder'daki renklerle boyar. Mermaid'in SVG yapısı tipe göre değiştiği için
   * her şekil yatayda en yakın lifeline'ın katılımcısına atanır. Stiller satır içi
   * yazıldığından PNG/SVG dışa aktarmaya da yansır.
   * "Renkli" kapalıyken (auto=false) yalnızca rengi elle seçilmiş katılımcılar boyanır.
   */
  function colorizeSvg(svg, auto, model = S.model) {
    if (!svg) return;
    const pById = (id) => model.participants.find((p) => p.id === id);
    const colorOfM = (id) => colorOf(id, model);
    const painted = (id) => auto || !!(pById(id) || {}).color;
    if (!auto && !model.participants.some((p) => p.color)) return;
    const bg = Seq.theme.PAPER_BG[Seq.theme.mmThemeName()] || '#ffffff';
    const dark = hexToRgb(bg).reduce((a, v) => a + v, 0) < 384;
    const lifelines = $$('line[data-et="life-line"]', svg)
      .map((l) => {
        const r = l.getBoundingClientRect();
        return { el: l, id: l.getAttribute('data-id'), x: r.left + r.width / 2 };
      })
      .filter((l) => pById(l.id));
    if (!lifelines.length) return;
    const xs = lifelines.map((l) => l.x).sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i] - xs[i - 1]);
    const tol = gap === Infinity ? 1e9 : gap / 2;
    const nearest = (el) => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      const cx = r.left + r.width / 2;
      let best = null, bd = Infinity;
      for (const l of lifelines) { const d = Math.abs(l.x - cx); if (d < bd) { bd = d; best = l; } }
      return bd <= tol ? best : null;
    };
    const paint = (el, c, fillT) => {
      const cs = getComputedStyle(el);
      if (cs.fill && cs.fill !== 'none') el.style.fill = mix(c, bg, fillT);
      if (cs.stroke && cs.stroke !== 'none') el.style.stroke = c;
    };

    for (const l of lifelines) if (painted(l.id)) l.el.style.stroke = mix(colorOfM(l.id), bg, dark ? 0.55 : 0.5);
    const ACTOR_G = 'g.actor, g.actor-man, g.actor-top, g.actor-bottom, g[data-et="participant"]';
    $$('rect, circle, ellipse, path, line, polygon, polyline', svg).forEach((el) => {
      const cls = el.getAttribute('class') || '';
      if (/\bactor-line\b/.test(cls) || el.getAttribute('data-et') === 'life-line') return;
      const isActivation = /\bactivation\d\b/.test(cls);
      const isActor = /(^|\s)actor(\s|$)/.test(cls) || !!el.closest(ACTOR_G);
      if (!isActivation && !isActor) return;
      const l = nearest(el);
      if (!l || !painted(l.id)) return;
      paint(el, colorOfM(l.id), isActivation ? (dark ? 0.45 : 0.3) : (dark ? 0.28 : 0.16));
    });
  }

  /**
   * loop/alt/opt/par/critical/break bloklarına, builder'daki tip rengiyle hafif
   * bir arka plan verir; kenarları ve etiket kutusunu aynı renge boyar. Arka
   * planlar ayrı bir katmanda en alta çizilir ki mesaj okları üstte kalsın.
   * İç içe bloklarda içteki blok dıştakinin üzerine gelir.
   * Kullanıcının seçtiği renk (block.color) her zaman uygulanır; tip renkleri
   * yalnızca "Renkli" açıkken (auto).
   */
  function colorizeBlocks(svg, auto, model = S.model) {
    if (!svg) return;
    const bg = Seq.theme.PAPER_BG[Seq.theme.mmThemeName()] || '#ffffff';
    const dark = hexToRgb(bg).reduce((a, v) => a + v, 0) < 384;
    const root = getComputedStyle(document.documentElement);
    const NS = 'http://www.w3.org/2000/svg';
    // rect dışındaki bloklar kaynak sırasıyla (ön-sıra) çizilir; SVG gruplarını
    // üst kenara göre sıralayınca aynı sıraya denk gelirler.
    const modelBlocks = [];
    M.walk(model.items, (it) => { if (it.kind === 'block' && it.type !== 'rect') modelBlocks.push(it); });
    const groups = $$('g[data-et="control-structure"]', svg).map((g) => {
      const lines = $$('line.loopLine', g).filter((l) => !l.style.strokeDasharray);
      if (!lines.length) return null;
      const xs = lines.flatMap((l) => [+l.getAttribute('x1'), +l.getAttribute('x2')]);
      const ys = lines.flatMap((l) => [+l.getAttribute('y1'), +l.getAttribute('y2')]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { g, x, y, w: Math.max(...xs) - x, ht: Math.max(...ys) - y };
    }).filter(Boolean).sort((a, b) => a.y - b.y || b.w * b.ht - a.w * a.ht);
    const sameShape = groups.length === modelBlocks.length;

    const blocks = [];
    groups.forEach((b, i) => {
      const { g } = b;
      const lbl = $('.labelText', g);
      const type = (lbl ? lbl.textContent : '').trim().toLowerCase().replace(/_over$/, '');
      const custom = sameShape && modelBlocks[i].color;
      const c = custom || (auto ? root.getPropertyValue('--c-' + type).trim() : '');
      if (!/^#[0-9a-f]{3,6}$/i.test(c)) return;
      b.c = c;
      blocks.push(b);

      $$('line.loopLine', g).forEach((l) => { l.style.stroke = c; });
      $$('.labelBox', g).forEach((b) => { b.style.fill = mix(c, bg, dark ? 0.38 : 0.22); b.style.stroke = c; });
      const ink = dark ? mix(c, '#ffffff', 0.55) : mix(c, '#000000', 0.62);
      $$('.labelText, .labelText tspan', g).forEach((t) => { t.style.fill = ink; });
    });
    if (!blocks.length) return;

    const parent = blocks[0].g.parentNode;
    const layer = document.createElementNS(NS, 'g');
    layer.setAttribute('class', 'block-bgs');
    blocks.sort((a, b) => b.w * b.ht - a.w * a.ht).forEach((b) => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', b.x); r.setAttribute('y', b.y);
      r.setAttribute('width', b.w); r.setAttribute('height', b.ht);
      r.style.fill = mix(b.c, bg, dark ? 0.13 : 0.07);
      r.style.stroke = 'none';
      layer.append(r);
    });
    const first = Array.from(parent.children).find((n) => !/^(style|defs)$/i.test(n.tagName));
    parent.insertBefore(layer, first || null);
  }

  /**
   * Tonu seçilmiş mesajların ok çizgisini, ok ucunu ve metnini boyar. Ok uçları Mermaid'de
   * paylaşılan <marker> tanımları olduğu için her ton için bir kopya oluşturulur.
   * Kullanıcının açık seçimi olduğundan "Renkli" anahtarından bağımsız uygulanır.
   */
  function colorizeMessages(svg, model = S.model) {
    if (!svg) return;
    const msgs = [];
    M.walk(model.items, (it) => { if (it.kind === 'message') msgs.push(it); });
    if (!msgs.some((m) => m.tone)) return;
    const lines = $$('[data-et="message"]', svg);
    if (lines.length !== msgs.length) return; // eşleşme güvenilir değilse hiç boyama
    const texts = $$('text.messageText', svg);
    const bg = Seq.theme.PAPER_BG[Seq.theme.mmThemeName()] || '#ffffff';
    const dark = hexToRgb(bg).reduce((a, v) => a + v, 0) < 384;
    const markers = new Map();
    const toneMarker = (url, tone, c) => {
      const m = /url\(#([^)]+)\)/.exec(url || '');
      if (!m) return url;
      const key = m[1] + '--' + tone;
      if (!markers.has(key)) {
        const src = svg.getElementById ? svg.getElementById(m[1]) : svg.querySelector('#' + CSS.escape(m[1]));
        if (!src) return url;
        const clone = src.cloneNode(true);
        clone.id = key;
        clone.querySelectorAll('*').forEach((n) => {
          const fill = n.getAttribute('fill');
          if (fill !== 'none') n.style.fill = c;
          if (n.getAttribute('stroke') || n.style.stroke) n.style.stroke = c;
        });
        src.parentNode.append(clone);
        markers.set(key, true);
      }
      return 'url(#' + key + ')';
    };
    msgs.forEach((it, i) => {
      if (!it.tone || !TONE_COLORS[it.tone]) return;
      const base = TONE_COLORS[it.tone];
      const c = dark ? mix(base, '#ffffff', 0.8) : base;
      const ln = lines[i];
      ln.style.stroke = c;
      ['marker-start', 'marker-end'].forEach((a) => { if (ln.getAttribute(a)) ln.setAttribute(a, toneMarker(ln.getAttribute(a), it.tone, c)); });
      if (texts.length === msgs.length) {
        const ink = dark ? mix(base, '#ffffff', 0.7) : mix(base, '#000000', 0.78);
        [texts[i], ...texts[i].querySelectorAll('tspan')].forEach((t) => { t.style.fill = ink; });
      }
    });
  }

  function init() {
    Seq.preview.addDecorator('participant-colors', (svg, c) => colorizeSvg(svg, c.settings.colorize, c.model), 10);
    Seq.preview.addDecorator('block-colors', (svg, c) => colorizeBlocks(svg, c.settings.colorize, c.model), 20);
    Seq.preview.addDecorator('message-tones', (svg, c) => colorizeMessages(svg, c.model), 30);
  }

  Seq.colors = { init, colorizeBlocks, colorizeMessages, colorizeSvg };
})(window.Seq = window.Seq || {});
