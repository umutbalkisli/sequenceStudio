/* Sequence Studio — sunum modu
 *
 * Açık akışı tam ekranda adım adım (mesaj mesaj) oynatır. Önizlemedeki çizimin bir kopyası kullanılır; böylece
 * renkler, tonlar, referanslar ve lejant aynen görünür. Sekans diyagramında zaman yukarıdan aşağı aktığından,
 * o anki adımın altı bir "perde" ile soluklaştırılır (ya da gizlenir): sonraki mesajlar, aktivasyon çubuklarının
 * devamı ve henüz başlamamış bloklar adım ilerledikçe açılır. O anki mesaj vurgulanır, altta metni okunur.
 *
 * Klavye: → / Boşluk / Enter ileri, ← / Backspace geri, Home / End baş / son, P oynat / duraklat, Esc kapat.
 */
(function (Seq) {
  'use strict';
  const { $, M, S, T, el, h, ico, oneLine, saveSettings, toast } = Seq.core;
  const NS = 'http://www.w3.org/2000/svg';
  const SPEEDS = [1500, 2500, 4000];

  let ui = null; // açık sunumun durumu

  /**
   * Çizimdeki adımlar (mesajlar ve notlar), zaman (y) sırasıyla.
   * Mesajlar modeldeki sırayla çizilir; sayı tutarsa model mesajıyla eşlenir (alt yazı için).
   * Döner: [{ kind, els: [Element], top, bottom, item? }]
   */
  function collectSteps(svg, model) {
    const msgs = [], notes = [];
    M.walk(model.items, (it) => { if (it.kind === 'message') msgs.push(it); else if (it.kind === 'note') notes.push(it); });
    const lines = Array.from(svg.querySelectorAll('[data-et="message"]'));
    const texts = Array.from(svg.querySelectorAll('text.messageText'));
    const noteGs = Array.from(svg.querySelectorAll('g[data-et="note"]'));
    const box = (els) => {
      const bs = els.map((e) => e.getBBox());
      return { top: Math.min(...bs.map((b) => b.y)), bottom: Math.max(...bs.map((b) => b.y + b.height)) };
    };
    const steps = [];
    lines.forEach((ln, i) => {
      const els = [ln, texts.length === lines.length ? texts[i] : null].filter(Boolean);
      steps.push(Object.assign({ kind: 'message', els, item: lines.length === msgs.length ? msgs[i] : null }, box(els)));
    });
    noteGs.forEach((g, i) => steps.push(Object.assign({ kind: 'note', els: [g], item: noteGs.length === notes.length ? notes[i] : null }, box([g]))));
    return steps.sort((a, b) => a.top - b.top);
  }

  /** Alt yazı: "Müşteri → Order Service: sipariş ver" ya da not metni */
  function caption(step) {
    if (!step) return T('pres.start');
    const name = (id) => { const p = S.model.participants.find((q) => q.id === id); return oneLine(p ? p.label : id); };
    const it = step.item;
    if (step.kind === 'message') {
      const text = it ? oneLine(it.text) : oneLine(step.els[1] ? step.els[1].textContent : '');
      return it ? `${name(it.from)} → ${name(it.to)}${text ? ': ' + text : ''}` : text;
    }
    return it ? `${T('pres.note')} · ${(it.targets || []).map(name).join(', ')}: ${oneLine(it.text)}` : oneLine(step.els[0].textContent);
  }

  function open() {
    if (ui) return;
    const src = $('.paper svg', el.canvas);
    if (!src || !S.lastOk) return toast(T('pres.noDiagram'), 'err');
    Seq.editor.flushHistory();
    const svg = src.cloneNode(true);
    svg.querySelectorAll('.ref-toggle').forEach((n) => n.remove());
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.maxWidth = '';
    const paper = h('div', { class: 'pres-paper' });
    paper.append(svg);
    const stage = h('div', { class: 'pres-stage' }, paper);
    const counter = h('span', { class: 'pres-counter' });
    const cap = h('div', { class: 'pres-caption' });
    const btn = (icon, title, fn, cls) => h('button', { class: 'icon-btn pres-btn' + (cls ? ' ' + cls : ''), title, onclick: fn }, ico(icon));
    const playBtn = btn('play', T('pres.play'), () => togglePlay(), 'pres-play');
    const speed = h('select', { class: 'select sm pres-speed', title: T('pres.speed') },
      SPEEDS.map((ms) => h('option', { value: ms }, (ms / 1000).toLocaleString() + ' sn')));
    speed.value = String(S.settings.presSpeed || 2500);
    speed.addEventListener('change', () => { S.settings.presSpeed = +speed.value; saveSettings(); if (ui.timer) { stopPlay(); togglePlay(); } });
    const dimSel = h('select', { class: 'select sm', title: T('pres.futureTitle') },
      h('option', { value: 'dim' }, T('pres.futureDim')), h('option', { value: 'hide' }, T('pres.futureHide')));
    dimSel.value = S.settings.presFuture === 'hide' ? 'hide' : 'dim';
    dimSel.addEventListener('change', () => { S.settings.presFuture = dimSel.value; saveSettings(); show(); });
    const root = h('div', { class: 'pres-root', role: 'dialog', 'aria-label': T('pres.title') },
      h('div', { class: 'pres-bar' },
        h('div', { class: 'pres-title' }, ico('present'), h('b', null, (S.doc && S.doc.name) || T('pres.title'))),
        h('div', { class: 'pres-controls' },
          btn('first', T('pres.first') + ' (Home)', () => go(0)),
          btn('prev', T('pres.prev') + ' (←)', () => go(ui.i - 1)),
          counter,
          btn('next', T('pres.next') + ' (→)', () => go(ui.i + 1)),
          btn('last', T('pres.last') + ' (End)', () => go(ui.steps.length)),
          h('span', { class: 'ph-sep' }),
          playBtn, speed, dimSel),
        btn('x', T('pres.close') + ' (Esc)', close)),
      stage,
      cap);
    document.body.append(root);
    document.body.classList.add('presenting');

    const steps = collectSteps(svg, S.renderModel || S.model);
    // Perde: o anki adımın altını örter (alttaki katılımcı kutuları ve lejant açık kalır)
    const vb = svg.viewBox.baseVal;
    const floorEls = Array.from(svg.querySelectorAll('.actor-bottom, g.seq-legend'));
    const floor = floorEls.length ? Math.min(...floorEls.map((e) => e.getBBox().y)) - 4 : vb.y + vb.height;
    const curtain = document.createElementNS(NS, 'rect');
    curtain.setAttribute('class', 'pres-curtain');
    curtain.setAttribute('x', vb.x);
    curtain.setAttribute('width', vb.width);
    svg.append(curtain);

    // Seçili mesajdan başla (anlatıma ortadan girmek için)
    let start = 0;
    if (S.selected) {
      const k = steps.findIndex((s) => s.item && s.item.uid === S.selected);
      if (k >= 0) start = k + 1;
    }
    ui = { root, svg, steps, curtain, floor, counter, cap, stage, playBtn, speed, i: start, timer: null };
    stage.addEventListener('click', (e) => { if (!e.target.closest('a')) go(ui.i + 1); });
    document.addEventListener('keydown', onKey, true);
    fit();
    window.addEventListener('resize', fit);
    show();
  }

  /** Çizimi sahnenin genişliğine sığdırır (okunaklı olsun diye en fazla 1,8 kat büyütülür); uzunsa dikey kaydırılır */
  function fit() {
    if (!ui) return;
    const vb = ui.svg.viewBox.baseVal;
    const avail = ui.stage.clientWidth - 56 - 48; // sahne ve kâğıt kenar boşlukları
    const w = Math.max(200, Math.min(avail, vb.width * 1.8));
    ui.svg.style.width = w + 'px';
    ui.svg.style.height = (w * vb.height / vb.width) + 'px';
  }

  function show() {
    const { steps, curtain, floor, counter, cap, svg } = ui;
    const i = Math.max(0, Math.min(ui.i, steps.length));
    ui.i = i;
    svg.querySelectorAll('.pres-current').forEach((e) => e.classList.remove('pres-current'));
    const cur = steps[i - 1] || null;
    if (cur) cur.els.forEach((e) => e.classList.add('pres-current'));
    // Perde: o anki adımın hemen altından başlar; son adımda kalkar
    const cut = i === 0 ? (steps[0] ? steps[0].top - 4 : floor) : cur.bottom + 6;
    const visible = i < steps.length;
    curtain.style.display = visible ? '' : 'none';
    // CSS özelliği olarak verilir ki geçiş animasyonu çalışsın (öznitelik de yedek olarak yazılır)
    curtain.setAttribute('y', cut);
    curtain.setAttribute('height', Math.max(0, floor - cut));
    curtain.style.y = cut + 'px';
    curtain.style.height = Math.max(0, floor - cut) + 'px';
    curtain.classList.toggle('hide', S.settings.presFuture === 'hide');
    counter.textContent = i === 0 ? T('pres.counterStart', { n: steps.length }) : T('pres.counter', { i, n: steps.length });
    cap.textContent = caption(cur);
    cap.classList.toggle('muted', !cur);
    if (cur) {
      // O anki adımı görünür alanın ortasına getir
      const r = cur.els[0].getBoundingClientRect(), sr = ui.stage.getBoundingClientRect();
      if (r.top < sr.top + sr.height * 0.25 || r.bottom > sr.top + sr.height * 0.75) {
        ui.stage.scrollBy({ top: r.top - (sr.top + sr.height / 2), behavior: 'smooth' });
      }
    } else ui.stage.scrollTo({ top: 0, behavior: 'smooth' });
    if (ui.timer && i >= steps.length) stopPlay();
  }
  function go(i) { if (!ui) return; ui.i = i; show(); }

  function togglePlay() {
    if (!ui) return;
    if (ui.timer) return stopPlay();
    if (ui.i >= ui.steps.length) ui.i = 0;
    ui.timer = setInterval(() => go(ui.i + 1), +ui.speed.value || 2500);
    ui.playBtn.classList.add('on');
    ui.playBtn.replaceChildren(ico('pause'));
    ui.playBtn.title = T('pres.pause');
    go(ui.i + 1);
  }
  function stopPlay() {
    clearInterval(ui.timer);
    ui.timer = null;
    ui.playBtn.classList.remove('on');
    ui.playBtn.replaceChildren(ico('play'));
    ui.playBtn.title = T('pres.play');
  }

  /** Sunum açıkken tüm tuşlar burada işlenir (uygulama kısayolları çalışmaz) */
  function onKey(e) {
    if (!ui) return;
    if (e.target.closest && e.target.closest('select')) { if (e.key !== 'Escape') return; }
    const k = e.key;
    const map = {
      ArrowRight: () => go(ui.i + 1), ArrowDown: () => go(ui.i + 1), ' ': () => go(ui.i + 1), Enter: () => go(ui.i + 1), PageDown: () => go(ui.i + 1),
      ArrowLeft: () => go(ui.i - 1), ArrowUp: () => go(ui.i - 1), Backspace: () => go(ui.i - 1), PageUp: () => go(ui.i - 1),
      Home: () => go(0), End: () => go(ui.steps.length), p: togglePlay, P: togglePlay, Escape: close,
    };
    e.stopPropagation();
    if (map[k]) { e.preventDefault(); map[k](); }
  }

  function close() {
    if (!ui) return;
    if (ui.timer) clearInterval(ui.timer);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', fit);
    ui.root.remove();
    document.body.classList.remove('presenting');
    ui = null;
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    $('#btnPresent').addEventListener('click', open);
  }

  Seq.present = { init, close, collectSteps, isOpen: () => !!ui, open };
})(window.Seq = window.Seq || {});
