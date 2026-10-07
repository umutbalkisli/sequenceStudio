/*
 * Sequence Studio — diagram model
 * Mermaid sequenceDiagram metni <-> yapılandırılmış model dönüşümü.
 * Tarayıcıda window.SeqModel olarak, Node'da module.exports olarak kullanılabilir.
 */
(function (root) {
  'use strict';

  let uidCounter = 0;
  const uid = () => 'n' + (++uidCounter).toString(36);

  // ---- Sabitler -----------------------------------------------------------

  const PARTICIPANT_TYPES = [
    { v: 'participant', label: 'Participant', hint: 'Servis / bileşen' },
    { v: 'actor', label: 'Actor', hint: 'Kullanıcı / insan' },
    { v: 'boundary', label: 'Boundary', hint: 'Sistem sınırı / UI' },
    { v: 'control', label: 'Control', hint: 'Kontrolcü / orkestratör' },
    { v: 'entity', label: 'Entity', hint: 'Domain nesnesi' },
    { v: 'database', label: 'Database', hint: 'Veritabanı' },
    { v: 'collections', label: 'Collections', hint: 'Çoklu instance' },
    { v: 'queue', label: 'Queue', hint: 'Kuyruk / broker' },
  ];

  const ARROWS = [
    { v: '->>', glyph: '───▶', label: 'Senkron çağrı' },
    { v: '-->>', glyph: '┄┄┄▶', label: 'Yanıt' },
    { v: '-)', glyph: '───⟩', label: 'Asenkron' },
    { v: '--)', glyph: '┄┄┄⟩', label: 'Asenkron (kesik)' },
    { v: '->', glyph: '────', label: 'Düz çizgi' },
    { v: '-->', glyph: '┄┄┄┄', label: 'Kesik çizgi' },
    { v: '-x', glyph: '───✕', label: 'Sonlandır / hata' },
    { v: '--x', glyph: '┄┄┄✕', label: 'Sonlandır (kesik)' },
    { v: '<<->>', glyph: '◀──▶', label: 'Çift yönlü' },
    { v: '<<-->>', glyph: '◀┄┄▶', label: 'Çift yönlü (kesik)' },
  ];
  // Mermaid'in desteklediği yarım oklar — yalnızca okunur/korunur
  const EXTRA_ARROWS = [
    '--|\\', '--|/', '--\\\\', '--//', '/|--', '\\|--', '//--', '\\\\--',
    '-|\\', '-|/', '-\\\\', '-//', '/|-', '\\|-', '//-', '\\\\-',
  ];

  const BLOCK_TYPES = {
    loop: { label: 'Loop', branch: null, hint: 'Döngü' },
    alt: { label: 'Alt', branch: 'else', hint: 'If / else' },
    opt: { label: 'Opt', branch: null, hint: 'Opsiyonel (if)' },
    par: { label: 'Par', branch: 'and', hint: 'Paralel' },
    critical: { label: 'Critical', branch: 'option', hint: 'Kritik bölge' },
    break: { label: 'Break', branch: null, hint: 'Akışı kes' },
    rect: { label: 'Rect', branch: null, hint: 'Vurgu alanı' },
  };

  const NOTE_POSITIONS = ['right of', 'left of', 'over'];

  // ---- Yardımcılar --------------------------------------------------------

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const ALL_ARROWS = ARROWS.map((a) => a.v).concat(EXTRA_ARROWS).sort((a, b) => b.length - a.length);
  const ARROW_RE_SRC = ALL_ARROWS.map(escapeRe).join('|');

  const MSG_RE = new RegExp('^(.+?)\\s*(' + ARROW_RE_SRC + ')\\s*([+-]?)\\s*([^:]+?)\\s*(?::(.*))?$');
  const PART_RE = /^(participant|actor)\s+(.+?)(?:\s*@\{([^}]*)\})?(?:\s+as\s+(.+?))?\s*$/i;
  const NOTE_RE = /^note\s+(right of|left of|over)\s+([^:]+?)\s*:\s?(.*)$/i;
  const ACT_RE = /^(activate|deactivate)\s+(.+?)\s*$/i;
  const BLOCK_RE = /^(loop|alt|opt|par_over|par|critical|break|rect)\b\s*(.*)$/i;
  const BRANCH_RE = /^(else|and|option)\b\s*(.*)$/i;
  const BOX_RE = /^box\b\s*(.*)$/i;
  const TITLE_RE = /^title(?:\s*:\s*|\s+)(.*)$/i;
  const AUTONUM_RE = /^autonumber\b\s*(.*)$/i;
  // Bloğun hemen üstündeki "%% @color #hex" satırı o bloğun rengidir (Mermaid yorum olarak yok sayar)
  const COLOR_RE = /^%%\s*@color\s+(#[0-9a-f]{6})\s*$/i;
  // "%% @auto" ardından gelen activate/deactivate satırları otomatik aktivasyonun ürettiği düzeltmelerdir
  const AUTO_RE = /^%%\s*@auto\s*$/i;

  // Mesaj metninde ; ve # Mermaid için özel karakterlerdir → entity olarak saklanır
  function encodeText(s) {
    return String(s == null ? '' : s).replace(/[#;]/g, (c) => (c === '#' ? '#35;' : '#59;'));
  }
  function decodeText(s) {
    return String(s == null ? '' : s).replace(/#35;/g, '#').replace(/#59;/g, ';');
  }

  const NAMED_COLORS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato transparent turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));

  function parseBoxHeader(rest) {
    rest = rest.trim();
    let m = rest.match(/^(rgba?\([^)]*\)|hsla?\([^)]*\))\s*(.*)$/i);
    if (m) return { color: m[1], label: m[2].trim() };
    m = rest.match(/^(\S+)\s*(.*)$/);
    if (m && NAMED_COLORS.has(m[1].toLowerCase())) return { color: m[1], label: m[2].trim() };
    return { color: '', label: rest };
  }

  function emptyModel() {
    return { frontmatter: '', title: '', autonumber: false, autonumberArgs: '', boxes: [], participants: [], items: [] };
  }

  // ---- Parse --------------------------------------------------------------

  function parse(text) {
    const model = emptyModel();
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let i = 0;

    // Front matter (--- ... ---)
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length && lines[i].trim() === '---') {
      const start = i;
      i++;
      while (i < lines.length && lines[i].trim() !== '---') i++;
      model.frontmatter = lines.slice(start, i + 1).join('\n');
      i++;
    }

    const pMap = new Map();
    const ensureParticipant = (id) => {
      id = id.trim();
      if (!id || pMap.has(id)) return;
      const p = { uid: uid(), id, label: id, type: 'participant', boxId: null, implicit: true };
      pMap.set(id, p);
      model.participants.push(p);
    };

    // stack: { node, list } — list = aktif item dizisi
    const stack = [{ node: null, list: model.items }];
    let box = null;
    let headerSeen = false;
    let messageSeen = false;
    let pendingColor = null;
    let autoNext = false;

    for (; i < lines.length; i++) {
      const rawLine = lines[i];
      const line = rawLine.trim();
      if (!line) continue;
      const top = stack[stack.length - 1];
      const push = (item) => top.list.push(item);

      if (!headerSeen && /^sequenceDiagram\b/i.test(line)) { headerSeen = true; continue; }
      headerSeen = true;

      const autoHere = autoNext;
      autoNext = false;
      if (AUTO_RE.test(line)) { autoNext = true; continue; }

      let m;
      if ((m = line.match(COLOR_RE))) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        const next = j < lines.length ? lines[j].trim().match(BLOCK_RE) : null;
        if (next && next[1].toLowerCase() !== 'rect' && !box) { pendingColor = m[1].toLowerCase(); continue; }
      }
      if (line.startsWith('%%')) { push({ uid: uid(), kind: 'raw', text: line }); continue; }


      if (box) {
        if (/^end$/i.test(line)) { box = null; continue; }
        if ((m = line.match(PART_RE))) { addParticipant(m, box.id); continue; }
        // box içinde beklenmeyen satır — yine de katılımcı değilse ham olarak sakla
        push({ uid: uid(), kind: 'raw', text: line });
        continue;
      }

      if ((m = line.match(TITLE_RE)) && !messageSeen && !model.title) { model.title = m[1].trim(); continue; }

      if ((m = line.match(AUTONUM_RE))) {
        if (!messageSeen && !model.autonumber) { model.autonumber = true; model.autonumberArgs = m[1].trim(); }
        else push({ uid: uid(), kind: 'raw', text: line });
        continue;
      }

      if ((m = line.match(BOX_RE))) {
        const h = parseBoxHeader(m[1]);
        box = { id: uid(), label: h.label, color: h.color };
        model.boxes.push(box);
        continue;
      }

      if ((m = line.match(PART_RE))) { addParticipant(m, null); continue; }

      if ((m = line.match(NOTE_RE))) {
        const targets = m[2].split(',').map((s) => s.trim()).filter(Boolean).slice(0, 2);
        targets.forEach(ensureParticipant);
        push({ uid: uid(), line: i, kind: 'note', position: m[1].toLowerCase(), targets, text: decodeText(m[3]) });
        continue;
      }

      if ((m = line.match(ACT_RE))) {
        ensureParticipant(m[2]);
        const a = { uid: uid(), kind: 'activation', action: m[1].toLowerCase(), participant: m[2].trim() };
        if (autoHere) { a.auto = true; autoNext = true; }
        push(a);
        continue;
      }

      if ((m = line.match(BLOCK_RE))) {
        let type = m[1].toLowerCase();
        const block = { uid: uid(), kind: 'block', type, branches: [{ uid: uid(), label: decodeText(m[2].trim()), items: [] }] };
        if (pendingColor) { block.color = pendingColor; pendingColor = null; }
        push(block);
        stack.push({ node: block, list: block.branches[0].items });
        continue;
      }

      if ((m = line.match(BRANCH_RE)) && top.node) {
        const block = top.node;
        const br = { uid: uid(), label: decodeText(m[2].trim()), items: [] };
        block.branches.push(br);
        top.list = br.items;
        continue;
      }

      if (/^end$/i.test(line)) {
        if (stack.length > 1) stack.pop();
        else push({ uid: uid(), kind: 'raw', text: line });
        continue;
      }

      if ((m = line.match(MSG_RE)) && !/^(create|destroy|links?|properties|details|accTitle|accDescr)\b/i.test(line)) {
        const from = m[1].trim();
        const to = m[4].trim();
        ensureParticipant(from);
        ensureParticipant(to);
        messageSeen = true;
        push({ uid: uid(), line: i, kind: 'message', from, to, arrow: m[2], act: m[3] || '', text: decodeText((m[5] || '').trim()) });
        continue;
      }

      push({ uid: uid(), kind: 'raw', text: line });
    }

    function addParticipant(m, boxId) {
      const keyword = m[1].toLowerCase();
      const id = m[2].trim();
      let type = keyword === 'actor' ? 'actor' : 'participant';
      if (m[3]) {
        const tm = m[3].match(/"?type"?\s*:\s*"?(\w+)"?/i);
        if (tm && PARTICIPANT_TYPES.some((t) => t.v === tm[1].toLowerCase())) type = tm[1].toLowerCase();
      }
      const label = m[4] ? m[4].trim() : id;
      let p = pMap.get(id);
      if (p) {
        // Daha önce örtük eklenmişse güncelle
        Object.assign(p, { label, type, boxId, implicit: false });
      } else {
        p = { uid: uid(), id, label, type, boxId, implicit: false };
        pMap.set(id, p);
        model.participants.push(p);
      }
    }

    // Kullanılmayan boş box'ları temizle
    model.boxes = model.boxes.filter((b) => model.participants.some((p) => p.boxId === b.id));
    return model;
  }

  // ---- Serialize ----------------------------------------------------------

  const IND = '    ';

  function participantLine(p) {
    let s = p.type === 'actor' ? 'actor ' : 'participant ';
    s += p.id;
    if (p.type !== 'actor' && p.type !== 'participant') s += '@{ "type": "' + p.type + '" }';
    if (p.label && p.label !== p.id) s += ' as ' + p.label;
    return s;
  }

  function serialize(model) {
    const out = [];
    if (model.frontmatter) out.push(model.frontmatter);
    out.push('sequenceDiagram');
    if (model.title) out.push(IND + 'title ' + model.title);
    if (model.autonumber) out.push(IND + ('autonumber ' + (model.autonumberArgs || '')).trim());

    const boxes = new Map(model.boxes.map((b) => [b.id, b]));
    const parts = model.participants.filter((p) => !p.implicit);
    let k = 0;
    while (k < parts.length) {
      const p = parts[k];
      const b = p.boxId && boxes.get(p.boxId);
      if (b) {
        out.push(IND + ('box ' + [b.color, b.label].filter(Boolean).join(' ')).trim());
        while (k < parts.length && parts[k].boxId === p.boxId) {
          out.push(IND + IND + participantLine(parts[k]));
          k++;
        }
        out.push(IND + 'end');
      } else {
        out.push(IND + participantLine(p));
        k++;
      }
    }
    if (parts.length && model.items.length) out.push('');
    writeItems(model.items, 1, out);
    return out.join('\n') + '\n';
  }

  function writeItems(items, depth, out) {
    const ind = IND.repeat(depth);
    items.forEach((it, i) => {
      const prev = items[i - 1];
      switch (it.kind) {
        case 'message': {
          const text = encodeText(it.text);
          out.push(ind + it.from + it.arrow + (it.act || '') + it.to + ':' + (text ? ' ' + text : ''));
          break;
        }
        case 'note': {
          const targets = (it.position === 'over' ? it.targets.slice(0, 2) : it.targets.slice(0, 1)).filter(Boolean);
          out.push(ind + 'Note ' + it.position + ' ' + targets.join(',') + ': ' + encodeText(it.text));
          break;
        }
        case 'activation':
          if (it.auto && !(prev && prev.kind === 'activation' && prev.auto)) out.push(ind + '%% @auto');
          out.push(ind + it.action + ' ' + it.participant);
          break;
        case 'block': {
          const def = BLOCK_TYPES[it.type] || BLOCK_TYPES.loop;
          const branchKw = it.type === 'par_over' ? 'and' : def.branch;
          if (it.color && it.type !== 'rect') out.push(ind + '%% @color ' + it.color);
          it.branches.forEach((br, idx) => {
            const kw = idx === 0 ? it.type : branchKw || 'else';
            const lbl = it.type === 'rect' ? br.label : encodeText(br.label);
            out.push(ind + (kw + ' ' + (lbl || '')).trimEnd());
            writeItems(br.items, depth + 1, out);
          });
          out.push(ind + 'end');
          break;
        }
        case 'raw':
          out.push(ind + it.text);
          break;
      }
    });
  }

  // ---- Model yardımcıları -------------------------------------------------

  function walk(items, fn, parentList) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (fn(it, items, i) === false) return false;
      if (it.kind === 'block') {
        for (const br of it.branches) if (walk(br.items, fn) === false) return false;
      }
    }
  }

  function findNode(model, nodeUid) {
    let res = null;
    walk(model.items, (it, list, index) => {
      if (it.uid === nodeUid) { res = { node: it, list, index }; return false; }
      if (it.kind === 'block') {
        for (const br of it.branches) if (br.uid === nodeUid) { res = { branch: br, block: it, list: br.items }; return false; }
      }
    });
    return res;
  }

  function cloneWithNewUids(node) {
    const c = JSON.parse(JSON.stringify(node));
    const re = (n) => {
      n.uid = uid();
      if (n.branches) n.branches.forEach((b) => { b.uid = uid(); b.items.forEach(re); });
    };
    re(c);
    return c;
  }

  const TR_MAP = { 'ı': 'i', 'İ': 'I', 'ş': 's', 'Ş': 'S', 'ğ': 'g', 'Ğ': 'G', 'ç': 'c', 'Ç': 'C', 'ö': 'o', 'Ö': 'O', 'ü': 'u', 'Ü': 'U' };

  function slugify(label) {
    let s = String(label || '')
      .replace(/[ıİşŞğĞçÇöÖüÜ]/g, (c) => TR_MAP[c])
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_]+/g, '');
    if (!s) s = 'P';
    if (/^\d/.test(s)) s = 'P' + s;
    return s;
  }

  /**
   * Mermaid boş blok kollarını ve boş notları çizerken yerleşimi bozuyor.
   * Önizleme için bunları "…" yer tutucularıyla dolduran bir kopya üretir.
   * Gerekmiyorsa null döner.
   */
  const isEmptyBranch = (b) => b.items.every((it) => it.kind === 'activation' && it.auto);
  function previewSafe(model) {
    let needs = false;
    walk(model.items, (it) => {
      if (it.kind === 'block' && it.branches.some(isEmptyBranch)) needs = true;
      if (it.kind === 'note' && !String(it.text).trim()) needs = true;
    });
    if (!needs || !model.participants.length) return null;
    const m = JSON.parse(JSON.stringify(model));
    const ps = m.participants.map((p) => p.id);
    const span = ps.length > 1 ? [ps[0], ps[1]] : [ps[0]];
    walk(m.items, (it) => {
      if (it.kind === 'note' && !String(it.text).trim()) it.text = '…';
      if (it.kind === 'block') {
        it.branches.forEach((b) => {
          if (isEmptyBranch(b)) b.items.unshift({ uid: 'ph', kind: 'note', position: 'over', targets: span, text: '…' });
        });
      }
    });
    return serialize(m);
  }

  // ---- Otomatik aktivasyon --------------------------------------------------

  const isCall = (a) => a === '->>' || a === '->';
  const isReply = (a) => a.startsWith('--');

  /** Mesajlarda elle girilmiş +/- aktivasyon işareti var mı? */
  function hasManualActivation(model) {
    let found = false;
    walk(model.items, (it) => { if (it.kind === 'message' && it.act) { found = true; return false; } });
    return found;
  }

  /**
   * Senkron çağrıları (A->>B) yanıtlarıyla (B-->>A) eşleştirip aktivasyonları çıkarır.
   *
   * Mermaid aktivasyonları kod sırasıyla, doğrusal işler; oysa alt/else gibi
   * kollar birbirinin alternatifidir. Bu yüzden akış, kollara duyarlı olarak
   * simüle edilir ("mantıksal durum" = açık aktivasyon çerçeveleri) ve
   * Mermaid'in doğrusal sayacı mantıksal durumdan saptığı yerlere otomatik
   * activate/deactivate satırları (auto: true) eklenir:
   *  - alt/critical: her kol bloğun başındaki durumdan başlar (kol başına düzeltme).
   *  - opt: gövde + "hiç girilmedi" yolu; break: blok sonrası, girilmeyen yoldan devam eder.
   *  - loop/par/rect: kollar sırayla çalışır.
   *  - Blok sonrası durum, kolların bitiş durumlarının birleşimidir; birleşim ile
   *    doğrusal sayaç arasındaki fark bloktan hemen sonra düzeltilir.
   *  - Bir kolda açık kalıp bloktan sonra hiç kapanmayacak çerçeve kolun sonunda
   *    kapatılır (Mermaid kapanmayan aktivasyonu çizmez).
   * Elle girilmiş activate/deactivate satırları korunur ve hesaba katılır.
   * Değişiklik olduysa true döner.
   */
  function inferActivations(model) {
    const before = serialize(model);

    // 1) Önceki otomatik düzeltmeleri temizle, mesajları sırala
    const strip = (items) => {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === 'activation' && it.auto) items.splice(i, 1);
        else if (it.kind === 'block') it.branches.forEach((b) => strip(b.items));
      }
    };
    strip(model.items);

    const pos = new Map(); // mesaj → doğrusal sıra
    const endPos = new Map(); // blok → son mesajın sırası
    const replyPos = new Map(); // "çağıran>çağrılan" → yanıtların sıraları
    let n = 0;
    const index = (items) => {
      for (const it of items) {
        if (it.kind === 'message') {
          pos.set(it, n++);
          if (isReply(it.arrow) && it.from !== it.to) {
            const k = it.to + '>' + it.from;
            if (!replyPos.has(k)) replyPos.set(k, []);
            replyPos.get(k).push(pos.get(it));
          }
        } else if (it.kind === 'block') {
          it.branches.forEach((b) => index(b.items));
          endPos.set(it, n - 1);
        }
      }
    };
    index(model.items);
    const repliesAfter = (k, p) => (replyPos.get(k) || []).filter((x) => x > p).length;

    // 2) Simülasyon. Çerçeve: { p: aktif katılımcı, k: çağrı anahtarı | null (elle) }
    const lin = new Map(); // Mermaid'in doğrusal sayacı
    const linInc = (p, d) => lin.set(p, (lin.get(p) || 0) + d);
    const ops = []; // { list, at: 'start' | 'end' | node(sonrasına), items }
    const fix = (target) => {
      // doğrusal sayacı hedef durumla eşitleyen satırlar
      const want = new Map();
      target.forEach((f) => want.set(f.p, (want.get(f.p) || 0) + 1));
      const out = [];
      new Set([...lin.keys(), ...want.keys()]).forEach((p) => {
        let d = (want.get(p) || 0) - (lin.get(p) || 0);
        for (; d > 0; d--) { out.push({ uid: uid(), kind: 'activation', action: 'activate', participant: p, auto: true }); linInc(p, 1); }
        for (; d < 0; d++) { out.push({ uid: uid(), kind: 'activation', action: 'deactivate', participant: p, auto: true }); linInc(p, -1); }
      });
      return out;
    };
    const keepIfReplied = (frames, after) => frames.filter((f) => !f.k || repliesAfter(f.k, after) > 0);
    const union = (states) => {
      const out = [];
      states.forEach((st) => st.forEach((f) => { if (!out.includes(f)) out.push(f); }));
      return out;
    };

    const run = (items, st) => {
      for (const it of [...items]) {
        if (it.kind === 'message') {
          const { from, to, arrow } = it;
          it.act = '';
          if (from === to) continue;
          if (isCall(arrow)) {
            const k = from + '>' + to;
            const open = st.filter((f) => f.k === k).length;
            if (repliesAfter(k, pos.get(it)) > open) { it.act = '+'; st.push({ p: to, k }); linInc(to, 1); }
          } else if (isReply(arrow)) {
            const k = to + '>' + from;
            for (let j = st.length - 1; j >= 0; j--) {
              if (st[j].k === k) { st.splice(j, 1); it.act = '-'; linInc(from, -1); break; }
            }
          }
        } else if (it.kind === 'activation') {
          if (it.action === 'activate') { st.push({ p: it.participant, k: null }); linInc(it.participant, 1); }
          else {
            for (let j = st.length - 1; j >= 0; j--) if (st[j].p === it.participant) { st.splice(j, 1); break; }
            if ((lin.get(it.participant) || 0) > 0) linInc(it.participant, -1);
          }
        } else if (it.kind === 'block') {
          runBlock(it, items, st);
        }
      }
    };

    const runBlock = (blk, list, st) => {
      const end = endPos.get(blk);
      const s0 = [...st];
      const alternatives = blk.type === 'alt' || blk.type === 'critical' || blk.type === 'opt' || blk.type === 'break';
      if (!alternatives) {
        blk.branches.forEach((b) => run(b.items, st));
        return;
      }
      const ends = blk.branches.map((b, i) => {
        const bs = [...s0];
        if (i > 0) ops.push({ list: b.items, at: 'start', items: fix(s0) });
        run(b.items, bs);
        // Bu yolda bir daha kapanmayacak çerçeveleri kolun sonunda kapat
        let keep = keepIfReplied(bs, end);
        if (blk.type === 'break') keep = keep.filter((f) => s0.includes(f));
        ops.push({ list: b.items, at: 'end', items: fix(keep) });
        return keep;
      });
      // opt/break: bloğa hiç girilmeyen yol
      let merged;
      if (blk.type === 'break') merged = keepIfReplied(s0, end);
      else merged = keepIfReplied(union(blk.type === 'opt' ? [s0, ...ends] : ends), end);
      ops.push({ list, at: blk, items: fix(merged) });
      st.length = 0;
      st.push(...merged);
    };

    run(model.items, []);

    // 3) Düzeltmeleri yerleştir
    for (const op of ops) {
      if (!op.items.length) continue;
      if (op.at === 'start') op.list.unshift(...op.items);
      else if (op.at === 'end') op.list.push(...op.items);
      else op.list.splice(op.list.indexOf(op.at) + 1, 0, ...op.items);
    }
    return serialize(model) !== before;
  }

  const api = {
    uid, parse, serialize, previewSafe, inferActivations, hasManualActivation, emptyModel, walk, findNode, cloneWithNewUids, slugify,
    encodeText, decodeText, parseBoxHeader,
    PARTICIPANT_TYPES, ARROWS, ALL_ARROWS, BLOCK_TYPES, NOTE_POSITIONS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeqModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
