/* Sequence Studio — mimari ekranı (C4)
 *
 * Üst bardaki "Akış / Mimari" geçişiyle açılan ikinci ekran. Katalog hiyerarşisini ve sekans diyagramlarından
 * türetilen ilişkileri C1 (sistemler) → C2 (sistemin içi) → C3 (konteynerin içi) olarak çizer; bir öğeye
 * tıklayıp içine girilir; bir kenara tıklayınca o ilişkinin geçtiği akışlar listelenir. Mantık lib/c4.js'tedir (SeqC4); bu modül ekranı, gezinmeyi ve dışa aktarmayı yönetir.
 */
(function (Seq) {
  'use strict';
  const { $, M, S, T, docCode, downloadBlob, dropdown, events, fileSafe, h, ico, mix, oneLine, saveSettings, toast } = Seq.core;
  const C4 = () => window.SeqC4;

  let ready = false;
  let renderSeq = 0;
  let last = null; // { view, ids, rels }
  const screen = () => (S.settings.screen === 'arch' ? 'arch' : 'seq');
  const isOpen = () => document.body.classList.contains('screen-arch');

  /** Akış ↔ mimari ekranı */
  function setScreen(s) {
    const arch = s === 'arch';
    S.settings.screen = arch ? 'arch' : 'seq';
    saveSettings();
    document.body.classList.toggle('screen-arch', arch);
    $('#archScreen').hidden = !arch;
    document.querySelectorAll('#screenSeg button').forEach((b) => b.classList.toggle('active', b.dataset.screen === S.settings.screen));
    if (arch) render();
  }

  const roleType = (id) => { const r = Seq.roles.roleById(id); return r ? r.type : ''; };
  const paperBg = () => Seq.theme.PAPER_BG[Seq.theme.mmThemeName()] || '#ffffff';
  /** Geçerli odak (yoksa C1); katalogdan silinmişse en üste dönülür */
  const focusId = () => (Seq.catalog.itemById(S.settings.archFocus) ? S.settings.archFocus : null);
  function setFocus(id) { S.settings.archFocus = id || null; saveSettings(); render(); }

  // ---------------------------------------------------------------------------
  // Çizim
  // ---------------------------------------------------------------------------
  async function render() {
    if (!isOpen()) return;
    const my = ++renderSeq;
    const canvas = $('#archCanvas');
    const docs = S.docs.map((d) => { try { return { id: d.id, model: M.parse(docCode(d)) }; } catch { return null; } }).filter(Boolean);
    const rels = C4().relations(S.catalog, docs);
    const v = C4().view(S.catalog, rels, focusId(), roleType);
    renderCrumbs(v);
    renderInfo(v, rels);
    canvas.innerHTML = '';
    if (!S.catalog.length) return canvas.append(empty(T('arch.emptyCatalog'), true));
    if (!v.nodes.length) return canvas.append(empty(T('arch.emptyLevel'), false));
    const bg = paperBg();
    const { code, ids } = C4().toMermaid(v, {
      name: (x) => oneLine(Seq.catalog.displayName(x)),
      roleOf: (x) => Seq.roles.roleById(x.role),
      levelLabel: (l) => '[' + T('c4.' + l) + ']',
      more: (n) => T('arch.more', { n }),
      fill: (c, outer) => mix(c, bg, outer ? 0.05 : 0.14),
    });
    last = { view: v, ids, rels, code };
    try {
      const { svg } = await mermaid.render('arch-' + my, code);
      if (my !== renderSeq) return;
      const paper = h('div', { class: 'paper arch-paper' });
      paper.innerHTML = svg;
      canvas.append(paper);
      wireNodes(paper.querySelector('svg'), v, ids);
      wireEdges(paper.querySelector('svg'), v, ids);
    } catch (err) {
      if (my !== renderSeq) return;
      canvas.append(h('div', { class: 'render-error', style: 'position:static' }, ico('critical'), h('pre', null, String(err && (err.message || err.str) || err))));
    } finally {
      document.querySelectorAll('[id^="darch-"], #arch-' + my).forEach((n) => { if (!canvas.contains(n)) n.remove(); });
    }
  }
  const empty = (text, withBtn) => h('div', { class: 'arch-empty' }, ico('layers'), h('p', null, text),
    withBtn ? h('button', { class: 'btn primary', onclick: () => Seq.library.open('catalog') }, ico('edit'), T('cat.manage')) : null);

  /** Konum: Tüm sistemler › Ödeme sistemi › Ledger */
  function renderCrumbs(v) {
    const box = $('#archCrumbs');
    box.innerHTML = '';
    const crumb = (label, id, current) => h('button', { class: 'crumb' + (current ? ' current' : ''), onclick: current ? null : () => setFocus(id) }, label);
    box.append(crumb(T('arch.top'), null, !v.focus));
    v.path.forEach((x, i) => box.append(h('span', { class: 'crumb-sep' }, '›'), crumb(oneLine(Seq.catalog.displayName(x)), x.id, i === v.path.length - 1)));
    box.append(h('span', { class: 'arch-level' }, T('arch.level.' + (v.focus ? (v.focusLevel === 'system' ? 'c2' : 'c3') : 'c1'))));
  }
  function renderInfo(v, rels) {
    const n = new Set(rels.flatMap((r) => r.docs)).size;
    const box = $('#archInfo');
    box.innerHTML = '';
    box.title = T('arch.infoTitle');
    box.append(T('arch.info', { e: v.edges.length, n }));
    if (rels.unlinked) {
      box.append(' · ' + T('arch.unlinked', { n: rels.unlinked }));
      // Adı katalogla eşleşen ama bağlı olmayan katılımcılar varsa toplu bağlama önerilir
      const m = S.docs.reduce((k, d) => { const md = M.parse(docCode(d)); return k + md.participants.filter((p) => Seq.catalog.matchesFor(p, md)).length; }, 0);
      if (m) box.append(' ', h('button', { class: 'link-btn', onclick: () => Seq.library.open('catalog', { match: true }) }, T('arch.linkMatches', { n: m })));
    }
  }

  /** Düğümlere tıklama: içine gir / kullanıldığı diyagramlar */
  function wireNodes(svg, v, ids) {
    if (!svg) return;
    svg.querySelectorAll('g.node').forEach((g) => {
      const m = /flowchart-(n\d+)-/.exec(g.id || '');
      const itemId = m && ids.get(m[1]);
      const node = itemId && v.nodes.find((n) => n.id === itemId);
      if (!node) return;
      g.classList.add('arch-node');
      g.setAttribute('tabindex', '0');
      g.setAttribute('data-item', itemId);
      const open = () => openNodeMenu(g, node);
      g.addEventListener('click', open);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  }
  let menu = null; // açık düğüm/kenar menüsü
  /**
   * Kenarlara tıklama: ince çizginin üstüne görünmez geniş bir tıklama alanı eklenir; etiket de tıklanabilir.
   * Mermaid kenarları "L_<from>_<to>_<n>" kimliğiyle çizer (hem çizgide hem etikette data-id).
   */
  function wireEdges(svg, v, ids) {
    if (!svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    svg.querySelectorAll('path.flowchart-link').forEach((path) => {
      const m = /^L_(n\d+)_(n\d+)_\d+$/.exec(path.dataset.id || '');
      const edge = m && v.edges.find((e) => e.from === ids.get(m[1]) && e.to === ids.get(m[2]));
      if (!edge) return;
      const hit = document.createElementNS(NS, 'path');
      hit.setAttribute('d', path.getAttribute('d'));
      hit.setAttribute('class', 'arch-edge-hit');
      hit.setAttribute('data-edge', edge.from + '>' + edge.to);
      hit.setAttribute('tabindex', '0');
      const tip = document.createElementNS(NS, 'title');
      tip.textContent = T('arch.edgeTitle');
      hit.append(tip);
      path.after(hit);
      const label = svg.querySelector(`.edgeLabel .label[data-id="${path.dataset.id}"]`);
      const targets = [hit, label && label.closest('.edgeLabel')].filter(Boolean);
      const hover = (on) => { path.classList.toggle('arch-edge-on', on); if (label) label.closest('.edgeLabel').classList.toggle('arch-edge-on', on); };
      targets.forEach((t) => {
        t.classList.add('arch-edge');
        t.addEventListener('mouseenter', () => hover(true));
        t.addEventListener('mouseleave', () => hover(false));
        t.addEventListener('click', () => openEdgeMenu(label || hit, edge));
        t.addEventListener('keydown', (e) => { if (e.key === 'Enter') openEdgeMenu(label || hit, edge); });
      });
    });
  }
  const shortName = (id) => oneLine(Seq.catalog.displayName(Seq.catalog.itemById(id)));
  const subtree = (id) => C4().subtree(S.catalog, id);
  /** İlişkinin geçtiği akışlar ve her birindeki mesajlar */
  function openEdgeMenu(anchor, edge) {
    if (menu) menu.close();
    const flows = edge.flows.map((f) => ({ doc: S.docs.find((d) => d.id === f.doc), texts: f.texts })).filter((f) => f.doc)
      .sort((a, b) => a.doc.name.localeCompare(b.doc.name));
    const fromSet = subtree(edge.from), toSet = subtree(edge.to);
    menu = dropdown(anchor, (box) => {
      box.append(h('div', { class: 'dd-head' },
        h('b', null, shortName(edge.from) + ' → ' + shortName(edge.to)),
        h('span', { class: 'dd-sum' }, T('arch.flowsN', { n: flows.length }))));
      box.append(h('ul', null, flows.map((f) => h('li', null,
        h('button', { class: 'dd-item bl-item', onclick: () => { menu.close(); openDiagram(f.doc.id, [...fromSet], { from: fromSet, to: toSet }); } }, ico('file'),
          h('span', { class: 'bl-text' }, h('b', null, f.doc.name),
            h('small', null, f.texts.length ? f.texts.map((t) => t.text + (t.n > 1 ? ' ×' + t.n : '')).join(', ') : T('arch.noText'))))))));
    }, { class: 'arch-edge-menu', onClose: () => { menu = null; } });
  }

  function openNodeMenu(anchor, node) {
    if (menu) menu.close();
    const x = node.item;
    // Kullanım: öğenin kendisi ve alt öğeleri (bir sistemin hangi diyagramlarda yer aldığı)
    const ids = [...subtree(x.id)];
    const used = new Map();
    ids.forEach((id) => Seq.catalog.usageOf(id).forEach(({ doc }) => used.set(doc.id, doc)));
    menu = dropdown(anchor, (box) => {
      box.append(h('div', { class: 'dd-head' }, h('b', null, oneLine(Seq.catalog.displayName(x))), h('span', { class: 'dd-sum' }, T('c4.' + node.level))));
      if (x.desc) box.append(h('p', { class: 'arch-desc' }, x.desc));
      const list = h('ul');
      if (node.hasChildren) {
        list.append(h('li', null, h('button', { class: 'dd-item', onclick: () => { menu.close(); setFocus(x.id); } }, ico('layers'), h('span', null, T('arch.zoomIn')))));
      }
      [...used.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach((d) => list.append(h('li', null,
        h('button', { class: 'dd-item bl-item', onclick: () => { menu.close(); openDiagram(d.id, ids); } }, ico('file'), h('span', { class: 'bl-text' }, h('b', null, d.name), h('small', null, T('arch.openSeq')))))));
      if (!node.hasChildren && !used.size) list.append(h('li', { class: 'dd-empty' }, ico('help'), T('arch.notUsed')));
      box.append(list);
    }, { onClose: () => { menu = null; } });
  }
  /**
   * Akış ekranına geçip diyagramı açar. msg ({ from, to } öğe kümeleri) verilirse ilişkinin ilk mesajını,
   * yoksa öğeye bağlı ilk katılımcıyı gösterir.
   */
  function openDiagram(docId, itemIds, msg) {
    setScreen('seq');
    if (!S.doc || S.doc.id !== docId) Seq.docs.openDoc(docId);
    if (msg) {
      const itemOf = new Map(S.model.participants.map((p) => [p.id, p.item]));
      let hit = null;
      M.walk(S.model.items, (it) => {
        if (hit || it.kind !== 'message' || it.arrow.startsWith('--')) return;
        if (msg.from.has(itemOf.get(it.from)) && msg.to.has(itemOf.get(it.to))) hit = it;
      });
      if (hit) {
        if (Seq.layout.currentView() === 'code') Seq.code.selectCodeLine(hit.line);
        else Seq.flow.reveal(hit.uid);
        return;
      }
    }
    const p = S.model.participants.find((q) => itemIds.includes(q.item));
    if (p) Seq.participants.revealCard(p.uid);
  }

  // ---------------------------------------------------------------------------
  // Dışa aktarma (SVG, PNG, Mermaid)
  // ---------------------------------------------------------------------------
  function fileBase() {
    const f = last && last.view.focus;
    return fileSafe(T('arch.fileName') + (f ? ' - ' + oneLine(Seq.catalog.displayName(f)) : ''));
  }
  async function exportAs(kind) {
    const src = $('#archCanvas svg');
    if (!last || !src) return toast(T('exp.nothing'), 'err');
    try {
      if (kind === 'mmd') return downloadBlob(new Blob([last.code], { type: 'text/plain;charset=utf-8' }), fileBase() + '.mmd');
      const built = Seq.export.buildExportSvg(Seq.export.exportBg(), src);
      if (kind === 'svg') return downloadBlob(new Blob([built.markup], { type: 'image/svg+xml;charset=utf-8' }), fileBase() + '.svg');
      downloadBlob(await Seq.export.svgToPngBlob(built.markup, built.w, built.h, Seq.export.effectiveScale(built.w, built.h)), fileBase() + '.png');
    } catch (err) { toast(T('exp.failed', { msg: err.message }), 'err'); }
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    document.querySelectorAll('#screenSeg button').forEach((b) => b.addEventListener('click', () => setScreen(b.dataset.screen)));
    document.querySelectorAll('#archExport [data-fmt]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.fmt)));
    $('#archEditCatalog').addEventListener('click', () => Seq.library.open('catalog'));
    // Kayıtlı ekran, açılış tamamlanınca uygulanır; sonrasında bir diyagram açılırsa akış ekranına geçilir
    events.on('app:ready', () => { ready = true; setScreen(screen()); });
    events.on('doc:opened', () => { if (ready && isOpen()) setScreen('seq'); });
    ['catalog:changed', 'docs:persisted', 'theme:changed'].forEach((e) => events.on(e, () => { if (isOpen()) render(); }));
  }

  Seq.arch = { init, isOpen, render, setFocus, setScreen };
})(window.Seq = window.Seq || {});
