/* Sequence Studio — çekirdek
 *
 * Uygulama genelinde paylaşılan küçük yapı taşları: DOM yardımcıları (h, $, ico…), bildirim (toast),
 * modal, renk yardımcıları, uygulama durumu (S), ayarlar ve DOM öğe referansları (el).
 * Diğer modüller yalnızca buradan aldıklarına ve birbirlerinin açık API'lerine (Seq.<modül>) bağımlıdır.
 */
(function (Seq) {
  'use strict';

  const M = window.SeqModel;
  const { icon, hydrate } = window.SeqIcons;
  const I18N = window.SeqI18n;
  const T = I18N.t;
  /** Şablonun aktif dildeki sürümü */
  const tplL = (tpl) => tpl[I18N.getLang()] || tpl.tr;

  // ---------------------------------------------------------------------------
  // Yardımcılar
  // ---------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'value') el.value = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  /** null/false değerleri atlayarak çocuk ekler (native append null'ı metne çevirir). */
  function add(parent, ...kids) {
    for (const c of kids.flat()) if (c != null && c !== false) parent.append(c);
    return parent;
  }
  function ico(name) {
    const t = document.createElement('template');
    t.innerHTML = icon(name);
    return t.content.firstChild;
  }
  const debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  function toast(msg, type) {
    const el = h('div', { class: 'toast' + (type === 'err' ? ' err' : '') }, ico(type === 'err' ? 'x' : 'check'), msg);
    $('#toasts').append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 2200);
  }

  function downloadBlob(blob, filename) {
    const a = h('a', { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  const timeAgo = (t) => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return T('time.now');
    if (s < 3600) return T('time.min', { n: Math.floor(s / 60) });
    if (s < 86400) return T('time.hour', { n: Math.floor(s / 3600) });
    return new Date(t).toLocaleDateString(I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // ---------------------------------------------------------------------------
  // Depolama (yalnızca localStorage)
  // ---------------------------------------------------------------------------
  const LS = { docs: 'seqstudio.docs', folders: 'seqstudio.folders', roles: 'seqstudio.roles', cur: 'seqstudio.current', set: 'seqstudio.settings' };
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  const DEFAULT_SETTINGS = { appTheme: 'system', mmTheme: 'auto', mirror: true, colorize: true, editorCollapsed: false, editorW: null, view: 'builder', pinParts: true, palCompact: false, legend: true, exp: { format: 'png', scale: 2, bg: 'theme' } };

  // ---------------------------------------------------------------------------
  // Durum
  // ---------------------------------------------------------------------------
  const S = {
    settings: Object.assign({}, DEFAULT_SETTINGS, store.get(LS.set, {})),
    docs: [], // init() içinde SeqStorage'dan (IndexedDB) yüklenir
    folders: [],
    doc: null,
    code: '',
    model: M.emptyModel(),
    selected: null,
    selectedP: null,
    collapsed: new Set(),
    hist: { stack: [], i: -1, timer: null },
    zoom: { k: 1, x: 0, y: 0, auto: true },
    drag: null,
    linking: false,
    renderSeq: 0,
    lastOk: false,
  };
  S.settings.exp = Object.assign({}, DEFAULT_SETTINGS.exp, S.settings.exp || {});
  const saveSettings = () => store.set(LS.set, S.settings);

  /** Mesaj tonları: ok çizgisi + metin rengi (anlamsal; tema ile uyumlu tonlanır) */
  const TONE_COLORS = { success: '#22a06b', error: '#e5484d', warning: '#e8910c', info: '#3a8dde' };
  const PCOLORS = ['#6c7cff', '#20b8a6', '#f0a020', '#ec5a8f', '#2fbf7f', '#9b6bff', '#3aa0ff', '#f97a3c', '#b5b82c', '#d46bff'];
  /** Katılımcı rengi: kullanıcının seçtiği (p.color) ya da sıraya göre otomatik */
  const colorOf = (id, model = S.model) => {
    const i = model.participants.findIndex((p) => p.id === id);
    if (i < 0) return '#8a93a6';
    return model.participants[i].color || PCOLORS[i % PCOLORS.length];
  };
  const participantById = (id) => S.model.participants.find((p) => p.id === id);

  // ---------------------------------------------------------------------------
  // Elemanlar
  // ---------------------------------------------------------------------------
  hydrate();
  const el = {
    docName: $('#docName'), saveState: $('#saveState'),
    undo: $('#btnUndo'), redo: $('#btnRedo'),
    viewSeg: $('#viewSeg'), viewBuilder: $('#viewBuilder'), viewCode: $('#viewCode'),
    autonum: $('#optAutonumber'), autoAct: $('#optAutoAct'), title: $('#diagramTitle'),
    palP: $('#palParticipants'), palS: $('#palSteps'), palR: $('#palRoles'),
    participants: $('#participants'), flow: $('#flow'), bscroll: $('#builderScroll'),
    partCount: $('#partCount'), stepCount: $('#stepCount'),
    code: $('#code'), codeHl: $('#codeHl'), gutter: $('#gutter'), codeStatus: $('#codeStatus'),
    viewport: $('#viewport'), canvas: $('#canvas'), emptyState: $('#emptyState'), renderError: $('#renderError'),
    zoomVal: $('#zoomVal'), mmTheme: $('#mmTheme'), mirror: $('#optMirror'), colorize: $('#optColorize'), legend: $('#optLegend'),
    popover: $('#popover'), overlay: $('#linkOverlay'), linkPath: $('#linkPath'),
    modalRoot: $('#modalRoot'), modalTitle: $('#modalTitle'), modalBody: $('#modalBody'),
    drawer: $('#drawer'), scrim: $('#scrim'), docList: $('#docList'), fileInput: $('#fileInput'),
  };

  // --- Katılımcı renkleri ---
  const hexToRgb = (hex) => {
    let x = hex.replace('#', '');
    if (x.length === 3) x = x.split('').map((c) => c + c).join('');
    const n = parseInt(x, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  /** a rengini b üzerine t oranında karıştırır (t=1 → a). */
  const mix = (a, b, t) => {
    const A = hexToRgb(a), B = hexToRgb(b);
    return '#' + A.map((v, i) => Math.round(v * t + B[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
  };

  function fitTextarea(ta) {
    if (!ta.isConnected) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + (ta.offsetHeight - ta.clientHeight) + 'px';
  }
  function multiline(ta, opts) {
    const shiftNewline = !opts || opts.shiftNewline !== false;
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      if (e.altKey || (e.shiftKey && shiftNewline)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        ta.setRangeText('\n', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        e.preventDefault(); // tek satırlık input gibi davran; alanın kendi Enter işleyicisi çalışır
      }
    });
    ta.addEventListener('input', () => fitTextarea(ta));
    requestAnimationFrame(() => fitTextarea(ta));
    return ta;
  }

  /** Tek satırlık yerlerde (select, rozet) gösterim için */
  const oneLine = (s) => String(s == null ? '' : s).replace(/\s*\n\s*/g, ' ');
  // ---------------------------------------------------------------------------
  // Katılımcı seçici: aranabilir combobox (kapalıyken eski <select> görünümünde)
  // ---------------------------------------------------------------------------
  /** Türkçe/aksan duyarsız karşılaştırma için normalize */
  const norm = (s) => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Olay yolu: modüller birbirini doğrudan çağırmak yerine yaşam döngüsü olaylarını dinler.
  // Olaylar (yük): doc:leaving {doc} · doc:opened {doc} · doc:saved {doc} · doc:deleted {id}
  //                · doc:renamed {id, from, to} · docs:persisted · roles:changed
  // ---------------------------------------------------------------------------
  const listeners = new Map();
  const events = {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(fn);
      return () => events.off(name, fn);
    },
    off(name, fn) { const l = listeners.get(name); if (l && l.includes(fn)) l.splice(l.indexOf(fn), 1); },
    emit(name, payload) { (listeners.get(name) || []).slice().forEach((fn) => fn(payload || {})); },
  };

  function openModal(title, body, wide) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = '';
    el.modalBody.append(body);
    $('.modal', el.modalRoot).classList.toggle('wide', !!wide);
    el.modalRoot.hidden = false;
  }
  function closeModal() { el.modalRoot.hidden = true; el.modalBody.innerHTML = ''; }

  const fileSafe = (n) => String(n || '').replace(/[\\/:*?"<>|\n\r]+/g, '-').trim() || 'diagram';
  const docCode = (d) => (S.doc && d.id === S.doc.id ? S.code : d.code);

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    el.modalRoot.addEventListener('pointerdown', (e) => { if (e.target === el.modalRoot) closeModal(); });
    $('[data-close]', el.modalRoot).addEventListener('click', closeModal);
  }

  Seq.core = { init, events, $, $$, DEFAULT_SETTINGS, I18N, LS, M, PCOLORS, S, T, TONE_COLORS, add, clamp, closeModal, colorOf, debounce, docCode, downloadBlob, el, esc, fileSafe, fitTextarea, h, hexToRgb, hydrate, ico, icon, isMac, mix, multiline, norm, oneLine, openModal, participantById, saveSettings, store, timeAgo, toast, tplL };
})(window.Seq = window.Seq || {});
