/* Sequence Studio — draw.io (.drawio) dışa aktarma
 *
 * Önizlemede çizilmiş (tema + renklendirme uygulanmış) Mermaid SVG'sini draw.io'nun
 * düzenlenebilir şekillerine çevirir. Konumlar ve renkler SVG'nin o anki hesaplanmış
 * stillerinden okunur; böylece çıktı önizlemeyle aynı görünür.
 *   - Katılımcılar: yaşam çizgisinin üstündeki/altındaki şekiller konumdan bulunur;
 *     tipe göre draw.io'nun UML şekline (umlActor, umlBoundary…) ya da birebir dikdörtgene çevrilir.
 *   - Mesajlar: uç noktaları, ok ucu tipi, kesik çizgi ve renk korunarak bağlantı çizgisi olur.
 *   - Bloklar, notlar, aktivasyonlar, box'lar, numaralar ve başlık aynı konum/renkte aktarılır.
 *   - Metinler mümkün olduğunca ait oldukları şeklin/okun kendi etiketi olur (draw.io'da çift tıklayıp
 *     düzenlenir, şekille birlikte taşınır): katılımcı adı, mesaj metni (okun etiketi), not, box adı,
 *     blok tipi, numara. Yalnızca blok koşulları ve başlık ayrı metindir.
 *   - Tanınmayan dikdörtgen/çizgi/metinler de genel olarak aktarılır (hiçbir şey kaybolmasın).
 * SVG belgede (görünür ya da ekran dışında) çizilmiş olmalıdır: ölçümler DOM'dan alınır.
 */
(function () {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const r1 = (n) => Math.round(n * 10) / 10;

  /** "rgb(…)/rgba(…)/#hex" → { hex, a } ya da null (none/şeffaf) */
  function color(c, opacity) {
    if (!c || c === 'none' || c === 'transparent') return null;
    let hex, a = 1;
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (m) {
      const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (v.length > 3) a = v[3];
      hex = '#' + v.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
    } else if (/^#[0-9a-f]{3,8}$/i.test(c)) hex = c;
    else return null;
    a *= opacity == null ? 1 : opacity;
    return a <= 0.001 ? null : { hex, a };
  }
  const styleStr = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => k + '=' + v).join(';') + ';';

  function convert(svg, opts) {
    opts = opts || {};
    const types = opts.types || {}; // katılımcı kimliği → tip
    const svgRect = svg.getBoundingClientRect();
    const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : { x: 0, y: 0, width: svgRect.width };
    const k = svgRect.width / vb.width || 1;
    // Ekran koordinatı → SVG kullanıcı koordinatı (önizlemenin yakınlaştırmasından bağımsız)
    const ux = (x) => vb.x + (x - svgRect.left) / k;
    const uy = (y) => vb.y + (y - svgRect.top) / k;
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: ux(r.left), y: uy(r.top), w: r.width / k, h: r.height / k }; };
    const pt = (el, x, y) => {
      const p = svg.createSVGPoint(); p.x = x; p.y = y;
      const s = p.matrixTransform(el.getScreenCTM());
      return { x: ux(s.x), y: uy(s.y) };
    };
    const cs = (el) => getComputedStyle(el);
    const strokeW = (st) => r1(parseFloat(st.strokeWidth) || 1);
    const dash = (st) => {
      const d = st.strokeDasharray;
      if (!d || d === 'none') return null;
      return d.split(/[\s,]+/).map((x) => parseFloat(x)).filter((x) => x > 0).map(r1).join(' ') || null;
    };
    const fillOf = (el) => { const st = cs(el); return color(st.fill, parseFloat(st.fillOpacity) * parseFloat(st.opacity)); };
    const strokeOf = (el) => { const st = cs(el); return color(st.stroke, parseFloat(st.strokeOpacity) * parseFloat(st.opacity)); };
    const fillStyle = (f) => (f ? { fillColor: f.hex, fillOpacity: f.a < 1 ? Math.round(f.a * 100) : null } : { fillColor: 'none' });
    const strokeStyle = (s, w) => (s ? { strokeColor: s.hex, strokeOpacity: s.a < 1 ? Math.round(s.a * 100) : null, strokeWidth: w } : { strokeColor: 'none' });

    const used = new Set();
    const skip = (el) => used.has(el) || !!el.closest('defs, marker');

    // ---- Hücreler ----
    const cells = [];
    let nid = 2;
    const id = () => 'c' + nid++;
    const vertex = (geo, style, value, parent) => {
      const c = { id: id(), kind: 'v', geo: { x: r1(geo.x), y: r1(geo.y), w: r1(Math.max(geo.w, 1)), h: r1(Math.max(geo.h, 1)) }, style, value: value || '', parent: parent || '1' };
      cells.push(c);
      return c;
    };
    const edge = (src, dst, style, points, parent, value, offset) => {
      const c = { id: id(), kind: 'e', src, dst, points: points || [], style, parent: parent || '1', value: value || '', offset: offset || null };
      cells.push(c);
      return c;
    };
    /** Hücreleri bir grupta toplar: grup geometrisi birleşim; çocuk koordinatları göreli olur. */
    const group = (children) => {
      children = children.filter(Boolean);
      if (children.length < 2) return;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      const ext = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
      children.forEach((c) => {
        if (c.kind === 'v') { ext(c.geo.x, c.geo.y); ext(c.geo.x + c.geo.w, c.geo.y + c.geo.h); }
        else { [c.src, c.dst, ...c.points].forEach((p) => ext(p.x, p.y)); }
      });
      const g = { id: id(), kind: 'v', geo: { x: r1(x1), y: r1(y1), w: r1(x2 - x1), h: r1(y2 - y1) }, style: 'group;', value: '', parent: '1', group: true };
      // Grup, ilk çocuğunun yerine (z-sırasını koruyarak) girer
      cells.splice(cells.indexOf(children[0]), 0, g);
      children.forEach((c) => {
        c.parent = g.id;
        if (c.kind === 'v') { c.geo.x = r1(c.geo.x - x1); c.geo.y = r1(c.geo.y - y1); }
        else { const rel = (p) => ({ x: r1(p.x - x1), y: r1(p.y - y1) }); c.src = rel(c.src); c.dst = rel(c.dst); c.points = c.points.map(rel); }
      });
    };

    // Metin: tspan satırları <br> ile; hizalama text-anchor'dan; yazı tipi draw.io'da taşınabilir olsun diye Helvetica
    const textCell = (el, parent) => {
      if (skip(el)) return null;
      used.add(el);
      const tspans = el.querySelectorAll('tspan');
      const lines = tspans.length ? Array.from(tspans).map((t) => t.textContent) : [el.textContent];
      const txt = lines.map(esc).join('<br>');
      if (!txt.trim()) return null;
      const st = cs(el);
      // Renk/kalınlık çoğu zaman tspan'e CSS ile verilir (ör. katılımcı adları): ilk tspan'den oku
      const tst = tspans.length ? cs(tspans[0]) : st;
      const b = box(el);
      const anchor = st.textAnchor;
      const fc = color(tst.fill) || color(st.fill) || { hex: '#000000' };
      const fs = Math.round(parseFloat(tst.fontSize) || parseFloat(st.fontSize) || 14);
      const bold = (parseInt(tst.fontWeight, 10) || parseInt(st.fontWeight, 10) || 400) >= 600;
      const italic = tst.fontStyle === 'italic' || st.fontStyle === 'italic';
      const pad = 6;
      return vertex({ x: b.x - pad, y: b.y - 2, w: b.w + pad * 2, h: b.h + 4 }, styleStr({
        text: '', html: 1, strokeColor: 'none', fillColor: 'none', whiteSpace: 'nowrap', spacing: 0,
        align: anchor === 'start' ? 'left' : anchor === 'end' ? 'right' : 'center', verticalAlign: 'middle',
        fontFamily: 'Helvetica', fontSize: fs, fontColor: fc.hex, fontStyle: (bold ? 1 : 0) + (italic ? 2 : 0) || null,
      }), txt, parent);
    };
    /**
     * Bir ya da birkaç <text> öğesini (Mermaid çok satırlı adları ayrı öğeler olarak çizer) tek bir
     * draw.io etiketine çevirir: html değer + yazı tipi stili + kaplanan alan. Öğeleri "kullanıldı" işaretler.
     */
    const textInfo = (els) => {
      els = (Array.isArray(els) ? els : [els]).filter((e) => e && !skip(e));
      if (!els.length) return null;
      els.sort((a, b) => box(a).y - box(b).y);
      const lines = els.flatMap((el) => { const ts = el.querySelectorAll('tspan'); return ts.length ? Array.from(ts).map((t) => t.textContent) : [el.textContent]; });
      if (!lines.join('').trim()) return null;
      els.forEach((e) => used.add(e));
      const el = els[0];
      const st = cs(el);
      const ts = el.querySelector('tspan');
      const tst = ts ? cs(ts) : st; // renk/kalınlık çoğu zaman tspan'e CSS ile verilir
      const fc = color(tst.fill) || color(st.fill) || { hex: '#000000' };
      const bold = (parseInt(tst.fontWeight, 10) || parseInt(st.fontWeight, 10) || 400) >= 600;
      const italic = tst.fontStyle === 'italic' || st.fontStyle === 'italic';
      const bs = els.map(box);
      const x1 = Math.min(...bs.map((b) => b.x)), y1 = Math.min(...bs.map((b) => b.y));
      const b = { x: x1, y: y1, w: Math.max(...bs.map((q) => q.x + q.w)) - x1, h: Math.max(...bs.map((q) => q.y + q.h)) - y1 };
      return {
        html: lines.map(esc).join('<br>'), box: b, cx: b.x + b.w / 2, cy: b.y + b.h / 2, anchor: st.textAnchor,
        font: { fontFamily: 'Helvetica', fontSize: Math.round(parseFloat(tst.fontSize) || parseFloat(st.fontSize) || 14), fontColor: fc.hex, fontStyle: (bold ? 1 : 0) + (italic ? 2 : 0) || null },
      };
    };
    const contains = (b, x, y) => x >= b.x - 1 && x <= b.x + b.w + 1 && y >= b.y - 1 && y <= b.y + b.h + 1;
    const rectCell = (el, extra, label) => {
      used.add(el);
      const st = cs(el);
      const b = box(el);
      const rx = parseFloat(el.getAttribute('rx')) || parseFloat(st.rx) || 0;
      return vertex(b, styleStr(Object.assign({
        rounded: rx ? 1 : 0, absoluteArcSize: rx ? 1 : null, arcSize: rx ? r1(rx * 2) : null, whiteSpace: 'wrap', html: 1,
      }, fillStyle(fillOf(el)), strokeStyle(strokeOf(el), strokeW(st)), dash(st) ? { dashed: 1, dashPattern: dash(st) } : {},
      label ? label.font : {}, extra || {})), label ? label.html : '');
    };
    const lineCell = (el, extra) => {
      used.add(el);
      const st = cs(el);
      const a = pt(el, +el.getAttribute('x1'), +el.getAttribute('y1'));
      const b = pt(el, +el.getAttribute('x2'), +el.getAttribute('y2'));
      const d = dash(st);
      return edge(a, b, styleStr(Object.assign({ endArrow: 'none', html: 1, rounded: 0 }, strokeStyle(strokeOf(el), strokeW(st)), d ? { dashed: 1, dashPattern: d } : {}, extra || {})));
    };

    // ---- 1) Box'lar (adı üstte, kutunun kendi etiketi) ve rect vurgu alanları (en altta) ----
    const boxTexts = Array.from(svg.querySelectorAll('text.text'));
    svg.querySelectorAll('rect.rect').forEach((el) => {
      if (skip(el)) return;
      const b = box(el);
      const t = boxTexts.find((x) => !used.has(x) && contains(b, box(x).x + box(x).w / 2, box(x).y + box(x).h / 2));
      const lab = t ? textInfo(t) : null;
      rectCell(el, lab ? { verticalAlign: 'top', align: 'center', spacing: 0, spacingTop: r1(Math.max(0, lab.box.y - b.y - 3)) } : null, lab);
    });

    // ---- 2) Bloklar (loop/alt/opt/par/critical/break) ----
    const overlays = [];
    const bgRects = Array.from(svg.querySelectorAll('.block-bgs rect'));
    bgRects.forEach((r) => used.add(r));
    // Mermaid iç içe bloklarda içtekini önce çizer; draw.io'da dıştakinin opak arka planı onu örtmesin
    // diye büyükten küçüğe sırala (önizlemedeki arka plan katmanıyla aynı mantık)
    const blockArea = (g) => { const b = box(g); return b.w * b.h; };
    Array.from(svg.querySelectorAll('g[data-et="control-structure"]')).sort((a, b) => blockArea(b) - blockArea(a)).forEach((g) => {
      // Çerçeve: satır içi kesik çizgi stili olmayan 4 çizgi; kol ayırıcıları satır içi stil taşır
      const borderLines = Array.from(g.querySelectorAll('line.loopLine')).filter((l) => !l.style.strokeDasharray).slice(0, 4);
      if (!borderLines.length) return;
      const pts = borderLines.flatMap((l) => [pt(l, +l.getAttribute('x1'), +l.getAttribute('y1')), pt(l, +l.getAttribute('x2'), +l.getAttribute('y2'))]);
      const bx = Math.min(...pts.map((p) => p.x)), by = Math.min(...pts.map((p) => p.y));
      const bw = Math.max(...pts.map((p) => p.x)) - bx, bh = Math.max(...pts.map((p) => p.y)) - by;
      const bg = bgRects.find((r) => { const b = box(r); return Math.abs(b.x - bx) < 1.5 && Math.abs(b.y - by) < 1.5; });
      const st = cs(borderLines[0]);
      const kids = [vertex({ x: bx, y: by, w: bw, h: bh }, styleStr(Object.assign({ rounded: 0, html: 1 },
        fillStyle(bg ? fillOf(bg) : null), strokeStyle(strokeOf(borderLines[0]), strokeW(st)), dash(st) ? { dashed: 1, dashPattern: dash(st) } : {})))];
      borderLines.forEach((l) => used.add(l));
      // Kol ayırıcıları (else/and/option)
      g.querySelectorAll('line.loopLine').forEach((l) => { if (!used.has(l)) kids.push(lineCell(l)); });
      group(kids);
      overlays.push(g); // etiket kutusu ve kol metinleri aktivasyonların üstünde çizilir (önizlemedeki gibi)
    });

    // ---- 3) Yaşam çizgileri ----
    const lifelines = Array.from(svg.querySelectorAll('line[data-et="life-line"]')).map((l) => {
      const a = pt(l, +l.getAttribute('x1'), +l.getAttribute('y1'));
      const b = pt(l, +l.getAttribute('x2'), +l.getAttribute('y2'));
      lineCell(l);
      return { id: l.getAttribute('data-id'), x: a.x, top: Math.min(a.y, b.y), bottom: Math.max(a.y, b.y) };
    });

    // ---- 4) Katılımcılar (üst ve alt) ----
    const xs = lifelines.map((l) => l.x).sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i] - xs[i - 1]);
    const tol = gap === Infinity ? 1e6 : gap / 2;
    const shapeEls = Array.from(svg.querySelectorAll('rect, path, circle, ellipse, line, polygon')).filter((el) =>
      !skip(el) && !el.closest('g[data-et="control-structure"], g[data-et="note"], .block-bgs')
      && el.getAttribute('data-et') !== 'message' && !/\b(activation\d|messageLine\d|note|rect|labelBox|loopLine)\b/.test(el.getAttribute('class') || ''));
    const actorTexts = Array.from(svg.querySelectorAll('text.actor'));
    const SHAPES = {
      actor: 'shape=umlActor;', boundary: 'shape=umlBoundary;', control: 'shape=umlControl;', entity: 'shape=umlEntity;',
      database: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=7;', queue: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=7;direction=south;',
    };
    lifelines.forEach((ll) => {
      ['top', 'bottom'].forEach((side) => {
        // Merkezi yaşam çizgisinin üstünde/altında kalan şekiller (kaydırılmış "collections" kutuları da dahil)
        const near = (b) => Math.abs(b.x + b.w / 2 - ll.x) <= tol && (side === 'top' ? b.y + b.h / 2 < ll.top : b.y + b.h / 2 > ll.bottom);
        const parts = shapeEls.filter((el) => !used.has(el)).map((el) => ({ el, b: box(el) })).filter((p) => p.b.w + p.b.h > 0 && near(p.b));
        // Çok satırlı adlarda Mermaid her satırı ayrı <text> olarak çizer
        const labels = actorTexts.filter((t) => !used.has(t) && near(box(t)));
        if (!parts.length && !labels.length) return;
        const kids = [];
        const type = types[ll.id] || 'participant';
        const lab = textInfo(labels);
        if (parts.length && parts.every((p) => p.el.tagName === 'rect')) {
          // Kutu tipleri (participant, collections): dikdörtgenler birebir; ad, metni içeren (öndeki) kutunun etiketi
          const host = lab && (parts.slice().reverse().find((p) => contains(p.b, lab.cx, lab.cy)) || parts[parts.length - 1]);
          parts.forEach((p) => kids.push(rectCell(p.el, p === host ? { align: 'center', verticalAlign: 'middle' } : null, p === host ? lab : null)));
        } else if (parts.length) {
          parts.forEach((p) => used.add(p.el));
          const x1 = Math.min(...parts.map((p) => p.b.x)), y1 = Math.min(...parts.map((p) => p.b.y));
          const x2 = Math.max(...parts.map((p) => p.b.x + p.b.w)), y2 = Math.max(...parts.map((p) => p.b.y + p.b.h));
          // Renk: dolgusu olan en büyük parça (çöp adamda baş, silindirde gövde)
          const main = parts.filter((p) => fillOf(p.el)).sort((a, b) => b.b.w * b.b.h - a.b.w * a.b.h)[0] || parts[0];
          const sStroke = parts.map((p) => strokeOf(p.el)).find(Boolean);
          // Ad şeklin etiketi: şeklin içindeyse ortada, dışındaysa (çöp adam, silindir…) altında
          const inside = lab && contains({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, lab.cx, lab.cy);
          const labPos = !lab ? {} : inside ? { align: 'center', verticalAlign: 'middle' }
            : { verticalLabelPosition: 'bottom', verticalAlign: 'top', labelPosition: 'center', align: 'center', spacing: 0, spacingTop: r1(Math.max(0, lab.box.y - y2 - 3)) };
          kids.push(vertex({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, (SHAPES[type] || 'rounded=1;') + styleStr(Object.assign({ html: 1 },
            fillStyle(fillOf(main.el)), strokeStyle(sStroke, strokeW(cs(main.el))), lab ? lab.font : {}, labPos)), lab ? lab.html : ''));
        }
        if (!parts.length && lab) kids.push(vertex(lab.box, styleStr(Object.assign({ text: '', html: 1, strokeColor: 'none', fillColor: 'none', whiteSpace: 'nowrap' }, lab.font)), lab.html));
        group(kids);
      });
    });

    // ---- 5) Aktivasyon barları ----
    svg.querySelectorAll('rect[class^="activation"]').forEach((el) => { if (!skip(el)) rectCell(el); });

    // ---- 5b) Blok etiketleri: kesik köşeli etiket kutusu (draw.io "card", iki yönde çevrilmiş) + metinler ----
    overlays.forEach((g) => {
      const kids = [];
      const lb = g.querySelector('polygon.labelBox');
      const kind = textInfo(Array.from(g.querySelectorAll('text.labelText')));
      if (lb) {
        used.add(lb);
        const lst = cs(lb);
        // Blok tipi ("alt", "loop"…) kesik köşeli etiket kutusunun kendi etiketi
        kids.push(vertex(box(lb), styleStr(Object.assign({ shape: 'card', flipH: 1, flipV: 1, size: 7, html: 1, spacingBottom: 2 },
          fillStyle(fillOf(lb)), strokeStyle(strokeOf(lb), strokeW(lst)), kind ? kind.font : {})), kind ? kind.html : ''));
      }
      // [koşul] metinleri ayrı kalır (blok arka planının etiketi olsalar yaşam çizgileri üstlerinden geçerdi),
      // ama etiket kutusuyla aynı grupta birlikte taşınır
      g.querySelectorAll('text').forEach((t) => kids.push(textCell(t)));
      group(kids);
    });

    // ---- 6) Mesajlar, numaralar ve metinleri ----
    const arrow = (url) => {
      const m = /url\(#([^)]+)\)/.exec(url || '');
      if (!m) return null;
      const n = m[1];
      if (/sequencenumber/i.test(n)) return { seq: true, id: n };
      if (/crosshead/i.test(n)) return { a: 'cross', fill: 0 };
      if (/filled-head/i.test(n)) return { a: 'open', fill: 0 };
      if (/stick/i.test(n)) return { a: 'open', fill: 0 };
      return { a: 'block', fill: 1 };
    };
    // Mesaj metinlerini oklarına konumdan bağla: her metin satırı (çok satırlı metinlerde Mermaid her satırı
    // ayrı <text> olarak çizer) yatayda üzerinde durduğu ve hemen altındaki oka aittir
    const msgEls = Array.from(svg.querySelectorAll('[data-et="message"]')).filter((e) => !skip(e));
    const msgGeo = msgEls.map((el) => {
      if (el.tagName === 'line') {
        const a = pt(el, +el.getAttribute('x1'), +el.getAttribute('y1')), b = pt(el, +el.getAttribute('x2'), +el.getAttribute('y2'));
        return { x1: Math.min(a.x, b.x) - 6, x2: Math.max(a.x, b.x) + 6, y: Math.min(a.y, b.y) };
      }
      const b = box(el); // kendine mesaj: metin eğrinin üstünde, biraz daha geniş bir aralıkta
      return { x1: b.x - 80, x2: b.x + b.w + 80, y: b.y };
    });
    const msgLabels = msgEls.map(() => []);
    Array.from(svg.querySelectorAll('text.messageText')).forEach((t) => {
      const b = box(t), cx = b.x + b.w / 2;
      let best = -1, bd = Infinity;
      msgGeo.forEach((g, i) => {
        if (cx < g.x1 || cx > g.x2 || b.y + b.h > g.y + 4) return;
        const d = g.y - (b.y + b.h);
        if (d < bd && d < 120) { bd = d; best = i; }
      });
      if (best >= 0) msgLabels[best].push(t);
    });
    const midOf = (ps) => {
      const segs = ps.slice(1).map((q, i) => ({ a: ps[i], b: q, l: Math.hypot(q.x - ps[i].x, q.y - ps[i].y) }));
      let rest = segs.reduce((x, sg) => x + sg.l, 0) / 2;
      for (const sg of segs) { if (rest <= sg.l) { const t = sg.l ? rest / sg.l : 0; return { x: sg.a.x + (sg.b.x - sg.a.x) * t, y: sg.a.y + (sg.b.y - sg.a.y) * t }; } rest -= sg.l; }
      return ps[0];
    };
    msgEls.forEach((el, mi) => {
      used.add(el);
      const st = cs(el);
      let a, b, points = [], curved = 0;
      if (el.tagName === 'line') {
        a = pt(el, +el.getAttribute('x1'), +el.getAttribute('y1'));
        b = pt(el, +el.getAttribute('x2'), +el.getAttribute('y2'));
      } else {
        // Kendine mesaj (eğri yol): yol boyunca örnek noktalar
        const L = el.getTotalLength();
        const at = (t) => { const q = el.getPointAtLength(L * t); return pt(el, q.x, q.y); };
        a = at(0); b = at(1);
        points = [0.2, 0.4, 0.5, 0.6, 0.8].map(at);
        curved = 1;
      }
      const s = arrow(el.getAttribute('marker-start'));
      const e = arrow(el.getAttribute('marker-end'));
      const d = dash(st);
      // Metin okun etiketi; konumu, önizlemedeki yeri olacak şekilde okun ortasına göre kaydırılır
      const lab = msgLabels[mi].length ? textInfo(msgLabels[mi]) : null;
      const mid = midOf([a, ...points, b]);
      edge(a, b, styleStr(Object.assign({ html: 1, rounded: 0, curved: curved || null, endSize: 7, startSize: 7 },
        strokeStyle(strokeOf(el), strokeW(st)), d ? { dashed: 1, dashPattern: d } : {},
        e && !e.seq ? { endArrow: e.a, endFill: e.fill } : { endArrow: 'none' },
        s && !s.seq ? { startArrow: s.a, startFill: s.fill } : { startArrow: 'none' },
        lab ? Object.assign({ labelBackgroundColor: 'none', align: 'center', verticalAlign: 'middle' }, lab.font) : {})),
      points, null, lab ? lab.html : '', lab ? { x: r1(lab.cx - mid.x), y: r1(lab.cy - mid.y) } : null);
    });
    // autonumber: Mermaid numara dairesini ayrı, sıfır uzunluklu bir çizginin başına işaretçi olarak koyar
    const seqTexts = Array.from(svg.querySelectorAll('text.sequenceNumber'));
    svg.querySelectorAll('line').forEach((l) => {
      if (skip(l)) return;
      const s = arrow(l.getAttribute('marker-start'));
      if (!s || !s.seq) return;
      used.add(l);
      const c = pt(l, +l.getAttribute('x1'), +l.getAttribute('y1'));
      const mk = svg.querySelector('marker#' + CSS.escape(s.id) + ' circle');
      const f = (mk && fillOf(mk)) || { hex: '#333333', a: 1 };
      const r = 8;
      const num = seqTexts.find((t) => !used.has(t) && Math.hypot(box(t).x + box(t).w / 2 - c.x, box(t).y + box(t).h / 2 - c.y) < 12);
      const lab = num ? textInfo(num) : null;
      vertex({ x: c.x - r, y: c.y - r, w: r * 2, h: r * 2 }, 'ellipse;' + styleStr(Object.assign({ html: 1, spacing: 0 }, fillStyle(f), { strokeColor: 'none' }, lab ? lab.font : {})), lab ? lab.html : '');
    });
    svg.querySelectorAll('text.sequenceNumber, text.messageText').forEach((t) => textCell(t)); // eşleşmeyenler

    // ---- 7) Notlar ----
    svg.querySelectorAll('g[data-et="note"]').forEach((g) => {
      const rects = Array.from(g.querySelectorAll('rect'));
      const lab = textInfo(Array.from(g.querySelectorAll('text')));
      // Not metni not kutusunun kendi etiketi
      rects.forEach((r, i) => rectCell(r, i === 0 && lab ? { align: 'center', verticalAlign: 'middle' } : null, i === 0 ? lab : null));
    });

    // ---- 8) Kalanlar: başlık, box adları ve tanınmayan öğeler ----
    svg.querySelectorAll('rect').forEach((el) => { if (!skip(el) && !el.closest('.block-bgs')) { const b = box(el); if (b.w > 0 && b.h > 0) rectCell(el); } });
    svg.querySelectorAll('line').forEach((el) => { if (!skip(el)) lineCell(el); });
    svg.querySelectorAll('text').forEach((el) => textCell(el));

    // ---- Konumlandırma: sol üst kenara pay bırak ----
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    cells.filter((c) => c.parent === '1').forEach((c) => {
      const ps = c.kind === 'v' ? [{ x: c.geo.x, y: c.geo.y }, { x: c.geo.x + c.geo.w, y: c.geo.y + c.geo.h }] : [c.src, c.dst, ...c.points];
      ps.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    });
    const PAD = 20;
    const dx = PAD - minX, dy = PAD - minY;
    cells.filter((c) => c.parent === '1').forEach((c) => {
      if (c.kind === 'v') { c.geo.x = r1(c.geo.x + dx); c.geo.y = r1(c.geo.y + dy); }
      else { const m = (p) => ({ x: r1(p.x + dx), y: r1(p.y + dy) }); c.src = m(c.src); c.dst = m(c.dst); c.points = c.points.map(m); }
    });
    const pageW = Math.ceil(maxX - minX + PAD * 2), pageH = Math.ceil(maxY - minY + PAD * 2);

    // ---- XML ----
    const xml = cells.map((c) => {
      if (c.kind === 'v') {
        return `<mxCell id="${c.id}" value="${esc(c.value)}" style="${esc(c.style)}" vertex="1"${c.group ? ' connectable="0"' : ''} parent="${c.parent}"><mxGeometry x="${c.geo.x}" y="${c.geo.y}" width="${c.geo.w}" height="${c.geo.h}" as="geometry"/></mxCell>`;
      }
      const pts = c.points.length ? `<Array as="points">${c.points.map((p) => `<mxPoint x="${p.x}" y="${p.y}"/>`).join('')}</Array>` : '';
      const off = c.offset ? `<mxPoint x="${c.offset.x}" y="${c.offset.y}" as="offset"/>` : '';
      return `<mxCell id="${c.id}" value="${esc(c.value || '')}" style="${esc(c.style)}" edge="1" parent="${c.parent}"><mxGeometry relative="1" as="geometry"><mxPoint x="${c.src.x}" y="${c.src.y}" as="sourcePoint"/><mxPoint x="${c.dst.x}" y="${c.dst.y}" as="targetPoint"/>${pts}${off}</mxGeometry></mxCell>`;
    }).join('\n        ');
    const bg = opts.background && opts.background !== 'transparent' ? ` background="${esc(opts.background)}"` : '';
    const name = esc(opts.name || 'Diagram');
    const diagId = 'seq-' + Math.random().toString(36).slice(2, 10);
    return `<mxfile host="SequenceStudio" agent="Sequence Studio" type="device">
  <diagram name="${name}" id="${diagId}">
    <mxGraphModel dx="${pageW}" dy="${pageH}" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageW}" pageHeight="${pageH}"${bg} math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${xml}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
  }

  window.SeqDrawio = { convert };
})();
