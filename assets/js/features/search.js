/* Sequence Studio — arama
 *
 * ⌘K arama penceresi: ad, klasör, katılımcı, mesaj/not ve kodda arama; eşleşen adıma gitme.
 */
(function (Seq) {
  'use strict';
  const { $, M, S, T, docCode, el, h, ico, norm, oneLine, timeAgo } = Seq.core;

  // ---------------------------------------------------------------------------
  // Arama (⌘K): diyagram adı, klasör yolu, katılımcılar, mesaj/not metinleri, blok koşulları ve kod
  // ---------------------------------------------------------------------------
  const searchCache = new Map();
 // doc id → { key, entry }
  const folderPath = (id) => { const out = []; for (let f = Seq.drawer.folderById(id); f; f = Seq.drawer.folderById(f.parent)) out.unshift(f.name); return out.join(' / '); };
  function searchEntry(d) {
    const code = docCode(d);
    const key = code.length + ':' + (d.updated || 0) + ':' + d.name + ':' + (d.folder || '') + ':' + S.folders.length;
    const c = searchCache.get(d.id);
    if (c && c.key === key && c.code === code) return c.entry;
    const m = M.parse(code);
    const items = [];
    m.participants.forEach((p, idx) => items.push({ kind: 'participant', text: oneLine(p.label || p.id) + (p.label && p.label !== p.id ? ' (' + p.id + ')' : ''), idx }));
    let mi = 0, ni = 0, bi = 0;
    M.walk(m.items, (it) => {
      if (it.kind === 'message') items.push({ kind: 'message', text: oneLine(it.text), idx: mi++, ctx: it.from + ' → ' + it.to });
      else if (it.kind === 'note') items.push({ kind: 'note', text: oneLine(it.text), idx: ni++ });
      else if (it.kind === 'block') { const i = bi++; it.branches.forEach((br) => { if (br.label && it.type !== 'rect') items.push({ kind: 'block', text: oneLine(br.label), idx: i, ctx: it.type }); }); }
    });
    items.forEach((x) => { x.n = norm(x.text); });
    const path = folderPath(d.folder);
    const entry = { d, path, nName: norm(d.name), nPath: norm(path), nCode: norm(code), items };
    searchCache.set(d.id, { key, code, entry });
    return entry;
  }
  const KIND_WEIGHT = { participant: 10, block: 6, message: 5, note: 5 };
  function runSearch(q) {
    const toks = norm(q).split(/\s+/).filter(Boolean);
    if (!toks.length) return [...S.docs].sort((a, b) => b.updated - a.updated).slice(0, 8).map((d) => ({ e: searchEntry(d), hits: [], score: 0 }));
    const res = [];
    S.docs.forEach((d) => {
      const e = searchEntry(d);
      let score = 0;
      for (const t of toks) {
        let best = 0;
        if (e.nName.includes(t)) best = e.nName.startsWith(t) ? 30 : 20;
        if (!best && e.nPath.includes(t)) best = 8;
        if (!best) for (const it of e.items) if (it.n.includes(t)) best = Math.max(best, KIND_WEIGHT[it.kind] || 3);
        if (!best && e.nCode.includes(t)) best = 1;
        if (!best) return; // tüm kelimeler eşleşmeli
        score += best;
      }
      const order = { message: 0, note: 1, block: 2, participant: 3 };
      const hits = e.items.filter((it) => toks.some((t) => it.n.includes(t))).sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 3);
      res.push({ e, hits, score });
    });
    return res.sort((a, b) => b.score - a.score || (b.e.d.updated || 0) - (a.e.d.updated || 0)).slice(0, 50);
  }
  /** Eşleşen kelimeleri vurgular (normalize uzunluğu değişmediyse) */
  function hl(text, toks) {
    const n = norm(text);
    if (!toks.length || n.length !== text.length) return text;
    const marks = new Array(text.length).fill(false);
    toks.forEach((t) => { let i = n.indexOf(t); while (i >= 0) { for (let k = i; k < i + t.length; k++) marks[k] = true; i = n.indexOf(t, i + 1); } });
    const out = []; let i = 0;
    while (i < text.length) {
      let j = i; while (j < text.length && marks[j] === marks[i]) j++;
      out.push(marks[i] ? h('mark', null, text.slice(i, j)) : text.slice(i, j));
      i = j;
    }
    return out;
  }
  /** Diyagramı açınca eşleşen adımı builder'da seç ve göster */
  function jumpTo(hit) {
    if (!hit) return;
    if (Seq.layout.currentView() !== 'builder') return jumpToCodeLine(hit);
    if (hit.kind === 'participant') {
      const p = S.model.participants[hit.idx];
      if (p) Seq.participants.revealCard(p.uid);
      return;
    }
    let c = { message: 0, note: 0, block: 0 }, target = null;
    M.walk(S.model.items, (it) => {
      if (target) return false;
      if (it.kind === hit.kind && c[it.kind]++ === hit.idx) target = it;
    });
    if (target) Seq.flow.reveal(target.uid);
  }
  /** Kod görünümünde: eşleşen mesaj/not/katılımcı satırını seç (selectCodeLine ile) */
  function jumpToCodeLine(hit) {
    let target = null;
    if (hit.kind === 'participant') {
      const p = S.model.participants[hit.idx];
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (p) { const i = S.code.split('\n').findIndex((l) => new RegExp('^\\s*(participant|actor)\\s+' + esc(p.id) + '\\b').test(l)); if (i >= 0) target = i; }
    } else {
      const c = { message: 0, note: 0, block: 0 };
      M.walk(S.model.items, (it) => { if (target != null) return false; if (it.kind === hit.kind && c[it.kind]++ === hit.idx && it.line != null) target = it.line; });
    }
    if (target != null) Seq.code.selectCodeLine(target);
  }
  let searchUi = null;
  const isOpen = () => !!searchUi && !searchUi.root.hidden;
  function closeSearch() { if (searchUi) { searchUi.root.hidden = true; } }
  function openSearch() {
    Seq.drawer.closeDrawer();
    if (!searchUi) {
      const input = h('input', { class: 'search-input', spellcheck: 'false', autocomplete: 'off' });
      const list = h('div', { class: 'search-results', role: 'listbox' });
      const foot = h('div', { class: 'search-foot' });
      const panel = h('div', { class: 'search-panel' }, h('div', { class: 'search-row' }, ico('search'), input, h('kbd', null, 'Esc')), list, foot);
      const root = h('div', { class: 'search-root', hidden: true }, panel);
      root.addEventListener('pointerdown', (e) => { if (e.target === root) closeSearch(); });
      document.body.append(root);
      searchUi = { root, input, list, foot, results: [], rows: [], active: 0 };
      const go = (r, hit) => {
        closeSearch();
        if (!S.doc || S.doc.id !== r.e.d.id) Seq.docs.openDoc(r.e.d.id);
        requestAnimationFrame(() => jumpTo(hit || r.hits[0]));
      };
      const mark = () => {
        searchUi.rows.forEach((x, i) => x.classList.toggle('active', i === searchUi.active));
        const a = searchUi.rows[searchUi.active];
        if (a) a.scrollIntoView({ block: 'nearest' });
      };
      const draw = () => {
        const q = input.value.trim();
        const toks = norm(q).split(/\s+/).filter(Boolean);
        const results = runSearch(q);
        searchUi.results = results;
        searchUi.active = 0;
        list.innerHTML = '';
        if (!q) list.append(h('div', { class: 'search-sec' }, T('search.recent')));
        if (!results.length) list.append(h('div', { class: 'search-none' }, T('search.none')));
        searchUi.rows = results.map((r, i) => {
          const row = h('div', { class: 'search-item', role: 'option' },
            h('span', { class: 'si-icon' }, ico('logo')),
            h('div', { class: 'si-body' },
              h('div', { class: 'si-name' }, hl(r.e.d.name, toks), r.e.path ? h('span', { class: 'si-path' }, ico('folder'), r.e.path) : null),
              r.hits.map((it) => {
                const sn = h('div', { class: 'si-hit' }, h('span', { class: 'si-kind' }, T('search.kind.' + it.kind)), h('span', { class: 'si-text' }, hl(it.text, toks)), it.ctx ? h('span', { class: 'si-ctx' }, it.ctx) : null);
                sn.addEventListener('click', (e) => { e.stopPropagation(); go(r, it); });
                return sn;
              }),
              !r.hits.length && q && !r.e.nName.includes(toks[0]) && !r.e.nPath.includes(toks[0]) ? h('div', { class: 'si-hit' }, h('span', { class: 'si-kind' }, T('search.kind.code'))) : null),
            h('span', { class: 'si-time' }, timeAgo(r.e.d.updated)));
          row.addEventListener('click', () => go(r));
          row.addEventListener('pointermove', () => { if (searchUi.active !== i) { searchUi.active = i; mark(); } });
          list.append(row);
          return row;
        });
        foot.textContent = (q ? T('search.count', { n: results.length }) + ' · ' : '') + T('search.hint');
        mark();
      };
      input.addEventListener('input', draw);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'ArrowDown') { e.preventDefault(); searchUi.active = Math.min(searchUi.rows.length - 1, searchUi.active + 1); mark(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); searchUi.active = Math.max(0, searchUi.active - 1); mark(); }
        else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const r = searchUi.results[searchUi.active]; if (r) go(r); }
        else if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
        else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); closeSearch(); }
      });
      searchUi.draw = draw;
    }
    // Açık diyagramın son hâli aranabilsin
    if (S.doc && el.code.value !== S.code) Seq.editor.applyCode(el.code.value, 'code');
    searchUi.input.placeholder = T('search.ph');
    searchUi.root.hidden = false;
    searchUi.input.value = '';
    searchUi.draw();
    searchUi.input.focus();
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    $('#btnSearch').addEventListener('click', openSearch);
    $('#btnDrawerSearch').addEventListener('click', openSearch);
  }

  Seq.search = { isOpen, init, closeSearch, folderPath, openSearch, searchUi };
})(window.Seq = window.Seq || {});
