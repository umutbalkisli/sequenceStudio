/* Sequence Studio — kod editörü
 *
 * Sözdizimi vurgulama, satır numaraları, hata satırı, satır seçme ve kod → model aktarımı.
 */
(function (Seq) {
  'use strict';
  const { M, S, T, debounce, el, esc, h, ico } = Seq.core;

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

  const codeToModel = debounce(() => Seq.editor.applyCode(el.code.value, 'code'), 260);

  function insertText(t) {
    const ta = el.code;
    ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
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
  }

  Seq.code = { init, selectCodeLine, setCodeStatus, updateEditorDecor };
})(window.Seq = window.Seq || {});
