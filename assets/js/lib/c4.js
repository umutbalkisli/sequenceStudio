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
 * Düzey öğenin türünden gelir (grup, kişi, sistem, konteyner, bileşen); türü olmayan eski öğelerde yerinden
 * tahmin edilir (kök → sistem ya da kişi, ara → konteyner, yaprak → bileşen). Gruplar çizilmez.
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

  // ---- Türler ----
  // Her öğenin açık bir C4 türü vardır: grup (yalnızca düzenleme, çizilmez), kişi, sistem, konteyner, bileşen.
  const KINDS = ['group', 'person', 'system', 'container', 'component'];
  /** Türün beklenen üst öğe türleri (null: en üst düzey) */
  const PARENTS = {
    group: [null, 'group'], person: [null, 'group'], system: [null, 'group'], container: ['system'], component: ['container'],
  };
  /** Türü olmayan (eski) öğe için derinlikten tahmin: kök → sistem (actor ise kişi), ara → konteyner, yaprak → bileşen */
  function inferKind(ix, x, roleType) {
    const depth = ix.path(x.id).length - 1;
    if (depth === 0) return roleType === 'actor' ? 'person' : 'system';
    return ix.children(x.id).length ? 'container' : 'component';
  }
  /** Yeni öğe için varsayılan tür: üst öğeye ve rol tipine göre */
  function defaultKind(parentKind, roleType) {
    if (parentKind === 'system') return 'container';
    if (parentKind === 'container' || parentKind === 'component') return 'component';
    if (roleType === 'actor') return 'person';
    return 'system';
  }
  /** Yerleşim uyarısı: tür, üst öğenin türüne uymuyorsa beklenen üst tür(ler)i döner, uyuyorsa null */
  function placementIssue(kind, parentKind) {
    const ok = PARENTS[kind] || [null];
    return ok.includes(parentKind || null) ? null : ok;
  }
  /** Öğenin C4 düzeyi (türü yoksa tahmin edilir) */
  function levelOf(ix, x, roleType) {
    return KINDS.includes(x.kind) ? x.kind : inferKind(ix, x, roleType);
  }

  /**
   * Görünüm. Gruplar hiçbir zaman düğüm olmaz; yollarda atlanır.
   * Bir öğe görünümde "temsilcisi" ile gösterilir: odakla ortak atadan sonraki ilk grup olmayan öğe.
   *  - Odak yoksa (C1): kişiler ve sistemler (gruplar ne kadar derin olursa olsun); sistem dışındaki
   *    konteyner/bileşenler sistemlerine toplanır. Sisteme bağlanmamış (yanlış yerleşmiş) öğe kendisi görünür.
   *  - Odak bir sistemse (C2): içindekiler (konteynerler) içeride; ilişkili dış öğeler kendi düzeylerinde dışarıda.
   *  - Odak bir konteynerse (C3): bileşenleri içeride; kardeş konteyner ve diğer sistemler dışarıda.
   * roleType(roleId) → katılımcı tipi (türü olmayan öğede kişi tahmini için).
   */
  function view(items, rels, focusId, roleType = () => '') {
    const ix = index(items);
    const kindOf = (id) => levelOf(ix, ix.byId.get(id), roleType(ix.byId.get(id).role));
    const focus = focusId && ix.byId.get(focusId) && kindOf(focusId) !== 'group' ? focusId : null;
    const focusPath = focus ? ix.path(focus) : [];
    const inside = (id) => !focus || ix.path(id).includes(focus);
    const rep = (id) => {
      const p = ix.path(id);
      let i = 0;
      while (i < p.length && i < focusPath.length && p[i] === focusPath[i]) i++;
      for (; i < p.length; i++) if (kindOf(p[i]) !== 'group') return p[i];
      return null;
    };
    const hasChildren = (id) => items.some((y) => y.id !== id && ix.path(y.id).includes(id) && kindOf(y.id) !== 'group');
    const nodes = new Map();
    const addNode = (id, outer) => {
      if (!id || id === focus || nodes.has(id)) return;
      const x = ix.byId.get(id);
      nodes.set(id, { id, item: x, outer, level: kindOf(id), hasChildren: hasChildren(id) });
    };
    // İç düğümler: odağın içindeki her öğenin temsilcisi (ilişkisi olmasa da görünür)
    items.forEach((x) => { if (x.id !== focus && inside(x.id)) addNode(rep(x.id), false); });
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
      focusLevel: focus ? kindOf(focus) : null,
      // Konum çubuğu: gruplar atlanır
      path: focusPath.filter((id) => kindOf(id) !== 'group').map((id) => ix.byId.get(id)),
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

  // ---- draw.io ----
  const xmlEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const htmlEsc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const DRAWIO_SHAPE = {
    actor: 'rounded=1;arcSize=50;', database: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=8;',
    queue: 'shape=process;size=0.06;', collections: 'shape=process;size=0.06;',
  };
  /**
   * Görünümü düzenlenebilir draw.io dosyasına çevirir. Konumlar ekranda çizilmiş yerleşimden gelir:
   *   layout: { nodes: Map(öğe id → { x, y, w, h }), focus: { x, y, w, h } | null }
   * Sınır (odak) bir kapsayıcıdır; içindeki düğümler onun çocuklarıdır (birlikte taşınır). Oklar kaynak ve
   * hedefe bağlı bağlayıcılardır; draw.io yolları kendisi çizer.
   * opts: toMermaid ile aynı (name, roleOf, levelLabel, maxLabels, more, fill) + { title, background }
   */
  function toDrawio(v, layout, opts) {
    const o = Object.assign({ maxLabels: 2, more: (n) => '+' + n, fill: (c) => c, levelLabel: (l) => '[' + l + ']', title: 'C4' }, opts);
    const cells = [];
    const ids = new Map();
    v.nodes.forEach((n, i) => ids.set(n.id, 'n' + i));
    const fb = layout.focus;
    if (v.focus && fb) {
      const label = '<b>' + htmlEsc(o.name(v.focus)) + '</b> ' + htmlEsc(o.levelLabel(v.focusLevel));
      cells.push(`<mxCell id="focus" value="${xmlEsc(label)}" style="rounded=1;arcSize=2;html=1;dashed=1;dashPattern=8 4;fillColor=none;strokeColor=#8a93a6;verticalAlign=top;align=left;spacingLeft=10;spacingTop=4;container=1;collapsible=0;" vertex="1" parent="1"><mxGeometry x="${Math.round(fb.x)}" y="${Math.round(fb.y)}" width="${Math.round(fb.w)}" height="${Math.round(fb.h)}" as="geometry"/></mxCell>`);
    }
    v.nodes.forEach((n) => {
      const g = layout.nodes.get(n.id);
      if (!g) return;
      const r = o.roleOf(n.item) || {};
      const c = r.color || '#8a93a6';
      const shape = DRAWIO_SHAPE[n.level === 'person' ? 'actor' : r.type] || 'rounded=1;arcSize=12;';
      const lines = ['<b>' + htmlEsc(o.name(n.item)) + '</b>', htmlEsc(o.levelLabel(n.level))];
      if (n.item.desc) lines.push('<font style="font-size:10px">' + htmlEsc(n.item.desc) + '</font>');
      const style = shape + `whiteSpace=wrap;html=1;fillColor=${o.fill(c, n.outer)};strokeColor=${c};strokeWidth=1.5;` + (n.outer ? 'dashed=1;dashPattern=5 3;' : '');
      // Sınırın içindekiler sınıra göre konumlanır
      const inner = v.focus && fb && !n.outer;
      const x = inner ? g.x - fb.x : g.x, y = inner ? g.y - fb.y : g.y;
      cells.push(`<mxCell id="${ids.get(n.id)}" value="${xmlEsc(lines.join('<br>'))}" style="${style}" vertex="1" parent="${inner ? 'focus' : '1'}"><mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${Math.round(g.w)}" height="${Math.round(g.h)}" as="geometry"/></mxCell>`);
    });
    v.edges.forEach((e, i) => {
      if (!layout.nodes.has(e.from) || !layout.nodes.has(e.to)) return;
      const shown = e.labels.slice(0, o.maxLabels).map((l) => htmlEsc(l.text));
      if (e.labels.length > o.maxLabels) shown.push(htmlEsc(o.more(e.labels.length - o.maxLabels)));
      cells.push(`<mxCell id="e${i}" value="${xmlEsc(shown.join('<br>'))}" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;endArrow=block;endFill=1;strokeColor=#6b7280;fontSize=11;labelBackgroundColor=default;" edge="1" parent="1" source="${ids.get(e.from)}" target="${ids.get(e.to)}"><mxGeometry relative="1" as="geometry"/></mxCell>`);
    });
    const all = [...layout.nodes.values()].concat(fb ? [fb] : []);
    const pageW = Math.ceil(Math.max(800, ...all.map((g) => g.x + g.w + 40)));
    const pageH = Math.ceil(Math.max(600, ...all.map((g) => g.y + g.h + 40)));
    const bg = o.background && o.background !== 'transparent' ? ` background="${xmlEsc(o.background)}"` : '';
    return `<mxfile host="SequenceStudio" agent="Sequence Studio" type="device">
  <diagram name="${xmlEsc(o.title)}" id="c4-${Date.now().toString(36)}">
    <mxGraphModel dx="${pageW}" dy="${pageH}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pageW}" pageHeight="${pageH}"${bg} math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
  }

  /** Öğe ve tüm alt öğelerinin kimlikleri */
  function subtree(items, id) {
    const ix = index(items);
    return new Set(items.filter((x) => ix.path(x.id).includes(id)).map((x) => x.id));
  }

  const api = { KINDS, PARENTS, index, relations, view, toMermaid, toDrawio, levelOf, inferKind, defaultKind, placementIssue, subtree };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeqC4 = api;
})(typeof window !== 'undefined' ? window : globalThis);
