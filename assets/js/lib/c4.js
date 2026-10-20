/* Sequence Studio — C4 mimari görünümü (saf mantık)
 *
 * Katalog hiyerarşisi (C4: sistem › konteyner › bileşen) ve sekans diyagramlarındaki mesajlardan mimari
 * görünümler üretir. İlişkiler elle çizilmez: kataloğa bağlı iki katılımcı arasındaki her çağrı bir "kullanır"
 * ilişkisidir; görünümün düzeyine göre hiyerarşide yukarı toplanır.
 *
 *   relations(items, docs)       → [{ from, to, labels: [{ text, n }], docs: [docId], flows: [{ doc, texts: [{ text, n }] }] }]
 *   view(items, rels, focusId)   → { focus, nodes, edges }   focusId boşsa en üst düzey (C1)
 *   toMermaid(view, opts)        → Mermaid flowchart kodu
 *
 * Düzey öğenin yerinden çıkar: kök → sistem (rolü actor ise kişi), ara → konteyner, yaprak → bileşen.
 * Tarayıcıda window.SeqC4, Node'da module.exports.
 */
(function (root) {
  'use strict';

  const isReply = (a) => String(a || '').startsWith('--');
  function walk(items, fn) {
    for (const it of items) {
      fn(it);
      if (it.kind === 'block') it.branches.forEach((b) => walk(b.items, fn));
    }
  }

  /** Öğe dizini: id → öğe, yol (kökten), alt öğeler */
  function index(items) {
    const byId = new Map(items.map((x) => [x.id, x]));
    const parentOf = (x) => (x.parent && byId.has(x.parent) ? x.parent : null);
    const pathCache = new Map();
    const path = (id) => {
      if (pathCache.has(id)) return pathCache.get(id);
      const out = [];
      for (let x = byId.get(id), guard = 0; x && guard < 50; x = byId.get(parentOf(x)), guard++) out.unshift(x.id);
      pathCache.set(id, out);
      return out;
    };
    const children = (id) => items.filter((x) => parentOf(x) === (id || null));
    return { byId, parentOf, path, children };
  }

  /**
   * Diyagramlardaki mesajlardan öğe → öğe ilişkileri. Yanıtlar (-->>), kendine çağrılar ve kataloğa bağlı
   * olmayan katılımcılar sayılmaz. docs: [{ id, model }]
   */
  function relations(items, docs) {
    const known = new Set(items.map((x) => x.id));
    const map = new Map();
    let unlinked = 0;
    docs.forEach((d) => {
      const itemOf = new Map(d.model.participants.filter((p) => p.item && known.has(p.item)).map((p) => [p.id, p.item]));
      walk(d.model.items, (it) => {
        if (it.kind !== 'message' || isReply(it.arrow) || it.from === it.to) return;
        const a = itemOf.get(it.from), b = itemOf.get(it.to);
        if (!a || !b) { unlinked++; return; }
        if (a === b) return;
        const k = a + '>' + b;
        if (!map.has(k)) map.set(k, { from: a, to: b, labels: new Map(), flows: new Map() });
        const r = map.get(k);
        const text = String(it.text || '').replace(/\s*\n\s*/g, ' ').trim();
        if (text) r.labels.set(text, (r.labels.get(text) || 0) + 1);
        if (!r.flows.has(d.id)) r.flows.set(d.id, new Map());
        if (text) r.flows.get(d.id).set(text, (r.flows.get(d.id).get(text) || 0) + 1);
      });
    });
    const out = [...map.values()].map((r) => ({
      from: r.from, to: r.to, docs: [...r.flows.keys()], labels: counted(r.labels),
      flows: [...r.flows].map(([doc, texts]) => ({ doc, texts: counted(texts) })),
    }));
    out.unlinked = unlinked;
    return out;
  }

  /** Map(metin → sayı) → [{ text, n }] çoktan aza */
  const counted = (m) => [...m].map(([text, n]) => ({ text, n })).sort((x, y) => y.n - x.n || x.text.localeCompare(y.text));
  /** [{ doc, texts }] listelerini diyagrama göre birleştirir */
  function mergeFlows(into, flows) {
    flows.forEach((f) => {
      if (!into.has(f.doc)) into.set(f.doc, new Map());
      const m = into.get(f.doc);
      f.texts.forEach((t) => m.set(t.text, (m.get(t.text) || 0) + t.n));
    });
  }

  /** Öğenin C4 düzeyi */
  function levelOf(ix, x, roleType) {
    const depth = ix.path(x.id).length - 1;
    const leaf = !ix.children(x.id).length;
    if (depth === 0) return roleType === 'actor' ? 'person' : 'system';
    return leaf ? 'component' : 'container';
  }

  /**
   * Görünüm: odak öğenin alt öğeleri (odak yoksa kökler) iç düğümlerdir; bunlarla ilişkili dış öğeler,
   * odakla ortak atadan hemen sonraki düzeyde gösterilir (ör. C3'te komşu konteyner, C2'de diğer sistem).
   * roleType(roleId) → katılımcı tipi (kişi ayrımı için).
   */
  function view(items, rels, focusId, roleType = () => '') {
    const ix = index(items);
    const focus = focusId && ix.byId.get(focusId) ? focusId : null;
    const focusPath = focus ? ix.path(focus) : [];
    const inside = (id) => !focus || ix.path(id).includes(focus);
    // Bir öğenin bu görünümdeki temsilcisi
    const rep = (id) => {
      const p = ix.path(id);
      if (inside(id)) return p[focusPath.length]; // odağın doğrudan alt öğesi
      let i = 0;
      while (i < p.length && p[i] === focusPath[i]) i++;
      return p[i]; // ortak atadan sonraki ilk öğe
    };
    const nodes = new Map();
    const addNode = (id, outer) => {
      if (!id || id === focus || nodes.has(id)) return;
      const x = ix.byId.get(id);
      nodes.set(id, { id, item: x, outer, level: levelOf(ix, x, roleType(x.role)), hasChildren: ix.children(id).length > 0 });
    };
    ix.children(focus).forEach((x) => addNode(x.id, false));
    const edges = new Map();
    rels.forEach((r) => {
      if (!ix.byId.has(r.from) || !ix.byId.has(r.to)) return;
      if (focus && !inside(r.from) && !inside(r.to)) return;
      const a = rep(r.from), b = rep(r.to);
      if (!a || !b || a === b || a === focus || b === focus) return;
      addNode(a, !inside(r.from));
      addNode(b, !inside(r.to));
      const k = a + '>' + b;
      if (!edges.has(k)) edges.set(k, { from: a, to: b, labels: new Map(), flows: new Map() });
      const e = edges.get(k);
      r.labels.forEach((l) => e.labels.set(l.text, (e.labels.get(l.text) || 0) + l.n));
      mergeFlows(e.flows, r.flows || r.docs.map((doc) => ({ doc, texts: [] })));
    });
    return {
      focus: focus ? ix.byId.get(focus) : null,
      focusLevel: focus ? levelOf(ix, ix.byId.get(focus), roleType(ix.byId.get(focus).role)) : null,
      path: focusPath.map((id) => ix.byId.get(id)),
      nodes: [...nodes.values()],
      edges: [...edges.values()].map((e) => ({
        from: e.from, to: e.to, docs: [...e.flows.keys()], labels: counted(e.labels),
        flows: [...e.flows].map(([doc, texts]) => ({ doc, texts: counted(texts) })),
      })),
    };
  }

  // ---- Mermaid ----
  const SHAPE = { database: ['[(', ')]'], queue: ['[[', ']]'], actor: ['([', '])'], collections: ['[[', ']]'] };
  /** Mermaid etiketinde güvenli metin (markdown dizesi içinde) */
  const safe = (s) => String(s == null ? '' : s).replace(/[`"]/g, "'").replace(/[*_]/g, (c) => '\\' + c).replace(/\s*\n\s*/g, ' ').trim();
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  /**
   * opts: {
   *   name(item) → görünen ad, roleOf(item) → { type, color }, levelLabel(level) → "[Sistem]" gibi,
   *   maxLabels (kenar başına gösterilen mesaj sayısı), more(n) → "+3", fill(color, outer) → dolgu rengi
   * }
   * Döner: { code, ids: Map(mermaidId → öğe id) } — kenarlar Mermaid'de "L_<from>_<to>_<n>" kimliğini alır
   */
  function toMermaid(v, opts) {
    const o = Object.assign({ maxLabels: 2, more: (n) => '+' + n, fill: (c) => c, levelLabel: (l) => '[' + l + ']' }, opts);
    const out = ['flowchart LR'];
    const ids = new Map();
    const mid = new Map();
    v.nodes.forEach((n, i) => { const k = 'n' + i; mid.set(n.id, k); ids.set(k, n.id); });
    const nodeLine = (n) => {
      const r = o.roleOf(n.item) || {};
      const [a, b] = SHAPE[n.level === 'person' ? 'actor' : r.type] || ['(', ')'];
      const lines = ['**' + safe(o.name(n.item)) + '**', safe(o.levelLabel(n.level))];
      if (n.item.desc) lines.push(clip(safe(n.item.desc), 48));
      return mid.get(n.id) + a + '"`' + lines.join('\n') + '`"' + b;
    };
    const inner = v.nodes.filter((n) => !n.outer);
    const outer = v.nodes.filter((n) => n.outer);
    if (v.focus) {
      out.push('  subgraph focus["`**' + safe(o.name(v.focus)) + '** ' + safe(o.levelLabel(v.focusLevel)) + '`"]');
      inner.forEach((n) => out.push('    ' + nodeLine(n)));
      out.push('  end');
    } else inner.forEach((n) => out.push('  ' + nodeLine(n)));
    outer.forEach((n) => out.push('  ' + nodeLine(n)));
    v.edges.forEach((e) => {
      const shown = e.labels.slice(0, o.maxLabels).map((l) => clip(safe(l.text), 40));
      if (e.labels.length > o.maxLabels) shown.push(o.more(e.labels.length - o.maxLabels));
      const lab = shown.length ? '|"`' + shown.join('\n') + '`"|' : '';
      out.push('  ' + mid.get(e.from) + ' -->' + lab + ' ' + mid.get(e.to));
    });
    v.nodes.forEach((n) => {
      const r = o.roleOf(n.item) || {};
      const c = r.color || '#8a93a6';
      out.push('  style ' + mid.get(n.id) + ' fill:' + o.fill(c, n.outer) + ',stroke:' + c + ',stroke-width:1.5px' + (n.outer ? ',stroke-dasharray:5 3' : ''));
    });
    if (v.focus) out.push('  style focus fill:transparent,stroke:#8a93a6,stroke-width:1.5px,stroke-dasharray:7 4');
    return { code: out.join('\n') + '\n', ids };
  }

  /** Öğe ve tüm alt öğelerinin kimlikleri */
  function subtree(items, id) {
    const ix = index(items);
    return new Set(items.filter((x) => ix.path(x.id).includes(id)).map((x) => x.id));
  }

  const api = { index, relations, view, toMermaid, levelOf, subtree };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeqC4 = api;
})(typeof window !== 'undefined' ? window : globalThis);
