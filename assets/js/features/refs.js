/* Sequence Studio — diyagramlar arası bağlantı
 *
 * Referans notlarının önizlemede çizimi, bağlantıyla gezinme (geri dönüş), ad değişikliğinin yayılması
 * ve dışa aktarmada referansları içine çizme.
 */
(function (Seq) {
  'use strict';
  const { $, $$, M, S, T, docCode, h, hexToRgb, ico, mix, toast, events } = Seq.core;

  // --- Referansları dışa aktarmada açma ---
  const countDocRefs = (model) => { let n = 0; M.walk(model.items, (it) => { if (it.kind === 'note' && it.ref) n++; }); return n; };
  const resolveDoc = (id) => { const d = S.docs.find((x) => x.id === id); return d ? { name: d.name, model: M.parse(docCode(d)) } : null; };
  /**
   * Diyagramın referansları açılmış hâli. forText: .mmd/.txt için başlık notlarının bağlantısı kaldırılır
   * (dosya tekrar içe aktarılınca yeniden açılmasın). Döner: expandRefs raporu + code.
   */
  function expandedDoc(doc, code, forText) {
    const r = M.expandRefs(M.parse(code), resolveDoc, { rootId: doc && doc.id });
    if (forText) M.walk(r.model.items, (it) => { if (it.refHeader) delete it.ref; });
    r.code = M.serialize(r.model);
    return r;
  }
  /** Dahil edilecek diyagramların listesi ve uyarılar (dışa aktarma penceresinde) */
  function refReport(r) {
    const box = h('div', { class: 'ref-report' });
    if (r.included.length) {
      box.append(h('div', { class: 'rr-title' }, T('exp.refsIncluded')));
      box.append(h('ul', null, r.included.map((x) => h('li', { style: `padding-left:${Math.max(0, x.depth - 1) * 16}px` }, ico('link'), x.name))));
    }
    const missing = r.missing.length ? T('exp.refsMissing', { n: r.missing.length }) : '';
    const cycles = r.cycles.length ? T('exp.refsCycles', { names: r.cycles.join(', ') }) : '';
    if (missing || cycles) box.append(h('p', { class: 'rr-warn' }, ico('critical'), [missing, cycles].filter(Boolean).join(' ')));
    box.append(h('p', { class: 'rr-note' }, T('exp.refsNote')));
    return box;
  }

  // ---------------------------------------------------------------------------
  // Diyagramlar arası bağlantı (ref)
  // ---------------------------------------------------------------------------
  const REF_COLOR = '#3a8dde';
  /**
   * Çizim dönüşümü: referans notlarının başına işaret ("↗", kopuksa "✕"). İşaret metnin parçası olduğundan
   * Mermaid notun genişliğini ona göre hesaplar (dar notlarda üst üste binme olmaz). Koddaki etiket değişmez.
   * Referans yoksa null; varsa modelin kopyası.
   */
  function refMarkers(model) {
    let hasRef = false;
    M.walk(model.items, (it) => { if (it.kind === 'note' && it.ref) { hasRef = true; return false; } });
    if (!hasRef) return null;
    const m = JSON.parse(JSON.stringify(model));
    M.walk(m.items, (it) => {
      if (it.kind === 'note' && it.ref) it.text = (S.docs.some((d) => d.id === it.ref) ? '↗ ' : '✕ ') + (String(it.text).trim() || '…');
    });
    return m;
  }
  /** Referans notlarını önizlemede ayırt edilir çizer (kesikli çerçeve, renk, araç ipucu) ve tıklanabilir yapar. */
  function decorateRefs(svg, model) {
    if (!svg) return;
    const notes = [];
    M.walk(model.items, (it) => { if (it.kind === 'note') notes.push(it); });
    if (!notes.some((n) => n.ref)) return;
    const groups = $$('g[data-et="note"]', svg);
    if (groups.length !== notes.length) return;
    const bg = Seq.theme.PAPER_BG[Seq.theme.mmThemeName()] || '#ffffff';
    const dark = hexToRgb(bg).reduce((a, v) => a + v, 0) < 384;
    const NS = 'http://www.w3.org/2000/svg';
    groups.forEach((g, i) => {
      const n = notes[i];
      if (!n.ref) return;
      const target = S.docs.find((d) => d.id === n.ref);
      const c = target ? REF_COLOR : (getComputedStyle(document.documentElement).getPropertyValue('--danger').trim() || '#e5484d');
      g.classList.add('ref-note');
      if (!target) g.classList.add('ref-broken');
      g.setAttribute('data-ref', n.ref);
      const rect = g.querySelector('rect');
      if (!rect) return;
      rect.style.fill = mix(c, bg, dark ? 0.16 : 0.07);
      rect.style.stroke = c;
      rect.style.strokeWidth = '1.5px';
      rect.style.strokeDasharray = '6 3';
      const ink = dark ? mix(c, '#ffffff', 0.55) : mix(c, '#000000', 0.7);
      g.querySelectorAll('text, tspan').forEach((t) => { t.style.fill = ink; t.style.fontWeight = '600'; });
      const tip = document.createElementNS(NS, 'title');
      tip.textContent = target ? T('ref.tip', { name: target.name }) : T('ref.broken');
      g.append(tip);
    });
  }

  // Bağlantıyla gidilen diyagramlardan geri dönüş yığını
  const nav = { stack: [], keep: false };
  function followRef(id) {
    const d = S.docs.find((x) => x.id === id);
    if (!d) return toast(T('ref.broken'), 'err');
    if (S.doc && S.doc.id === id) return;
    if (S.doc) nav.stack.push(S.doc.id);
    navOpen(id);
  }
  function navOpen(id) {
    nav.keep = true;
    try { Seq.docs.openDoc(id); } finally { nav.keep = false; }
    updateNavBack();
  }
  function navBack() {
    while (nav.stack.length) {
      const id = nav.stack.pop();
      if (S.docs.some((d) => d.id === id)) return navOpen(id);
    }
    updateNavBack();
  }
  function updateNavBack() {
    const btn = $('#navBack');
    if (!btn) return;
    nav.stack = nav.stack.filter((id) => S.docs.some((d) => d.id === id));
    const prev = S.docs.find((d) => d.id === nav.stack[nav.stack.length - 1]);
    btn.hidden = !prev;
    if (prev) { btn.lastChild.textContent = prev.name; btn.title = T('ref.backTitle'); }
  }
  /** Diyagram yeniden adlandırılınca, ona bağlanan referansların (elle değiştirilmemiş) etiketlerini güncelle */
  function propagateRefRename(id, oldName, newName) {
    if (!oldName || oldName === newName) return;
    const fix = (model) => {
      let ch = false;
      M.walk(model.items, (it) => { if (it.kind === 'note' && it.ref === id && it.text === oldName) { it.text = newName; ch = true; } });
      return ch;
    };
    let n = 0;
    S.docs.forEach((d) => {
      if (d === S.doc || !d.code.includes('@ref ' + id)) return;
      const m = M.parse(d.code);
      if (fix(m)) { d.code = M.serialize(m); n++; }
    });
    if (S.doc && S.doc.id !== id && fix(S.model)) { Seq.editor.commit(); n++; }
    if (n) { Seq.docs.persistDocs(); toast(T('ref.renamed', { n })); }
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    Seq.preview.addTransform('ref-markers', refMarkers, 20);
    Seq.preview.addDecorator('refs', (svg, c) => decorateRefs(svg, c.renderModel), 40);
    // Bağlantıyla gelinmediyse geri dönüş yığını sıfırlanır
    events.on('doc:opened', () => { if (!nav.keep) nav.stack = []; updateNavBack(); });
    // Açık diyagram silinen diyagrama bağlanıyorsa referans hemen "kopuk" görünsün
    events.on('doc:deleted', ({ id }) => { if (S.code.includes('@ref ' + id)) { Seq.flow.renderBuilder(); Seq.preview.scheduleRender(0); } });
    events.on('doc:renamed', ({ id, from, to }) => propagateRefRename(id, from, to));
    $('#navBack').addEventListener('click', navBack);
  }

  Seq.refs = { init, countDocRefs, decorateRefs, expandedDoc, followRef, nav, propagateRefRename, refReport, updateNavBack };
})(window.Seq = window.Seq || {});
