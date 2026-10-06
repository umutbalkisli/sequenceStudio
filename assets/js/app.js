/* ==========================================================================
   Sequence Studio — uygulama
   Runs entirely in the browser; makes no requests to external services.
   ========================================================================== */
(function () {
  'use strict';

  const M = window.SeqModel;
  const { icon, hydrate } = window.SeqIcons;
  const I18N = window.SeqI18n;
  const T = I18N.t;
  /** Şablonun aktif dildeki sürümü */
  const tplL = (tpl) => tpl[I18N.getLang()] || tpl.tr;

  // ---------------------------------------------------------------------------
  // Yardımcılar
  // ---------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  /** null/false değerleri atlayarak çocuk ekler (native append null'ı metne çevirir). */
  function add(parent, ...kids) {
    for (const c of kids.flat()) if (c != null && c !== false) parent.append(c);
    return parent;
  }
  function ico(name) {
    const t = document.createElement('template');
    t.innerHTML = icon(name);
    return t.content.firstChild;
  }
  const debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  function toast(msg, type) {
    const el = h('div', { class: 'toast' + (type === 'err' ? ' err' : '') }, ico(type === 'err' ? 'x' : 'check'), msg);
    $('#toasts').append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 2200);
  }

  function downloadBlob(blob, filename) {
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  const timeAgo = (t) => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return T('time.now');
    if (s < 3600) return T('time.min', { n: Math.floor(s / 60) });
    if (s < 86400) return T('time.hour', { n: Math.floor(s / 3600) });
    return new Date(t).toLocaleDateString(I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // ---------------------------------------------------------------------------
  // Depolama (yalnızca localStorage)
  // ---------------------------------------------------------------------------
  const LS = { docs: 'seqstudio.docs', cur: 'seqstudio.current', set: 'seqstudio.settings' };
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  const DEFAULT_SETTINGS = { appTheme: 'system', mmTheme: 'auto', mirror: true, colorize: true, editorCollapsed: false, editorW: null, view: 'builder', exp: { format: 'png', scale: 2, bg: 'theme' } };

  // ---------------------------------------------------------------------------
  // Durum
  // ---------------------------------------------------------------------------
  const S = {
    settings: Object.assign({}, DEFAULT_SETTINGS, store.get(LS.set, {})),
    docs: store.get(LS.docs, []),
    doc: null,
    code: '',
    model: M.emptyModel(),
    selected: null,
    selectedP: null,
    collapsed: new Set(),
    hist: { stack: [], i: -1, timer: null },
    zoom: { k: 1, x: 0, y: 0, auto: true },
    drag: null,
    linking: false,
    renderSeq: 0,
    lastOk: false,
  };
  S.settings.exp = Object.assign({}, DEFAULT_SETTINGS.exp, S.settings.exp || {});
  const saveSettings = () => store.set(LS.set, S.settings);

  const PCOLORS = ['#6c7cff', '#20b8a6', '#f0a020', '#ec5a8f', '#2fbf7f', '#9b6bff', '#3aa0ff', '#f97a3c', '#b5b82c', '#d46bff'];
  const colorOf = (id) => {
    const i = S.model.participants.findIndex((p) => p.id === id);
    return i < 0 ? '#8a93a6' : PCOLORS[i % PCOLORS.length];
  };
  const participantById = (id) => S.model.participants.find((p) => p.id === id);

  // ---------------------------------------------------------------------------
  // Elemanlar
  // ---------------------------------------------------------------------------
  hydrate();
  const el = {
    docName: $('#docName'), saveState: $('#saveState'),
    undo: $('#btnUndo'), redo: $('#btnRedo'),
    viewSeg: $('#viewSeg'), viewBuilder: $('#viewBuilder'), viewCode: $('#viewCode'),
    autonum: $('#optAutonumber'), autoAct: $('#optAutoAct'), title: $('#diagramTitle'),
    palP: $('#palParticipants'), palS: $('#palSteps'),
    participants: $('#participants'), flow: $('#flow'), bscroll: $('#builderScroll'),
    partCount: $('#partCount'), stepCount: $('#stepCount'),
    code: $('#code'), codeHl: $('#codeHl'), gutter: $('#gutter'), codeStatus: $('#codeStatus'),
    viewport: $('#viewport'), canvas: $('#canvas'), emptyState: $('#emptyState'), renderError: $('#renderError'),
    zoomVal: $('#zoomVal'), mmTheme: $('#mmTheme'), mirror: $('#optMirror'), colorize: $('#optColorize'),
    popover: $('#popover'), overlay: $('#linkOverlay'), linkPath: $('#linkPath'),
    modalRoot: $('#modalRoot'), modalTitle: $('#modalTitle'), modalBody: $('#modalBody'),
    drawer: $('#drawer'), scrim: $('#scrim'), docList: $('#docList'), fileInput: $('#fileInput'),
  };

  // ---------------------------------------------------------------------------
  // Tema
  // ---------------------------------------------------------------------------
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const appTheme = () => (S.settings.appTheme === 'system' ? (darkMQ.matches ? 'dark' : 'light') : S.settings.appTheme);
  function applyAppTheme() {
    const t = appTheme();
    document.documentElement.dataset.theme = t;
    const b = $('#btnTheme');
    b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
    b.title = T(t === 'dark' ? 'theme.toLight' : 'theme.toDark');
  }
  darkMQ.addEventListener('change', () => {
    if (S.settings.appTheme === 'system') { applyAppTheme(); configureMermaid(); scheduleRender(0); }
  });

  // ---------------------------------------------------------------------------
  // Mermaid yapılandırması
  // ---------------------------------------------------------------------------
  const FONT = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const STUDIO = {
    'studio-light': {
      background: '#ffffff', fontFamily: FONT, fontSize: '14px',
      primaryColor: '#eef0ff', primaryBorderColor: '#6c7cff', primaryTextColor: '#1b2030',
      secondaryColor: '#f4f5f8', tertiaryColor: '#f8f9fb', lineColor: '#4b5368', textColor: '#1b2030',
      actorBkg: '#eef0ff', actorBorder: '#6c7cff', actorTextColor: '#1b2030', actorLineColor: '#c4c9d6',
      signalColor: '#3b4255', signalTextColor: '#1b2030',
      labelBoxBkgColor: '#fff3dc', labelBoxBorderColor: '#f0a020', labelTextColor: '#7a4b00', loopTextColor: '#4b5368',
      noteBkgColor: '#fff8d6', noteBorderColor: '#e5c454', noteTextColor: '#4a3d00',
      activationBkgColor: '#e3e7ff', activationBorderColor: '#6c7cff', sequenceNumberColor: '#ffffff',
    },
    'studio-dark': {
      darkMode: true, background: '#12151c', fontFamily: FONT, fontSize: '14px',
      primaryColor: '#1f2647', primaryBorderColor: '#7c8cff', primaryTextColor: '#e7eaf1',
      secondaryColor: '#1b2030', tertiaryColor: '#171b24', lineColor: '#9aa3b5', textColor: '#e7eaf1',
      actorBkg: '#1c2242', actorBorder: '#7c8cff', actorTextColor: '#e7eaf1', actorLineColor: '#384157',
      signalColor: '#c4cad8', signalTextColor: '#e7eaf1',
      labelBoxBkgColor: '#3a2c10', labelBoxBorderColor: '#f0a020', labelTextColor: '#ffd58a', loopTextColor: '#c4cad8',
      noteBkgColor: '#2d2a17', noteBorderColor: '#a08c3c', noteTextColor: '#f2e8bb',
      activationBkgColor: '#283063', activationBorderColor: '#7c8cff', sequenceNumberColor: '#12151c',
    },
  };
  const PAPER_BG = { 'studio-light': '#ffffff', 'studio-dark': '#12151c', default: '#ffffff', neutral: '#ffffff', forest: '#ffffff', dark: '#333333' };
  const STUDIO_CSS = `
    rect.actor, .actor-man circle, rect.note, rect.labelBox { stroke-width: 1.4px; }
    rect.actor { rx: 8px; ry: 8px; }
    rect.note { rx: 6px; ry: 6px; }
    text.actor > tspan { font-weight: 600; }
    .messageText { font-weight: 500; }
    .labelText, .labelText > tspan { font-weight: 700; letter-spacing: .03em; }
    .loopText, .loopText > tspan { font-style: italic; }
  `;

  const mmThemeName = () => (S.settings.mmTheme === 'auto' ? (appTheme() === 'dark' ? 'studio-dark' : 'studio-light') : S.settings.mmTheme);

  function configureMermaid() {
    const t = mmThemeName();
    const cfg = {
      startOnLoad: false,
      securityLevel: 'strict',
      fontFamily: FONT,
      htmlLabels: false,
      sequence: {
        useMaxWidth: false, mirrorActors: !!S.settings.mirror, actorMargin: 64, boxMargin: 10, noteMargin: 12,
        messageMargin: 38, boxTextMargin: 6, diagramMarginX: 24, diagramMarginY: 16, wrap: false,
      },
    };
    if (STUDIO[t]) { cfg.theme = 'base'; cfg.themeVariables = STUDIO[t]; cfg.themeCSS = STUDIO_CSS; }
    else cfg.theme = t;
    mermaid.initialize(cfg);
    el.canvas.style.setProperty('--paper-bg', PAPER_BG[t] || '#ffffff');
  }

  // ---------------------------------------------------------------------------
  // Çekirdek: kod <-> model akışı
  // ---------------------------------------------------------------------------
  function applyCode(code, src) {
    S.code = code;
    if (src !== 'builder') {
      S.model = M.parse(code);
      renderBuilder();
    }
    if (src !== 'code' && el.code.value !== code) el.code.value = code;
    updateEditorDecor();
    syncMeta();
    scheduleRender();
    scheduleSave();
    if (src !== 'history' && src !== 'load') scheduleHistory();
  }

  /** Builder modeli değiştirdikten sonra çağrılır. */
  function commit(opts) {
    opts = opts || {};
    if (isAutoAct()) M.inferActivations(S.model);
    applyCode(M.serialize(S.model), 'builder');
    if (opts.rerender !== false) renderBuilder();
  }

  /** Belge için otomatik aktivasyon açık mı? (varsayılan: açık) */
  const isAutoAct = () => !!S.doc && S.doc.autoAct !== false;
  /** Otomatik moddaysa aktivasyonları yeniden hesaplar; kod değiştiyse uygular. */
  function refreshAutoAct(src) {
    if (!isAutoAct() || !M.inferActivations(S.model)) return false;
    applyCode(M.serialize(S.model), src || 'builder');
    renderBuilder();
    return true;
  }

  function syncMeta() {
    el.autonum.checked = !!S.model.autonumber;
    el.autoAct.checked = isAutoAct();
    if (document.activeElement !== el.title && el.title.value !== (S.model.title || '')) el.title.value = S.model.title || '';
  }

  // ---------------------------------------------------------------------------
  // Geçmiş (undo / redo)
  // ---------------------------------------------------------------------------
  const H = S.hist;
  function scheduleHistory() { clearTimeout(H.timer); H.timer = setTimeout(flushHistory, 450); }
  function flushHistory() {
    clearTimeout(H.timer); H.timer = null;
    if (H.stack[H.i] === S.code) return;
    H.stack = H.stack.slice(0, H.i + 1);
    H.stack.push(S.code);
    if (H.stack.length > 300) H.stack.shift();
    H.i = H.stack.length - 1;
    updateUndoUi();
  }
  function resetHistory() { H.stack = [S.code]; H.i = 0; updateUndoUi(); }
  function undo() { flushHistory(); if (H.i <= 0) return; H.i--; applyCode(H.stack[H.i], 'history'); updateUndoUi(); }
  function redo() { flushHistory(); if (H.i >= H.stack.length - 1) return; H.i++; applyCode(H.stack[H.i], 'history'); updateUndoUi(); }
  function updateUndoUi() { el.undo.disabled = H.i <= 0; el.redo.disabled = H.i >= H.stack.length - 1; }

  // ---------------------------------------------------------------------------
  // Belgeler
  // ---------------------------------------------------------------------------
  const newDocId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  function persistDocs() {
    if (!store.set(LS.docs, S.docs)) toast(T('storage.full'), 'err');
    store.set(LS.cur, S.doc && S.doc.id);
  }
  const doSave = debounce(() => {
    if (!S.doc) return;
    if (S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
    persistDocs();
    el.saveState.classList.remove('dirty');
    el.saveState.lastChild.textContent = T('tb.saved');
  }, 500);
  function scheduleSave() {
    el.saveState.classList.add('dirty');
    el.saveState.lastChild.textContent = T('tb.saving');
    doSave();
  }

  function createDoc(name, code, open) {
    // Kodda elle girilmiş aktivasyon işaretleri varsa onlara dokunma
    const d = { id: newDocId(), name: uniqueDocName(name), code, updated: Date.now(), autoAct: !M.hasManualActivation(M.parse(code)) };
    S.docs.unshift(d);
    persistDocs();
    if (open !== false) openDoc(d.id);
    return d;
  }
  function uniqueDocName(name) {
    name = (name || T('doc.untitled')).trim();
    let n = name, k = 2;
    while (S.docs.some((d) => d.name === n)) n = name + ' (' + k++ + ')';
    return n;
  }
  function openDoc(id) {
    if (S.doc && S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
    const d = S.docs.find((x) => x.id === id) || S.docs[0];
    S.doc = d;
    S.selected = null;
    S.collapsed.clear();
    el.docName.value = d.name;
    S.zoom.auto = true;
    if (d.autoAct === undefined) d.autoAct = !M.hasManualActivation(M.parse(d.code));
    applyCode(d.code, 'load');
    refreshAutoAct('load');
    resetHistory();
    persistDocs();
    renderDocList();
  }
  function deleteDoc(id) {
    const d = S.docs.find((x) => x.id === id);
    if (!d || !confirm(T('doc.confirmDelete', { name: d.name }))) return;
    S.docs = S.docs.filter((x) => x.id !== id);
    if (!S.docs.length) createDoc(T('doc.untitled'), tplL(window.SeqTemplates[0]).code, false);
    if (S.doc.id === id) { S.doc = null; openDoc(S.docs[0].id); }
    persistDocs();
    renderDocList();
  }
  function renderDocList() {
    el.docList.innerHTML = '';
    [...S.docs].sort((a, b) => b.updated - a.updated).forEach((d) => {
      const item = h('div', { class: 'doc-item' + (S.doc && d.id === S.doc.id ? ' active' : ''), onclick: () => { openDoc(d.id); closeDrawer(); } },
        h('span', { class: 'di-icon' }, ico('logo')),
        h('div', { class: 'di-text' }, h('div', { class: 'di-name' }, d.name), h('div', { class: 'di-meta' }, timeAgo(d.updated))),
        h('div', { class: 'di-actions' },
          h('button', { class: 'icon-btn sm', title: T('duplicate'), onclick: (e) => { e.stopPropagation(); createDoc(d.name + T('doc.copySuffix'), d.id === S.doc.id ? S.code : d.code, false); renderDocList(); } }, ico('copy')),
          h('button', { class: 'icon-btn sm', title: T('delete'), onclick: (e) => { e.stopPropagation(); deleteDoc(d.id); } }, ico('trash'))));
      el.docList.append(item);
    });
  }
  function openDrawer() { renderDocList(); el.drawer.classList.add('open'); el.scrim.classList.add('show'); }
  function closeDrawer() { el.drawer.classList.remove('open'); el.scrim.classList.remove('show'); }

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
      setCodeStatus(true);
      return;
    }
    const id = 'mmd' + seq;
    try {
      await mermaid.parse(code);
      const safe = M.previewSafe(S.model);
      const { svg } = await mermaid.render(id, safe || code);
      if (seq !== S.renderSeq) return;
      el.canvas.innerHTML = '<div class="paper">' + svg + '</div>';
      if (S.settings.colorize) colorizeSvg($('.paper svg', el.canvas));
      el.canvas.classList.remove('stale');
      el.renderError.hidden = true;
      S.lastOk = true;
      setCodeStatus(true);
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
      setCodeStatus(false, msg);
    }
  }

  // --- Katılımcı renkleri ---
  const hexToRgb = (hex) => {
    let x = hex.replace('#', '');
    if (x.length === 3) x = x.split('').map((c) => c + c).join('');
    const n = parseInt(x, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  /** a rengini b üzerine t oranında karıştırır (t=1 → a). */
  const mix = (a, b, t) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    return '#' + A.map((v, i) => Math.round(v * t + B[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
  };

  /**
   * Önizlemedeki katılımcı başlıklarını, lifeline'ları ve aktivasyon çubuklarını
   * builder'daki renklerle boyar. Mermaid'in SVG yapısı tipe göre değiştiği için
   * her şekil yatayda en yakın lifeline'ın katılımcısına atanır. Stiller satır içi
   * yazıldığından PNG/SVG dışa aktarmaya da yansır.
   */
  function colorizeSvg(svg) {
    if (!svg) return;
    const bg = PAPER_BG[mmThemeName()] || '#ffffff';
    const dark = hexToRgb(bg).reduce((a, v) => a + v, 0) < 384;
    const lifelines = $$('line[data-et="life-line"]', svg)
      .map((l) => {
        const r = l.getBoundingClientRect();
        return { el: l, id: l.getAttribute('data-id'), x: r.left + r.width / 2 };
      })
      .filter((l) => participantById(l.id));
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

    for (const l of lifelines) l.el.style.stroke = mix(colorOf(l.id), bg, dark ? 0.55 : 0.5);
    const ACTOR_G = 'g.actor, g.actor-man, g.actor-top, g.actor-bottom, g[data-et="participant"]';
    $$('rect, circle, ellipse, path, line, polygon, polyline', svg).forEach((el) => {
      const cls = el.getAttribute('class') || '';
      if (/\bactor-line\b/.test(cls) || el.getAttribute('data-et') === 'life-line') return;
      const isActivation = /\bactivation\d\b/.test(cls);
      const isActor = /(^|\s)actor(\s|$)/.test(cls) || !!el.closest(ACTOR_G);
      if (!isActivation && !isActor) return;
      const l = nearest(el);
      if (!l) return;
      paint(el, colorOf(l.id), isActivation ? (dark ? 0.45 : 0.3) : (dark ? 0.28 : 0.16));
    });
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
      if (e.button !== 0 || e.target.closest('.zoombar, .render-error')) return;
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

  /** Önizlemede bir mesaja/nota tıklanınca editörde ilgili satıra git. */
  function onPreviewClick(target) {
    const t = target.closest && target.closest('text.messageText, text.noteText');
    if (!t) return;
    const isNote = t.classList.contains('noteText');
    const all = $$(isNote ? 'text.noteText' : 'text.messageText', el.canvas);
    const idx = all.indexOf(t);
    if (idx < 0) return;
    const kind = isNote ? 'note' : 'message';
    if (currentView() === 'code') {
      const nodes = [];
      M.walk(M.parse(S.code).items, (it) => { if (it.kind === kind) nodes.push(it); });
      const n = nodes[idx];
      if (n && n.line != null) selectCodeLine(n.line);
      return;
    }
    const nodes = [];
    M.walk(S.model.items, (it) => { if (it.kind === kind) nodes.push(it); });
    const n = nodes[idx];
    if (!n) return;
    // Daraltılmış ataları aç
    let changed = false;
    M.walk(S.model.items, (it) => {
      if (it.kind === 'block' && S.collapsed.has(it.uid) && containsNode(it, n.uid)) { S.collapsed.delete(it.uid); changed = true; }
    });
    if (changed) renderBuilder();
    setSelected(n.uid);
    const row = el.flow.querySelector(`[data-uid="${n.uid}"]`);
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
      const inp = row.querySelector('.text-input');
      if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 250);
    }
  }
  function containsNode(block, nodeUid) {
    let found = false;
    for (const br of block.branches) M.walk(br.items, (it) => { if (it.uid === nodeUid) { found = true; return false; } });
    return found;
  }

  // ---------------------------------------------------------------------------
  // Kod editörü
  // ---------------------------------------------------------------------------
  const KW_RE = /^(\s*)(sequenceDiagram|participant|actor|box|end|loop|alt|else|opt|par_over|par|and|critical|option|break|rect|note|activate|deactivate|autonumber|title|create|destroy|accTitle|accDescr|links?|properties|details)\b/i;
  const LABEL_KW = new Set(['loop', 'alt', 'else', 'opt', 'par', 'par_over', 'and', 'critical', 'option', 'break', 'rect', 'title', 'box', 'acctitle', 'accdescr']);
  const ARROW_HL = /^(.*?)(<<-->>|<<->>|-->>|->>|--x|-x|--\)|-\)|-->|->|--\|[\\/]|-\|[\\/]|--\\\\|--\/\/|-\\\\|-\/\/)([+-]?)(.*)$/;
  const sp = (cls, s) => `<span class="hl-${cls}">${s}</span>`;

  function hlLine(line) {
    if (/^\s*%%/.test(line) || /^\s*---\s*$/.test(line)) return sp('comment', esc(line));
    let out = '';
    let rest = line;
    const m = line.match(KW_RE);
    if (m) {
      const kw = m[2].toLowerCase();
      out = esc(m[1]) + sp('kw', esc(m[2]));
      rest = line.slice(m[0].length);
      if (LABEL_KW.has(kw)) return out + sp('text', esc(rest));
      if (kw === 'note') {
        const nm = rest.match(/^(\s+)(right of|left of|over)([^:]*)(:?)(.*)$/i);
        if (nm) return out + esc(nm[1]) + sp('kw2', esc(nm[2])) + esc(nm[3]) + (nm[4] ? sp('arrow', ':') + sp('text', esc(nm[5])) : '');
      }
      if (kw === 'participant' || kw === 'actor') {
        let s = esc(rest).replace(/@\{[^}]*\}/, (x) => sp('attr', x));
        s = s.replace(/(\s)(as)(\s)/i, (x, a, b, c) => a + sp('kw2', b) + c);
        return out + s;
      }
      return out + esc(rest);
    }
    const ci = rest.indexOf(':');
    const head = ci >= 0 ? rest.slice(0, ci) : rest;
    const tail = ci >= 0 ? rest.slice(ci + 1) : null;
    const am = head.match(ARROW_HL);
    let s = am ? esc(am[1]) + sp('arrow', esc(am[2] + am[3])) + esc(am[4]) : esc(head);
    if (tail != null) s += sp('arrow', ':') + sp('text', esc(tail));
    return s;
  }

  let errLine = -1;
  function updateEditorDecor() {
    const v = el.code.value;
    const lines = v.split('\n');
    el.codeHl.innerHTML = lines.map(hlLine).join('\n') + '\n ';
    let g = '';
    for (let i = 0; i < lines.length; i++) g += `<div${i === errLine ? ' class="err"' : ''}>${i + 1}</div>`;
    el.gutter.innerHTML = g + '<div>&nbsp;</div>';
    syncEditorScroll();
  }
  function syncEditorScroll() {
    el.codeHl.scrollTop = el.code.scrollTop;
    el.codeHl.scrollLeft = el.code.scrollLeft;
    el.gutter.scrollTop = el.code.scrollTop;
  }
  function setCodeStatus(ok, msg) {
    const prev = errLine;
    errLine = -1;
    el.codeStatus.className = 'code-status ' + (ok ? 'ok' : 'err');
    el.codeStatus.innerHTML = '';
    if (ok) {
      let msgs = 0;
      M.walk(S.model.items, (it) => { if (it.kind === 'message') msgs++; });
      el.codeStatus.append(ico('check'), h('span', null, T('status.ok', { p: S.model.participants.length, m: msgs })));
    } else {
      const lm = String(msg).match(/line (\d+)/i);
      if (lm) errLine = parseInt(lm[1], 10) - 1;
      el.codeStatus.append(ico('critical'), h('span', { class: 'msg' }, String(msg).split('\n').slice(0, 4).join('\n')));
    }
    if (prev !== errLine) updateEditorDecor();
  }
  function selectCodeLine(line) {
    const lines = el.code.value.split('\n');
    let pos = 0;
    for (let i = 0; i < line && i < lines.length; i++) pos += lines[i].length + 1;
    const len = (lines[line] || '').length;
    const indent = (lines[line] || '').match(/^\s*/)[0].length;
    el.code.focus();
    el.code.setSelectionRange(pos + indent, pos + len);
    el.code.scrollTop = Math.max(0, line * 21 - el.code.clientHeight / 2);
    syncEditorScroll();
  }

  const codeToModel = debounce(() => applyCode(el.code.value, 'code'), 260);
  el.code.addEventListener('input', () => { updateEditorDecor(); codeToModel(); });
  el.code.addEventListener('scroll', syncEditorScroll);
  el.code.addEventListener('keydown', (e) => {
    const ta = el.code;
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en, value: v } = ta;
      if (s === en && !e.shiftKey) { insertText('    '); return; }
      // Çok satırlı girinti / girinti azaltma
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const block = v.slice(ls, en);
      const nb = e.shiftKey ? block.replace(/^ {1,4}/gm, '') : block.replace(/^/gm, '    ');
      ta.setRangeText(nb, ls, en, 'select');
      ta.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const v = ta.value, s = ta.selectionStart;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const cur = v.slice(ls, s);
      let ind = cur.match(/^\s*/)[0];
      if (/^\s*(sequenceDiagram|loop|alt|else|opt|par|par_over|and|critical|option|break|rect|box)\b/i.test(cur)) ind += '    ';
      insertText('\n' + ind);
    }
  });
  function insertText(t) {
    const ta = el.code;
    ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }

  // ---------------------------------------------------------------------------
  // Görünüm sekmeleri
  // ---------------------------------------------------------------------------
  const currentView = () => S.settings.view;
  function setView(v) {
    if (v !== 'builder' && v !== 'code') v = 'builder';
    // Koddan builder'a geçerken bekleyen değişiklikleri uygula
    if (v === 'builder' && el.code.value !== S.code) applyCode(el.code.value, 'code');
    if (v === 'builder') refreshAutoAct();
    S.settings.view = v;
    saveSettings();
    $$('button', el.viewSeg).forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    el.viewBuilder.classList.toggle('active', v === 'builder');
    el.viewCode.classList.toggle('active', v === 'code');
    $('#builderMeta').style.visibility = v === 'builder' ? 'visible' : 'hidden';
    if (v === 'code') { updateEditorDecor(); setTimeout(() => el.code.focus({ preventScroll: true }), 0); }
  }
  el.viewSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });

  // ---------------------------------------------------------------------------
  // Palet
  // ---------------------------------------------------------------------------
  const STEP_PALETTE = [
    { k: 'message', ic: 'message', c: 'var(--accent)' },
    { k: 'reply', ic: 'reply', c: 'var(--muted)' },
    { k: 'note', ic: 'note', c: 'var(--c-note)' },
    { k: 'loop', ic: 'loop', c: 'var(--c-loop)' },
    { k: 'alt', ic: 'alt', c: 'var(--c-alt)' },
    { k: 'opt', ic: 'opt', c: 'var(--c-opt)' },
    { k: 'par', ic: 'par', c: 'var(--c-par)' },
    { k: 'critical', ic: 'critical', c: 'var(--c-critical)' },
    { k: 'break', ic: 'break', c: 'var(--c-break)' },
    { k: 'rect', ic: 'rect', c: 'var(--c-rect)' },
    { k: 'activation', ic: 'activate', c: 'var(--c-activation)' },
    { k: 'raw', ic: 'raw', c: 'var(--c-raw)' },
  ];
  const TYPE_LABEL = Object.fromEntries(M.PARTICIPANT_TYPES.map((t) => [t.v, t.label]));

  function renderPalette() {
    el.palP.innerHTML = '';
    el.palS.innerHTML = '';
    M.PARTICIPANT_TYPES.forEach((t, i) => {
      const chip = h('div', { class: 'chip', draggable: 'true', title: T('type.' + t.v) + ' — ' + T('pal.clickOrDrag'), style: `--c:${PCOLORS[i % PCOLORS.length]}` }, ico('t-' + t.v), t.label);
      chip.addEventListener('click', () => addParticipant(t.v));
      chip.addEventListener('dragstart', (e) => startDrag(e, { kind: 'newPart', type: t.v }));
      chip.addEventListener('dragend', endDrag);
      el.palP.append(chip);
    });
    STEP_PALETTE.forEach((s) => {
      const chip = h('div', { class: 'chip', draggable: 'true', title: (M.BLOCK_TYPES[s.k] ? T('block.' + s.k) + ' — ' : '') + T('pal.clickOrDragFlow'), style: `--c:${s.c}` }, ico(s.ic), T('step.' + s.k));
      chip.addEventListener('click', () => addStep(s.k));
      chip.addEventListener('dragstart', (e) => startDrag(e, { kind: 'newStep', type: s.k }));
      chip.addEventListener('dragend', endDrag);
      el.palS.append(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // Katılımcılar
  // ---------------------------------------------------------------------------
  function uniqueId(base, exceptUid) {
    base = M.slugify(base);
    let id = base, k = 2;
    while (S.model.participants.some((p) => p.id === id && p.uid !== exceptUid)) id = base + k++;
    return id;
  }

  function addParticipant(type, index) {
    const label = T('newp.' + type);
    const n = S.model.participants.length + 1;
    const lbl = S.model.participants.some((p) => p.label === label) ? label + ' ' + n : label;
    const p = { uid: M.uid(), id: uniqueId(lbl), label: lbl, type, boxId: null, implicit: false, autoId: true };
    S.model.participants.forEach((q) => { q.implicit = false; });
    if (index == null || index > S.model.participants.length) S.model.participants.push(p);
    else S.model.participants.splice(index, 0, p);
    commit();
    const card = el.participants.querySelector(`[data-uid="${p.uid}"]`);
    if (card) openParticipantEditor(p, card, true);
    return p;
  }

  function renderParticipants() {
    const box = el.participants;
    box.innerHTML = '';
    const boxes = new Map(S.model.boxes.map((b) => [b.id, b]));
    S.model.participants.forEach((p, i) => {
      const c = PCOLORS[i % PCOLORS.length];
      const bx = p.boxId && boxes.get(p.boxId);
      const card = h('div', {
        class: 'pcard' + (S.selectedP === p.uid ? ' selected' : ''), draggable: 'true', 'data-uid': p.uid,
        style: `--c:${c};` + (bx ? `--box:${bx.color && bx.color !== 'transparent' ? bx.color : 'var(--border-strong)'}` : ''),
        title: TYPE_LABEL[p.type] + ' · ' + T('pcard.title'),
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
        startDrag(e, { kind: 'part', uid: p.uid });
        setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); endDrag(); });
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
    if (d.kind === 'newPart') { addParticipant(d.type, i); return; }
    if (d.kind === 'part') {
      const arr = S.model.participants;
      const from = arr.findIndex((p) => p.uid === d.uid);
      if (from < 0) return;
      // i, sürüklenen kart hariç listedeki indekstir
      const [p] = arr.splice(from, 1);
      arr.splice(i, 0, p);
      arr.forEach((q) => { q.implicit = false; });
      fixBoxContiguity(p);
      commit();
    }
  });
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
    commit();
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

    const labelIn = h('input', { class: 'input', value: p.label, placeholder: T('pe.labelPh') });
    const idIn = h('input', { class: 'input', value: p.id, spellcheck: 'false', style: 'font-family:var(--mono)' });
    const idHint = h('small', null, T('pe.idHint'));

    labelIn.addEventListener('input', () => {
      touch();
      p.label = labelIn.value.trim() || p.id;
      if (p.autoId) {
        const nid = uniqueId(labelIn.value || 'P', p.uid);
        renameRefs(p.id, nid);
        p.id = nid;
        idIn.value = nid;
      }
      commit();
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
      commit();
    });

    const typeGrid = h('div', { class: 'type-grid' });
    M.PARTICIPANT_TYPES.forEach((t) => {
      const b = h('button', { class: 'type-opt' + (p.type === t.v ? ' active' : ''), title: T('type.' + t.v) }, ico('t-' + t.v), t.label);
      b.addEventListener('click', () => {
        touch(); p.type = t.v;
        $$('.type-opt', typeGrid).forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        commit();
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
      bl.addEventListener('input', () => { b.label = bl.value; fillBoxSelLabels(); commit(); });
      const bc = h('select', { class: 'select' });
      const known = BOX_COLORS.some((c) => c.v === (b.color || ''));
      BOX_COLORS.forEach((c) => bc.append(h('option', { value: c.v }, T('color.' + c.name))));
      if (!known) bc.append(h('option', { value: b.color }, b.color));
      bc.value = b.color || '';
      bc.addEventListener('change', () => { b.color = bc.value; commit(); });
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
      commit();
      fillBoxSel(); fillBoxRow();
    });
    fillBoxSel(); fillBoxRow();

    pop.append(
      h('div', { class: 'pop-title' }, T('pe.title'), h('button', { class: 'icon-btn sm', onclick: closePopover }, ico('x'))),
      h('div', { class: 'field' }, h('label', null, T('pe.label')), labelIn),
      h('div', { class: 'field' }, h('label', null, T('pe.id')), idIn, idHint),
      h('div', { class: 'field' }, h('label', null, T('pe.type')), typeGrid),
      h('div', { class: 'field' }, h('label', null, T('pe.box')), boxSel, boxRow),
      h('div', { class: 'pop-actions' },
        h('button', { class: 'btn danger sm', onclick: () => { if (deleteParticipant(p)) closePopover(); } }, ico('trash'), T('delete')),
        h('div', { class: 'row', style: 'flex:none' },
          h('button', { class: 'btn sm', title: T('pe.addMsgTitle'), onclick: () => { closePopover(); addMessageFrom(p.id); } }, ico('message'), T('pe.addMsg')),
          h('button', { class: 'btn primary sm', onclick: closePopover }, T('pe.done')))),
    );
    showPopover(anchor);
    if (focusLabel) setTimeout(() => { labelIn.focus(); labelIn.select(); }, 30);
  }

  let popAnchor = null;
  function showPopover(anchor) {
    const pop = el.popover;
    popAnchor = anchor;
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
    flushHistory();
  }
  document.addEventListener('pointerdown', (e) => {
    if (!el.popover.hidden && !el.popover.contains(e.target) && !(e.target.closest && e.target.closest('.pcard'))) closePopover();
  });

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
      insertNode(node);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------------------------------------------------------------------------
  // Akış adımları
  // ---------------------------------------------------------------------------
  function blockDefaults(kind) {
    switch (kind) {
      case 'loop': return [T('bd.loop')];
      case 'alt': return [T('bd.alt1'), T('bd.alt2')];
      case 'opt': return [T('bd.opt')];
      case 'par': return [T('bd.par1'), T('bd.par2')];
      case 'critical': return [T('bd.crit1'), T('bd.crit2')];
      case 'break': return [T('bd.break')];
      case 'rect': return ['rgba(108, 124, 255, 0.12)'];
      default: return [''];
    }
  }
  const branchPh = (type) => (['loop', 'alt', 'opt', 'par', 'par_over', 'critical', 'break', 'rect'].includes(type) ? T('ph.' + (type === 'par_over' ? 'par' : type)) : T('ph.label'));
  const BRANCH_LABEL = { else: 'Else', and: 'And', option: 'Option' };
  const RECT_SWATCHES = ['rgba(108, 124, 255, 0.12)', 'rgba(47, 191, 127, 0.14)', 'rgba(240, 160, 32, 0.16)', 'rgba(236, 90, 143, 0.14)', 'rgba(138, 147, 166, 0.16)'];
  const actLabel = (act) => T(act === '+' ? 'act.plus' : act === '-' ? 'act.minus' : 'act.none');

  function selectedMessage() {
    const f = S.selected && M.findNode(S.model, S.selected);
    return f && f.node && f.node.kind === 'message' ? f.node : null;
  }

  function newStep(kind) {
    const P = S.model.participants;
    const sel = selectedMessage();
    const a = P[0] && P[0].id, b = (P[1] || P[0]) && (P[1] || P[0]).id;
    const nextAfter = (id) => { const i = P.findIndex((p) => p.id === id); return (P[i + 1] || P[i - 1] || P[i]).id; };
    switch (kind) {
      case 'message': {
        if (!P.length) return null;
        if (sel) return { uid: M.uid(), kind: 'message', from: sel.to, to: sel.to === sel.from ? nextAfter(sel.to) : nextAfter(sel.to), arrow: '->>', act: '', text: '' };
        return { uid: M.uid(), kind: 'message', from: a, to: b, arrow: '->>', act: '', text: '' };
      }
      case 'reply': {
        if (!P.length) return null;
        if (sel) return { uid: M.uid(), kind: 'message', from: sel.to, to: sel.from, arrow: '-->>', act: '', text: '' };
        return { uid: M.uid(), kind: 'message', from: b, to: a, arrow: '-->>', act: '', text: '' };
      }
      case 'note':
        if (!P.length) return null;
        return { uid: M.uid(), kind: 'note', position: 'right of', targets: [sel ? sel.to : a], text: '' };
      case 'activation':
        if (!P.length) return null;
        return { uid: M.uid(), kind: 'activation', action: 'activate', participant: sel ? sel.to : a };
      case 'raw':
        return { uid: M.uid(), kind: 'raw', text: T('raw.default') };
      default: {
        const labels = blockDefaults(kind);
        return { uid: M.uid(), kind: 'block', type: kind, branches: labels.map((l) => ({ uid: M.uid(), label: l, items: [] })) };
      }
    }
  }

  function insertionPoint() {
    const f = S.selected && M.findNode(S.model, S.selected);
    if (f) {
      if (f.branch) return { list: f.branch.items, index: f.branch.items.length };
      return { list: f.list, index: f.index + 1 };
    }
    return { list: S.model.items, index: S.model.items.length };
  }

  function addStep(kind, list, index) {
    const node = newStep(kind);
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
    commit();
    flushHistory();
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
    commit();
    flushHistory();
  }
  function duplicateNode(nodeUid) {
    const f = M.findNode(S.model, nodeUid);
    if (!f || !f.node) return;
    const c = M.cloneWithNewUids(f.node);
    f.list.splice(f.index + 1, 0, c);
    S.selected = c.uid;
    commit();
    flushHistory();
    focusStep(c.uid);
  }
  function moveNodeBy(nodeUid, delta) {
    const f = M.findNode(S.model, nodeUid);
    if (!f || !f.node) return;
    const j = f.index + delta;
    if (j < 0 || j >= f.list.length) return;
    f.list.splice(f.index, 1);
    f.list.splice(j, 0, f.node);
    commit();
    focusRow(nodeUid);
  }
  function focusRow(nodeUid) {
    requestAnimationFrame(() => {
      const row = el.flow.querySelector(`[data-uid="${nodeUid}"]`);
      if (row) row.scrollIntoView({ block: 'nearest' });
    });
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

  function renderBuilder() {
    const st = el.bscroll.scrollTop;
    renderParticipants();
    renderFlow();
    el.bscroll.scrollTop = st;
  }

  function renderFlow() {
    listReg.clear();
    const counter = { n: 0 };
    el.flow.innerHTML = '';
    el.flow.append(renderList(S.model.items, 'root', counter));
    let steps = 0;
    M.walk(S.model.items, () => { steps++; });
    el.stepCount.textContent = steps;
    if (S.selected) setSelected(S.selected);
  }

  function renderList(items, listId, counter) {
    listReg.set(listId, items);
    const list = h('div', { class: 'step-list' + (listId === 'root' ? ' root' : ''), 'data-list': listId });
    if (!items.length) {
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
  function textInput(value, placeholder, onInput, cls) {
    const inp = h('input', { class: 'text-input' + (cls ? ' ' + cls : ''), value: value || '', placeholder, spellcheck: 'false' });
    inp.addEventListener('input', () => { onInput(inp.value); commit({ rerender: false }); });
    inp.addEventListener('blur', flushHistory);
    return inp;
  }
  function pSelect(value, onChange, allowEmpty) {
    const sel = h('select', { class: 'pselect', title: T('participant') });
    if (allowEmpty) sel.append(h('option', { value: '' }, '—'));
    const ids = S.model.participants.map((p) => p.id);
    S.model.participants.forEach((p) => sel.append(h('option', { value: p.id }, p.label || p.id)));
    if (value && !ids.includes(value)) sel.append(h('option', { value }, value));
    sel.value = value || '';
    sel.style.setProperty('--pc', value ? colorOf(value) : 'transparent');
    sel.addEventListener('change', () => { onChange(sel.value); commit(); flushHistory(); });
    return sel;
  }

  function renderStep(it, counter) {
    switch (it.kind) {
      case 'message': return renderMessage(it, counter);
      case 'note': return renderNote(it);
      case 'activation': return renderActivation(it);
      case 'block': return renderBlock(it, counter);
      default: return renderRaw(it);
    }
  }

  function renderMessage(it, counter) {
    counter.n++;
    const row = stepShell(it, 'step-message' + (it.arrow.startsWith('--') || it.arrow.startsWith('<<--') ? ' reply' : ''));
    const aSel = h('select', { class: 'aselect', title: T('arrow.title') });
    M.ARROWS.forEach((a) => aSel.append(h('option', { value: a.v }, a.glyph + '  ' + T('arrow.' + a.v))));
    if (!M.ARROWS.some((a) => a.v === it.arrow)) aSel.append(h('option', { value: it.arrow }, it.arrow));
    aSel.value = it.arrow;
    // Seçili değerde sadece glifi göster
    const shortLabel = () => { $$('option', aSel).forEach((o) => { const a = M.ARROWS.find((x) => x.v === o.value); o.textContent = a ? (o.selected ? a.glyph : a.glyph + '  ' + T('arrow.' + a.v)) : o.value; }); };
    aSel.addEventListener('focus', () => $$('option', aSel).forEach((o) => { const a = M.ARROWS.find((x) => x.v === o.value); if (a) o.textContent = a.glyph + '  ' + T('arrow.' + a.v); }));
    aSel.addEventListener('blur', shortLabel);
    aSel.addEventListener('change', () => { it.arrow = aSel.value; commit(); flushHistory(); });
    shortLabel();

    let actBtn = null;
    if (isAutoAct()) {
      // Otomatik mod: hesaplanan başlangıç / bitişi salt okunur rozet olarak göster
      if (it.act) {
        const who = participantById(it.act === '+' ? it.to : it.from);
        const name = who ? who.label || who.id : (it.act === '+' ? it.to : it.from);
        actBtn = h('span', { class: 'act-badge ' + (it.act === '+' ? 'start' : 'end'), title: T(it.act === '+' ? 'act.autoStart' : 'act.autoEnd', { name }) },
          ico('activate'), h('span', { class: 'act-name' }, (it.act === '+' ? '▶ ' : '■ ') + name));
      }
    } else {
      actBtn = h('button', { class: 'act-btn' + (it.act === '+' ? ' on' : it.act === '-' ? ' off' : ''), title: actLabel(it.act) + ' — ' + T('act.click') },
        ico('activate'), it.act === '+' ? '+' : it.act === '-' ? '−' : '');
      actBtn.addEventListener('click', () => { it.act = it.act === '' ? '+' : it.act === '+' ? '-' : ''; commit(); flushHistory(); });
    }

    const txt = textInput(it.text, T('ph.message'), (v) => { it.text = v; });
    txt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        S.selected = it.uid;
        const reply = e.shiftKey
          ? { uid: M.uid(), kind: 'message', from: it.to, to: it.from, arrow: it.arrow.startsWith('--') ? '->>' : '-->>', act: '', text: '' }
          : { uid: M.uid(), kind: 'message', from: it.from, to: it.to, arrow: it.arrow, act: '', text: '' };
        insertNode(reply);
      }
    });
    add(row, 
      handleEl(),
      S.model.autonumber ? h('span', { class: 'num' }, counter.n) : null,
      h('div', { class: 'route' },
        pSelect(it.from, (v) => { it.from = v; }),
        aSel,
        pSelect(it.to, (v) => { it.to = v; })),
      txt,
      actBtn,
      actionsEl(it, h('button', { class: 'icon-btn', title: T('swap'), onclick: () => { [it.from, it.to] = [it.to, it.from]; commit(); flushHistory(); } }, ico('swap'))),
    );
    return row;
  }

  function renderNote(it) {
    const row = stepShell(it, 'step-note');
    const pos = h('select', { class: 'mini-select', title: T('note.pos') },
      h('option', { value: 'right of' }, T('note.right')), h('option', { value: 'left of' }, T('note.left')), h('option', { value: 'over' }, T('note.over')));
    pos.value = it.position;
    pos.addEventListener('change', () => { it.position = pos.value; if (pos.value !== 'over') it.targets = it.targets.slice(0, 1); commit(); flushHistory(); });
    add(row, 
      handleEl(),
      h('span', { class: 'kind-badge' }, ico('note'), T('badge.note')),
      pos,
      pSelect(it.targets[0], (v) => { it.targets[0] = v; }),
      it.position === 'over' ? pSelect(it.targets[1] || '', (v) => { it.targets = v ? [it.targets[0], v] : [it.targets[0]]; }, true) : null,
      textInput(it.text, T('ph.note'), (v) => { it.text = v; }),
      actionsEl(it),
    );
    return row;
  }

  function renderActivation(it) {
    const row = stepShell(it, 'step-activation');
    const act = h('select', { class: 'mini-select' }, h('option', { value: 'activate' }, T('activation.on')), h('option', { value: 'deactivate' }, T('activation.off')));
    act.value = it.action;
    act.addEventListener('change', () => { it.action = act.value; commit(); flushHistory(); });
    add(row, handleEl(), h('span', { class: 'kind-badge' }, ico('activate'), T('badge.activation')), act, pSelect(it.participant, (v) => { it.participant = v; }), h('span', { style: 'flex:1' }), actionsEl(it));
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
    const node = h('div', { class: `step block block-${it.type}` + (S.selected === it.uid ? ' selected' : '') + (collapsed ? ' collapsed' : ''), 'data-uid': it.uid });
    const b0 = it.branches[0];

    let labelEl;
    if (it.type === 'rect') {
      labelEl = h('div', { class: 'row', style: 'flex:1 1 160px; gap:6px' },
        h('div', { class: 'swatches' }, RECT_SWATCHES.map((c) => h('button', { class: 'swatch', style: `background:${c}`, title: c, onclick: () => { b0.label = c; commit(); flushHistory(); } }))),
        textInput(b0.label, branchPh('rect'), (v) => { b0.label = v; }, 'mono'));
    } else {
      labelEl = textInput(b0.label, branchPh(it.type), (v) => { b0.label = v; });
    }

    let inner = 0;
    M.walk(it.branches.flatMap((b) => b.items), () => { inner++; });
    const head = h('div', { class: 'block-head' },
      handleEl(),
      h('span', { class: 'kind-badge' }, ico(it.type === 'par_over' ? 'par' : it.type), def.label),
      labelEl,
      collapsed ? h('span', { class: 'collapsed-info' }, T('block.steps', { n: inner })) : null,
      branchKw ? h('button', { class: 'add-branch', title: T('block.addBranch', { kw: branchKw }), onclick: () => {
        const br = { uid: M.uid(), label: branchKw === 'else' ? T('bd.else') : '', items: [] };
        it.branches.push(br);
        S.collapsed.delete(it.uid);
        S.selected = br.uid;
        commit(); flushHistory();
      } }, ico('plus'), BRANCH_LABEL[branchKw]) : null,
      h('div', { class: 'step-actions' },
        h('button', { class: 'icon-btn collapse-btn', title: T(collapsed ? 'expand' : 'collapse'), onclick: () => { collapsed ? S.collapsed.delete(it.uid) : S.collapsed.add(it.uid); renderFlow(); } }, ico('collapse')),
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
              commit(); flushHistory();
            } }, ico('x')))));
      }
      const brEl = h('div', { class: 'branch', 'data-branch': br.uid });
      brEl.append(renderList(br.items, br.uid, counter));
      node.append(brEl);
    });
    return node;
  }

  function unwrapBlock(nodeUid) {
    const f = M.findNode(S.model, nodeUid);
    if (!f || !f.node) return;
    const items = f.node.branches.flatMap((b) => b.items);
    f.list.splice(f.index, 1, ...items);
    S.selected = items[0] ? items[0].uid : null;
    commit();
    flushHistory();
  }

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
    clearPMarker();
    $$('.step.dragging').forEach((x) => { x.classList.remove('dragging'); x.draggable = false; });
  }

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
      commit();
      flushHistory();
    }
  });

  // Sayfa dışına dosya sürükleyip bırakma (içe aktarma)
  let fileDragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { fileDragDepth++; document.body.classList.add('file-drop'); } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --fileDragDepth <= 0) { fileDragDepth = 0; document.body.classList.remove('file-drop'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    fileDragDepth = 0;
    document.body.classList.remove('file-drop');
    const f = e.dataTransfer.files[0];
    if (f) importFile(f);
  });

  // ---------------------------------------------------------------------------
  // İçe aktarma / paylaşım
  // ---------------------------------------------------------------------------
  function importFile(file) {
    const r = new FileReader();
    r.onload = () => {
      let text = String(r.result || '');
      const fence = text.match(/```mermaid\s*\n([\s\S]*?)```/);
      if (fence) text = fence[1];
      if (!/sequenceDiagram/.test(text)) toast(T('import.noSeq'), 'err');
      createDoc(file.name.replace(/\.(mmd|mermaid|txt|md)$/i, ''), text.trim() + '\n');
      toast(T('import.done', { name: file.name }));
    };
    r.readAsText(file);
  }
  el.fileInput.addEventListener('change', () => { const f = el.fileInput.files[0]; if (f) importFile(f); el.fileInput.value = ''; });

  const b64url = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64url = (s) => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };

  async function encodeShare(code) {
    const bytes = new TextEncoder().encode(code);
    if ('CompressionStream' in window) {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return 'z' + b64url(new Uint8Array(await new Response(stream).arrayBuffer()));
    }
    return 'b' + b64url(bytes);
  }
  async function decodeShare(s) {
    const kind = s[0], bytes = fromB64url(s.slice(1));
    if (kind === 'z') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new TextDecoder().decode(await new Response(stream).arrayBuffer());
    }
    return new TextDecoder().decode(bytes);
  }
  async function copyShareLink() {
    const enc = await encodeShare(S.code);
    const url = location.href.split('#')[0] + '#s=' + enc + '&n=' + encodeURIComponent(S.doc.name);
    try { await navigator.clipboard.writeText(url); toast(T('share.copied')); }
    catch (e) { prompt(T('share.prompt'), url); }
  }
  async function loadFromHash() {
    const m = location.hash.match(/#s=([^&]+)(?:&n=([^&]*))?/);
    if (!m) return false;
    try {
      const code = await decodeShare(m[1]);
      createDoc(m[2] ? decodeURIComponent(m[2]) : T('share.docName'), code);
      toast(T('share.opened'));
    } catch (e) { toast(T('share.failed'), 'err'); }
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  function openModal(title, body, wide) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = '';
    el.modalBody.append(body);
    $('.modal', el.modalRoot).classList.toggle('wide', !!wide);
    el.modalRoot.hidden = false;
  }
  function closeModal() { el.modalRoot.hidden = true; el.modalBody.innerHTML = ''; }
  el.modalRoot.addEventListener('pointerdown', (e) => { if (e.target === el.modalRoot) closeModal(); });
  $('[data-close]', el.modalRoot).addEventListener('click', closeModal);

  // --- Dışa aktarma ---
  const FORMATS = [
    { v: 'png', ic: 'image' },
    { v: 'svg', ic: 'vector' },
    { v: 'mmd', ic: 'code' },
    { v: 'txt', ic: 'file' },
  ];
  const safeName = () => (S.doc && S.doc.name ? S.doc.name : 'diagram').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'diagram';

  function buildExportSvg(bg) {
    const src = $('.paper svg', el.canvas);
    if (!src) return null;
    const svg = src.cloneNode(true);
    const vb = src.viewBox && src.viewBox.baseVal && src.viewBox.baseVal.width ? src.viewBox.baseVal : { x: 0, y: 0, width: src.getBBox().width, height: src.getBBox().height };
    const pad = 16;
    const x = vb.x - pad, y = vb.y - pad, w = Math.ceil(vb.width + pad * 2), ht = Math.ceil(vb.height + pad * 2);
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${ht}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', ht);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svg.style.maxWidth = '';
    svg.style.backgroundColor = '';
    if (bg && bg !== 'transparent') {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x); rect.setAttribute('y', y); rect.setAttribute('width', w); rect.setAttribute('height', ht);
      rect.setAttribute('fill', bg);
      svg.insertBefore(rect, svg.firstChild);
    }
    return { markup: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg), w, h: ht };
  }
  function exportBg() {
    const b = S.settings.exp.bg;
    if (b === 'transparent') return 'transparent';
    if (b === 'white') return '#ffffff';
    return PAPER_BG[mmThemeName()] || '#ffffff';
  }
  function effectiveScale(w, ht) {
    let s = S.settings.exp.scale;
    while (s > 1 && (Math.max(w, ht) * s > 16000 || w * ht * s * s > 120e6)) s -= 0.5;
    return s;
  }
  async function svgToPngBlob(markup, w, ht, scale) {
    const img = new Image();
    img.decoding = 'async';
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(T('exp.svgLoad'))); img.src = url; });
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(ht * scale);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(T('exp.pngFail')))), 'image/png'));
    } finally { URL.revokeObjectURL(url); }
  }

  function openExport() {
    if (el.code.value !== S.code) applyCode(el.code.value, 'code');
    refreshAutoAct();
    flushHistory();
    const ex = S.settings.exp;
    const body = h('div');
    const draw = () => {
      body.innerHTML = '';
      const isImg = ex.format === 'png' || ex.format === 'svg';
      const grid = h('div', { class: 'fmt-grid' });
      FORMATS.forEach((f) => grid.append(h('button', { class: 'fmt' + (ex.format === f.v ? ' active' : ''), onclick: () => { ex.format = f.v; saveSettings(); draw(); } }, ico(f.ic), h('b', null, T('fmt.' + f.v)), h('span', null, T('fmt.' + f.v + '.desc')))));
      body.append(grid);

      const nameIn = h('input', { class: 'input', value: safeName(), spellcheck: 'false' });
      const ext = { png: '.png', svg: '.svg', mmd: '.mmd', txt: '.txt' }[ex.format];

      if (isImg) {
        if (!S.lastOk) body.append(h('div', { class: 'render-error', style: 'position:static;margin-bottom:12px' }, ico('critical'), T('exp.hasError')));
        const built = buildExportSvg(exportBg());
        const prev = h('div', { class: 'export-preview' });
        const dim = h('span', { class: 'dim-info' });
        if (built) {
          const img = h('img', { alt: T('exp.preview'), src: URL.createObjectURL(new Blob([built.markup], { type: 'image/svg+xml' })) });
          prev.append(img);
          const sc = effectiveScale(built.w, built.h);
          dim.textContent = ex.format === 'png' ? `${Math.round(built.w * sc)} × ${Math.round(built.h * sc)} px` : `${built.w} × ${built.h} (${T('exp.vector')})`;
        } else prev.append(h('span', { class: 'dim-info' }, T('exp.nothing')));
        body.append(prev);

        const seg = (opts, val, on) => h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: v === val ? 'active' : '', onclick: () => { on(v); saveSettings(); draw(); } }, l)));
        if (ex.format === 'png') body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.scale')), seg([[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']], ex.scale, (v) => { ex.scale = v; })));
        body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.bg')), seg([['theme', T('exp.bgTheme')], ['white', T('exp.bgWhite')], ['transparent', T('exp.bgTransparent')]], ex.bg, (v) => { ex.bg = v; })));
        body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.size')), dim));
      } else {
        body.append(h('pre', { class: 'export-code', style: 'margin:0 0 12px;max-height:260px;overflow:auto;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--code-bg);font:12px/1.55 var(--mono)' }, S.code));
      }
      body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.filename')), h('div', { class: 'row', style: 'max-width:340px;gap:6px' }, nameIn, h('span', { class: 'dim-info', style: 'flex:none' }, ext))));

      const doDownload = async () => {
        const fname = (nameIn.value.trim() || 'diagram') + ext;
        try {
          if (ex.format === 'mmd' || ex.format === 'txt') {
            downloadBlob(new Blob([S.code], { type: 'text/plain;charset=utf-8' }), fname);
          } else {
            const built = buildExportSvg(exportBg());
            if (!built) return toast(T('exp.nothing'), 'err');
            if (ex.format === 'svg') downloadBlob(new Blob([built.markup], { type: 'image/svg+xml;charset=utf-8' }), fname);
            else downloadBlob(await svgToPngBlob(built.markup, built.w, built.h, effectiveScale(built.w, built.h)), fname);
          }
          toast(T('exp.downloaded', { name: fname }));
          closeModal();
        } catch (err) { toast(T('exp.failed', { msg: err.message }), 'err'); }
      };
      const doCopy = async () => {
        try {
          if (ex.format === 'png') {
            const built = buildExportSvg(exportBg());
            if (!built) return;
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': svgToPngBlob(built.markup, built.w, built.h, effectiveScale(built.w, built.h)) })]);
            toast(T('exp.pngCopied'));
          } else if (ex.format === 'svg') {
            const built = buildExportSvg(exportBg());
            if (!built) return;
            await navigator.clipboard.writeText(built.markup);
            toast(T('exp.svgCopied'));
          } else {
            await navigator.clipboard.writeText(S.code);
            toast(T('exp.codeCopied'));
          }
        } catch (err) { toast(T('exp.copyFailed', { msg: err.message }), 'err'); }
      };
      body.append(h('div', { class: 'export-actions' },
        h('div', { class: 'left' },
          h('button', { class: 'btn', onclick: doCopy }, ico('copy'), T('exp.copy')),
          h('button', { class: 'btn ghost', onclick: copyShareLink, title: T('exp.shareTitle') }, ico('share'), T('exp.share'))),
        h('div', { class: 'right' }, h('button', { class: 'btn primary', onclick: doDownload }, ico('download'), T('exp.download')))));
    };
    draw();
    openModal(T('exp.title'), body);
  }

  // --- Şablonlar ---
  function openTemplates() {
    const grid = h('div', { class: 'tpl-grid' });
    window.SeqTemplates.forEach((tpl) => {
      const t = tplL(tpl);
      grid.append(h('button', { class: 'tpl', onclick: () => { createDoc(tpl.id === 'blank' ? T('doc.untitled') : t.name, t.code); closeModal(); toast(T('tpl.opened', { name: t.name })); } },
        h('b', null, t.name), h('span', null, t.desc), h('pre', null, t.code.split('\n').slice(0, 9).join('\n'))));
    });
    openModal(T('tpl.title'), grid, true);
  }

  // --- Yardım ---
  function openHelp() {
    const mod = isMac ? '⌘' : 'Ctrl';
    const kb = (k) => k.split('+').map((x) => `<kbd>${x}</kbd>`).join(' ');
    const rows = (arr) => '<table>' + arr.map(([a, b]) => `<tr><td>${a}</td><td>${esc(b)}</td></tr>`).join('') + '</table>';
    const c = (code) => `<code>${esc(code)}</code>`;
    const body = h('div', { html: `
      <div class="help-grid">
        <div>
          <h4>${T('help.builder')}</h4>
          ${rows([
            [T('help.addP'), T('help.addPd')],
            [T('help.drawM'), T('help.drawMd')],
            [T('help.addS'), T('help.addSd')],
            [T('help.addB'), T('help.addBd')],
            [T('help.move'), T('help.moved')],
            [T('help.act'), T('help.actd')],
            [T('help.goto'), T('help.gotod')],
          ])}
          <h4 style="margin-top:18px">${T('help.shortcuts')}</h4>
          ${rows([
            [kb(mod + '+Z') + ' / ' + kb(mod + '+Shift+Z'), T('help.k.undo')],
            [kb('Enter'), T('help.k.enter')],
            [kb('Shift+Enter'), T('help.k.shiftEnter')],
            [kb(mod + '+D'), T('help.k.dup')],
            [kb('Alt+↑') + ' ' + kb('Alt+↓'), T('help.k.move')],
            [kb('Del'), T('help.k.del')],
            [kb(mod + '+E'), T('help.k.export')],
            [kb(mod + '+1') + ' / ' + kb(mod + '+2'), T('help.k.views')],
            [kb(mod + '+B'), T('help.k.collapse')],
            [kb('F'), T('help.k.fullscreen')],
            [kb(mod + '+' + T('help.scroll')), T('help.k.zoom')],
          ])}
        </div>
        <div>
          <h4>${T('help.syntax')}</h4>
          ${rows([
            [c('participant A as Name'), T('help.s.participant')],
            [c('actor U'), T('help.s.actor')],
            [c('participant D@{ "type": "database" }'), T('help.s.typed')],
            [c('A->>B: text'), T('help.s.sync')],
            [c('B-->>A: text'), T('help.s.reply')],
            [c('A-)B: event'), T('help.s.async')],
            [c('A-xB: error'), T('help.s.cross')],
            [c('A->>+B') + ' · ' + c('B-->>-A'), T('help.s.act')],
            [c('loop') + ' … ' + c('end'), T('help.s.loop')],
            [c('alt') + ' … ' + c('else') + ' … ' + c('end'), T('help.s.alt')],
            [c('opt') + ' · ' + c('break'), T('help.s.opt')],
            [c('par') + ' … ' + c('and') + ' … ' + c('end'), T('help.s.par')],
            [c('critical') + ' … ' + c('option') + ' … ' + c('end'), T('help.s.critical')],
            [c('rect rgba(…)') + ' … ' + c('end'), T('help.s.rect')],
            [c('Note over A,B: text'), T('help.s.note')],
            [c('box Aqua Group') + ' … ' + c('end'), T('help.s.box')],
            [c('autonumber'), T('help.s.autonumber')],
          ])}
        </div>
      </div>
      <ul class="help-tips">
        <li>${esc(T('help.tip1'))}</li>
        <li>${esc(T('help.tip2'))}</li>
        <li>${esc(T('help.tip3'))}</li>
      </ul>` });
    openModal(T('help.title'), body, true);
  }

  // ---------------------------------------------------------------------------
  // Panel boyutlandırma
  // ---------------------------------------------------------------------------
  (function setupResizer() {
    const rz = $('#resizer');
    const pane = $('#paneEditor');
    if (S.settings.editorW) pane.style.width = S.settings.editorW + 'px';
    rz.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      rz.setPointerCapture(e.pointerId);
      rz.classList.add('dragging');
      const x0 = e.clientX, w0 = pane.offsetWidth;
      const move = (ev) => {
        const w = clamp(w0 + ev.clientX - x0, 380, window.innerWidth - 360);
        pane.style.width = w + 'px';
      };
      const up = () => {
        rz.removeEventListener('pointermove', move);
        rz.classList.remove('dragging');
        S.settings.editorW = pane.offsetWidth;
        saveSettings();
        if (S.zoom.auto) fitView();
      };
      rz.addEventListener('pointermove', move);
      rz.addEventListener('pointerup', up, { once: true });
    });
    rz.addEventListener('dblclick', () => { pane.style.width = ''; S.settings.editorW = null; saveSettings(); });
  })();
  window.addEventListener('resize', debounce(() => { if (S.zoom.auto) fitView(); }, 150));

  // ---------------------------------------------------------------------------
  // Üst bar ve kontroller
  // ---------------------------------------------------------------------------
  el.undo.addEventListener('click', undo);
  el.redo.addEventListener('click', redo);
  $('#btnTemplates').addEventListener('click', openTemplates);
  $('#btnImport').addEventListener('click', () => el.fileInput.click());
  $('#btnHelp').addEventListener('click', openHelp);
  $('#btnExport').addEventListener('click', openExport);
  $('#btnDocs').addEventListener('click', openDrawer);
  $('#btnNewDoc').addEventListener('click', () => { createDoc(T('doc.untitled'), tplL(window.SeqTemplates[0]).code); closeDrawer(); });
  $('#btnLang').addEventListener('click', () => {
    S.settings.lang = I18N.getLang() === 'tr' ? 'en' : 'tr';
    saveSettings();
    applyLang();
  });
  $('[data-close]', el.drawer).addEventListener('click', closeDrawer);
  el.scrim.addEventListener('click', closeDrawer);
  $('#btnTheme').addEventListener('click', () => {
    S.settings.appTheme = appTheme() === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyAppTheme();
    configureMermaid();
    scheduleRender(0);
  });
  el.docName.addEventListener('input', () => {
    if (!S.doc) return;
    S.doc.name = el.docName.value.trim() || T('doc.untitled');
    S.doc.updated = Date.now();
    persistDocs();
  });
  el.docName.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.docName.blur(); });
  el.mmTheme.addEventListener('change', () => { S.settings.mmTheme = el.mmTheme.value; saveSettings(); configureMermaid(); scheduleRender(0); });
  el.colorize.addEventListener('change', () => { S.settings.colorize = el.colorize.checked; saveSettings(); scheduleRender(0); });
  el.mirror.addEventListener('change', () => { S.settings.mirror = el.mirror.checked; saveSettings(); configureMermaid(); scheduleRender(0); });
  el.autoAct.addEventListener('change', () => {
    if (!S.doc) return;
    S.doc.autoAct = el.autoAct.checked;
    persistDocs();
    // Açılınca hesapla; kapatılınca mevcut işaretler kalır ve elle düzenlenebilir olur
    commit();
    flushHistory();
    toast(T(el.autoAct.checked ? 'act.autoOnToast' : 'act.autoOffToast'));
  });
  el.autonum.addEventListener('change', () => { S.model.autonumber = el.autonum.checked; if (!el.autonum.checked) S.model.autonumberArgs = ''; commit(); flushHistory(); });
  el.title.addEventListener('input', () => { S.model.title = el.title.value.trim(); commit({ rerender: false }); });
  el.title.addEventListener('blur', flushHistory);
  $('#zoomIn').addEventListener('click', () => zoomCenter(1.2));
  $('#zoomOut').addEventListener('click', () => zoomCenter(1 / 1.2));
  $('#zoomFit').addEventListener('click', () => { S.zoom.auto = true; fitView(); });

  // --- Önizleme tam ekran ---
  const panePreview = $('#panePreview');
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isFullscreen = () => fsElement() === panePreview || panePreview.classList.contains('pseudo-fullscreen');
  function updateFullscreenUi() {
    const on = isFullscreen();
    const b = $('#btnFullscreen');
    b.innerHTML = icon(on ? 'minimize' : 'maximize');
    b.dataset.i18nTitle = on ? 'fs.exit' : 'fs.enter';
    b.title = T(b.dataset.i18nTitle);
    S.zoom.auto = true;
    requestAnimationFrame(fitView);
  }
  function toggleFullscreen() {
    if (isFullscreen()) {
      if (panePreview.classList.contains('pseudo-fullscreen')) { panePreview.classList.remove('pseudo-fullscreen'); updateFullscreenUi(); }
      else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    closePopover();
    const req = panePreview.requestFullscreen || panePreview.webkitRequestFullscreen;
    const fallback = () => { panePreview.classList.add('pseudo-fullscreen'); updateFullscreenUi(); };
    if (!req) return fallback();
    try {
      const p = req.call(panePreview);
      if (p && p.catch) p.catch(fallback);
    } catch (e) { fallback(); }
  }
  $('#btnFullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenUi);
  document.addEventListener('webkitfullscreenchange', updateFullscreenUi);

  /** Sol editör panelini gizler / gösterir; çizim yeni alana sığdırılır. */
  function setEditorCollapsed(collapsed) {
    S.settings.editorCollapsed = !!collapsed;
    saveSettings();
    $('#workspace').classList.toggle('editor-collapsed', !!collapsed);
    if (collapsed) closePopover();
    S.zoom.auto = true;
    requestAnimationFrame(fitView);
  }
  $('#btnCollapse').addEventListener('click', () => setEditorCollapsed(true));
  $('#btnExpand').addEventListener('click', () => setEditorCollapsed(false));
  el.zoomVal.addEventListener('click', () => {
    const r = el.viewport.getBoundingClientRect();
    zoomAt(1 / S.zoom.k, r.width / 2, r.height / 2);
  });

  // ---------------------------------------------------------------------------
  // Klavye kısayolları
  // ---------------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

    if (e.key === 'Escape') {
      if (!el.modalRoot.hidden) return closeModal();
      if (panePreview.classList.contains('pseudo-fullscreen')) return toggleFullscreen();
      if (!el.popover.hidden) return closePopover();
      if (el.drawer.classList.contains('open')) return closeDrawer();
      if (typing) e.target.blur();
      else setSelected(null);
      return;
    }
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); return; }
      if (k === 's') { e.preventDefault(); flushHistory(); doSave(); toast(T('saved.toast')); return; }
      if (k === 'e') { e.preventDefault(); openExport(); return; }
      if (k === '1') { e.preventDefault(); setView('builder'); return; }
      if (k === '2') { e.preventDefault(); setView('code'); return; }
      if (k === 'b') { e.preventDefault(); setEditorCollapsed(!S.settings.editorCollapsed); return; }
      if (k === 'd' && currentView() === 'builder' && S.selected) { e.preventDefault(); duplicateNode(S.selected); return; }
    }
    if (!typing && !mod && !e.altKey && (e.key === 'f' || e.key === 'F') && el.modalRoot.hidden) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (currentView() !== 'builder' || S.settings.editorCollapsed || !S.selected || !el.modalRoot.hidden) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveNodeBy(S.selected, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (!typing && (e.key === 'Delete' || e.key === 'Backspace')) {
      const f = M.findNode(S.model, S.selected);
      if (f && f.node) { e.preventDefault(); deleteNode(S.selected); }
    }
  });

  window.addEventListener('beforeunload', () => {
    if (S.doc && S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); persistDocs(); }
  });

  // ---------------------------------------------------------------------------
  // Başlat
  // ---------------------------------------------------------------------------
  /** Dili uygular ve dinamik arayüzü yeniden çizer. */
  function applyLang() {
    I18N.setLang(S.settings.lang);
    $('#langLabel').textContent = I18N.getLang().toUpperCase();
    document.body.dataset.dropLabel = T('drop.file');
    closePopover();
    applyAppTheme();
    renderPalette();
    renderBuilder();
    renderDocList();
    scheduleRender(0);
  }

  async function init() {
    S.settings.lang = I18N.detect(S.settings.lang);
    I18N.setLang(S.settings.lang);
    $('#langLabel').textContent = I18N.getLang().toUpperCase();
    document.body.dataset.dropLabel = T('drop.file');
    applyAppTheme();
    el.mmTheme.value = S.settings.mmTheme;
    el.mirror.checked = !!S.settings.mirror;
    el.colorize.checked = S.settings.colorize !== false;
    configureMermaid();
    renderPalette();
    setView(S.settings.view);
    if (S.settings.editorCollapsed) $('#workspace').classList.add('editor-collapsed');

    const fromHash = await loadFromHash();
    if (!fromHash) {
      if (!S.docs.length) {
        const tpl = window.SeqTemplates.find((x) => x.id === 'checkout');
        createDoc(T('doc.sample'), tplL(tpl).code);
      } else {
        openDoc(store.get(LS.cur, null) || S.docs[0].id);
      }
    }
  }
  init();
})();
