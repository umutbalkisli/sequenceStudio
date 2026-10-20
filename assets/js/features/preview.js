/* Sequence Studio — önizleme
 *
 * Mermaid çizimi, süsleme adımları, yakınlaştırma/kaydırma, önizlemeden adıma gitme ve ekran dışı çizim (dışa aktarma için).
 */
(function (Seq) {
  'use strict';
  const { $, $$, M, S, T, clamp, debounce, el, h, ico, saveSettings } = Seq.core;

  // ---------------------------------------------------------------------------
  // Çizim hattı (genişlemeye açık): modüller kendi adımlarını init()'te kaydeder; önizleme ve ekran dışı
  // çizim (dışa aktarma) aynı hattı kullanır. Yeni bir süsleme eklemek bu dosyayı değiştirmeyi gerektirmez.
  //  - Dönüşüm: (model) → yeni model kopyası | null (değişiklik yok). Mermaid'e gönderilmeden önce uygulanır.
  //  - Süsleme: (svg, { model, renderModel, settings }) → çizilmiş SVG'yi yerinde değiştirir.
  // Adımlar "order" değerine göre (küçükten büyüğe) çalışır.
  // ---------------------------------------------------------------------------
  const pipeline = { transforms: [], decorators: [] };
  const byOrder = (a, b) => a.order - b.order;
  function addTransform(name, fn, order = 100) { pipeline.transforms.push({ name, fn, order }); pipeline.transforms.sort(byOrder); }
  function addDecorator(name, fn, order = 100) { pipeline.decorators.push({ name, fn, order }); pipeline.decorators.sort(byOrder); }
  /** Çizim için model: dönüşümler uygulanmış kopya; hiçbiri değiştirmediyse null. */
  /** ctx: { live } — live: canlı önizleme (oturumdaki geçici seçimler uygulanır), değilse ekran dışı çizim */
  function prepareModel(model, ctx) {
    let cur = model, changed = false;
    pipeline.transforms.forEach(({ fn }) => { const r = fn(cur, ctx || {}); if (r) { cur = r; changed = true; } });
    return changed ? cur : null;
  }
  function decorate(svg, ctx) {
    if (!svg) return;
    const c = Object.assign({ settings: S.settings }, ctx);
    pipeline.decorators.forEach(({ fn }) => fn(svg, c));
  }

  // ---------------------------------------------------------------------------
  // Önizleme (render + pan/zoom)
  // ---------------------------------------------------------------------------
  let renderTimer;
  function scheduleRender(ms) { clearTimeout(renderTimer); renderTimer = setTimeout(renderPreview, ms == null ? 160 : ms); }

  async function renderPreview() {
    const seq = ++S.renderSeq;
    const code = S.code;
    const empty = !S.model.participants.length && !S.model.items.length;
    el.emptyState.hidden = !empty;
    if (empty) {
      el.canvas.innerHTML = '';
      el.renderError.hidden = true;
      Seq.code.setCodeStatus(true);
      return;
    }
    const id = 'mmd' + seq;
    try {
      await mermaid.parse(code);
      const prepared = prepareModel(S.model, { live: true });
      const { svg } = await mermaid.render(id, prepared ? M.serialize(prepared) : code);
      if (seq !== S.renderSeq) return;
      S.renderModel = prepared || S.model; // önizlemede çizilen model (yer tutucu notlar dahil)
      el.canvas.innerHTML = '<div class="paper">' + svg + '</div>';
      decorate($('.paper svg', el.canvas), { model: S.model, renderModel: S.renderModel });
      el.canvas.classList.remove('stale');
      el.renderError.hidden = true;
      S.lastOk = true;
      Seq.code.setCodeStatus(true);
      if (S.zoom.auto) fitView(); else applyZoom();
    } catch (err) {
      const stray = document.getElementById('d' + id);
      if (stray) stray.remove();
      if (seq !== S.renderSeq) return;
      const msg = String((err && (err.message || err.str)) || err);
      el.canvas.classList.add('stale');
      S.lastOk = false;
      el.renderError.hidden = false;
      el.renderError.innerHTML = '';
      el.renderError.append(ico('critical'), h('div', null, h('b', null, T('render.failed')), h('pre', null, msg.slice(0, 600))));
      Seq.code.setCodeStatus(false, msg);
    }
  }

  function applyZoom() {
    const z = S.zoom;
    el.canvas.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.k})`;
    el.zoomVal.textContent = Math.round(z.k * 100) + '%';
  }
  function fitView() {
    const paper = $('.paper', el.canvas);
    if (!paper) return;
    const vp = el.viewport.getBoundingClientRect();
    const w = paper.offsetWidth, ht = paper.offsetHeight;
    const pad = 28;
    const kw = (vp.width - pad * 2) / w;
    const kh = (vp.height - pad * 2 - 40) / ht;
    let k = Math.min(kw, kh, 1.15);
    if (k < 0.45) k = Math.min(kw, 1.15); // uzun diyagramlarda genişliğe sığdır, kaydırılabilir kalsın
    k = clamp(k, 0.1, 4);
    S.zoom.k = k;
    S.zoom.x = (vp.width - w * k) / 2;
    S.zoom.y = Math.max(pad, (vp.height - 40 - ht * k) / 2);
    applyZoom();
  }
  function zoomAt(factor, cx, cy) {
    const z = S.zoom;
    const k2 = clamp(z.k * factor, 0.1, 5);
    const f = k2 / z.k;
    z.x = cx - (cx - z.x) * f;
    z.y = cy - (cy - z.y) * f;
    z.k = k2;
    z.auto = false;
    applyZoom();
  }
  function zoomCenter(factor) {
    const r = el.viewport.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  }

  /** Önizlemede bir mesaja/nota tıklanınca editörde ilgili satıra git. */
  function onPreviewClick(target) {
    // Referansın içini aç/kapat düğmesi
    const tg = target.closest && target.closest('.ref-toggle');
    if (tg) { Seq.refs.toggleExpand(tg.getAttribute('data-key')); return; }
    // Referans notu: bağlı diyagramı aç
    const refG = target.closest && target.closest('g.ref-note');
    if (refG) { Seq.refs.followRef(refG.getAttribute('data-ref')); return; }
    const t = target.closest && target.closest('text.messageText, text.noteText');
    if (!t) return;
    const isNote = t.classList.contains('noteText');
    const kind = isNote ? 'note' : 'message';
    if (isNote) {
      // Notlar: not grubunun sırası önizleme modelindeki notlarla eşlenir (yer tutucu notlar atlanır)
      const gi = $$('g[data-et="note"]', el.canvas).indexOf(t.closest('g[data-et="note"]'));
      const rn = [];
      M.walk((S.renderModel || S.model).items, (it) => { if (it.kind === 'note') rn.push(it); });
      const hit = rn[gi];
      if (!hit || hit.uid === 'ph') return;
      if (hit.fromRef) return Seq.refs.followRef(hit.fromRef); // açılmış referansın içindeki not
      const real = [];
      M.walk(S.model.items, (it) => { if (it.kind === 'note') real.push(it); });
      const ri = real.findIndex((n) => n.uid === hit.uid);
      if (ri < 0) return;
      return gotoNode('note', ri);
    }
    // Mesajlar: çizilen modeldeki sırayla eşlenir (açılmış referanslar ek mesaj getirir), sonra kimlikle asıl modele
    const idx = $$('text.messageText', el.canvas).indexOf(t);
    const rm = [];
    M.walk((S.renderModel || S.model).items, (it) => { if (it.kind === 'message') rm.push(it); });
    const hit = rm[idx];
    if (!hit) return;
    if (hit.fromRef) return Seq.refs.followRef(hit.fromRef); // açılmış referansın içindeki mesaj: o diyagrama git
    const real = [];
    M.walk(S.model.items, (it) => { if (it.kind === 'message') real.push(it); });
    const ri = real.findIndex((n) => n.uid === hit.uid);
    if (ri >= 0) gotoNode(kind, ri);
  }
  /** kind türündeki idx'inci adıma git (kod görünümünde satır, görsel görünümde adım) */
  function gotoNode(kind, idx) {
    if (Seq.layout.currentView() === 'code') {
      const nodes = [];
      M.walk(M.parse(S.code).items, (it) => { if (it.kind === kind) nodes.push(it); });
      const n = nodes[idx];
      if (n && n.line != null) Seq.code.selectCodeLine(n.line);
      return;
    }
    const nodes = [];
    M.walk(S.model.items, (it) => { if (it.kind === kind) nodes.push(it); });
    if (nodes[idx]) Seq.flow.reveal(nodes[idx].uid, { focusText: true });
  }

  /** Bir diyagramı ekran dışında çizer; önizlemedeki renklendirme aynen uygulanır. */
  let offscreenSeq = 0;
  async function renderDocSvg(code, opts) {
    const model = M.parse(code);
    if (!model.participants.length && !model.items.length) throw new Error(T('exp.nothing'));
    const id = 'zx' + ++offscreenSeq;
    const host = h('div', { class: 'offscreen-render', 'aria-hidden': 'true' });
    document.body.append(host);
    try {
      await mermaid.parse(code);
      const prepared = prepareModel(model, { live: false });
      const { svg } = await mermaid.render(id, prepared ? M.serialize(prepared) : code);
      host.innerHTML = '<div class="paper">' + svg + '</div>';
      const svgEl = $('svg', host);
      decorate(svgEl, { model, renderModel: prepared || model });
      const built = Seq.export.buildExportSvg(Seq.export.exportBg(), svgEl);
      if (built && opts && opts.drawio) built.drawio = Seq.export.toDrawio(svgEl, prepared || model, opts.drawio);
      return built;
    } finally {
      host.remove();
      const stray = document.getElementById('d' + id);
      if (stray) stray.remove();
    }
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    // Mermaid boş blok kollarını ve boş notları çizerken yerleşimi bozuyor: "…" yer tutucuları
    addTransform('placeholders', (model) => M.previewSafeModel(model), 10);
    el.viewport.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = el.viewport.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey ? 4 : 1)), e.clientX - r.left, e.clientY - r.top);
      } else {
        S.zoom.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        S.zoom.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        S.zoom.auto = false;
        applyZoom();
      }
    }, { passive: false });
    (function setupPan() {
      let start = null;
      el.viewport.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.zoombar, .render-error, .nav-back')) return;
        start = { x: e.clientX, y: e.clientY, zx: S.zoom.x, zy: S.zoom.y, moved: false, target: e.target };
        el.viewport.setPointerCapture(e.pointerId);
      });
      el.viewport.addEventListener('pointermove', (e) => {
        if (!start) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) > 4) { start.moved = true; el.viewport.classList.add('panning'); }
        if (start.moved) { S.zoom.x = start.zx + dx; S.zoom.y = start.zy + dy; S.zoom.auto = false; applyZoom(); }
      });
      const end = () => {
        if (start && !start.moved) onPreviewClick(start.target);
        start = null;
        el.viewport.classList.remove('panning');
      };
      el.viewport.addEventListener('pointerup', end);
      el.viewport.addEventListener('pointercancel', () => { start = null; el.viewport.classList.remove('panning'); });
    })();
    window.addEventListener('resize', debounce(() => { if (S.zoom.auto) fitView(); }, 150));
    el.colorize.addEventListener('change', () => { S.settings.colorize = el.colorize.checked; saveSettings(); scheduleRender(0); });
    el.legend.addEventListener('change', () => { S.settings.legend = el.legend.checked; saveSettings(); scheduleRender(0); });
    $('#zoomIn').addEventListener('click', () => zoomCenter(1.2));
    $('#zoomOut').addEventListener('click', () => zoomCenter(1 / 1.2));
    $('#zoomFit').addEventListener('click', () => { S.zoom.auto = true; fitView(); });
    el.zoomVal.addEventListener('click', () => {
      const r = el.viewport.getBoundingClientRect();
      zoomAt(1 / S.zoom.k, r.width / 2, r.height / 2);
    });
  }

  Seq.preview = { init, addTransform, addDecorator, fitView, renderDocSvg, scheduleRender };
})(window.Seq = window.Seq || {});
