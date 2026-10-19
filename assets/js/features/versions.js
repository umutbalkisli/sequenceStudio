/* Sequence Studio — sürüm geçmişi
 *
 * Diyagram başına otomatik ve elle sürümler, karşılaştırma (önizleme + satır farkı) ve sürüme dönme.
 */
(function (Seq) {
  'use strict';
  const { $, I18N, S, T, add, closeModal, el, h, ico, openModal, timeAgo, toast, events } = Seq.core;

  // ---------------------------------------------------------------------------
  // Sürüm geçmişi (diyagram başına)
  // Otomatik: oturumdaki ilk değişiklikten önceki hâl, düzenleme sürdükçe en fazla 10 dakikada bir,
  // başka diyagrama geçerken ve sekme kapanırken. Değişiklik yoksa sürüm alınmaz.
  // Otomatik sürümlerden son 50'si tutulur; elle kaydedilenler silinmez.
  // ---------------------------------------------------------------------------
  const VERSION_INTERVAL = 10 * 60 * 1000;
  const KEEP_AUTO_VERSIONS = 50;
  const ver = { docId: null, baseline: null, baselineTs: 0, editing: false, lastTs: 0, lastCode: null, loaded: false };
  function beginVersionSession(d) {
    Object.assign(ver, { docId: d.id, baseline: d.code, baselineTs: d.updated || Date.now(), editing: false, lastTs: 0, lastCode: null, loaded: false });
    window.SeqStorage.listVersions(d.id).then((vs) => {
      if (ver.docId !== d.id) return;
      ver.loaded = true;
      if (vs[0]) { ver.lastCode = vs[0].code; ver.lastTs = vs[0].ts; }
    }).catch(() => { ver.loaded = true; });
  }
  function snapshot(kind, code, opts) {
    if (!S.doc) return Promise.resolve(null);
    opts = opts || {};
    const v = { vid: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), docId: S.doc.id, ts: opts.ts || Date.now(), code, name: S.doc.name, kind };
    if (opts.label) v.label = opts.label;
    ver.lastTs = Date.now();
    ver.lastCode = code;
    return window.SeqStorage.addVersion(v, KEEP_AUTO_VERSIONS).catch((e) => { Seq.docs.storageError(e); return null; });
  }
  /** Kayıttan sonra çağrılır; force: diyagramdan çıkarken/kapanırken son hâli sakla. */
  function versionTick(force) {
    if (!S.doc || ver.docId !== S.doc.id || !ver.loaded) return;
    const code = S.doc.code;
    if (!ver.editing) {
      if (code === ver.baseline) return;
      // İlk değişiklik: düzenlemeye başlamadan önceki hâli (daha önce saklanmadıysa) sürüm yap
      ver.editing = true;
      if (ver.lastCode !== ver.baseline) snapshot('auto', ver.baseline, { ts: ver.baselineTs });
      else ver.lastTs = Date.now();
      return;
    }
    if (code === ver.lastCode) return;
    if (force || Date.now() - ver.lastTs >= VERSION_INTERVAL) snapshot('auto', code);
  }

  /**
   * Satır bazlı fark (LCS). Döner: [{ t: ' ' | '-' | '+', s }] (eski → yeni).
   * Satırlar baş/son boşlukları yok sayılarak karşılaştırılır (girinti farkı anlamlı değişiklik değildir).
   */
  function lineDiff(a, b) {
    const A = a.split('\n'), B = b.split('\n');
    const KA = A.map((l) => l.trim()), KB = B.map((l) => l.trim());
    const n = A.length, m = B.length;
    if (n * m > 4e6) return A.map((s) => ({ t: '-', s })).concat(B.map((s) => ({ t: '+', s })));
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = KA[i] === KB[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (KA[i] === KB[j]) { out.push({ t: ' ', s: B[j] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', s: A[i++] });
      else out.push({ t: '+', s: B[j++] });
    }
    while (i < n) out.push({ t: '-', s: A[i++] });
    while (j < m) out.push({ t: '+', s: B[j++] });
    return out;
  }
  const diffStat = (ops) => ({ add: ops.filter((o) => o.t === '+').length, del: ops.filter((o) => o.t === '-').length });

  function openHistory() {
    if (!S.doc) return;
    if (el.code.value !== S.code) Seq.editor.applyCode(el.code.value, 'code');
    if (S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); Seq.docs.persistDocs(); }
    const doc = S.doc;
    const fmtDate = (t) => new Date(t).toLocaleString(I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
    let versions = [], sel = null, tab = 'preview';
    const imgCache = new Map(); // kod → çizilmiş SVG (blob URL)
    const listEl = h('div', { class: 'hist-list' });
    const detailEl = h('div', { class: 'hist-detail' });
    const labelIn = h('input', { class: 'input', placeholder: T('hist.labelPh'), spellcheck: 'false' });
    const saveBtn = h('button', { class: 'btn primary sm', onclick: () => {
      snapshot('manual', S.code, { label: labelIn.value.trim() }).then(() => { labelIn.value = ''; toast(T('hist.saved')); load(); });
    } }, ico('plus'), T('hist.save'));
    labelIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); } });

    const renderImg = (code, box) => {
      box.innerHTML = '';
      box.append(h('span', { class: 'dim-info' }, '…'));
      const show = (url) => { box.innerHTML = ''; box.append(url ? h('img', { src: url, alt: '' }) : h('span', { class: 'dim-info' }, T('hist.renderFail'))); };
      if (imgCache.has(code)) return show(imgCache.get(code));
      Seq.preview.renderDocSvg(code).then((b) => {
        const url = b ? URL.createObjectURL(new Blob([b.markup], { type: 'image/svg+xml' })) : null;
        imgCache.set(code, url);
        show(url);
      }).catch(() => { imgCache.set(code, null); show(null); });
    };
    const drawList = () => {
      listEl.innerHTML = '';
      if (!versions.length) { listEl.append(h('p', { class: 'hist-empty' }, T('hist.empty'))); return; }
      versions.forEach((v) => {
        const st = diffStat(lineDiff(v.code, S.code));
        const same = !st.add && !st.del;
        const row = h('button', { class: 'hist-item' + (sel === v ? ' active' : ''), title: fmtDate(v.ts), onclick: () => { sel = v; drawList(); drawDetail(); } },
          h('div', { class: 'hi-top' }, h('b', null, timeAgo(v.ts)), h('span', { class: 'hi-kind k-' + v.kind }, T('hist.kind.' + v.kind))),
          v.label ? h('div', { class: 'hi-label' }, v.label) : null,
          h('div', { class: 'hi-stat' + (same ? ' same' : '') }, same ? T('hist.same') : [h('span', { class: 'add' }, '+' + st.add), ' ', h('span', { class: 'del' }, '−' + st.del)]));
        listEl.append(row);
      });
    };
    const drawDetail = () => {
      detailEl.innerHTML = '';
      if (!sel) { detailEl.append(h('p', { class: 'hist-empty' }, T('hist.pick'))); return; }
      const tabs = h('div', { class: 'seg' }, [['preview', T('hist.tabPreview')], ['diff', T('hist.tabDiff')]].map(([v, l]) =>
        h('button', { class: tab === v ? 'active' : '', onclick: () => { tab = v; drawDetail(); } }, l)));
      const meta = h('div', { class: 'hist-meta' }, h('b', null, fmtDate(sel.ts)), h('span', { class: 'hi-kind k-' + sel.kind }, T('hist.kind.' + sel.kind)), sel.label ? h('span', null, '· ' + sel.label) : null);
      const content = h('div', { class: 'hist-content' });
      if (tab === 'preview') {
        const a = h('div', { class: 'hist-img' }), b = h('div', { class: 'hist-img' });
        content.append(h('div', { class: 'hist-cmp' },
          h('div', null, h('div', { class: 'hist-cap' }, T('hist.thisVersion')), a),
          h('div', null, h('div', { class: 'hist-cap' }, T('hist.current')), b)));
        renderImg(sel.code, a);
        renderImg(S.code, b);
      } else {
        const ops = lineDiff(sel.code, S.code);
        const pre = h('div', { class: 'hist-diff' });
        if (!ops.some((o) => o.t !== ' ')) pre.append(h('div', { class: 'hd-same' }, T('hist.noDiff')));
        // Değişmeyen uzun bölümleri katla (değişikliklerin çevresinde 2 satır bağlam)
        const keep = ops.map((o, i) => o.t !== ' ' || ops.slice(Math.max(0, i - 2), i + 3).some((x) => x.t !== ' '));
        for (let i = 0; i < ops.length; i++) {
          if (!keep[i]) {
            let j = i; while (j < ops.length && !keep[j]) j++;
            pre.append(h('div', { class: 'hd-skip' }, T('hist.unchanged', { n: j - i })));
            i = j - 1; continue;
          }
          const o = ops[i];
          pre.append(h('div', { class: 'hd-line ' + (o.t === '+' ? 'add' : o.t === '-' ? 'del' : '') }, h('span', { class: 'hd-sign' }, o.t === ' ' ? '' : o.t === '-' ? '−' : '+'), o.s || ' '));
        }
        content.append(h('div', { class: 'hist-cap' }, T('hist.diffFrom')), pre);
      }
      const actions = h('div', { class: 'hist-actions' },
        h('button', { class: 'btn ghost sm danger', onclick: () => {
          if (!confirm(T('hist.confirmDelete'))) return;
          window.SeqStorage.deleteVersion(sel.vid, doc.id).then(load);
        } }, ico('trash'), T('hist.delete')),
        h('div', { class: 'row', style: 'flex:none' },
          h('button', { class: 'btn sm', onclick: () => {
            const v = sel;
            closeModal();
            Seq.docs.createDoc(doc.name + ' (' + fmtDate(v.ts) + ')', v.code, true, doc.folder);
            toast(T('hist.copied'));
          } }, ico('copy'), T('hist.copy')),
          h('button', { class: 'btn primary sm', onclick: () => {
            const v = sel;
            if (S.code === v.code) return;
            // Dönmeden önce şu anki hâli sakla: geri dönüş geri alınabilsin
            snapshot('restore', S.code, { label: T('hist.beforeRestore') }).then(() => {
              closeModal();
              Seq.editor.applyCode(v.code, 'code');
              el.code.value = v.code;
              Seq.editor.flushHistory();
              toast(T('hist.restored'));
            });
          } }, ico('undo'), T('hist.restore'))));
      add(detailEl, h('div', { class: 'hist-dhead' }, meta, tabs), content, actions);
    };
    const load = () => window.SeqStorage.listVersions(doc.id).then((vs) => {
      versions = vs;
      sel = (sel && vs.find((v) => v.vid === sel.vid)) || vs[0] || null;
      drawList(); drawDetail();
    });
    const body = h('div', { class: 'hist' },
      h('div', { class: 'hist-top' }, labelIn, saveBtn),
      h('div', { class: 'hist-main' }, listEl, detailEl),
      h('p', { class: 'note-line' }, ico('help'), T('hist.policy')));
    openModal(T('hist.title', { name: doc.name }), body, true);
    load();
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    // Diyagram yaşam döngüsü: açılınca oturum başlar, kayıtta aralık kontrol edilir, çıkarken son hâl saklanır
    events.on('doc:opened', ({ doc }) => beginVersionSession(doc));
    events.on('doc:saved', () => versionTick(false));
    events.on('doc:leaving', () => versionTick(true));
    events.on('doc:deleted', ({ id }) => window.SeqStorage.deleteVersionsOf(id).catch(Seq.docs.storageError));
    $('#btnHistory').addEventListener('click', openHistory);
  }

  Seq.versions = { init, beginVersionSession, versionTick };
})(window.Seq = window.Seq || {});
