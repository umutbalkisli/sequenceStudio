/* Sequence Studio — dışa aktarma
 *
 * Dışa aktarma penceresi ve formatları (PNG, SVG, Mermaid, metin, draw.io), arka plan ve ölçek seçenekleri.
 */
(function (Seq) {
  'use strict';
  const { $, S, T, closeModal, downloadBlob, el, h, ico, openModal, saveSettings, toast } = Seq.core;

  // ---------------------------------------------------------------------------
  // Format kaydı
  //
  // Her format kendini tanımlar; pencere, panoya kopyalama ve klasör dışa aktarma formata göre dallanmaz.
  // Yeni format eklemek için registerFormat yeterlidir:
  //   id, icon, ext       — kimlik, simge, dosya uzantısı (etiketler i18n'de fmt.<id> / fmt.<id>.desc)
  //   kind                — 'image' (çizilmiş SVG'den üretilir) | 'text' (Mermaid kodundan üretilir)
  //   drawio              — true ise çizim draw.io XML'iyle birlikte istenir
  //   options(ex, seg)    — formata özel ayar satırları (isteğe bağlı)
  //   info(built)         — önizleme altındaki boyut bilgisi (görsel formatlar)
  //   toBlob(payload)     — indirilecek içerik; payload görselde çizim ({ markup, w, h, drawio? }), metinde koddur
  //   copy(payload)       — panoya kopyalar, gösterilecek bildirimi döndürür
  // ---------------------------------------------------------------------------
  const formats = [];
  function registerFormat(f) { formats.push(f); }
  const formatById = (id) => formats.find((f) => f.id === id) || formats[0];
  const textBlob = (s, type) => new Blob([s], { type: type + ';charset=utf-8' });
  const pngOf = (b) => svgToPngBlob(b.markup, b.w, b.h, effectiveScale(b.w, b.h));
  const scaleRow = (ex, seg) => h('div', { class: 'opt-row' }, h('label', null, T('exp.scale')),
    seg([[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']], ex.scale, (v) => { ex.scale = v; }));
  const vectorInfo = (b) => `${b.w} × ${b.h} (${T('exp.vector')})`;
  const copyText = async (s, msg) => { await navigator.clipboard.writeText(s); return T(msg); };

  registerFormat({
    id: 'png', icon: 'image', ext: '.png', kind: 'image',
    options: (ex, seg) => [scaleRow(ex, seg), ...bgOptionRows(ex, seg)],
    info: (b) => { const sc = effectiveScale(b.w, b.h); return `${Math.round(b.w * sc)} × ${Math.round(b.h * sc)} px`; },
    toBlob: pngOf,
    copy: async (b) => { await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(b) })]); return T('exp.pngCopied'); },
  });
  registerFormat({
    id: 'svg', icon: 'vector', ext: '.svg', kind: 'image',
    options: bgOptionRows,
    info: vectorInfo,
    toBlob: (b) => textBlob(b.markup, 'image/svg+xml'),
    copy: (b) => copyText(b.markup, 'exp.svgCopied'),
  });
  registerFormat({
    id: 'mmd', icon: 'code', ext: '.mmd', kind: 'text',
    toBlob: (code) => textBlob(code, 'text/plain'),
    copy: (code) => copyText(code, 'exp.codeCopied'),
  });
  registerFormat({
    id: 'txt', icon: 'file', ext: '.txt', kind: 'text',
    toBlob: (code) => textBlob(code, 'text/plain'),
    copy: (code) => copyText(code, 'exp.codeCopied'),
  });
  registerFormat({
    id: 'drawio', icon: 'drawio', ext: '.drawio', kind: 'image', drawio: true,
    transparentNote: 'exp.bgTransDrawio',
    options: bgOptionRows,
    info: () => T('exp.drawioInfo'),
    toBlob: (b) => textBlob(b.drawio, 'application/vnd.jgraph.mxfile'),
    copy: (b) => copyText(b.drawio, 'exp.drawioCopied'),
  });

  /** Format seçim ızgarası (tek diyagram ve klasör dışa aktarmada ortak) */
  function formatGrid(ex, onPick) {
    return h('div', { class: 'fmt-grid' }, formats.map((f) => h('button', {
      class: 'fmt' + (ex.format === f.id ? ' active' : ''),
      onclick: () => { ex.format = f.id; saveSettings(); onPick(f); },
    }, ico(f.icon), h('b', null, T('fmt.' + f.id)), h('span', null, T('fmt.' + f.id + '.desc')))));
  }
  /** Bir dosyanın içeriği: görselde çizim, metinde (rol tanımları eklenmiş) kod */
  async function renderFile(fmt, code, name) {
    if (fmt.kind === 'text') return fmt.toBlob(Seq.catalog.withDefs(code));
    const built = await Seq.preview.renderDocSvg(code, fmt.drawio ? { drawio: name } : null);
    if (!built) throw new Error(T('exp.nothing'));
    return fmt.toBlob(built);
  }

  /** Çizilmiş (DOM'daki) SVG'yi draw.io dosyasına çevirir; konum ve renkler önizlemedeki gibidir. */
  function toDrawio(svgEl, model, name) {
    const types = {};
    model.participants.forEach((p) => { types[p.id] = p.type; });
    const bg = exportBg();
    return window.SeqDrawio.convert(svgEl, { types, name, background: bg === 'transparent' ? 'none' : bg });
  }
  const safeName = () => (S.doc && S.doc.name ? S.doc.name : 'diagram').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'diagram';

  function buildExportSvg(bg, src = $('.paper svg', el.canvas)) {
    if (!src) return null;
    const svg = src.cloneNode(true);
    svg.querySelectorAll('.ref-toggle').forEach((n) => n.remove()); // yalnızca önizlemedeki etkileşim için
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
    return Seq.theme.PAPER_BG[Seq.theme.mmThemeName()] || '#ffffff';
  }
  /**
   * Arka plan seçimi satırı (tek diyagram ve klasör dışa aktarmada ortak). "Tema" gerçek rengini bir
   * renk noktasıyla gösterir (açık temada beyazla aynı olduğu anlaşılsın); şeffafta formata göre not çıkar.
   */
  function bgOptionRows(ex, seg) {
    const themeColor = Seq.theme.PAPER_BG[Seq.theme.mmThemeName()] || '#ffffff';
    const themeLabel = h('span', { class: 'bg-opt' }, h('span', { class: 'bg-dot', style: `--bg:${themeColor}` }), T('exp.bgTheme'));
    const rows = [h('div', { class: 'opt-row' }, h('label', null, T('exp.bg')),
      seg([['theme', themeLabel], ['white', T('exp.bgWhite')], ['transparent', T('exp.bgTransparent')]], ex.bg, (v) => { ex.bg = v; }))];
    if (ex.bg === 'transparent') rows.push(h('p', { class: 'bg-note' }, ico('help'), T(formatById(ex.format).transparentNote || 'exp.bgTransHint')));
    return rows;
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
    if (el.code.value !== S.code) Seq.editor.applyCode(el.code.value, 'code');
    Seq.editor.refreshAutoAct();
    Seq.editor.flushHistory();
    const ex = S.settings.exp;
    if (!ex.refs) ex.refs = 'link';
    const hasRefs = Seq.refs.countDocRefs(S.model) > 0;
    const inline = () => hasRefs && ex.refs === 'inline';
    // Açılmış diyagram (görsel ve metin için ayrı) — pencere açıkken bir kez hesaplanır
    let expImg = null, expText = null;
    const getExp = (forText) => (forText ? (expText = expText || Seq.refs.expandedDoc(S.doc, S.code, true)) : (expImg = expImg || Seq.refs.expandedDoc(S.doc, S.code, false)));
    /** Dışa aktarılacak görsel: referanslar açılacaksa ekran dışında çizilir, yoksa önizlemeden alınır */
    const exportBuilt = async (drawioName) => {
      if (inline()) return Seq.preview.renderDocSvg(getExp(false).code, drawioName ? { drawio: drawioName } : null);
      const built = buildExportSvg(exportBg());
      if (built && drawioName) built.drawio = toDrawio($('.paper svg', el.canvas), S.renderModel || S.model, drawioName);
      return built;
    };
    const exportText = () => Seq.catalog.withDefs(inline() ? getExp(true).code : S.code);

    const body = h('div');
    const draw = () => {
      body.innerHTML = '';
      const fmt = formatById(ex.format);
      body.append(formatGrid(ex, draw));
      const seg = (opts, val, on) => h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: v === val ? 'active' : '', onclick: () => { on(v); saveSettings(); draw(); } }, l)));

      // Referanslar: bağlantı olarak bırak ya da bağlı diyagramları içine çiz
      if (hasRefs) {
        body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.refs')),
          seg([['link', T('exp.refsLink')], ['inline', T('exp.refsInline')]], ex.refs, (v) => { ex.refs = v; })));
        if (inline()) body.append(Seq.refs.refReport(getExp(false)));
      }

      const nameIn = h('input', { class: 'input', value: safeName(), spellcheck: 'false' });
      const fileBase = () => nameIn.value.trim() || safeName();
      /** Formatın işleyeceği içerik: görselde çizim, metinde kod */
      const payload = async () => (fmt.kind === 'text' ? exportText() : exportBuilt(fmt.drawio ? fileBase() : null));

      if (fmt.kind === 'image') {
        if (!S.lastOk) body.append(h('div', { class: 'render-error', style: 'position:static;margin-bottom:12px' }, ico('critical'), T('exp.hasError')));
        const prev = h('div', { class: 'export-preview' });
        const dim = h('span', { class: 'dim-info' });
        const show = (built) => {
          prev.innerHTML = '';
          if (!built) { prev.append(h('span', { class: 'dim-info' }, T('exp.nothing'))); return; }
          prev.append(h('img', { alt: T('exp.preview'), src: URL.createObjectURL(new Blob([built.markup], { type: 'image/svg+xml' })) }));
          dim.textContent = fmt.info ? fmt.info(built) : '';
        };
        if (inline()) {
          prev.append(h('span', { class: 'dim-info' }, '…'));
          exportBuilt().then(show).catch((e) => { prev.innerHTML = ''; prev.append(h('span', { class: 'dim-info' }, T('exp.failed', { msg: e.message }))); });
        } else show(buildExportSvg(exportBg()));
        body.append(prev);
        if (fmt.options) body.append(...fmt.options(ex, seg));
        body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.size')), dim));
      } else {
        body.append(h('pre', { class: 'export-code', style: 'margin:0 0 12px;max-height:260px;overflow:auto;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--code-bg);font:12px/1.55 var(--mono)' }, exportText()));
        if (fmt.options) body.append(...fmt.options(ex, seg));
      }
      body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.filename')), h('div', { class: 'row', style: 'max-width:340px;gap:6px' }, nameIn, h('span', { class: 'dim-info', style: 'flex:none' }, fmt.ext))));

      const doDownload = async () => {
        const fname = (nameIn.value.trim() || 'diagram') + fmt.ext;
        try {
          const p = await payload();
          if (p == null) return toast(T('exp.nothing'), 'err');
          downloadBlob(await fmt.toBlob(p), fname);
          toast(T('exp.downloaded', { name: fname }));
          closeModal();
        } catch (err) { toast(T('exp.failed', { msg: err.message }), 'err'); }
      };
      const doCopy = async () => {
        try {
          const p = await payload();
          if (p == null) return;
          toast(await fmt.copy(p));
        } catch (err) { toast(T('exp.copyFailed', { msg: err.message }), 'err'); }
      };
      body.append(h('div', { class: 'export-actions' },
        h('div', { class: 'left' },
          h('button', { class: 'btn', onclick: doCopy }, ico('copy'), T('exp.copy')),
          h('button', { class: 'btn ghost', onclick: Seq.share.copyShareLink, title: T('exp.shareTitle') }, ico('share'), T('exp.share'))),
        h('div', { class: 'right' }, h('button', { class: 'btn primary', onclick: doDownload }, ico('download'), T('exp.download')))));
    };
    draw();
    openModal(T('exp.title'), body);
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    $('#btnExport').addEventListener('click', openExport);
  }

  Seq.export = { init, bgOptionRows, formatById, formatGrid, formats, registerFormat, renderFile, buildExportSvg, effectiveScale, exportBg, openExport, svgToPngBlob, toDrawio };
})(window.Seq = window.Seq || {});
