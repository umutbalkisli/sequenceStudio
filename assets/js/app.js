/* ==========================================================================
   Sequence Studio — uygulama
   Runs entirely in the browser; makes no requests to external services.
   ========================================================================== */
(function () {
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

  const DEFAULT_SETTINGS = { appTheme: 'system', mmTheme: 'auto', mirror: true, colorize: true, editorCollapsed: false, editorW: null, view: 'builder', pinParts: true, palCompact: false, exp: { format: 'png', scale: 2, bg: 'theme' } };

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
    zoomVal: $('#zoomVal'), mmTheme: $('#mmTheme'), mirror: $('#optMirror'), colorize: $('#optColorize'),
    popover: $('#popover'), overlay: $('#linkOverlay'), linkPath: $('#linkPath'),
    modalRoot: $('#modalRoot'), modalTitle: $('#modalTitle'), modalBody: $('#modalBody'),
    drawer: $('#drawer'), scrim: $('#scrim'), docList: $('#docList'), fileInput: $('#fileInput'),
  };

  // ---------------------------------------------------------------------------
  // Tema
  // ---------------------------------------------------------------------------
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const appTheme = () => (S.settings.appTheme === 'system' ? (darkMQ.matches ? 'dark' : 'light') : S.settings.appTheme);
  function applyAppTheme() {
    const t = appTheme();
    document.documentElement.dataset.theme = t;
    const b = $('#btnTheme');
    b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
    b.title = T(t === 'dark' ? 'theme.toLight' : 'theme.toDark');
  }
  darkMQ.addEventListener('change', () => {
    if (S.settings.appTheme === 'system') { applyAppTheme(); configureMermaid(); scheduleRender(0); }
  });

  // ---------------------------------------------------------------------------
  // Mermaid yapılandırması
  // ---------------------------------------------------------------------------
  const FONT = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const STUDIO = {
    'studio-light': {
      background: '#ffffff', fontFamily: FONT, fontSize: '14px',
      primaryColor: '#eef0ff', primaryBorderColor: '#6c7cff', primaryTextColor: '#1b2030',
      secondaryColor: '#f4f5f8', tertiaryColor: '#f8f9fb', lineColor: '#4b5368', textColor: '#1b2030',
      actorBkg: '#eef0ff', actorBorder: '#6c7cff', actorTextColor: '#1b2030', actorLineColor: '#c4c9d6',
      signalColor: '#3b4255', signalTextColor: '#1b2030',
      labelBoxBkgColor: '#fff3dc', labelBoxBorderColor: '#f0a020', labelTextColor: '#7a4b00', loopTextColor: '#4b5368',
      noteBkgColor: '#fff8d6', noteBorderColor: '#e5c454', noteTextColor: '#4a3d00',
      activationBkgColor: '#e3e7ff', activationBorderColor: '#6c7cff', sequenceNumberColor: '#ffffff',
    },
    'studio-dark': {
      darkMode: true, background: '#12151c', fontFamily: FONT, fontSize: '14px',
      primaryColor: '#1f2647', primaryBorderColor: '#7c8cff', primaryTextColor: '#e7eaf1',
      secondaryColor: '#1b2030', tertiaryColor: '#171b24', lineColor: '#9aa3b5', textColor: '#e7eaf1',
      actorBkg: '#1c2242', actorBorder: '#7c8cff', actorTextColor: '#e7eaf1', actorLineColor: '#384157',
      signalColor: '#c4cad8', signalTextColor: '#e7eaf1',
      labelBoxBkgColor: '#3a2c10', labelBoxBorderColor: '#f0a020', labelTextColor: '#ffd58a', loopTextColor: '#c4cad8',
      noteBkgColor: '#2d2a17', noteBorderColor: '#a08c3c', noteTextColor: '#f2e8bb',
      activationBkgColor: '#283063', activationBorderColor: '#7c8cff', sequenceNumberColor: '#12151c',
    },
  };
  const PAPER_BG = { 'studio-light': '#ffffff', 'studio-dark': '#12151c', default: '#ffffff', neutral: '#ffffff', forest: '#ffffff', dark: '#333333' };
  const STUDIO_CSS = `
    rect.actor, .actor-man circle, rect.note, rect.labelBox { stroke-width: 1.4px; }
    rect.actor { rx: 8px; ry: 8px; }
    rect.note { rx: 6px; ry: 6px; }
    text.actor > tspan { font-weight: 600; }
    .messageText { font-weight: 500; }
    .labelText, .labelText > tspan { font-weight: 700; letter-spacing: .03em; }
    .loopText, .loopText > tspan, .sectionTitle, .sectionTitle > tspan { font-style: italic; }
  `;

  const mmThemeName = () => (S.settings.mmTheme === 'auto' ? (appTheme() === 'dark' ? 'studio-dark' : 'studio-light') : S.settings.mmTheme);

  function configureMermaid() {
    const t = mmThemeName();
    const cfg = {
      startOnLoad: false,
      securityLevel: 'strict',
      fontFamily: FONT,
      htmlLabels: false,
      sequence: {
        useMaxWidth: false, mirrorActors: !!S.settings.mirror, actorMargin: 64, boxMargin: 10, noteMargin: 12,
        messageMargin: 38, boxTextMargin: 6, diagramMarginX: 24, diagramMarginY: 16, wrap: false,
      },
    };
    if (STUDIO[t]) { cfg.theme = 'base'; cfg.themeVariables = STUDIO[t]; cfg.themeCSS = STUDIO_CSS; }
    else cfg.theme = t;
    mermaid.initialize(cfg);
    el.canvas.style.setProperty('--paper-bg', PAPER_BG[t] || '#ffffff');
  }

  // ---------------------------------------------------------------------------
  // Çekirdek: kod <-> model akışı
  // ---------------------------------------------------------------------------
  function applyCode(code, src) {
    S.code = code;
    if (src !== 'builder') {
      S.model = M.parse(code);
      renderBuilder();
    }
    if (src !== 'code' && el.code.value !== code) el.code.value = code;
    updateEditorDecor();
    syncMeta();
    scheduleRender();
    scheduleSave();
    if (src !== 'history' && src !== 'load') scheduleHistory();
  }

  /** Builder modeli değiştirdikten sonra çağrılır. */
  function commit(opts) {
    opts = opts || {};
    if (isAutoAct()) M.inferActivations(S.model);
    applyCode(M.serialize(S.model), 'builder');
    if (opts.rerender !== false) renderBuilder();
  }

  /** Belge için otomatik aktivasyon açık mı? (varsayılan: açık) */
  const isAutoAct = () => !!S.doc && S.doc.autoAct !== false;
  /** Otomatik moddaysa aktivasyonları yeniden hesaplar; kod değiştiyse uygular. */
  function refreshAutoAct(src) {
    if (!isAutoAct() || !M.inferActivations(S.model)) return false;
    applyCode(M.serialize(S.model), src || 'builder');
    renderBuilder();
    return true;
  }

  function syncMeta() {
    el.autonum.checked = !!S.model.autonumber;
    el.autoAct.checked = isAutoAct();
    if (document.activeElement !== el.title && el.title.value !== (S.model.title || '')) el.title.value = S.model.title || '';
  }

  // ---------------------------------------------------------------------------
  // Geçmiş (undo / redo)
  // ---------------------------------------------------------------------------
  const H = S.hist;
  function scheduleHistory() { clearTimeout(H.timer); H.timer = setTimeout(flushHistory, 450); }
  function flushHistory() {
    clearTimeout(H.timer); H.timer = null;
    if (H.stack[H.i] === S.code) return;
    H.stack = H.stack.slice(0, H.i + 1);
    H.stack.push(S.code);
    if (H.stack.length > 300) H.stack.shift();
    H.i = H.stack.length - 1;
    updateUndoUi();
  }
  function resetHistory() { H.stack = [S.code]; H.i = 0; updateUndoUi(); }
  function undo() { flushHistory(); if (H.i <= 0) return; H.i--; applyCode(H.stack[H.i], 'history'); updateUndoUi(); }
  function redo() { flushHistory(); if (H.i >= H.stack.length - 1) return; H.i++; applyCode(H.stack[H.i], 'history'); updateUndoUi(); }
  function updateUndoUi() { el.undo.disabled = H.i <= 0; el.redo.disabled = H.i >= H.stack.length - 1; }

  // ---------------------------------------------------------------------------
  // Belgeler
  // ---------------------------------------------------------------------------
  const newDocId = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // Depolama hatası bildirimi (art arda gelen hatalarda tek bildirim)
  let lastStorageErr = 0;
  function storageError(err) {
    console.error('[storage]', err);
    if (Date.now() - lastStorageErr < 5000) return;
    lastStorageErr = Date.now();
    const quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.message || err)));
    toast(T(quota ? 'storage.full' : 'storage.error'), 'err');
  }
  /** Diyagram ve klasörleri kaydeder (IndexedDB'de yalnızca değişenler yazılır). */
  function persistDocs() {
    window.SeqStorage.saveDocs(S.docs).catch(storageError);
    window.SeqStorage.saveKV('folders', S.folders).catch(storageError);
    store.set(LS.cur, S.doc && S.doc.id);
    scheduleBackupUi();
  }
  /**
   * IndexedDB yazmaları asenkron olduğundan sayfa kapanırken son değişiklik yetişmeyebilir: açık diyagram
   * senkron olarak localStorage'a da yazılır; sonraki açılışta kayıtlı sürümden yeniyse uygulanır.
   */
  const RESCUE_KEY = 'seqstudio.rescue';
  function writeRescue() {
    if (!S.doc) return;
    // Kod editörü modele gecikmeli aktarılır: kapanırken editördeki son metni al
    if (el.code.value !== S.code) applyCode(el.code.value, 'code');
    if (S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
    store.set(RESCUE_KEY, S.doc);
    persistDocs();
    versionTick(true);
  }
  function applyRescue() {
    const r = store.get(RESCUE_KEY, null);
    if (!r || !r.id) return;
    const d = S.docs.find((x) => x.id === r.id);
    if (!d) S.docs.unshift(r);
    else if ((r.updated || 0) > (d.updated || 0)) Object.assign(d, r);
    else { localStorage.removeItem(RESCUE_KEY); return; }
    window.SeqStorage.saveDocs(S.docs).then(() => localStorage.removeItem(RESCUE_KEY)).catch(storageError);
  }
  const doSave = debounce(() => {
    if (!S.doc) return;
    if (S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
    persistDocs();
    versionTick(false);
    el.saveState.classList.remove('dirty');
    el.saveState.lastChild.textContent = T('tb.saved');
  }, 500);
  function scheduleSave() {
    el.saveState.classList.add('dirty');
    el.saveState.lastChild.textContent = T('tb.saving');
    doSave();
  }

  function createDoc(name, code, open, folder) {
    // Kodda elle girilmiş aktivasyon işaretleri varsa onlara dokunma
    const d = { id: newDocId(), name: uniqueDocName(name), code, updated: Date.now(), autoAct: !M.hasManualActivation(M.parse(code)) };
    if (folder) d.folder = folder;
    S.docs.unshift(d);
    persistDocs();
    if (open !== false) openDoc(d.id);
    return d;
  }
  function uniqueDocName(name) {
    name = (name || T('doc.untitled')).trim();
    let n = name, k = 2;
    while (S.docs.some((d) => d.name === n)) n = name + ' (' + k++ + ')';
    return n;
  }
  function openDoc(id) {
    if (S.doc && S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
    versionTick(true); // önceki diyagramdan çıkarken son hâlini sürüm olarak sakla
    const d = S.docs.find((x) => x.id === id) || S.docs[0];
    S.doc = d;
    beginVersionSession(d);
    if (!nav.keep) nav.stack = []; // bağlantıyla gelinmediyse geri dönüş yığını sıfırlanır
    S.selected = null;
    S.collapsed.clear();
    el.docName.value = d.name;
    S.zoom.auto = true;
    if (d.autoAct === undefined) d.autoAct = !M.hasManualActivation(M.parse(d.code));
    applyCode(d.code, 'load');
    refreshAutoAct('load');
    resetHistory();
    persistDocs();
    renderDocList();
    updateNavBack();
  }
  function deleteDoc(id) {
    const d = S.docs.find((x) => x.id === id);
    if (!d || !confirm(T('doc.confirmDelete', { name: d.name }))) return;
    S.docs = S.docs.filter((x) => x.id !== id);
    window.SeqStorage.deleteVersionsOf(id).catch(storageError);
    if (!S.docs.length) createDoc(T('doc.untitled'), tplL(window.SeqTemplates[0]).code, false);
    if (S.doc.id === id) { S.doc = null; openDoc(S.docs[0].id); }
    // Açık diyagram silinen diyagrama bağlanıyorsa referans hemen "kopuk" görünsün
    else if (S.code.includes('@ref ' + id)) { renderBuilder(); scheduleRender(0); }
    persistDocs();
    renderDocList();
  }
  // Klasörler (iç içe). Belge d.folder ile, klasör f.parent ile üst klasörüne bağlanır; yoksa kökte durur.
  const folderById = (id) => id && S.folders.find((f) => f.id === id);
  const childFolders = (parentId) => S.folders.filter((f) => (f.parent || null) === (parentId || null))
    .sort((a, b) => a.name.localeCompare(b.name, I18N.getLang()));
  /** a, b'nin kendisi ya da alt klasörü mü? */
  const isWithin = (a, b) => { for (let f = folderById(a); f; f = folderById(f.parent)) if (f.id === b) return true; return false; };
  /** Klasörü ve tüm üst klasörlerini aç */
  const expandTo = (id) => { for (let f = folderById(id); f; f = folderById(f.parent)) f.collapsed = false; };
  /** Klasör ve alt klasörlerindeki toplam diyagram */
  const folderDocCount = (id) => S.docs.filter((d) => d.folder && isWithin(d.folder, id)).length;
  /** Ağaç sırasında klasörler (taşıma menüsü için) */
  const folderTree = (parentId, depth = 0) => childFolders(parentId).flatMap((f) => [{ f, depth }, ...folderTree(f.id, depth + 1)]);

  function createFolder(parentId) {
    const base = T('folder.new');
    const siblings = childFolders(parentId);
    let n = base, k = 2;
    while (siblings.some((f) => f.name === n)) n = base + ' (' + k++ + ')';
    const f = { id: 'f' + newDocId().slice(1), name: n, collapsed: false };
    if (parentId) { f.parent = parentId; expandTo(parentId); }
    S.folders.push(f);
    persistDocs();
    renderDocList(f.id);
    return f;
  }
  function deleteFolder(id) {
    const f = folderById(id);
    if (!f) return;
    const nDocs = S.docs.filter((d) => d.folder === id).length;
    const nSub = S.folders.filter((x) => x.parent === id).length;
    if ((nDocs || nSub) && !confirm(T('folder.confirmDelete', { name: f.name, n: nDocs, m: nSub }))) return;
    // İçerik bir üst seviyeye çıkar
    S.docs.forEach((d) => { if (d.folder === id) { if (f.parent) d.folder = f.parent; else delete d.folder; } });
    S.folders.forEach((x) => { if (x.parent === id) { if (f.parent) x.parent = f.parent; else delete x.parent; } });
    S.folders = S.folders.filter((x) => x.id !== id);
    persistDocs();
    renderDocList();
  }
  function moveDoc(docId, folderId) {
    const d = S.docs.find((x) => x.id === docId);
    if (!d || (d.folder || null) === (folderId || null)) return;
    if (folderId) d.folder = folderId; else delete d.folder;
    expandTo(folderId);
    persistDocs();
    renderDocList();
  }
  function moveFolder(id, parentId) {
    const f = folderById(id);
    if (!f || (f.parent || null) === (parentId || null) || (parentId && isWithin(parentId, id))) return;
    if (parentId) f.parent = parentId; else delete f.parent;
    expandTo(parentId);
    persistDocs();
    renderDocList();
  }

  /** Sürükle-bırak: diyagram ya da klasör, bir klasöre veya kök alanına bırakılır. */
  let draggingFolder = null;
  function docDropZone(node, folderId) {
    const accepts = (e) => {
      const t = e.dataTransfer.types;
      if (t.includes('text/x-seq-doc')) return true;
      return t.includes('text/x-seq-folder') && draggingFolder && !(folderId && isWithin(folderId, draggingFolder));
    };
    node.addEventListener('dragover', (e) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      $$('.drop-over', el.drawer).forEach((x) => { if (x !== node) x.classList.remove('drop-over'); });
      node.classList.add('drop-over');
    });
    node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove('drop-over'); });
    node.addEventListener('drop', (e) => {
      const docId = e.dataTransfer.getData('text/x-seq-doc');
      const fId = e.dataTransfer.getData('text/x-seq-folder');
      if (!docId && !fId) return;
      e.preventDefault();
      e.stopPropagation();
      node.classList.remove('drop-over');
      if (docId) moveDoc(docId, folderId);
      else moveFolder(fId, folderId);
    });
  }

  function closeMoveMenu() { $$('.move-menu', el.drawer).forEach((m) => m.remove()); }
  function openMoveMenu(btn, d) {
    const row = btn.closest('.doc-item');
    const had = row.querySelector('.move-menu');
    closeMoveMenu();
    if (had) return;
    const opt = (label, icn, folderId) => h('button', {
      class: 'mm-opt' + ((d.folder || null) === (folderId || null) ? ' current' : ''),
      onclick: (e) => { e.stopPropagation(); closeMoveMenu(); moveDoc(d.id, folderId); },
    }, ico(icn), h('span', null, label));
    const menu = h('div', { class: 'move-menu', onclick: (e) => e.stopPropagation() },
      h('div', { class: 'mm-title' }, T('folder.moveTo')),
      opt(T('folder.root'), 'menu', null),
      folderTree(null).map(({ f, depth }) => {
        const o = opt(f.name, 'folder', f.id);
        o.style.paddingLeft = 8 + depth * 16 + 'px';
        return o;
      }),
      h('button', { class: 'mm-opt', onclick: (e) => {
        e.stopPropagation();
        closeMoveMenu();
        moveDoc(d.id, createFolder().id);
      } }, ico('folderPlus'), h('span', null, T('folder.newEllipsis'))));
    row.append(menu);
  }

  function renderDocItem(d) {
    const item = h('div', { class: 'doc-item' + (S.doc && d.id === S.doc.id ? ' active' : ''), draggable: 'true', onclick: () => { openDoc(d.id); closeDrawer(); } },
      h('span', { class: 'di-icon' }, ico('logo')),
      h('div', { class: 'di-text' }, h('div', { class: 'di-name' }, d.name), h('div', { class: 'di-meta' }, timeAgo(d.updated))),
      h('div', { class: 'di-actions' },
        h('button', { class: 'icon-btn sm', title: T('folder.moveTo'), onclick: (e) => { e.stopPropagation(); openMoveMenu(e.currentTarget, d); } }, ico('folderMove')),
        h('button', { class: 'icon-btn sm', title: T('duplicate'), onclick: (e) => { e.stopPropagation(); createDoc(d.name + T('doc.copySuffix'), d.id === S.doc.id ? S.code : d.code, false, d.folder); renderDocList(); } }, ico('copy')),
        h('button', { class: 'icon-btn sm', title: T('delete'), onclick: (e) => { e.stopPropagation(); deleteDoc(d.id); } }, ico('trash'))));
    item.addEventListener('dragstart', (e) => {
      closeMoveMenu();
      e.dataTransfer.setData('text/x-seq-doc', d.id);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => item.classList.add('dragging'));
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      $$('.drop-over', el.drawer).forEach((x) => x.classList.remove('drop-over'));
    });
    return item;
  }

  function startFolderRename(f, nameEl) {
    const input = h('input', { class: 'fh-input', value: f.name, spellcheck: 'false' });
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== f.name) { f.name = v; persistDocs(); }
      renderDocList();
    };
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    const head = nameEl.closest('.folder-head');
    if (head) head.draggable = false; // giriş alanında metin seçimi sürüklemeye dönüşmesin
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  function renderFolder(f, docs, renameId) {
    const name = h('span', { class: 'fh-name' }, f.name);
    const subs = childFolders(f.id);
    const own = docs.filter((d) => d.folder === f.id);
    const head = h('div', { class: 'folder-head', role: 'button', draggable: 'true', 'aria-expanded': String(!f.collapsed),
      onclick: () => { f.collapsed = !f.collapsed; persistDocs(); renderDocList(); } },
      h('span', { class: 'fh-chev' }, ico('chevron')),
      h('span', { class: 'fh-icon' }, ico('folder')),
      name,
      h('span', { class: 'fh-count', title: T('folder.countTitle') }, folderDocCount(f.id)),
      h('div', { class: 'di-actions' },
        h('button', { class: 'icon-btn sm', title: T('folder.newDoc'), onclick: (e) => {
          e.stopPropagation();
          createDoc(T('doc.untitled'), tplL(window.SeqTemplates[0]).code, true, f.id);
          closeDrawer();
        } }, ico('plus')),
        h('button', { class: 'icon-btn sm', title: T('folder.newSub'), onclick: (e) => { e.stopPropagation(); createFolder(f.id); } }, ico('folderPlus')),
        h('button', { class: 'icon-btn sm', title: T('fx.title'), onclick: (e) => { e.stopPropagation(); closeDrawer(); openFolderExport(f.id); } }, ico('download')),
        h('button', { class: 'icon-btn sm', title: T('folder.rename'), onclick: (e) => { e.stopPropagation(); startFolderRename(f, name); } }, ico('edit')),
        h('button', { class: 'icon-btn sm', title: T('folder.delete'), onclick: (e) => { e.stopPropagation(); deleteFolder(f.id); } }, ico('trash'))));
    name.addEventListener('dblclick', (e) => { e.stopPropagation(); startFolderRename(f, name); });
    head.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      closeMoveMenu();
      draggingFolder = f.id;
      e.dataTransfer.setData('text/x-seq-folder', f.id);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => box.classList.add('dragging'));
    });
    head.addEventListener('dragend', () => {
      draggingFolder = null;
      box.classList.remove('dragging');
      $$('.drop-over', el.drawer).forEach((x) => x.classList.remove('drop-over'));
    });
    const box = h('div', { class: 'folder' + (f.collapsed ? ' collapsed' : '') }, head);
    if (!f.collapsed) {
      box.append(subs.length || own.length
        ? h('div', { class: 'folder-body' }, subs.map((sf) => renderFolder(sf, docs, renameId)), own.map(renderDocItem))
        : h('div', { class: 'folder-empty' }, T('folder.empty')));
    }
    docDropZone(box, f.id);
    if (renameId === f.id) requestAnimationFrame(() => startFolderRename(f, name));
    return box;
  }

  function renderDocList(renameId) {
    hideNameTip();
    el.docList.innerHTML = '';
    // Silinmiş klasörlere işaret eden belge/klasörleri köke al; döngüleri kır
    S.docs.forEach((d) => { if (d.folder && !folderById(d.folder)) delete d.folder; });
    S.folders.forEach((f) => {
      if (f.parent && (!folderById(f.parent) || isWithin(f.parent, f.id))) delete f.parent;
    });
    const docs = [...S.docs].sort((a, b) => b.updated - a.updated);
    childFolders(null).forEach((f) => el.docList.append(renderFolder(f, docs, renameId)));
    const root = docs.filter((d) => !d.folder);
    if (S.folders.length) el.docList.append(h('div', { class: 'root-label' }, T('folder.root')));
    const rootBox = h('div', { class: 'root-docs' }, root.map(renderDocItem));
    if (S.folders.length && !root.length) rootBox.append(h('div', { class: 'folder-empty' }, T('folder.rootEmpty')));
    el.docList.append(rootBox);
  }
  // Kesilmiş (2 satıra sığmayan) diyagram/klasör adlarının tamamını hover'da gösterir
  const nameTip = h('div', { class: 'name-tip', role: 'tooltip', hidden: true });
  document.body.append(nameTip);
  let nameTipTimer = null;
  function hideNameTip() { clearTimeout(nameTipTimer); nameTip.hidden = true; }
  el.docList.addEventListener('mouseover', (e) => {
    const n = e.target.closest('.di-name, .fh-name');
    if (!n || n.contains(e.relatedTarget)) return;
    hideNameTip();
    if (n.scrollHeight <= n.clientHeight + 1) return; // kesilmemiş
    nameTipTimer = setTimeout(() => {
      if (!n.isConnected || !n.matches(':hover')) return;
      nameTip.textContent = n.textContent;
      nameTip.hidden = false;
      const r = n.getBoundingClientRect();
      const w = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
      nameTip.style.width = w + 'px';
      const left = clamp(r.left - 10, 8, window.innerWidth - w - 8);
      const below = r.bottom + 6;
      const top = below + nameTip.offsetHeight > window.innerHeight - 8 ? r.top - nameTip.offsetHeight - 6 : below;
      nameTip.style.left = left + 'px';
      nameTip.style.top = Math.max(8, top) + 'px';
    }, 300);
  });
  el.docList.addEventListener('mouseout', (e) => {
    const n = e.target.closest('.di-name, .fh-name');
    if (n && !n.contains(e.relatedTarget)) hideNameTip();
  });
  el.docList.addEventListener('scroll', hideNameTip, { passive: true });
  el.docList.addEventListener('dragstart', hideNameTip);

  function openDrawer() {
    // Açık belgenin klasörünü göster
    if (S.doc && S.doc.folder) { expandTo(S.doc.folder); persistDocs(); }
    renderDocList();
    refreshBackupUi();
    el.drawer.classList.add('open');
    el.scrim.classList.add('show');
  }
  function closeDrawer() { hideNameTip(); closeMoveMenu(); el.drawer.classList.remove('open'); el.scrim.classList.remove('show'); }

  // ---------------------------------------------------------------------------
  // Önizleme (render + pan/zoom)
  // ---------------------------------------------------------------------------
  let renderTimer;
  function scheduleRender(ms) { clearTimeout(renderTimer); renderTimer = setTimeout(renderPreview, ms == null ? 160 : ms); }

  async function renderPreview() {
    const seq = ++S.renderSeq;
    const code = S.code;
    const empty = !S.model.participants.length && !S.model.items.length;
    el.emptyState.hidden = !empty;
    if (empty) {
      el.canvas.innerHTML = '';
      el.renderError.hidden = true;
      setCodeStatus(true);
      return;
    }
    const id = 'mmd' + seq;
    try {
      await mermaid.parse(code);
      const safeModel = renderableModel(S.model);
      const { svg } = await mermaid.render(id, safeModel ? M.serialize(safeModel) : code);
      if (seq !== S.renderSeq) return;
      S.renderModel = safeModel || S.model; // önizlemede çizilen model (yer tutucu notlar dahil)
      el.canvas.innerHTML = '<div class="paper">' + svg + '</div>';
      colorizeSvg($('.paper svg', el.canvas), S.settings.colorize);
      colorizeBlocks($('.paper svg', el.canvas), S.settings.colorize);
      colorizeMessages($('.paper svg', el.canvas));
      decorateRefs($('.paper svg', el.canvas), S.renderModel);
      el.canvas.classList.remove('stale');
      el.renderError.hidden = true;
      S.lastOk = true;
      setCodeStatus(true);
      if (S.zoom.auto) fitView(); else applyZoom();
    } catch (err) {
      const stray = document.getElementById('d' + id);
      if (stray) stray.remove();
      if (seq !== S.renderSeq) return;
      const msg = String((err && (err.message || err.str)) || err);
      el.canvas.classList.add('stale');
      S.lastOk = false;
      el.renderError.hidden = false;
      el.renderError.innerHTML = '';
      el.renderError.append(ico('critical'), h('div', null, h('b', null, T('render.failed')), h('pre', null, msg.slice(0, 600))));
      setCodeStatus(false, msg);
    }
  }

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

  /**
   * Önizlemedeki katılımcı başlıklarını, lifeline'ları ve aktivasyon çubuklarını
   * builder'daki renklerle boyar. Mermaid'in SVG yapısı tipe göre değiştiği için
   * her şekil yatayda en yakın lifeline'ın katılımcısına atanır. Stiller satır içi
   * yazıldığından PNG/SVG dışa aktarmaya da yansır.
   * "Renkli" kapalıyken (auto=false) yalnızca rengi elle seçilmiş katılımcılar boyanır.
   */
  function colorizeSvg(svg, auto, model = S.model) {
    if (!svg) return;
    const pById = (id) => model.participants.find((p) => p.id === id);
    const colorOfM = (id) => colorOf(id, model);
    const painted = (id) => auto || !!(pById(id) || {}).color;
    if (!auto && !model.participants.some((p) => p.color)) return;
    const bg = PAPER_BG[mmThemeName()] || '#ffffff';
    const dark = hexToRgb(bg).reduce((a, v) => a + v, 0) < 384;
    const lifelines = $$('line[data-et="life-line"]', svg)
      .map((l) => {
        const r = l.getBoundingClientRect();
        return { el: l, id: l.getAttribute('data-id'), x: r.left + r.width / 2 };
      })
      .filter((l) => pById(l.id));
    if (!lifelines.length) return;
    const xs = lifelines.map((l) => l.x).sort((a, b) => a - b);
    let gap = Infinity;
    for (let i = 1; i < xs.length; i++) gap = Math.min(gap, xs[i] - xs[i - 1]);
    const tol = gap === Infinity ? 1e9 : gap / 2;
    const nearest = (el) => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      const cx = r.left + r.width / 2;
      let best = null, bd = Infinity;
      for (const l of lifelines) { const d = Math.abs(l.x - cx); if (d < bd) { bd = d; best = l; } }
      return bd <= tol ? best : null;
    };
    const paint = (el, c, fillT) => {
      const cs = getComputedStyle(el);
      if (cs.fill && cs.fill !== 'none') el.style.fill = mix(c, bg, fillT);
      if (cs.stroke && cs.stroke !== 'none') el.style.stroke = c;
    };

    for (const l of lifelines) if (painted(l.id)) l.el.style.stroke = mix(colorOfM(l.id), bg, dark ? 0.55 : 0.5);
    const ACTOR_G = 'g.actor, g.actor-man, g.actor-top, g.actor-bottom, g[data-et="participant"]';
    $$('rect, circle, ellipse, path, line, polygon, polyline', svg).forEach((el) => {
      const cls = el.getAttribute('class') || '';
      if (/\bactor-line\b/.test(cls) || el.getAttribute('data-et') === 'life-line') return;
      const isActivation = /\bactivation\d\b/.test(cls);
      const isActor = /(^|\s)actor(\s|$)/.test(cls) || !!el.closest(ACTOR_G);
      if (!isActivation && !isActor) return;
      const l = nearest(el);
      if (!l || !painted(l.id)) return;
      paint(el, colorOfM(l.id), isActivation ? (dark ? 0.45 : 0.3) : (dark ? 0.28 : 0.16));
    });
  }

  /**
   * loop/alt/opt/par/critical/break bloklarına, builder'daki tip rengiyle hafif
   * bir arka plan verir; kenarları ve etiket kutusunu aynı renge boyar. Arka
   * planlar ayrı bir katmanda en alta çizilir ki mesaj okları üstte kalsın.
   * İç içe bloklarda içteki blok dıştakinin üzerine gelir.
   * Kullanıcının seçtiği renk (block.color) her zaman uygulanır; tip renkleri
   * yalnızca "Renkli" açıkken (auto).
   */
  function colorizeBlocks(svg, auto, model = S.model) {
    if (!svg) return;
    const bg = PAPER_BG[mmThemeName()] || '#ffffff';
    const dark = hexToRgb(bg).reduce((a, v) => a + v, 0) < 384;
    const root = getComputedStyle(document.documentElement);
    const NS = 'http://www.w3.org/2000/svg';
    // rect dışındaki bloklar kaynak sırasıyla (ön-sıra) çizilir; SVG gruplarını
    // üst kenara göre sıralayınca aynı sıraya denk gelirler.
    const modelBlocks = [];
    M.walk(model.items, (it) => { if (it.kind === 'block' && it.type !== 'rect') modelBlocks.push(it); });
    const groups = $$('g[data-et="control-structure"]', svg).map((g) => {
      const lines = $$('line.loopLine', g).filter((l) => !l.style.strokeDasharray);
      if (!lines.length) return null;
      const xs = lines.flatMap((l) => [+l.getAttribute('x1'), +l.getAttribute('x2')]);
      const ys = lines.flatMap((l) => [+l.getAttribute('y1'), +l.getAttribute('y2')]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { g, x, y, w: Math.max(...xs) - x, ht: Math.max(...ys) - y };
    }).filter(Boolean).sort((a, b) => a.y - b.y || b.w * b.ht - a.w * a.ht);
    const sameShape = groups.length === modelBlocks.length;

    const blocks = [];
    groups.forEach((b, i) => {
      const { g } = b;
      const lbl = $('.labelText', g);
      const type = (lbl ? lbl.textContent : '').trim().toLowerCase().replace(/_over$/, '');
      const custom = sameShape && modelBlocks[i].color;
      const c = custom || (auto ? root.getPropertyValue('--c-' + type).trim() : '');
      if (!/^#[0-9a-f]{3,6}$/i.test(c)) return;
      b.c = c;
      blocks.push(b);

      $$('line.loopLine', g).forEach((l) => { l.style.stroke = c; });
      $$('.labelBox', g).forEach((b) => { b.style.fill = mix(c, bg, dark ? 0.38 : 0.22); b.style.stroke = c; });
      const ink = dark ? mix(c, '#ffffff', 0.55) : mix(c, '#000000', 0.62);
      $$('.labelText, .labelText tspan', g).forEach((t) => { t.style.fill = ink; });
    });
    if (!blocks.length) return;

    const parent = blocks[0].g.parentNode;
    const layer = document.createElementNS(NS, 'g');
    layer.setAttribute('class', 'block-bgs');
    blocks.sort((a, b) => b.w * b.ht - a.w * a.ht).forEach((b) => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', b.x); r.setAttribute('y', b.y);
      r.setAttribute('width', b.w); r.setAttribute('height', b.ht);
      r.style.fill = mix(b.c, bg, dark ? 0.13 : 0.07);
      r.style.stroke = 'none';
      layer.append(r);
    });
    const first = Array.from(parent.children).find((n) => !/^(style|defs)$/i.test(n.tagName));
    parent.insertBefore(layer, first || null);
  }

  /**
   * Tonu seçilmiş mesajların ok çizgisini, ok ucunu ve metnini boyar. Ok uçları Mermaid'de
   * paylaşılan <marker> tanımları olduğu için her ton için bir kopya oluşturulur.
   * Kullanıcının açık seçimi olduğundan "Renkli" anahtarından bağımsız uygulanır.
   */
  function colorizeMessages(svg, model = S.model) {
    if (!svg) return;
    const msgs = [];
    M.walk(model.items, (it) => { if (it.kind === 'message') msgs.push(it); });
    if (!msgs.some((m) => m.tone)) return;
    const lines = $$('[data-et="message"]', svg);
    if (lines.length !== msgs.length) return; // eşleşme güvenilir değilse hiç boyama
    const texts = $$('text.messageText', svg);
    const bg = PAPER_BG[mmThemeName()] || '#ffffff';
    const dark = hexToRgb(bg).reduce((a, v) => a + v, 0) < 384;
    const markers = new Map();
    const toneMarker = (url, tone, c) => {
      const m = /url\(#([^)]+)\)/.exec(url || '');
      if (!m) return url;
      const key = m[1] + '--' + tone;
      if (!markers.has(key)) {
        const src = svg.getElementById ? svg.getElementById(m[1]) : svg.querySelector('#' + CSS.escape(m[1]));
        if (!src) return url;
        const clone = src.cloneNode(true);
        clone.id = key;
        clone.querySelectorAll('*').forEach((n) => {
          const fill = n.getAttribute('fill');
          if (fill !== 'none') n.style.fill = c;
          if (n.getAttribute('stroke') || n.style.stroke) n.style.stroke = c;
        });
        src.parentNode.append(clone);
        markers.set(key, true);
      }
      return 'url(#' + key + ')';
    };
    msgs.forEach((it, i) => {
      if (!it.tone || !TONE_COLORS[it.tone]) return;
      const base = TONE_COLORS[it.tone];
      const c = dark ? mix(base, '#ffffff', 0.8) : base;
      const ln = lines[i];
      ln.style.stroke = c;
      ['marker-start', 'marker-end'].forEach((a) => { if (ln.getAttribute(a)) ln.setAttribute(a, toneMarker(ln.getAttribute(a), it.tone, c)); });
      if (texts.length === msgs.length) {
        const ink = dark ? mix(base, '#ffffff', 0.7) : mix(base, '#000000', 0.78);
        [texts[i], ...texts[i].querySelectorAll('tspan')].forEach((t) => { t.style.fill = ink; });
      }
    });
  }

  function applyZoom() {
    const z = S.zoom;
    el.canvas.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.k})`;
    el.zoomVal.textContent = Math.round(z.k * 100) + '%';
  }
  function fitView() {
    const paper = $('.paper', el.canvas);
    if (!paper) return;
    const vp = el.viewport.getBoundingClientRect();
    const w = paper.offsetWidth, ht = paper.offsetHeight;
    const pad = 28;
    const kw = (vp.width - pad * 2) / w;
    const kh = (vp.height - pad * 2 - 40) / ht;
    let k = Math.min(kw, kh, 1.15);
    if (k < 0.45) k = Math.min(kw, 1.15); // uzun diyagramlarda genişliğe sığdır, kaydırılabilir kalsın
    k = clamp(k, 0.1, 4);
    S.zoom.k = k;
    S.zoom.x = (vp.width - w * k) / 2;
    S.zoom.y = Math.max(pad, (vp.height - 40 - ht * k) / 2);
    applyZoom();
  }
  function zoomAt(factor, cx, cy) {
    const z = S.zoom;
    const k2 = clamp(z.k * factor, 0.1, 5);
    const f = k2 / z.k;
    z.x = cx - (cx - z.x) * f;
    z.y = cy - (cy - z.y) * f;
    z.k = k2;
    z.auto = false;
    applyZoom();
  }
  function zoomCenter(factor) {
    const r = el.viewport.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  }

  el.viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = el.viewport.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025) * (e.ctrlKey && !e.metaKey ? 4 : 1)), e.clientX - r.left, e.clientY - r.top);
    } else {
      S.zoom.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      S.zoom.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      S.zoom.auto = false;
      applyZoom();
    }
  }, { passive: false });

  (function setupPan() {
    let start = null;
    el.viewport.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.zoombar, .render-error, .nav-back')) return;
      start = { x: e.clientX, y: e.clientY, zx: S.zoom.x, zy: S.zoom.y, moved: false, target: e.target };
      el.viewport.setPointerCapture(e.pointerId);
    });
    el.viewport.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!start.moved && Math.hypot(dx, dy) > 4) { start.moved = true; el.viewport.classList.add('panning'); }
      if (start.moved) { S.zoom.x = start.zx + dx; S.zoom.y = start.zy + dy; S.zoom.auto = false; applyZoom(); }
    });
    const end = () => {
      if (start && !start.moved) onPreviewClick(start.target);
      start = null;
      el.viewport.classList.remove('panning');
    };
    el.viewport.addEventListener('pointerup', end);
    el.viewport.addEventListener('pointercancel', () => { start = null; el.viewport.classList.remove('panning'); });
  })();

  /** Önizlemede bir mesaja/nota tıklanınca editörde ilgili satıra git. */
  function onPreviewClick(target) {
    // Referans notu: bağlı diyagramı aç
    const refG = target.closest && target.closest('g.ref-note');
    if (refG) { followRef(refG.getAttribute('data-ref')); return; }
    const t = target.closest && target.closest('text.messageText, text.noteText');
    if (!t) return;
    const isNote = t.classList.contains('noteText');
    const kind = isNote ? 'note' : 'message';
    if (isNote) {
      // Notlar: not grubunun sırası önizleme modelindeki notlarla eşlenir (yer tutucu notlar atlanır)
      const gi = $$('g[data-et="note"]', el.canvas).indexOf(t.closest('g[data-et="note"]'));
      const rn = [];
      M.walk((S.renderModel || S.model).items, (it) => { if (it.kind === 'note') rn.push(it); });
      const hit = rn[gi];
      if (!hit || hit.uid === 'ph') return;
      const real = [];
      M.walk(S.model.items, (it) => { if (it.kind === 'note') real.push(it); });
      const ri = real.findIndex((n) => n.uid === hit.uid);
      if (ri < 0) return;
      return gotoNode('note', ri);
    }
    const all = $$('text.messageText', el.canvas);
    const idx = all.indexOf(t);
    if (idx < 0) return;
    return gotoNode(kind, idx);
  }
  /** kind türündeki idx'inci adıma git (kod görünümünde satır, görsel görünümde adım) */
  function gotoNode(kind, idx) {
    if (currentView() === 'code') {
      const nodes = [];
      M.walk(M.parse(S.code).items, (it) => { if (it.kind === kind) nodes.push(it); });
      const n = nodes[idx];
      if (n && n.line != null) selectCodeLine(n.line);
      return;
    }
    const nodes = [];
    M.walk(S.model.items, (it) => { if (it.kind === kind) nodes.push(it); });
    const n = nodes[idx];
    if (!n) return;
    // Daraltılmış ataları aç
    let changed = false;
    M.walk(S.model.items, (it) => {
      if (it.kind === 'block' && S.collapsed.has(it.uid) && containsNode(it, n.uid)) { S.collapsed.delete(it.uid); changed = true; }
    });
    if (changed) renderBuilder();
    setSelected(n.uid);
    const row = el.flow.querySelector(`[data-uid="${n.uid}"]`);
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
      const inp = row.querySelector('.text-input');
      if (inp) setTimeout(() => inp.focus({ preventScroll: true }), 250);
    }
  }
  function containsNode(block, nodeUid) {
    let found = false;
    for (const br of block.branches) M.walk(br.items, (it) => { if (it.uid === nodeUid) { found = true; return false; } });
    return found;
  }

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

  const codeToModel = debounce(() => applyCode(el.code.value, 'code'), 260);
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
  function insertText(t) {
    const ta = el.code;
    ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  }

  // ---------------------------------------------------------------------------
  // Görünüm sekmeleri
  // ---------------------------------------------------------------------------
  const currentView = () => S.settings.view;
  function setView(v) {
    if (v !== 'builder' && v !== 'code') v = 'builder';
    // Koddan builder'a geçerken bekleyen değişiklikleri uygula
    if (v === 'builder' && el.code.value !== S.code) applyCode(el.code.value, 'code');
    if (v === 'builder') refreshAutoAct();
    S.settings.view = v;
    saveSettings();
    $$('button', el.viewSeg).forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    el.viewBuilder.classList.toggle('active', v === 'builder');
    el.viewCode.classList.toggle('active', v === 'code');
    document.body.classList.toggle('view-code', v === 'code');
    $('#builderMeta').style.visibility = v === 'builder' ? 'visible' : 'hidden';
    if (v === 'code') { updateEditorDecor(); setTimeout(() => el.code.focus({ preventScroll: true }), 0); }
  }
  el.viewSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.view); });

  // ---------------------------------------------------------------------------
  // Palet
  // ---------------------------------------------------------------------------
  const STEP_PALETTE = [
    { k: 'message', ic: 'message', c: 'var(--accent)' },
    { k: 'reply', ic: 'reply', c: 'var(--muted)' },
    { k: 'note', ic: 'note', c: 'var(--c-note)' },
    { k: 'ref', ic: 'link', c: 'var(--c-ref)' },
    { k: 'loop', ic: 'loop', c: 'var(--c-loop)' },
    { k: 'alt', ic: 'alt', c: 'var(--c-alt)' },
    { k: 'opt', ic: 'opt', c: 'var(--c-opt)' },
    { k: 'par', ic: 'par', c: 'var(--c-par)' },
    { k: 'critical', ic: 'critical', c: 'var(--c-critical)' },
    { k: 'break', ic: 'break', c: 'var(--c-break)' },
    { k: 'rect', ic: 'rect', c: 'var(--c-rect)' },
    { k: 'activation', ic: 'activate', c: 'var(--c-activation)' },
    { k: 'raw', ic: 'raw', c: 'var(--c-raw)' },
  ];
  const TYPE_LABEL = Object.fromEntries(M.PARTICIPANT_TYPES.map((t) => [t.v, t.label]));

  function renderPalette() {
    el.palP.innerHTML = '';
    el.palS.innerHTML = '';
    el.palR.innerHTML = '';
    (S.roles || []).forEach((r) => {
      const chip = h('div', { class: 'chip role-chip', draggable: 'true', title: r.name + ' — ' + T('pal.clickOrDrag'), style: `--c:${r.color}` }, ico('t-' + r.type), r.name);
      chip.addEventListener('click', () => addParticipant(r.type, null, r.id));
      chip.addEventListener('dragstart', (e) => startDrag(e, { kind: 'newPart', type: r.type, role: r.id }));
      chip.addEventListener('dragend', endDrag);
      el.palR.append(chip);
    });
    el.palR.append(h('button', { class: 'chip chip-edit', title: T('role.manage'), onclick: openRoles }, ico('edit'), (S.roles || []).length ? null : T('role.manageShort')));
    requestAnimationFrame(() => { if (typeof balancePalette === 'function') balancePalette(); });
    M.PARTICIPANT_TYPES.forEach((t, i) => {
      const chip = h('div', { class: 'chip', draggable: 'true', title: T('type.' + t.v) + ' — ' + T('pal.clickOrDrag'), style: `--c:${PCOLORS[i % PCOLORS.length]}` }, ico('t-' + t.v), t.label);
      chip.addEventListener('click', () => addParticipant(t.v));
      chip.addEventListener('dragstart', (e) => startDrag(e, { kind: 'newPart', type: t.v }));
      chip.addEventListener('dragend', endDrag);
      el.palP.append(chip);
    });
    STEP_PALETTE.forEach((s) => {
      const chip = h('div', { class: 'chip', draggable: 'true', title: (M.BLOCK_TYPES[s.k] ? T('block.' + s.k) + ' — ' : '') + T('pal.clickOrDragFlow'), style: `--c:${s.c}` }, ico(s.ic), T('step.' + s.k));
      chip.addEventListener('click', () => addStep(s.k));
      chip.addEventListener('dragstart', (e) => startDrag(e, { kind: 'newStep', type: s.k }));
      chip.addEventListener('dragend', endDrag);
      el.palS.append(chip);
    });
  }

  // ---------------------------------------------------------------------------
  // Katılımcılar
  // ---------------------------------------------------------------------------
  function uniqueId(base, exceptUid) {
    base = M.slugify(base);
    let id = base, k = 2;
    while (S.model.participants.some((p) => p.id === id && p.uid !== exceptUid)) id = base + k++;
    return id;
  }

  // ---------------------------------------------------------------------------
  // Katılımcı rolleri: ad + şekil (tip) + renk + ön/son ek. Kütüphane bu tarayıcıda
  // global tutulur; diyagram koduna "%% @role id" ile birlikte çözülmüş tip ve renk de
  // yazılır, böylece paylaşılan diyagram kütüphane olmadan da aynı görünür.
  // Tip ya da renk elle değiştirilirse katılımcının rol bağlantısı kopar.
  // ---------------------------------------------------------------------------
  const PRESET_ROLES = [
    { id: 'user', tr: 'Kullanıcı', en: 'User', type: 'actor', color: '#6c7cff', prefix: '', suffix: '' },
    { id: 'client', tr: 'İstemci uygulama', en: 'Client app', type: 'boundary', color: '#20b8a6', prefix: '', suffix: ' App' },
    { id: 'gateway', tr: 'API Gateway', en: 'API Gateway', type: 'collections', color: '#f0a020', prefix: '', suffix: ' Gateway' },
    { id: 'service', tr: 'Servis', en: 'Service', type: 'participant', color: '#2fbf7f', prefix: '', suffix: ' Service' },
    { id: 'external', tr: 'Dış sistem', en: 'External system', type: 'boundary', color: '#3aa0ff', prefix: '', suffix: '' },
    { id: 'database', tr: 'Veritabanı', en: 'Database', type: 'database', color: '#f97a3c', prefix: '', suffix: ' DB' },
    { id: 'queue', tr: 'Kuyruk', en: 'Message queue', type: 'queue', color: '#9b6bff', prefix: '', suffix: ' Queue' },
  ];
  const presetRole = (r) => ({ id: r.id, name: r[I18N.getLang()] || r.en, type: r.type, color: r.color, prefix: r.prefix, suffix: r.suffix });
  S.roles = null; // init() içinde yüklenir
  const saveRoles = () => window.SeqStorage.saveKV('roles', S.roles).catch(storageError);
  const roleById = (id) => id && (S.roles || []).find((r) => r.id === id);
  // Ekler isteğe bağlı satır sonuyla ayrılır: ön ekten sonra (prefixBreak) / son ekten önce (suffixBreak)
  // (satır sonu varken ekin o taraftaki boşluğu kırpılır: " Service" → "\nService")
  const prefixStr = (r) => (r && r.prefix ? (r.prefixBreak ? r.prefix.trimEnd() + '\n' : r.prefix) : '');
  const suffixStr = (r) => (r && r.suffix ? (r.suffixBreak ? '\n' + r.suffix.trimStart() : r.suffix) : '');
  /** Ön/son eki ayıklanmış ad (rolün o anki tanımına göre) */
  function stripAffixes(label, r) {
    let l = String(label || '');
    const pre = prefixStr(r), suf = suffixStr(r);
    if (pre && l.startsWith(pre)) l = l.slice(pre.length);
    if (suf && l.endsWith(suf) && l.length > suf.length) l = l.slice(0, -suf.length);
    return l;
  }
  const composeLabel = (r, base) => prefixStr(r) + base + suffixStr(r);
  const baseName = (p) => stripAffixes(p.label, roleById(p.role));

  /** Rolü katılımcıya uygular; adın çekirdeği korunur, ekler yenilenir. */
  function applyRole(p, r) {
    const base = baseName(p);
    p.role = r.id;
    p.type = r.type;
    p.color = r.color;
    p.label = composeLabel(r, base);
    p.implicit = false;
    if (p.autoId) {
      const nid = uniqueId(p.label, p.uid);
      renameRefs(p.id, nid);
      p.id = nid;
    }
  }

  /** Bir rolün tanımı değişti/silindi: bu tarayıcıdaki tüm diyagramlarda katılımcıları güncelle. */
  function updateRoleEverywhere(old, cur) {
    const transform = (model) => {
      let changed = false;
      model.participants.forEach((p) => {
        if (p.role !== old.id) return;
        changed = true;
        if (!cur) { delete p.role; return; }
        const base = stripAffixes(p.label, old);
        p.type = cur.type;
        p.color = cur.color;
        p.label = composeLabel(cur, base);
      });
      return changed;
    };
    const marker = new RegExp('^\\s*%%\\s*@role\\s+' + old.id + '\\s*$', 'm');
    S.docs.forEach((d) => {
      if (S.doc && d.id === S.doc.id) return;
      if (!marker.test(d.code)) return;
      const m = M.parse(d.code);
      if (transform(m)) d.code = M.serialize(m);
    });
    persistDocs();
    if (transform(S.model)) commit();
  }
  /** Rolü kullanan diyagram sayısı */
  function roleUsage(id) {
    const marker = new RegExp('^\\s*%%\\s*@role\\s+' + id + '\\s*$', 'm');
    return S.docs.filter((d) => marker.test(S.doc && d.id === S.doc.id ? S.code : d.code)).length;
  }

  function addParticipant(type, index, roleId) {
    const r = roleById(roleId);
    // Ekli rollerde çekirdek "Yeni" olur (Yeni Service → yazınca Order Service); eksizse rolün adı
    const core = r ? (r.prefix || r.suffix ? T('role.newBase') : r.name) : T('newp.' + type);
    const taken = (b) => S.model.participants.some((p) => p.label === composeLabel(r, b));
    let base = core, n = 2;
    while (taken(base)) base = core + ' ' + n++;
    const lbl = composeLabel(r, base);
    const p = { uid: M.uid(), id: uniqueId(lbl), label: lbl, type: r ? r.type : type, boxId: null, implicit: false, autoId: true };
    if (r) { p.role = r.id; p.color = r.color; }
    S.model.participants.forEach((q) => { q.implicit = false; });
    if (index == null || index > S.model.participants.length) S.model.participants.push(p);
    else S.model.participants.splice(index, 0, p);
    commit();
    const card = el.participants.querySelector(`[data-uid="${p.uid}"]`);
    if (card) openParticipantEditor(p, card, true);
    return p;
  }

  function renderParticipants() {
    const box = el.participants;
    box.innerHTML = '';
    const boxes = new Map(S.model.boxes.map((b) => [b.id, b]));
    S.model.participants.forEach((p, i) => {
      const c = p.color || PCOLORS[i % PCOLORS.length];
      const bx = p.boxId && boxes.get(p.boxId);
      const card = h('div', {
        class: 'pcard' + (S.selectedP === p.uid ? ' selected' : ''), draggable: 'true', 'data-uid': p.uid,
        style: `--c:${c};` + (bx ? `--box:${bx.color && bx.color !== 'transparent' ? bx.color : 'var(--border-strong)'}` : ''),
        title: TYPE_LABEL[p.type] + ' · ' + T('pcard.title'),
      },
      bx ? h('span', { class: 'pc-box-tag' }, bx.label || 'Grup') : null,
      h('span', { class: 'pc-icon' }, ico('t-' + p.type)),
      h('div', { class: 'pc-text' },
        h('div', { class: 'pc-label' }, p.label || p.id),
        h('div', { class: 'pc-sub' }, p.id + (p.implicit ? ' · ' + T('pcard.auto') : ''))),
      h('button', { class: 'pc-handle', title: T('pcard.handle'), onpointerdown: (e) => startLink(e, p) }));
      card.addEventListener('click', (e) => { if (!e.target.closest('.pc-handle')) openParticipantEditor(p, card); });
      card.addEventListener('dragstart', (e) => {
        if (S.linking) { e.preventDefault(); return; }
        startDrag(e, { kind: 'part', uid: p.uid });
        setTimeout(() => card.classList.add('dragging'), 0);
      });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); endDrag(); });
      box.append(card);
    });
    box.append(h('button', { class: 'pcard-add', onclick: () => addParticipant('participant') }, ico('plus'), T('pcard.add')));
    el.partCount.textContent = S.model.participants.length;
  }

  // Katılımcı alanına bırakma (sıralama + paletten ekleme)
  let pMarker = null;
  function pDropIndex(e) {
    const cards = $$('.pcard', el.participants).filter((c) => !c.classList.contains('dragging'));
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      if (e.clientY < r.top) return { i, ref: cards[i] };
      if (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2) return { i, ref: cards[i] };
    }
    return { i: cards.length, ref: $('.pcard-add', el.participants) };
  }
  el.participants.addEventListener('dragover', (e) => {
    if (!S.drag || (S.drag.kind !== 'part' && S.drag.kind !== 'newPart')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = S.drag.kind === 'part' ? 'move' : 'copy';
    el.participants.classList.add('drop-active');
    const { ref } = pDropIndex(e);
    if (!pMarker) pMarker = h('div', { class: 'p-drop-marker' });
    if (pMarker.nextSibling !== ref) el.participants.insertBefore(pMarker, ref);
  });
  el.participants.addEventListener('dragleave', (e) => {
    if (!el.participants.contains(e.relatedTarget)) clearPMarker();
  });
  el.participants.addEventListener('drop', (e) => {
    if (!S.drag) return;
    e.preventDefault();
    const { i } = pDropIndex(e);
    const d = S.drag;
    clearPMarker();
    if (d.kind === 'newPart') { addParticipant(d.type, i, d.role); return; }
    if (d.kind === 'part') {
      const arr = S.model.participants;
      const from = arr.findIndex((p) => p.uid === d.uid);
      if (from < 0) return;
      // i, sürüklenen kart hariç listedeki indekstir
      const [p] = arr.splice(from, 1);
      arr.splice(i, 0, p);
      arr.forEach((q) => { q.implicit = false; });
      fixBoxContiguity(p);
      commit();
    }
  });
  function clearPMarker() { if (pMarker) pMarker.remove(); pMarker = null; el.participants.classList.remove('drop-active'); }

  /** Bir katılımcı bir gruba aitse, grubun diğer üyeleriyle yan yana durmasını sağlar. */
  function fixBoxContiguity(p) {
    const arr = S.model.participants;
    if (!p.boxId) return;
    const members = arr.filter((q) => q.boxId === p.boxId);
    if (members.length < 2) return;
    const idx = arr.indexOf(p);
    const neighborsOk = (arr[idx - 1] && arr[idx - 1].boxId === p.boxId) || (arr[idx + 1] && arr[idx + 1].boxId === p.boxId);
    if (neighborsOk) return;
    arr.splice(idx, 1);
    const last = arr.map((q) => q.boxId).lastIndexOf(p.boxId);
    arr.splice(last + 1, 0, p);
  }

  function renameRefs(oldId, newId) {
    if (oldId === newId) return;
    M.walk(S.model.items, (it) => {
      if (it.kind === 'message') { if (it.from === oldId) it.from = newId; if (it.to === oldId) it.to = newId; }
      else if (it.kind === 'note') it.targets = it.targets.map((t) => (t === oldId ? newId : t));
      else if (it.kind === 'activation' && it.participant === oldId) it.participant = newId;
    });
  }
  function countRefs(id) {
    let n = 0;
    M.walk(S.model.items, (it) => {
      if ((it.kind === 'message' && (it.from === id || it.to === id)) || (it.kind === 'note' && it.targets.includes(id)) || (it.kind === 'activation' && it.participant === id)) n++;
    });
    return n;
  }
  function deleteParticipant(p) {
    const n = countRefs(p.id);
    if (n && !confirm(T('p.confirmDelete', { name: p.label, n }))) return false;
    S.model.participants = S.model.participants.filter((q) => q !== p);
    const prune = (items) => {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind === 'message' && (it.from === p.id || it.to === p.id)) items.splice(i, 1);
        else if (it.kind === 'activation' && it.participant === p.id) items.splice(i, 1);
        else if (it.kind === 'note') {
          it.targets = it.targets.filter((t) => t !== p.id);
          if (!it.targets.length) items.splice(i, 1);
        } else if (it.kind === 'block') it.branches.forEach((b) => prune(b.items));
      }
    };
    prune(S.model.items);
    S.model.boxes = S.model.boxes.filter((b) => S.model.participants.some((q) => q.boxId === b.id));
    commit();
    return true;
  }

  // Katılımcı düzenleme popover'ı
  const BOX_COLORS = [
    { v: '', name: 'none' },
    { v: 'rgba(108, 124, 255, 0.10)', name: 'blue' },
    { v: 'rgba(32, 184, 166, 0.12)', name: 'teal' },
    { v: 'rgba(47, 191, 127, 0.12)', name: 'green' },
    { v: 'rgba(240, 160, 32, 0.14)', name: 'orange' },
    { v: 'rgba(236, 90, 143, 0.12)', name: 'pink' },
    { v: 'rgba(138, 147, 166, 0.15)', name: 'gray' },
  ];

  function openParticipantEditor(p, anchor, focusLabel) {
    S.selectedP = p.uid;
    $$('.pcard', el.participants).forEach((c) => c.classList.toggle('selected', c.dataset.uid === p.uid));
    const pop = el.popover;
    pop.innerHTML = '';
    const touch = () => { p.implicit = false; };

    const role = roleById(p.role);
    // Rol yeniden çizimi: kart yeniden oluştuğu için güncel kartı çapa al
    const reopen = () => {
      const card = el.participants.querySelector(`[data-uid="${p.uid}"]`);
      openParticipantEditor(p, card || anchor);
    };
    // Ad alanı: rolün ön/son eki sabit etiket olarak görünür, yalnızca çekirdek ad düzenlenir
    const labelIn = multiline(h('textarea', { class: 'input', rows: 1, value: role ? baseName(p) : p.label, placeholder: T('pe.labelPh') }));
    const labelField = role && (role.prefix || role.suffix)
      ? h('div', { class: 'affix-input' },
        role.prefix ? h('span', { class: 'affix', title: T('role.prefix') }, role.prefix, role.prefixBreak ? h('span', { class: 'affix-br', title: T('role.breakAfter') }, '↵') : null) : null,
        labelIn,
        role.suffix ? h('span', { class: 'affix', title: T('role.suffix') }, role.suffixBreak ? h('span', { class: 'affix-br', title: T('role.breakBefore') }, '↵') : null, role.suffix) : null)
      : labelIn;
    const idIn = h('input', { class: 'input', value: p.id, spellcheck: 'false', style: 'font-family:var(--mono)' });
    const idHint = h('small', null, T('pe.idHint'));

    labelIn.addEventListener('input', () => {
      touch();
      const r = roleById(p.role);
      p.label = labelIn.value.trim() ? composeLabel(r, labelIn.value.trim()) : p.id;
      if (p.autoId) {
        const nid = uniqueId(p.label || 'P', p.uid);
        renameRefs(p.id, nid);
        p.id = nid;
        idIn.value = nid;
      }
      commit();
    });
    idIn.addEventListener('input', () => {
      const v = idIn.value.trim();
      const invalid = !v || /[\s:;,<>@#+\-]/.test(v) || /^(participant|actor|end|as|loop|alt|else|opt|par|and|note|box|rect|critical|break|option)$/i.test(v);
      const dup = S.model.participants.some((q) => q.id === v && q !== p);
      idIn.style.borderColor = invalid || dup ? 'var(--danger)' : '';
      idHint.textContent = T(invalid ? 'pe.idInvalid' : dup ? 'pe.idDup' : 'pe.idHint');
      idHint.style.color = invalid || dup ? 'var(--danger)' : '';
      if (invalid || dup) return;
      touch();
      p.autoId = false;
      const wasLabelId = p.label === p.id;
      renameRefs(p.id, v);
      p.id = v;
      if (wasLabelId) { p.label = v; labelIn.value = v; }
      commit();
    });

    const typeGrid = h('div', { class: 'type-grid' });
    M.PARTICIPANT_TYPES.forEach((t) => {
      const b = h('button', { class: 'type-opt' + (p.type === t.v ? ' active' : ''), title: T('type.' + t.v) }, ico('t-' + t.v), t.label);
      b.addEventListener('click', () => {
        touch(); p.type = t.v;
        const hadRole = !!p.role;
        delete p.role; // elle değişiklik → rol bağlantısı kopar
        $$('.type-opt', typeGrid).forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        commit();
        if (hadRole) reopen();
      });
      typeGrid.append(b);
    });

    // Grup (box)
    const boxSel = h('select', { class: 'select' });
    const boxRow = h('div', { class: 'row', style: 'margin-top:6px' });
    const fillBoxSel = () => {
      boxSel.innerHTML = '';
      boxSel.append(h('option', { value: '' }, T('pe.noBox')));
      S.model.boxes.forEach((b) => boxSel.append(h('option', { value: b.id }, b.label || T('pe.unnamedBox'))));
      boxSel.append(h('option', { value: '__new' }, T('pe.newBox')));
      boxSel.value = p.boxId || '';
    };
    const fillBoxRow = () => {
      boxRow.innerHTML = '';
      const b = S.model.boxes.find((x) => x.id === p.boxId);
      if (!b) return;
      const bl = h('input', { class: 'input', value: b.label, placeholder: T('pe.boxName') });
      bl.addEventListener('input', () => { b.label = bl.value; fillBoxSelLabels(); commit(); });
      const bc = h('select', { class: 'select' });
      const known = BOX_COLORS.some((c) => c.v === (b.color || ''));
      BOX_COLORS.forEach((c) => bc.append(h('option', { value: c.v }, T('color.' + c.name))));
      if (!known) bc.append(h('option', { value: b.color }, b.color));
      bc.value = b.color || '';
      bc.addEventListener('change', () => { b.color = bc.value; commit(); });
      boxRow.append(bl, bc);
    };
    const fillBoxSelLabels = () => { $$('option', boxSel).forEach((o) => { const b = S.model.boxes.find((x) => x.id === o.value); if (b) o.textContent = b.label || T('pe.unnamedBox'); }); };
    boxSel.addEventListener('change', () => {
      touch();
      if (boxSel.value === '__new') {
        const b = { id: M.uid(), label: T('pe.boxDefault', { n: S.model.boxes.length + 1 }), color: BOX_COLORS[1].v };
        S.model.boxes.push(b);
        p.boxId = b.id;
      } else p.boxId = boxSel.value || null;
      S.model.participants.forEach((q) => { q.implicit = false; });
      fixBoxContiguity(p);
      S.model.boxes = S.model.boxes.filter((b) => S.model.participants.some((q) => q.boxId === b.id));
      commit();
      fillBoxSel(); fillBoxRow();
    });
    fillBoxSel(); fillBoxRow();

    // Renk: hazır renkler + özel renk + otomatik (sıraya göre). Kodda "%% @color #hex" olarak saklanır.
    const colorField = h('div', { class: 'pe-colors' });
    const fillColors = () => {
      colorField.innerHTML = '';
      const setColor = (c) => {
        touch();
        if (c) p.color = c; else delete p.color;
        const hadRole = !!p.role;
        delete p.role; // elle değişiklik → rol bağlantısı kopar
        commit();
        flushHistory();
        if (hadRole) reopen(); else fillColors();
      };
      const cur = colorOf(p.id);
      const custom = h('input', { type: 'color', value: cur, title: T('block.colorCustom') });
      custom.addEventListener('change', () => setColor(custom.value.toLowerCase()));
      add(colorField,
        h('div', { class: 'swatches' }, PCOLORS.map((c) => h('button', {
          class: 'swatch' + (p.color === c ? ' active' : ''), style: `background:${c}`, title: c, onclick: () => setColor(c),
        }))),
        h('label', { class: 'cm-custom' }, custom, h('span', null, T('block.colorCustom'))),
        p.color ? h('button', { class: 'btn ghost sm', onclick: () => setColor(null) }, T('pe.colorAuto')) : null);
    };
    fillColors();

    // Rol seçimi
    const roleChips = h('div', { class: 'role-pick' },
      h('button', { class: 'rp-chip' + (!p.role ? ' active' : ''), onclick: () => {
        if (!p.role) return;
        delete p.role; // görünüm ve ad olduğu gibi kalır
        commit(); flushHistory(); reopen();
      } }, T('role.none')),
      (S.roles || []).map((r) => h('button', {
        class: 'rp-chip' + (p.role === r.id ? ' active' : ''), style: `--c:${r.color}`, title: r.name,
        onclick: () => { if (p.role === r.id) return; applyRole(p, r); commit(); flushHistory(); reopen(); },
      }, ico('t-' + r.type), r.name)),
      p.role && !role ? h('span', { class: 'rp-chip active unknown', title: T('role.unknown') }, '@' + p.role) : null,
      h('button', { class: 'rp-edit', onclick: () => { closePopover(); openRoles(); } }, T('role.manageEllipsis')));
    const custom = h('details', { class: 'pe-custom', open: p.role ? null : true },
      h('summary', null, T('pe.customize')),
      p.role ? h('small', { class: 'pe-custom-hint' }, T('role.detachHint')) : null,
      h('div', { class: 'field' }, h('label', null, T('pe.type')), typeGrid),
      h('div', { class: 'field' }, h('label', null, T('pe.color')), colorField));

    pop.append(
      h('div', { class: 'pop-title' }, T('pe.title'), h('button', { class: 'icon-btn sm', onclick: closePopover }, ico('x'))),
      h('div', { class: 'field' }, h('label', null, T('pe.label')), labelField),
      h('div', { class: 'field' }, h('label', null, T('pe.role')), roleChips),
      h('div', { class: 'field' }, h('label', null, T('pe.id')), idIn, idHint),
      custom,
      h('div', { class: 'field' }, h('label', null, T('pe.box')), boxSel, boxRow),
      h('div', { class: 'pop-actions' },
        h('button', { class: 'btn danger sm', onclick: () => { if (deleteParticipant(p)) closePopover(); } }, ico('trash'), T('delete')),
        h('div', { class: 'row', style: 'flex:none' },
          h('button', { class: 'btn sm', title: T('pe.addMsgTitle'), onclick: () => { closePopover(); addMessageFrom(p.id); } }, ico('message'), T('pe.addMsg')),
          h('button', { class: 'btn primary sm', onclick: closePopover }, T('pe.done')))),
    );
    showPopover(anchor);
    if (focusLabel) setTimeout(() => { labelIn.focus(); labelIn.select(); }, 30);
  }

  let popAnchor = null;
  function showPopover(anchor) {
    const pop = el.popover;
    popAnchor = anchor;
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = clamp(r.left, 10, innerWidth - pw - 10);
    let y = r.bottom + 8;
    if (y + ph > innerHeight - 10) y = Math.max(10, r.top - ph - 8);
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
  }
  function closePopover() {
    if (el.popover.hidden) return;
    el.popover.hidden = true;
    S.selectedP = null;
    $$('.pcard.selected', el.participants).forEach((c) => c.classList.remove('selected'));
    flushHistory();
  }
  document.addEventListener('pointerdown', (e) => {
    if (!el.popover.hidden && !el.popover.contains(e.target) && !(e.target.closest && e.target.closest('.pcard'))) closePopover();
  });

  // Bağlantı noktasından sürükleyerek mesaj oluşturma
  function startLink(e, p) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    closePopover();
    S.linking = true;
    const r = e.currentTarget.getBoundingClientRect();
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    let target = null, maxDist = 0;
    el.overlay.classList.add('show');
    const draw = (x1, y1) => {
      const dx = x1 - x0;
      el.linkPath.setAttribute('d', `M${x0},${y0} C${x0 + dx * 0.5},${y0 - 30} ${x1 - dx * 0.5},${y1 - 30} ${x1},${y1}`);
    };
    draw(x0, y0);
    const move = (ev) => {
      maxDist = Math.max(maxDist, Math.hypot(ev.clientX - x0, ev.clientY - y0));
      draw(ev.clientX, ev.clientY);
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const card = hit && hit.closest('.pcard');
      if (target && target !== card) target.classList.remove('link-target');
      target = card || null;
      if (target && (target.dataset.uid !== p.uid || maxDist > 60)) target.classList.add('link-target');
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.overlay.classList.remove('show');
      S.linking = false;
      if (!target) return;
      target.classList.remove('link-target');
      const tp = S.model.participants.find((q) => q.uid === target.dataset.uid);
      if (!tp || (tp === p && maxDist <= 60)) return;
      const node = { uid: M.uid(), kind: 'message', from: p.id, to: tp.id, arrow: '->>', act: '', text: '' };
      insertNode(node);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------------------------------------------------------------------------
  // Akış adımları
  // ---------------------------------------------------------------------------
  function blockDefaults(kind) {
    switch (kind) {
      case 'loop': return [T('bd.loop')];
      case 'alt': return [T('bd.alt1'), T('bd.alt2')];
      case 'opt': return [T('bd.opt')];
      case 'par': return [T('bd.par1'), T('bd.par2')];
      case 'critical': return [T('bd.crit1'), T('bd.crit2')];
      case 'break': return [T('bd.break')];
      case 'rect': return ['rgba(108, 124, 255, 0.12)'];
      default: return [''];
    }
  }
  const branchPh = (type) => (['loop', 'alt', 'opt', 'par', 'par_over', 'critical', 'break', 'rect'].includes(type) ? T('ph.' + (type === 'par_over' ? 'par' : type)) : T('ph.label'));
  const BRANCH_LABEL = { else: 'Else', and: 'And', option: 'Option' };
  const RECT_SWATCHES = ['rgba(108, 124, 255, 0.12)', 'rgba(47, 191, 127, 0.14)', 'rgba(240, 160, 32, 0.16)', 'rgba(236, 90, 143, 0.14)', 'rgba(138, 147, 166, 0.16)'];
  const actLabel = (act) => T(act === '+' ? 'act.plus' : act === '-' ? 'act.minus' : 'act.none');

  function selectedMessage() {
    const f = S.selected && M.findNode(S.model, S.selected);
    return f && f.node && f.node.kind === 'message' ? f.node : null;
  }

  function newStep(kind) {
    const P = S.model.participants;
    const sel = selectedMessage();
    const a = P[0] && P[0].id, b = (P[1] || P[0]) && (P[1] || P[0]).id;
    const nextAfter = (id) => { const i = P.findIndex((p) => p.id === id); return (P[i + 1] || P[i - 1] || P[i]).id; };
    switch (kind) {
      case 'message': {
        if (!P.length) return null;
        if (sel) return { uid: M.uid(), kind: 'message', from: sel.to, to: sel.to === sel.from ? nextAfter(sel.to) : nextAfter(sel.to), arrow: '->>', act: '', text: '' };
        return { uid: M.uid(), kind: 'message', from: a, to: b, arrow: '->>', act: '', text: '' };
      }
      case 'reply': {
        if (!P.length) return null;
        if (sel) return { uid: M.uid(), kind: 'message', from: sel.to, to: sel.from, arrow: '-->>', act: '', text: REPLY_TEXT };
        return { uid: M.uid(), kind: 'message', from: b, to: a, arrow: '-->>', act: '', text: REPLY_TEXT };
      }
      case 'note':
        if (!P.length) return null;
        return { uid: M.uid(), kind: 'note', position: 'right of', targets: [sel ? sel.to : a], text: '' };
      case 'ref': {
        if (!P.length) return null;
        // Varsayılan hedef: en son düzenlenen diğer diyagram
        const target = S.docs.filter((d) => d !== S.doc).sort((x, y) => (y.updated || 0) - (x.updated || 0))[0];
        if (!target) { toast(T('ref.noTarget'), 'err'); return false; }
        // Tek katılımcıya bağlanır: seçili mesaj varsa mesajın gittiği katılımcı (ayrıntı orada gerçekleşir)
        return { uid: M.uid(), kind: 'note', position: 'over', targets: [sel ? sel.to : P[0].id], text: target.name, ref: target.id };
      }
      case 'activation':
        if (!P.length) return null;
        return { uid: M.uid(), kind: 'activation', action: 'activate', participant: sel ? sel.to : a };
      case 'raw':
        return { uid: M.uid(), kind: 'raw', text: T('raw.default') };
      default: {
        const labels = blockDefaults(kind);
        return { uid: M.uid(), kind: 'block', type: kind, branches: labels.map((l) => ({ uid: M.uid(), label: l, items: [] })) };
      }
    }
  }

  function insertionPoint() {
    const f = S.selected && M.findNode(S.model, S.selected);
    if (f) {
      if (f.branch) return { list: f.branch.items, index: f.branch.items.length };
      return { list: f.list, index: f.index + 1 };
    }
    return { list: S.model.items, index: S.model.items.length };
  }

  function addStep(kind, list, index) {
    const node = newStep(kind);
    if (node === false) return null; // newStep kendi uyarısını gösterdi
    if (!node) { toast(T('err.needParticipant'), 'err'); return null; }
    insertNode(node, list, index);
    return node;
  }
  function addMessageFrom(id) {
    const P = S.model.participants;
    const i = P.findIndex((p) => p.id === id);
    const to = (P[i + 1] || P[i - 1] || P[i]).id;
    insertNode({ uid: M.uid(), kind: 'message', from: id, to, arrow: '->>', act: '', text: '' });
  }

  /** Yeni yanıt mesajlarının varsayılan metni (alan odaklanınca seçili gelir, yazınca değişir) */
  const REPLY_TEXT = '✓';

  function insertNode(node, list, index) {
    if (!list) { const ip = insertionPoint(); list = ip.list; index = ip.index; }
    list.splice(index == null ? list.length : index, 0, node);
    S.selected = node.uid;
    commit();
    flushHistory();
    focusStep(node.uid);
  }

  function focusStep(nodeUid) {
    requestAnimationFrame(() => {
      const row = el.flow.querySelector(`[data-uid="${nodeUid}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const inp = row.querySelector('.text-input');
      if (inp) { inp.focus({ preventScroll: true }); if (inp.select && inp.value) inp.select(); }
    });
  }

  function deleteNode(nodeUid) {
    const f = M.findNode(S.model, nodeUid);
    if (!f || !f.node) return;
    const next = f.list[f.index + 1] || f.list[f.index - 1];
    f.list.splice(f.index, 1);
    S.selected = next ? next.uid : null;
    commit();
    flushHistory();
  }
  function duplicateNode(nodeUid) {
    const f = M.findNode(S.model, nodeUid);
    if (!f || !f.node) return;
    const c = M.cloneWithNewUids(f.node);
    f.list.splice(f.index + 1, 0, c);
    S.selected = c.uid;
    commit();
    flushHistory();
    focusStep(c.uid);
  }
  function moveNodeBy(nodeUid, delta) {
    const f = M.findNode(S.model, nodeUid);
    if (!f || !f.node) return;
    let j = f.index + delta;
    while (f.list[j] && f.list[j].auto) j += delta;
    if (j < 0 || j >= f.list.length) return;
    f.list.splice(f.index, 1);
    f.list.splice(j, 0, f.node);
    commit();
    focusRow(nodeUid);
  }
  function focusRow(nodeUid) {
    requestAnimationFrame(() => {
      const row = el.flow.querySelector(`[data-uid="${nodeUid}"]`);
      if (row) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function setSelected(id) {
    S.selected = id;
    $$('.step.selected, .empty-list.selected, .branch.selected', el.flow).forEach((x) => x.classList.remove('selected'));
    if (!id) return;
    const row = el.flow.querySelector(`[data-uid="${id}"]`);
    if (row) row.classList.add('selected');
    const br = el.flow.querySelector(`[data-branch="${id}"]`);
    if (br) {
      br.classList.add('selected');
      const empty = br.querySelector(':scope > .step-list > .empty-list');
      if (empty) empty.classList.add('selected');
    }
  }

  // --- Render ---
  const listReg = new Map();

  /**
   * Yeniden çizim sırasında kaydırma konumunu korur. İçerik bir anlığına boşaldığında konum 0'a
   * düşer; geri yükleme, builder'ın "smooth" kaydırması yüzünden animasyonlu olmasın diye anlık yapılır.
   */
  function keepScroll(fn) {
    const sc = el.bscroll;
    const st = sc.scrollTop;
    sc.style.scrollBehavior = 'auto';
    try { fn(); } finally {
      sc.scrollTop = st;
      sc.style.scrollBehavior = '';
    }
  }
  function renderBuilder() {
    keepScroll(() => { renderParticipants(); renderFlow(); });
  }

  function renderFlow() {
    listReg.clear();
    const counter = { n: 0 };
    el.flow.innerHTML = '';
    el.flow.append(renderList(S.model.items, 'root', counter));
    let steps = 0;
    M.walk(S.model.items, (it) => { if (!it.auto) steps++; });
    el.stepCount.textContent = steps;
    if (S.selected) setSelected(S.selected);
  }

  function renderList(items, listId, counter) {
    listReg.set(listId, items);
    const list = h('div', { class: 'step-list' + (listId === 'root' ? ' root' : ''), 'data-list': listId });
    if (!items.some((it) => !it.auto)) {
      if (listId === 'root') {
        list.append(h('div', { class: 'empty-list flow-empty' }, ico('blocks'), h('b', null, T('flow.empty')),
          h('span', null, T(S.model.participants.length >= 2 ? 'flow.emptyHintLink' : 'flow.emptyHintAdd'))));
      } else {
        list.append(h('div', { class: 'empty-list' + (S.selected === listId ? ' selected' : ''), 'data-select-branch': listId }, T('flow.dropHere')));
      }
    }
    items.forEach((it) => list.append(renderStep(it, counter)));
    return list;
  }

  function stepShell(it, cls) {
    return h('div', { class: `step ${cls}` + (S.selected === it.uid ? ' selected' : ''), 'data-uid': it.uid });
  }
  function handleEl() { return h('div', { class: 'handle', title: T('drag') }, ico('grip')); }
  function actionsEl(it, extra) {
    return h('div', { class: 'step-actions' },
      extra || null,
      h('button', { class: 'icon-btn', title: T('duplicateKey'), onclick: () => duplicateNode(it.uid) }, ico('copy')),
      h('button', { class: 'icon-btn del', title: T('deleteKey'), onclick: () => deleteNode(it.uid) }, ico('trash')));
  }
  /**
   * Metin alanı: "mono" olanlar tek satırlık input, diğerleri içeriğe göre büyüyen
   * textarea. Satır sonları Mermaid'e <br/> olarak yazılır. Yeni satır: Alt+Enter
   * (her yerde) ve Shift+Enter (opts.shiftNewline !== false iken; mesajda Shift+Enter
   * yanıt eklediği için kapalı). Düz Enter satır eklemez; alanın kendi davranışı çalışır.
   */
  function textInput(value, placeholder, onInput, cls, opts) {
    if (cls === 'mono') {
      const inp = h('input', { class: 'text-input mono', value: value || '', placeholder, spellcheck: 'false' });
      inp.addEventListener('input', () => { onInput(inp.value); commit({ rerender: false }); });
      inp.addEventListener('blur', flushHistory);
      return inp;
    }
    const ta = h('textarea', { class: 'text-input' + (cls ? ' ' + cls : ''), rows: 1, value: value || '', placeholder, spellcheck: 'false' });
    multiline(ta, opts);
    ta.addEventListener('input', () => { onInput(ta.value); commit({ rerender: false }); });
    ta.addEventListener('blur', flushHistory);
    return ta;
  }
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
  // Panel genişliği değişince satır kaymaları değişir → yükseklikleri yeniden hesapla
  const refitAll = debounce(() => $$('textarea.text-input, textarea.input').forEach(fitTextarea), 60);
  if (window.ResizeObserver) new ResizeObserver(refitAll).observe(el.flow);
  /** Tek satırlık yerlerde (select, rozet) gösterim için */
  const oneLine = (s) => String(s == null ? '' : s).replace(/\s*\n\s*/g, ' ');
  // ---------------------------------------------------------------------------
  // Katılımcı seçici: aranabilir combobox (kapalıyken eski <select> görünümünde)
  // ---------------------------------------------------------------------------
  /** Türkçe/aksan duyarsız karşılaştırma için normalize */
  const norm = (s) => String(s || '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');
  let combo = null; // { btn, pop, close }
  function closeCombo(refocus) {
    if (!combo) return;
    const c = combo;
    combo = null;
    c.pop.remove();
    window.removeEventListener('resize', c.onAway);
    el.bscroll.removeEventListener('scroll', c.onAway);
    document.removeEventListener('pointerdown', c.onDown, true);
    if (refocus && c.btn.isConnected) c.btn.focus({ preventScroll: true });
  }
  /** Yazılan adla yeni katılımcı ekler (popover açmadan) ve kimliğini döner. */
  function quickCreateParticipant(name) {
    const label = name.trim();
    const p = { uid: M.uid(), id: uniqueId(label), label, type: 'participant', boxId: null, implicit: false };
    S.model.participants.forEach((q) => { q.implicit = false; });
    S.model.participants.push(p);
    return p.id;
  }
  function openCombo(btn, value, allowEmpty, choose, initial) {
    closeCombo();
    const input = h('input', { class: 'pcombo-search', value: initial || '', placeholder: T('combo.search'), spellcheck: 'false', autocomplete: 'off', 'aria-label': T('combo.search') });
    const list = h('div', { class: 'pcombo-list', role: 'listbox' });
    const pop = h('div', { class: 'pcombo' }, input, list);
    let options = [], active = 0;

    const highlight = (text, q) => {
      if (!q) return text;
      const i = norm(text).indexOf(q);
      if (i < 0) return text;
      return [text.slice(0, i), h('mark', null, text.slice(i, i + q.length)), text.slice(i + q.length)];
    };
    const draw = () => {
      const q = norm(input.value.trim());
      const ps = S.model.participants.map((p) => ({ v: p.id, label: oneLine(p.label || p.id), id: p.id, c: colorOf(p.id) }));
      if (value && !ps.some((o) => o.v === value)) ps.push({ v: value, label: value, id: value, c: colorOf(value) });
      let shown = ps;
      if (q) {
        const rank = (o) => {
          const l = norm(o.label), i = norm(o.id);
          if (l.startsWith(q) || i.startsWith(q)) return 0;
          if (l.split(/\s+/).some((w) => w.startsWith(q))) return 1;
          if (l.includes(q) || i.includes(q)) return 2;
          return -1;
        };
        shown = ps.map((o) => [o, rank(o)]).filter(([, r]) => r >= 0).sort((a, b) => a[1] - b[1]).map(([o]) => o);
      }
      options = [];
      if (allowEmpty && !q) options.push({ v: '', label: '—', empty: true });
      options.push(...shown);
      const typed = input.value.trim();
      if (typed && !ps.some((o) => norm(o.label) === q || norm(o.id) === q)) options.push({ create: typed });
      // Açılışta mevcut değeri işaretle; aramada ilk sonucu
      active = q ? 0 : Math.max(0, options.findIndex((o) => o.v === value));
      list.innerHTML = '';
      if (!options.length) list.append(h('div', { class: 'pcombo-empty' }, T('combo.empty')));
      options.forEach((o, i) => {
        const row = o.create
          ? h('div', { class: 'pcombo-opt create', role: 'option' }, ico('plus'), h('span', { class: 'po-label' }, T('combo.create', { name: o.create })))
          : h('div', { class: 'pcombo-opt' + (o.v === value ? ' current' : ''), role: 'option', 'aria-selected': String(o.v === value) },
            h('span', { class: 'po-dot', style: o.empty ? null : `--pc:${o.c}` }),
            h('span', { class: 'po-label' }, highlight(o.label, q)),
            !o.empty && o.id !== o.label ? h('span', { class: 'po-id' }, o.id) : null);
        row.addEventListener('pointerdown', (e) => e.preventDefault()); // arama kutusu odağı kaybetmesin
        row.addEventListener('click', () => pick(i));
        row.addEventListener('pointermove', () => { if (active !== i) { active = i; mark(); } });
        list.append(row);
      });
      mark();
    };
    const mark = () => {
      $$('.pcombo-opt', list).forEach((r, i) => r.classList.toggle('active', i === active));
      const a = $$('.pcombo-opt', list)[active];
      if (a) a.scrollIntoView({ block: 'nearest' });
    };
    const pick = (i) => {
      const o = options[i];
      if (!o) return;
      const v = o.create ? quickCreateParticipant(o.create) : o.v;
      closeCombo();
      choose(v, !!o.create);
    };
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // genel kısayollar (Del, Enter, Esc…) devreye girmesin
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(options.length - 1, active + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); pick(active); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCombo(true); }
      else if (e.key === 'Tab') closeCombo();
    });

    document.body.append(pop);
    // Konum: düğmenin altında (sığmazsa üstünde); sabit konumlu olduğu için kaydırma alanında kesilmez
    const r = btn.getBoundingClientRect();
    const w = Math.max(r.width, 230);
    pop.style.width = w + 'px';
    pop.style.left = clamp(r.left, 8, window.innerWidth - w - 8) + 'px';
    draw();
    const ph = pop.offsetHeight;
    pop.style.top = (r.bottom + 4 + ph > window.innerHeight - 8 ? Math.max(8, r.top - 4 - ph) : r.bottom + 4) + 'px';
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);

    const onAway = () => closeCombo();
    const onDown = (e) => { if (!pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) closeCombo(); };
    window.addEventListener('resize', onAway);
    el.bscroll.addEventListener('scroll', onAway, { passive: true });
    document.addEventListener('pointerdown', onDown, true);
    combo = { btn, pop, onAway, onDown };
  }

  function pSelect(value, onChange, allowEmpty) {
    const p = participantById(value);
    const btn = h('button', { type: 'button', class: 'pselect', title: T('participant'), 'aria-haspopup': 'listbox' },
      value ? oneLine(p ? p.label || p.id : value) : '—');
    btn.style.setProperty('--pc', value ? colorOf(value) : 'transparent');
    const choose = (v, created) => {
      if (v === value && !created) return;
      onChange(v);
      commit();
      flushHistory();
    };
    const open = (initial) => openCombo(btn, value, allowEmpty, choose, initial);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (combo && combo.btn === btn) closeCombo(); else open('');
    });
    // Odaktayken yazmaya başlamak aramayı o harfle açar
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(''); }
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); open(e.key); }
    });
    return btn;
  }

  function renderStep(it, counter) {
    switch (it.kind) {
      case 'message': return renderMessage(it, counter);
      case 'note': return it.ref != null ? renderRef(it) : renderNote(it);
      // Otomatik aktivasyonun ürettiği düzeltme satırları gizli tutulur; DOM'da
      // yer almaları sürükle-bırak indekslerinin modelle hizalı kalmasını sağlar.
      case 'activation': return it.auto ? h('div', { class: 'step auto-act', hidden: true, 'data-uid': it.uid }) : renderActivation(it);
      case 'block': return renderBlock(it, counter);
      default: return renderRaw(it);
    }
  }

  function renderMessage(it, counter) {
    counter.n++;
    const row = stepShell(it, 'step-message' + (it.arrow.startsWith('--') || it.arrow.startsWith('<<--') ? ' reply' : ''));
    if (it.tone && TONE_COLORS[it.tone]) { row.classList.add('toned'); row.style.setProperty('--c', TONE_COLORS[it.tone]); }
    const aSel = h('select', { class: 'aselect', title: T('arrow.title') });
    M.ARROWS.forEach((a) => aSel.append(h('option', { value: a.v }, a.glyph + '  ' + T('arrow.' + a.v))));
    if (!M.ARROWS.some((a) => a.v === it.arrow)) aSel.append(h('option', { value: it.arrow }, it.arrow));
    aSel.value = it.arrow;
    // Seçili değerde sadece glifi göster
    const shortLabel = () => { $$('option', aSel).forEach((o) => { const a = M.ARROWS.find((x) => x.v === o.value); o.textContent = a ? (o.selected ? a.glyph : a.glyph + '  ' + T('arrow.' + a.v)) : o.value; }); };
    aSel.addEventListener('focus', () => $$('option', aSel).forEach((o) => { const a = M.ARROWS.find((x) => x.v === o.value); if (a) o.textContent = a.glyph + '  ' + T('arrow.' + a.v); }));
    aSel.addEventListener('blur', shortLabel);
    aSel.addEventListener('change', () => { it.arrow = aSel.value; commit(); flushHistory(); });
    shortLabel();

    let actBtn = null;
    if (isAutoAct()) {
      // Otomatik mod: hesaplanan başlangıç / bitişi salt okunur rozet olarak göster
      if (it.act) {
        const who = participantById(it.act === '+' ? it.to : it.from);
        const name = oneLine(who ? who.label || who.id : (it.act === '+' ? it.to : it.from));
        actBtn = h('span', { class: 'act-badge ' + (it.act === '+' ? 'start' : 'end'), title: T(it.act === '+' ? 'act.autoStart' : 'act.autoEnd', { name }) },
          ico('activate'), h('span', { class: 'act-name' }, (it.act === '+' ? '▶ ' : '■ ') + name));
      }
    } else {
      actBtn = h('button', { class: 'act-btn' + (it.act === '+' ? ' on' : it.act === '-' ? ' off' : ''), title: actLabel(it.act) + ' — ' + T('act.click') },
        ico('activate'), it.act === '+' ? '+' : it.act === '-' ? '−' : '');
      actBtn.addEventListener('click', () => { it.act = it.act === '' ? '+' : it.act === '+' ? '-' : ''; commit(); flushHistory(); });
    }

    const txt = textInput(it.text, T('ph.message'), (v) => { it.text = v; }, null, { shiftNewline: false });
    txt.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        S.selected = it.uid;
        const reply = e.shiftKey
          ? { uid: M.uid(), kind: 'message', from: it.to, to: it.from, arrow: it.arrow.startsWith('--') ? '->>' : '-->>', act: '', text: it.arrow.startsWith('--') ? '' : REPLY_TEXT }
          : { uid: M.uid(), kind: 'message', from: it.from, to: it.to, arrow: it.arrow, act: '', text: '' };
        insertNode(reply);
      }
    });
    add(row, 
      handleEl(),
      S.model.autonumber ? h('span', { class: 'num' }, counter.n) : null,
      h('div', { class: 'route' },
        pSelect(it.from, (v) => { it.from = v; }),
        aSel,
        pSelect(it.to, (v) => { it.to = v; })),
      toneBtn(it),
      txt,
      actBtn,
      actionsEl(it, h('button', { class: 'icon-btn', title: T('swap'), onclick: () => { [it.from, it.to] = [it.to, it.from]; commit(); flushHistory(); } }, ico('swap'))),
    );
    return row;
  }

  /** Mesaj tonu seçici: küçük renkli nokta → menü (Varsayılan / Başarılı / Hata / Uyarı / Bilgi) */
  function toneBtn(it) {
    const btn = h('button', { class: 'tone-btn' + (it.tone ? ' on' : ''), title: T('tone.title') + (it.tone ? ': ' + T('tone.' + it.tone) : ''),
      style: it.tone ? `--tc:${TONE_COLORS[it.tone]}` : null });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = btn.parentNode.querySelector('.tone-menu');
      closeColorMenus();
      if (open) return;
      const set = (v) => {
        if (v) it.tone = v; else delete it.tone;
        closeColorMenus();
        commit(); flushHistory();
      };
      const menu = h('div', { class: 'color-menu tone-menu', onclick: (ev) => ev.stopPropagation() },
        [''].concat(M.TONES).map((v) => h('button', { class: 'tm-opt' + ((it.tone || '') === v ? ' current' : ''), onclick: () => set(v) },
          h('span', { class: 'tm-dot', style: v ? `--tc:${TONE_COLORS[v]}` : null }),
          h('span', { class: 'tm-line', style: v ? `--tc:${TONE_COLORS[v]}` : null }),
          T(v ? 'tone.' + v : 'tone.none'))));
      btn.after(menu);
      // Noktanın altına hizala (satır dışına taşmadan)
      const row = btn.closest('.step-message');
      menu.style.left = Math.max(0, Math.min(btn.offsetLeft - 8, row.clientWidth - menu.offsetWidth - 4)) + 'px';
    });
    return btn;
  }

  /** Referans adımı: başka bir diyagrama bağlanan not (Mermaid'de "Note over") */
  function renderRef(it) {
    const target = S.docs.find((d) => d.id === it.ref);
    const row = stepShell(it, 'step-note step-ref' + (target ? '' : ' ref-broken'));
    const sel = h('select', { class: 'mini-select ref-select', title: T('ref.target') });
    if (!target) sel.append(h('option', { value: it.ref }, T('ref.missing')));
    // Diyagramlar klasör yollarına göre gruplu
    const groups = new Map();
    S.docs.filter((d) => d !== S.doc).sort((a, b) => a.name.localeCompare(b.name, I18N.getLang())).forEach((d) => {
      const path = folderPath(d.folder) || T('folder.root');
      if (!groups.has(path)) groups.set(path, []);
      groups.get(path).push(d);
    });
    [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], I18N.getLang())).forEach(([path, ds]) =>
      sel.append(h('optgroup', { label: path }, ds.map((d) => h('option', { value: d.id }, d.name)))));
    sel.value = it.ref;
    sel.addEventListener('change', () => {
      const old = S.docs.find((d) => d.id === it.ref);
      const nd = S.docs.find((d) => d.id === sel.value);
      // Etiket boşsa ya da eski hedefin adıysa (elle değiştirilmemişse) yeni hedefin adını al
      if (nd && (!String(it.text).trim() || (old && it.text === old.name))) it.text = nd.name;
      it.ref = sel.value;
      commit(); flushHistory();
    });
    add(row,
      handleEl(),
      h('span', { class: 'kind-badge' }, ico('link'), T('badge.ref')),
      pSelect(it.targets[0], (v) => { it.targets[0] = v; }),
      // İkinci katılımcı isteğe bağlı: yalnızca "Genişlet" ile ya da zaten iki katılımcılı referanslarda
      it.targets[1]
        ? pSelect(it.targets[1], (v) => { it.targets = v ? [it.targets[0], v] : [it.targets[0]]; }, true)
        : h('button', { class: 'ref-span', title: T('ref.spanTitle'), onclick: () => {
          const P = S.model.participants;
          const i = P.findIndex((p) => p.id === it.targets[0]);
          const next = P[i + 1] || P[i - 1];
          if (!next) return;
          it.targets = [it.targets[0], next.id];
          commit(); flushHistory();
        } }, ico('plus'), T('ref.span')),
      sel,
      textInput(it.text, T('ph.refLabel'), (v) => { it.text = v; }),
      h('button', { class: 'icon-btn ref-open', title: T('ref.open'), disabled: !target || null, onclick: () => followRef(it.ref) }, ico('external')),
      actionsEl(it),
    );
    return row;
  }

  function renderNote(it) {
    const row = stepShell(it, 'step-note');
    const pos = h('select', { class: 'mini-select', title: T('note.pos') },
      h('option', { value: 'right of' }, T('note.right')), h('option', { value: 'left of' }, T('note.left')), h('option', { value: 'over' }, T('note.over')));
    pos.value = it.position;
    pos.addEventListener('change', () => { it.position = pos.value; if (pos.value !== 'over') it.targets = it.targets.slice(0, 1); commit(); flushHistory(); });
    add(row, 
      handleEl(),
      h('span', { class: 'kind-badge' }, ico('note'), T('badge.note')),
      pos,
      pSelect(it.targets[0], (v) => { it.targets[0] = v; }),
      it.position === 'over' ? pSelect(it.targets[1] || '', (v) => { it.targets = v ? [it.targets[0], v] : [it.targets[0]]; }, true) : null,
      textInput(it.text, T('ph.note'), (v) => { it.text = v; }),
      actionsEl(it),
    );
    return row;
  }

  function renderActivation(it) {
    const row = stepShell(it, 'step-activation');
    const act = h('select', { class: 'mini-select' }, h('option', { value: 'activate' }, T('activation.on')), h('option', { value: 'deactivate' }, T('activation.off')));
    act.value = it.action;
    act.addEventListener('change', () => { it.action = act.value; commit(); flushHistory(); });
    add(row, handleEl(), h('span', { class: 'kind-badge' }, ico('activate'), T('badge.activation')), act, pSelect(it.participant, (v) => { it.participant = v; }), h('span', { style: 'flex:1' }), actionsEl(it));
    return row;
  }

  function renderRaw(it) {
    const row = stepShell(it, 'step-raw');
    add(row, handleEl(), h('span', { class: 'kind-badge' }, ico('raw'), T('badge.raw')), textInput(it.text, T('ph.raw'), (v) => { it.text = v; }, 'mono'), actionsEl(it));
    return row;
  }

  function renderBlock(it, counter) {
    const def = M.BLOCK_TYPES[it.type] || { label: it.type, branch: 'and' };
    const branchKw = it.type === 'par_over' ? 'and' : def.branch;
    const collapsed = S.collapsed.has(it.uid);
    const node = h('div', { class: `step block block-${it.type}` + (S.selected === it.uid ? ' selected' : '') + (collapsed ? ' collapsed' : ''), 'data-uid': it.uid, style: it.color && it.type !== 'rect' ? `--c:${it.color}` : null });
    const b0 = it.branches[0];

    let labelEl;
    if (it.type === 'rect') {
      labelEl = h('div', { class: 'row', style: 'flex:1 1 160px; gap:6px' },
        h('div', { class: 'swatches' }, RECT_SWATCHES.map((c) => h('button', { class: 'swatch', style: `background:${c}`, title: c, onclick: () => { b0.label = c; commit(); flushHistory(); } }))),
        textInput(b0.label, branchPh('rect'), (v) => { b0.label = v; }, 'mono'));
    } else {
      labelEl = textInput(b0.label, branchPh(it.type), (v) => { b0.label = v; });
    }

    let inner = 0;
    M.walk(it.branches.flatMap((b) => b.items), () => { inner++; });
    const head = h('div', { class: 'block-head' },
      handleEl(),
      h('span', { class: 'kind-badge' }, ico(it.type === 'par_over' ? 'par' : it.type), def.label),
      it.type !== 'rect' ? blockColorBtn(it) : null,
      labelEl,
      collapsed ? h('span', { class: 'collapsed-info' }, T('block.steps', { n: inner })) : null,
      branchKw ? h('button', { class: 'add-branch', title: T('block.addBranch', { kw: branchKw }), onclick: () => {
        const br = { uid: M.uid(), label: branchKw === 'else' ? T('bd.else') : '', items: [] };
        it.branches.push(br);
        S.collapsed.delete(it.uid);
        S.selected = br.uid;
        commit(); flushHistory();
      } }, ico('plus'), BRANCH_LABEL[branchKw]) : null,
      h('div', { class: 'step-actions' },
        h('button', { class: 'icon-btn collapse-btn', title: T(collapsed ? 'expand' : 'collapse'), onclick: () => { collapsed ? S.collapsed.delete(it.uid) : S.collapsed.add(it.uid); keepScroll(renderFlow); } }, ico('collapse')),
        h('button', { class: 'icon-btn', title: T('unwrap'), onclick: () => unwrapBlock(it.uid) }, ico('fit')),
        h('button', { class: 'icon-btn', title: T('duplicateKey'), onclick: () => duplicateNode(it.uid) }, ico('copy')),
        h('button', { class: 'icon-btn del', title: T('delete'), onclick: () => { if (inner && !confirm(T('block.confirmDelete', { n: inner }))) return; deleteNode(it.uid); } }, ico('trash'))),
    );
    node.append(head);

    it.branches.forEach((br, idx) => {
      if (idx > 0) {
        add(node, h('div', { class: 'branch-head' },
          h('span', { class: 'kind-badge' }, BRANCH_LABEL[branchKw] || 'Else'),
          textInput(br.label, branchKw === 'else' ? T('ph.else') : T('ph.label'), (v) => { br.label = v; }),
          h('div', { class: 'step-actions', style: 'opacity:1' },
            h('button', { class: 'icon-btn del', title: T('branch.delete'), onclick: () => {
              it.branches[idx - 1].items.push(...br.items);
              it.branches.splice(idx, 1);
              commit(); flushHistory();
            } }, ico('x')))));
      }
      const brEl = h('div', { class: 'branch', 'data-branch': br.uid });
      brEl.append(renderList(br.items, br.uid, counter));
      node.append(brEl);
    });
    return node;
  }

  // Blok rengi: hazır renkler + özel renk + varsayılana dön. Kodda "%% @color #hex" olarak saklanır.
  const BLOCK_SWATCHES = ['#f0a020', '#f97a3c', '#f05252', '#ec5a8f', '#9b6bff', '#6c7cff', '#3aa0ff', '#1fb5c9', '#2fbf7f', '#8a93a6'];
  function closeColorMenus() { $$('.color-menu').forEach((m) => m.remove()); }
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target.closest && e.target.closest('.color-menu, .block-color, .tone-btn'))) closeColorMenus();
  });
  function blockColorBtn(it) {
    const setColor = (c) => {
      if (c) it.color = c; else delete it.color;
      closeColorMenus();
      commit();
      flushHistory();
    };
    const btn = h('button', { class: 'block-color' + (it.color ? ' custom' : ''), title: T('block.color') });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = btn.parentNode.querySelector('.color-menu');
      closeColorMenus();
      if (open) return;
      const custom = h('input', { type: 'color', value: it.color || getComputedStyle(btn).getPropertyValue('--c').trim() || '#6c7cff' });
      custom.addEventListener('change', () => setColor(custom.value.toLowerCase()));
      const menu = h('div', { class: 'color-menu', onclick: (ev) => ev.stopPropagation() },
        h('div', { class: 'swatches' }, BLOCK_SWATCHES.map((c) => h('button', {
          class: 'swatch' + (it.color === c ? ' active' : ''), style: `background:${c}`, title: c, onclick: () => setColor(c),
        }))),
        h('div', { class: 'cm-row' },
          h('label', { class: 'cm-custom' }, custom, h('span', null, T('block.colorCustom'))),
          it.color ? h('button', { class: 'btn ghost sm', onclick: () => setColor(null) }, T('block.colorReset')) : null));
      btn.after(menu);
    });
    return btn;
  }

  function unwrapBlock(nodeUid) {
    const f = M.findNode(S.model, nodeUid);
    if (!f || !f.node) return;
    const items = f.node.branches.flatMap((b) => b.items);
    f.list.splice(f.index, 1, ...items);
    S.selected = items[0] ? items[0].uid : null;
    commit();
    flushHistory();
  }

  // Akış alanında seçim
  el.flow.addEventListener('focusin', (e) => {
    const row = e.target.closest('[data-uid]');
    if (row && S.selected !== row.dataset.uid) setSelected(row.dataset.uid);
  });
  el.flow.addEventListener('pointerdown', (e) => {
    const t = e.target;
    const sb = t.closest('[data-select-branch]');
    if (sb) { setSelected(sb.dataset.selectBranch); return; }
    // Kolun boş alanına tıklandı → eklemeler bu kolun sonuna yapılır
    if (t.classList.contains('branch') || (t.classList.contains('step-list') && !t.classList.contains('root'))) {
      setSelected(t.closest('.branch').dataset.branch);
      return;
    }
    const row = t.closest('[data-uid]');
    setSelected(row ? row.dataset.uid : null);
  });

  // ---------------------------------------------------------------------------
  // Sürükle-bırak (akış)
  // ---------------------------------------------------------------------------
  function startDrag(e, data) {
    S.drag = data;
    e.dataTransfer.effectAllowed = data.kind === 'newStep' || data.kind === 'newPart' ? 'copy' : 'move';
    try { e.dataTransfer.setData('text/plain', data.type || data.uid || ''); } catch (_) { /* yok say */ }
  }
  function endDrag() {
    S.drag = null;
    clearDropLine();
    clearPMarker();
    $$('.step.dragging').forEach((x) => { x.classList.remove('dragging'); x.draggable = false; });
  }

  // Tutamaçtan basınca satırı sürüklenebilir yap
  el.flow.addEventListener('mousedown', (e) => {
    const hd = e.target.closest('.handle');
    if (!hd) return;
    const row = hd.closest('.step');
    row.draggable = true;
    const off = () => { if (!S.drag) row.draggable = false; window.removeEventListener('mouseup', off); };
    window.addEventListener('mouseup', off);
  });
  el.flow.addEventListener('dragstart', (e) => {
    const row = e.target;
    if (!(row instanceof HTMLElement) || !row.classList.contains('step')) return;
    startDrag(e, { kind: 'step', uid: row.dataset.uid });
    e.dataTransfer.setDragImage(row, 20, 20);
    setTimeout(() => row.classList.add('dragging'), 0);
  });
  el.flow.addEventListener('dragend', endDrag);

  let dropLine = null, dropTarget = null;
  function clearDropLine() { if (dropLine) dropLine.remove(); dropLine = null; dropTarget = null; }

  function findDropTarget(e) {
    let c = e.target.closest('.branch, .step-list');
    if (!c || !el.flow.contains(c)) c = el.flow.querySelector('.step-list.root');
    const list = c.classList.contains('branch') ? c.querySelector(':scope > .step-list') : c;
    const listId = list.dataset.list;
    // Bir bloğu kendi içine bırakmayı engelle
    if (S.drag.kind === 'step') {
      const dragged = el.flow.querySelector(`[data-uid="${S.drag.uid}"]`);
      if (dragged && dragged.contains(list)) return null;
    }
    const kids = $$(':scope > .step', list);
    let index = kids.length, ref = null;
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { index = i; ref = kids[i]; break; }
    }
    return { list, listId, index, ref };
  }

  el.flow.addEventListener('dragover', (e) => {
    if (!S.drag || (S.drag.kind !== 'step' && S.drag.kind !== 'newStep')) return;
    const t = findDropTarget(e);
    if (!t) { clearDropLine(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = S.drag.kind === 'step' ? 'move' : 'copy';
    dropTarget = t;
    if (!dropLine) dropLine = h('div', { class: 'drop-line' });
    const ref = t.ref || null;
    if (dropLine.parentNode !== t.list || dropLine.nextSibling !== ref) t.list.insertBefore(dropLine, ref);
  });
  el.flow.addEventListener('dragleave', (e) => { if (!el.flow.contains(e.relatedTarget)) clearDropLine(); });
  el.flow.addEventListener('drop', (e) => {
    if (!S.drag || !dropTarget) return;
    e.preventDefault();
    const { listId, index } = dropTarget;
    const target = listReg.get(listId);
    const d = S.drag;
    clearDropLine();
    if (!target) return;
    if (d.kind === 'newStep') { addStep(d.type, target, index); return; }
    if (d.kind === 'step') {
      const f = M.findNode(S.model, d.uid);
      if (!f || !f.node) return;
      let idx = index;
      if (f.list === target && f.index < index) idx--;
      f.list.splice(f.index, 1);
      target.splice(idx, 0, f.node);
      S.selected = f.node.uid;
      commit();
      flushHistory();
    }
  });

  // Sayfa dışına dosya sürükleyip bırakma (içe aktarma)
  let fileDragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { fileDragDepth++; document.body.classList.add('file-drop'); } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --fileDragDepth <= 0) { fileDragDepth = 0; document.body.classList.remove('file-drop'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    fileDragDepth = 0;
    document.body.classList.remove('file-drop');
    const f = e.dataTransfer.files[0];
    if (f) importFile(f);
  });

  // ---------------------------------------------------------------------------
  // İçe aktarma / paylaşım
  // ---------------------------------------------------------------------------
  function importFile(file) {
    const r = new FileReader();
    r.onload = () => {
      let text = String(r.result || '');
      const fence = text.match(/```mermaid\s*\n([\s\S]*?)```/);
      if (fence) text = fence[1];
      if (!/sequenceDiagram/.test(text)) toast(T('import.noSeq'), 'err');
      createDoc(file.name.replace(/\.(mmd|mermaid|txt|md)$/i, ''), text.trim() + '\n');
      toast(T('import.done', { name: file.name }));
    };
    r.readAsText(file);
  }
  el.fileInput.addEventListener('change', () => { const f = el.fileInput.files[0]; if (f) importFile(f); el.fileInput.value = ''; });

  const b64url = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64url = (s) => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };

  /**
   * Paylaşım linki. Yeni biçim ("y"): ad + girintisi atılmış kod tek parça olarak deflate ile sıkıştırılır
   * (ad URL'de ayrıca kodlanmaz, girinti tekrarları atılır). Açılınca kod standart girintiyle yeniden yazılır.
   * Eski "z"/"b" linkleri açılmaya devam eder.
   */
  const SHARE_WARN_LEN = 8000;
  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  async function encodeShare(code, name) {
    const flat = code.split('\n').map((l) => l.trim()).join('\n');
    const bytes = new TextEncoder().encode((name || '').replace(/\n/g, ' ') + '\n' + flat);
    if ('CompressionStream' in window) return 'y' + b64url(await deflate(bytes));
    return 'c' + b64url(bytes);
  }
  /** Döner: { code, name } (eski biçimlerde name = null) */
  async function decodeShare(s) {
    const kind = s[0], bytes = fromB64url(s.slice(1));
    if (kind === 'y' || kind === 'c') {
      const text = kind === 'y' ? await inflate(bytes) : new TextDecoder().decode(bytes);
      const nl = text.indexOf('\n');
      let code = text.slice(nl + 1);
      // Girintiyi geri kazandır (kod Studio biçimindeyse okunup yeniden yazılır)
      try { if (/^\s*sequenceDiagram\b/.test(code)) code = M.serialize(M.parse(code)); } catch (e) { /* olduğu gibi kalsın */ }
      return { code, name: text.slice(0, nl) || null };
    }
    if (kind === 'z') return { code: await inflate(bytes), name: null };
    return { code: new TextDecoder().decode(bytes), name: null };
  }
  async function copyShareLink() {
    const enc = await encodeShare(S.code, S.doc.name);
    const url = location.href.split('#')[0] + '#s=' + enc;
    try { await navigator.clipboard.writeText(url); toast(T('share.copied')); }
    catch (e) { prompt(T('share.prompt'), url); }
    if (url.length > SHARE_WARN_LEN) setTimeout(() => toast(T('share.long', { n: url.length.toLocaleString(I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US') }), 'err'), 300);
  }
  async function loadFromHash() {
    const m = location.hash.match(/#s=([^&]+)(?:&n=([^&]*))?/);
    if (!m) return false;
    try {
      const { code, name } = await decodeShare(m[1]);
      createDoc(name || (m[2] ? decodeURIComponent(m[2]) : T('share.docName')), code);
      toast(T('share.opened'));
    } catch (e) { toast(T('share.failed'), 'err'); }
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  function openModal(title, body, wide) {
    el.modalTitle.textContent = title;
    el.modalBody.innerHTML = '';
    el.modalBody.append(body);
    $('.modal', el.modalRoot).classList.toggle('wide', !!wide);
    el.modalRoot.hidden = false;
  }
  function closeModal() { el.modalRoot.hidden = true; el.modalBody.innerHTML = ''; }
  el.modalRoot.addEventListener('pointerdown', (e) => { if (e.target === el.modalRoot) closeModal(); });
  $('[data-close]', el.modalRoot).addEventListener('click', closeModal);

  // --- Dışa aktarma ---
  const FORMATS = [
    { v: 'png', ic: 'image' },
    { v: 'svg', ic: 'vector' },
    { v: 'mmd', ic: 'code' },
    { v: 'txt', ic: 'file' },
    { v: 'drawio', ic: 'drawio' },
  ];
  const EXT = { png: '.png', svg: '.svg', mmd: '.mmd', txt: '.txt', drawio: '.drawio' };
  /** Çizilmiş (DOM'daki) SVG'yi draw.io dosyasına çevirir; konum ve renkler önizlemedeki gibidir. */
  function toDrawio(svgEl, model, name) {
    const types = {};
    model.participants.forEach((p) => { types[p.id] = p.type; });
    const bg = exportBg();
    return window.SeqDrawio.convert(svgEl, { types, name, background: bg === 'transparent' ? 'none' : bg });
  }
  const safeName = () => (S.doc && S.doc.name ? S.doc.name : 'diagram').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'diagram';

  function buildExportSvg(bg, src = $('.paper svg', el.canvas)) {
    if (!src) return null;
    const svg = src.cloneNode(true);
    const vb = src.viewBox && src.viewBox.baseVal && src.viewBox.baseVal.width ? src.viewBox.baseVal : { x: 0, y: 0, width: src.getBBox().width, height: src.getBBox().height };
    const pad = 16;
    const x = vb.x - pad, y = vb.y - pad, w = Math.ceil(vb.width + pad * 2), ht = Math.ceil(vb.height + pad * 2);
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${ht}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', ht);
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svg.style.maxWidth = '';
    svg.style.backgroundColor = '';
    if (bg && bg !== 'transparent') {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x); rect.setAttribute('y', y); rect.setAttribute('width', w); rect.setAttribute('height', ht);
      rect.setAttribute('fill', bg);
      svg.insertBefore(rect, svg.firstChild);
    }
    return { markup: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg), w, h: ht };
  }
  function exportBg() {
    const b = S.settings.exp.bg;
    if (b === 'transparent') return 'transparent';
    if (b === 'white') return '#ffffff';
    return PAPER_BG[mmThemeName()] || '#ffffff';
  }
  /**
   * Arka plan seçimi satırı (tek diyagram ve klasör dışa aktarmada ortak). "Tema" gerçek rengini bir
   * renk noktasıyla gösterir (açık temada beyazla aynı olduğu anlaşılsın); şeffafta formata göre not çıkar.
   */
  function bgOptionRows(ex, seg) {
    const themeColor = PAPER_BG[mmThemeName()] || '#ffffff';
    const themeLabel = h('span', { class: 'bg-opt' }, h('span', { class: 'bg-dot', style: `--bg:${themeColor}` }), T('exp.bgTheme'));
    const rows = [h('div', { class: 'opt-row' }, h('label', null, T('exp.bg')),
      seg([['theme', themeLabel], ['white', T('exp.bgWhite')], ['transparent', T('exp.bgTransparent')]], ex.bg, (v) => { ex.bg = v; }))];
    if (ex.bg === 'transparent') rows.push(h('p', { class: 'bg-note' }, ico('help'), T(ex.format === 'drawio' ? 'exp.bgTransDrawio' : 'exp.bgTransHint')));
    return rows;
  }
  function effectiveScale(w, ht) {
    let s = S.settings.exp.scale;
    while (s > 1 && (Math.max(w, ht) * s > 16000 || w * ht * s * s > 120e6)) s -= 0.5;
    return s;
  }
  async function svgToPngBlob(markup, w, ht, scale) {
    const img = new Image();
    img.decoding = 'async';
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error(T('exp.svgLoad'))); img.src = url; });
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(ht * scale);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(T('exp.pngFail')))), 'image/png'));
    } finally { URL.revokeObjectURL(url); }
  }

  function openExport() {
    if (el.code.value !== S.code) applyCode(el.code.value, 'code');
    refreshAutoAct();
    flushHistory();
    const ex = S.settings.exp;
    const body = h('div');
    const draw = () => {
      body.innerHTML = '';
      const isImg = ex.format === 'png' || ex.format === 'svg' || ex.format === 'drawio';
      const grid = h('div', { class: 'fmt-grid' });
      FORMATS.forEach((f) => grid.append(h('button', { class: 'fmt' + (ex.format === f.v ? ' active' : ''), onclick: () => { ex.format = f.v; saveSettings(); draw(); } }, ico(f.ic), h('b', null, T('fmt.' + f.v)), h('span', null, T('fmt.' + f.v + '.desc')))));
      body.append(grid);

      const nameIn = h('input', { class: 'input', value: safeName(), spellcheck: 'false' });
      const ext = EXT[ex.format];

      if (isImg) {
        if (!S.lastOk) body.append(h('div', { class: 'render-error', style: 'position:static;margin-bottom:12px' }, ico('critical'), T('exp.hasError')));
        const built = buildExportSvg(exportBg());
        const prev = h('div', { class: 'export-preview' });
        const dim = h('span', { class: 'dim-info' });
        if (built) {
          const img = h('img', { alt: T('exp.preview'), src: URL.createObjectURL(new Blob([built.markup], { type: 'image/svg+xml' })) });
          prev.append(img);
          const sc = effectiveScale(built.w, built.h);
          dim.textContent = ex.format === 'png' ? `${Math.round(built.w * sc)} × ${Math.round(built.h * sc)} px` : ex.format === 'drawio' ? T('exp.drawioInfo') : `${built.w} × ${built.h} (${T('exp.vector')})`;
        } else prev.append(h('span', { class: 'dim-info' }, T('exp.nothing')));
        body.append(prev);

        const seg = (opts, val, on) => h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: v === val ? 'active' : '', onclick: () => { on(v); saveSettings(); draw(); } }, l)));
        if (ex.format === 'png') body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.scale')), seg([[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']], ex.scale, (v) => { ex.scale = v; })));
        body.append(...bgOptionRows(ex, seg));
        body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.size')), dim));
      } else {
        body.append(h('pre', { class: 'export-code', style: 'margin:0 0 12px;max-height:260px;overflow:auto;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--code-bg);font:12px/1.55 var(--mono)' }, S.code));
      }
      body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.filename')), h('div', { class: 'row', style: 'max-width:340px;gap:6px' }, nameIn, h('span', { class: 'dim-info', style: 'flex:none' }, ext))));

      const doDownload = async () => {
        const fname = (nameIn.value.trim() || 'diagram') + ext;
        try {
          if (ex.format === 'mmd' || ex.format === 'txt') {
            downloadBlob(new Blob([S.code], { type: 'text/plain;charset=utf-8' }), fname);
          } else if (ex.format === 'drawio') {
            const src = $('.paper svg', el.canvas);
            if (!src) return toast(T('exp.nothing'), 'err');
            downloadBlob(new Blob([toDrawio(src, S.model, nameIn.value.trim() || safeName())], { type: 'application/vnd.jgraph.mxfile;charset=utf-8' }), fname);
          } else {
            const built = buildExportSvg(exportBg());
            if (!built) return toast(T('exp.nothing'), 'err');
            if (ex.format === 'svg') downloadBlob(new Blob([built.markup], { type: 'image/svg+xml;charset=utf-8' }), fname);
            else downloadBlob(await svgToPngBlob(built.markup, built.w, built.h, effectiveScale(built.w, built.h)), fname);
          }
          toast(T('exp.downloaded', { name: fname }));
          closeModal();
        } catch (err) { toast(T('exp.failed', { msg: err.message }), 'err'); }
      };
      const doCopy = async () => {
        try {
          if (ex.format === 'png') {
            const built = buildExportSvg(exportBg());
            if (!built) return;
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': svgToPngBlob(built.markup, built.w, built.h, effectiveScale(built.w, built.h)) })]);
            toast(T('exp.pngCopied'));
          } else if (ex.format === 'svg') {
            const built = buildExportSvg(exportBg());
            if (!built) return;
            await navigator.clipboard.writeText(built.markup);
            toast(T('exp.svgCopied'));
          } else if (ex.format === 'drawio') {
            const src = $('.paper svg', el.canvas);
            if (!src) return;
            await navigator.clipboard.writeText(toDrawio(src, S.model, safeName()));
            toast(T('exp.drawioCopied'));
          } else {
            await navigator.clipboard.writeText(S.code);
            toast(T('exp.codeCopied'));
          }
        } catch (err) { toast(T('exp.copyFailed', { msg: err.message }), 'err'); }
      };
      body.append(h('div', { class: 'export-actions' },
        h('div', { class: 'left' },
          h('button', { class: 'btn', onclick: doCopy }, ico('copy'), T('exp.copy')),
          h('button', { class: 'btn ghost', onclick: copyShareLink, title: T('exp.shareTitle') }, ico('share'), T('exp.share'))),
        h('div', { class: 'right' }, h('button', { class: 'btn primary', onclick: doDownload }, ico('download'), T('exp.download')))));
    };
    draw();
    openModal(T('exp.title'), body);
  }

  // --- Çalışma alanı yedeği (tüm diyagramlar, klasörler, roller, ayarlar) ---
  const BACKUP_KIND = 'sequence-studio-workspace';
  const BACKUP_DUE_MS = 7 * 24 * 3600 * 1000;
  const fmtBytes = (n) => (n == null ? '—' : n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(1) + ' GB')
    .replace('.', I18N.getLang() === 'tr' ? ',' : '.');
  /** Yedeklenmemiş değişiklik var ve son yedek (ya da ilk kullanım) 7 günden eski mi? */
  function backupDue() {
    if (!S.docs.length) return false;
    const last = S.settings.lastBackup || 0;
    const changed = S.docs.some((d) => (d.updated || 0) > last);
    return changed && Date.now() - (last || S.settings.firstUse || Date.now()) > BACKUP_DUE_MS;
  }
  function buildBackup() {
    if (S.doc && S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
    return {
      kind: BACKUP_KIND, version: 1, app: 'Sequence Studio', exportedAt: new Date().toISOString(),
      docs: S.docs, folders: S.folders, roles: S.roles || [], settings: S.settings, current: S.doc && S.doc.id,
    };
  }
  function downloadBackup() {
    const b = buildBackup();
    const day = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }), T('backup.fileName', { date: day }) + '.json');
    S.settings.lastBackup = Date.now();
    saveSettings();
    persistDocs();
    refreshBackupUi();
    toast(T('backup.done', { n: b.docs.length }));
  }

  /** Yedek dosyasını doğrular; geçerli diyagram/klasör/rol listelerini döner (geçersiz kayıtlar atlanır). */
  function parseBackup(text) {
    const b = JSON.parse(text);
    if (!b || b.kind !== BACKUP_KIND || !Array.isArray(b.docs)) throw new Error('kind');
    const docs = b.docs.filter((d) => d && typeof d.id === 'string' && typeof d.code === 'string')
      .map((d) => Object.assign({}, d, { name: String(d.name || T('doc.untitled')), updated: +d.updated || Date.now() }));
    const folders = (Array.isArray(b.folders) ? b.folders : []).filter((f) => f && typeof f.id === 'string').map((f) => Object.assign({}, f, { name: String(f.name || T('folder.new')) }));
    const okType = (t) => M.PARTICIPANT_TYPES.some((x) => x.v === t);
    const roles = (Array.isArray(b.roles) ? b.roles : []).filter((r) => r && /^[A-Za-z0-9_-]+$/.test(r.id || '') && okType(r.type) && /^#[0-9a-f]{6}$/i.test(r.color || ''));
    return { docs, folders, roles, exportedAt: b.exportedAt, current: b.current };
  }

  /** Birleştir: mevcutlar korunur; aynı kimlikli ama farklı diyagram "(yedek)" kopyası olarak eklenir. */
  function mergeBackup(bk) {
    let added = 0, copies = 0, same = 0;
    const fIds = new Set(S.folders.map((f) => f.id));
    bk.folders.forEach((f) => { if (!fIds.has(f.id)) { S.folders.push(f); fIds.add(f.id); } });
    bk.docs.forEach((d) => {
      const cur = S.docs.find((x) => x.id === d.id);
      if (!cur) { S.docs.push(d); added++; return; }
      if (cur.code === d.code && cur.name === d.name) { same++; return; }
      S.docs.push(Object.assign({}, d, { id: newDocId(), name: uniqueDocName(d.name + T('backup.copySuffix')) }));
      copies++;
    });
    const rIds = new Set((S.roles || []).map((r) => r.id));
    bk.roles.forEach((r) => { if (!rIds.has(r.id)) { (S.roles = S.roles || []).push(r); rIds.add(r.id); } });
    return { added, copies, same };
  }
  function replaceWithBackup(bk) {
    S.docs = bk.docs;
    S.folders = bk.folders;
    S.roles = bk.roles.length ? bk.roles : PRESET_ROLES.map(presetRole);
  }
  function afterRestore(preferId) {
    persistDocs();
    saveRoles();
    renderPalette();
    const keep = S.doc && S.docs.find((d) => d.id === S.doc.id);
    if (keep && !preferId) { S.doc = keep; renderDocList(); }
    else if (S.docs.length) { S.doc = null; openDoc((preferId && S.docs.find((d) => d.id === preferId) ? preferId : S.docs[0].id)); }
    else { S.doc = null; createDoc(T('doc.untitled'), tplL(window.SeqTemplates[0]).code); }
    refreshBackupUi();
  }
  function openRestore(file) {
    file.text().then((text) => {
      let bk;
      try { bk = parseBackup(text); } catch (e) { return toast(T('backup.invalid'), 'err'); }
      const when = bk.exportedAt ? new Date(bk.exportedAt).toLocaleString(I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
      const choice = (icn, title, desc, cls, onclick) => h('button', { class: 'restore-opt' + (cls ? ' ' + cls : ''), onclick }, ico(icn), h('b', null, title), h('span', null, desc));
      const body = h('div', { class: 'restore' },
        h('p', { class: 'restore-sum' }, ico('file'), h('span', null, T('backup.summary', { date: when, n: bk.docs.length, m: bk.folders.length, k: bk.roles.length }))),
        h('div', { class: 'restore-opts' },
          choice('plus', T('backup.merge'), T('backup.mergeDesc'), 'primary', () => {
            if (S.doc && S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
            const r = mergeBackup(bk);
            closeModal();
            afterRestore();
            toast(T('backup.merged', { a: r.added, c: r.copies, s: r.same }));
          }),
          choice('swap', T('backup.replace'), T('backup.replaceDesc', { n: S.docs.length }), 'danger', () => {
            if (!confirm(T('backup.confirmReplace', { n: S.docs.length }))) return;
            replaceWithBackup(bk);
            closeModal();
            afterRestore(bk.current);
            toast(T('backup.replaced', { n: bk.docs.length }));
          })),
        h('p', { class: 'roles-note' }, ico('help'), T('backup.restoreNote')));
      openModal(T('backup.restoreTitle'), body);
    });
  }

  /** Menünün altındaki yedek/depolama bölümü ve menü düğmesindeki hatırlatma noktası */
  let backupUiTimer = null;
  function scheduleBackupUi() { clearTimeout(backupUiTimer); backupUiTimer = setTimeout(refreshBackupUi, 400); }
  function refreshBackupUi() {
    const due = backupDue();
    $('#btnDocs').classList.toggle('needs-backup', due);
    const box = $('#backupBox');
    if (!box) return;
    const last = S.settings.lastBackup;
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) { closeDrawer(); openRestore(f); } });
    const usage = h('div', { class: 'bk-usage' }, '…');
    box.innerHTML = '';
    box.classList.toggle('due', due);
    add(box,
      h('div', { class: 'bk-status' + (last || due ? '' : ' neutral') }, ico(due ? 'critical' : last ? 'check' : 'help'),
        h('span', null, last ? T('backup.last', { when: timeAgo(last) }) : T('backup.never')),
        due ? h('span', { class: 'bk-due' }, T('backup.due')) : null),
      h('div', { class: 'bk-actions' },
        h('button', { class: 'btn sm' + (due ? ' primary' : ''), onclick: downloadBackup, title: T('backup.saveTitle') }, ico('download'), T('backup.save')),
        h('button', { class: 'btn sm ghost', onclick: () => fileIn.click(), title: T('backup.restoreTitle') }, ico('upload'), T('backup.restore')),
        fileIn),
      usage);
    window.SeqStorage.estimate().then((e) => {
      const where = T(e.mode === 'idb' ? 'storage.idb' : 'storage.local');
      // Boyut kendi verimizden (tarayıcının tahmini file:// adreslerinde güvenilir değil)
      const size = T('storage.usage', { size: fmtBytes(e.dataSize) });
      const pers = e.mode === 'idb' && e.persisted != null ? T(e.persisted ? 'storage.persisted' : 'storage.notPersisted') : '';
      usage.textContent = [where, size, pers].filter(Boolean).join(' · ');
      usage.classList.toggle('warn', e.mode !== 'idb');
    });
  }

  // ---------------------------------------------------------------------------
  // Diyagramlar arası bağlantı (ref)
  // ---------------------------------------------------------------------------
  const REF_COLOR = '#3a8dde';
  /**
   * Çizim için model: boş kollara yer tutucu (previewSafeModel) ve referans notlarının başına işaret
   * ("↗", kopuksa "✕"). İşaret metnin parçası olduğundan Mermaid notun genişliğini ona göre hesaplar
   * (dar, tek katılımcılı notlarda üst üste binme olmaz). Koddaki etiket değişmez. Gerekmiyorsa null.
   */
  function renderableModel(model) {
    let m = M.previewSafeModel(model);
    let hasRef = false;
    M.walk(model.items, (it) => { if (it.kind === 'note' && it.ref) { hasRef = true; return false; } });
    if (!hasRef) return m;
    m = m || JSON.parse(JSON.stringify(model));
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
    const bg = PAPER_BG[mmThemeName()] || '#ffffff';
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
    try { openDoc(id); } finally { nav.keep = false; }
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
    if (S.doc && S.doc.id !== id && fix(S.model)) { commit(); n++; }
    if (n) { persistDocs(); toast(T('ref.renamed', { n })); }
  }

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
    return window.SeqStorage.addVersion(v, KEEP_AUTO_VERSIONS).catch((e) => { storageError(e); return null; });
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
    if (el.code.value !== S.code) applyCode(el.code.value, 'code');
    if (S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); persistDocs(); }
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
      renderDocSvg(code).then((b) => {
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
            createDoc(doc.name + ' (' + fmtDate(v.ts) + ')', v.code, true, doc.folder);
            toast(T('hist.copied'));
          } }, ico('copy'), T('hist.copy')),
          h('button', { class: 'btn primary sm', onclick: () => {
            const v = sel;
            if (S.code === v.code) return;
            // Dönmeden önce şu anki hâli sakla: geri dönüş geri alınabilsin
            snapshot('restore', S.code, { label: T('hist.beforeRestore') }).then(() => {
              closeModal();
              applyCode(v.code, 'code');
              el.code.value = v.code;
              flushHistory();
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
      h('p', { class: 'roles-note' }, ico('help'), T('hist.policy')));
    openModal(T('hist.title', { name: doc.name }), body, true);
    load();
  }

  // ---------------------------------------------------------------------------
  // Arama (⌘K): diyagram adı, klasör yolu, katılımcılar, mesaj/not metinleri, blok koşulları ve kod
  // ---------------------------------------------------------------------------
  const searchCache = new Map(); // doc id → { key, entry }
  const folderPath = (id) => { const out = []; for (let f = folderById(id); f; f = folderById(f.parent)) out.unshift(f.name); return out.join(' / '); };
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
    if (currentView() !== 'builder') return jumpToCodeLine(hit);
    if (hit.kind === 'participant') {
      const p = S.model.participants[hit.idx];
      const card = p && el.participants.querySelector(`[data-uid="${p.uid}"]`);
      if (card) { card.scrollIntoView({ block: 'nearest' }); card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
      return;
    }
    let c = { message: 0, note: 0, block: 0 }, target = null;
    M.walk(S.model.items, (it) => {
      if (target) return false;
      if (it.kind === hit.kind && c[it.kind]++ === hit.idx) target = it;
    });
    if (target) { setSelected(target.uid); focusRow(target.uid); const row = el.flow.querySelector(`[data-uid="${target.uid}"]`); if (row) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); } }
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
    if (target != null) selectCodeLine(target);
  }
  let searchUi = null;
  function closeSearch() { if (searchUi) { searchUi.root.hidden = true; } }
  function openSearch() {
    closeDrawer();
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
        if (!S.doc || S.doc.id !== r.e.d.id) openDoc(r.e.d.id);
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
    if (S.doc && el.code.value !== S.code) applyCode(el.code.value, 'code');
    searchUi.input.placeholder = T('search.ph');
    searchUi.root.hidden = false;
    searchUi.input.value = '';
    searchUi.draw();
    searchUi.input.focus();
  }

  // --- Klasör dışa aktarma (.zip) ---
  /** Sıkıştırmasız (store) ZIP; UTF-8 dosya adları. Harici kütüphane gerektirmez. */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function makeZip(entries) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.path);
      const data = e.data || new Uint8Array(0);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
      local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
      local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
      parts.push(local, name, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true); cd.setUint16(12, time, true); cd.setUint16(14, date, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, name.length, true); cd.setUint32(38, e.dir ? 0x10 : 0, true); cd.setUint32(42, offset, true);
      central.push(cd, name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((a, x) => a + x.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  const fileSafe = (n) => String(n || '').replace(/[\\/:*?"<>|\n\r]+/g, '-').trim() || 'diagram';
  const docCode = (d) => (S.doc && d.id === S.doc.id ? S.code : d.code);

  /** Bir diyagramı ekran dışında çizer; önizlemedeki renklendirme aynen uygulanır. */
  let offscreenSeq = 0;
  async function renderDocSvg(code, opts) {
    const model = M.parse(code);
    if (!model.participants.length && !model.items.length) throw new Error(T('exp.nothing'));
    const id = 'zx' + ++offscreenSeq;
    const host = h('div', { class: 'offscreen-render', 'aria-hidden': 'true' });
    document.body.append(host);
    try {
      await mermaid.parse(code);
      const safeModel = renderableModel(model);
      const { svg } = await mermaid.render(id, safeModel ? M.serialize(safeModel) : code);
      host.innerHTML = '<div class="paper">' + svg + '</div>';
      const svgEl = $('svg', host);
      colorizeSvg(svgEl, S.settings.colorize, model);
      colorizeBlocks(svgEl, S.settings.colorize, model);
      colorizeMessages(svgEl, model);
      decorateRefs(svgEl, safeModel || model);
      const built = buildExportSvg(exportBg(), svgEl);
      if (built && opts && opts.drawio) built.drawio = toDrawio(svgEl, model, opts.drawio);
      return built;
    } finally {
      host.remove();
      const stray = document.getElementById('d' + id);
      if (stray) stray.remove();
    }
  }

  /** Klasör ağacındaki diyagramları (isteğe bağlı alt klasörlerle) yol bilgisiyle toplar. */
  function collectFolder(folderId, withSubs, base) {
    const f = folderById(folderId);
    const dir = (base ? base + '/' : '') + fileSafe(f.name);
    const out = { dirs: [dir], docs: [] };
    S.docs.filter((d) => d.folder === folderId).sort((a, b) => a.name.localeCompare(b.name, I18N.getLang()))
      .forEach((d) => out.docs.push({ d, dir }));
    if (withSubs) childFolders(folderId).forEach((sf) => {
      const sub = collectFolder(sf.id, true, dir);
      out.dirs.push(...sub.dirs);
      out.docs.push(...sub.docs);
    });
    return out;
  }

  function openFolderExport(folderId) {
    const f = folderById(folderId);
    if (!f) return;
    if (el.code.value !== S.code) applyCode(el.code.value, 'code');
    const ex = S.settings.exp;
    const hasSubs = childFolders(folderId).length > 0;
    let withSubs = true;
    let busy = false;
    const body = h('div');
    const draw = () => {
      body.innerHTML = '';
      const { docs, dirs } = collectFolder(folderId, withSubs);
      body.append(h('p', { class: 'fx-info' }, ico('folder'), h('b', null, f.name),
        h('span', null, T('fx.count', { n: docs.length, m: dirs.length - 1 }))));
      const grid = h('div', { class: 'fmt-grid' });
      FORMATS.forEach((x) => grid.append(h('button', { class: 'fmt' + (ex.format === x.v ? ' active' : ''), onclick: () => { ex.format = x.v; saveSettings(); draw(); } }, ico(x.ic), h('b', null, T('fmt.' + x.v)), h('span', null, T('fmt.' + x.v + '.desc')))));
      body.append(grid);
      const seg = (opts, val, on) => h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: v === val ? 'active' : '', onclick: () => { on(v); saveSettings(); draw(); } }, l)));
      if (ex.format === 'png') body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.scale')), seg([[1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']], ex.scale, (v) => { ex.scale = v; })));
      if (ex.format === 'png' || ex.format === 'svg' || ex.format === 'drawio') body.append(...bgOptionRows(ex, seg));
      if (hasSubs) {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = withSubs;
        cb.addEventListener('change', () => { withSubs = cb.checked; draw(); });
        body.append(h('div', { class: 'opt-row' }, h('label', null, T('fx.subfolders')), h('label', { class: 'fx-check' }, cb, h('span', null, T('fx.subfoldersHint')))));
      }
      body.append(h('p', { class: 'roles-note' }, ico('help'), T('fx.note')));
      const status = h('span', { class: 'dim-info' });
      const btn = h('button', { class: 'btn primary', disabled: !docs.length || null }, ico('download'), T('fx.download'));
      btn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        btn.disabled = true;
        const enc = new TextEncoder();
        const entries = dirs.map((d) => ({ path: d + '/', dir: true }));
        const used = new Set();
        const failed = [];
        const ext = EXT[ex.format];
        try {
          for (let i = 0; i < docs.length; i++) {
            const { d, dir } = docs[i];
            status.textContent = T('fx.progress', { i: i + 1, n: docs.length });
            let name = fileSafe(d.name), k = 2;
            while (used.has(dir + '/' + name + ext)) name = fileSafe(d.name) + ' (' + k++ + ')';
            const path = dir + '/' + name + ext;
            used.add(path);
            const code = docCode(d);
            try {
              let data;
              if (ex.format === 'mmd' || ex.format === 'txt') data = enc.encode(code);
              else {
                const built = await renderDocSvg(code, ex.format === 'drawio' ? { drawio: d.name } : null);
                if (!built) throw new Error(T('exp.nothing'));
                data = ex.format === 'drawio' ? enc.encode(built.drawio)
                  : ex.format === 'svg' ? enc.encode(built.markup)
                  : new Uint8Array(await (await svgToPngBlob(built.markup, built.w, built.h, effectiveScale(built.w, built.h))).arrayBuffer());
              }
              entries.push({ path, data });
            } catch (err) {
              const msg = String((err && (err.message || err.str)) || err).trim().slice(0, 600);
              failed.push('# ' + dir + '/' + d.name + '\n' + msg.split('\n').map((l) => '  ' + l).join('\n'));
            }
          }
          if (failed.length) entries.push({ path: dirs[0] + '/' + T('fx.errorsFile'), data: enc.encode(failed.join('\n\n') + '\n') });
          const zipName = fileSafe(f.name) + '.zip';
          downloadBlob(makeZip(entries), zipName);
          toast(failed.length ? T('fx.doneWithErrors', { n: docs.length - failed.length, m: failed.length }) : T('fx.done', { n: docs.length, name: zipName }), failed.length ? 'err' : undefined);
          closeModal();
        } catch (err) {
          toast(T('exp.failed', { msg: err.message }), 'err');
        } finally {
          busy = false;
          btn.disabled = false;
          status.textContent = '';
        }
      });
      body.append(h('div', { class: 'export-actions' }, h('div', { class: 'left' }, status), h('div', { class: 'right' }, btn)));
    };
    draw();
    openModal(T('fx.title'), body);
  }

  // --- Şablonlar ---
  // --- Katılımcı rolleri ---
  function openRoles() {
    // Değişiklikler gecikmeli olarak tüm diyagramlara yayılır; eski tanım "snap" içinde tutulur
    const snap = new Map((S.roles || []).map((r) => [r.id, { ...r }]));
    const pending = new Set();
    const flush = debounce(() => {
      pending.forEach((id) => {
        const old = snap.get(id);
        const cur = roleById(id);
        if (old) updateRoleEverywhere(old, cur || null);
        if (cur) snap.set(id, { ...cur }); else snap.delete(id);
      });
      pending.clear();
      renderPalette();
    }, 300);
    const changed = (r) => { saveRoles(); pending.add(r.id); flush(); };

    const list = h('div', { class: 'role-list' });
    const renderRows = () => {
      list.innerHTML = '';
      list.append(h('div', { class: 'role-row role-head' },
        h('span'), h('span', null, T('role.name')), h('span', null, T('pe.type')), h('span', null, T('pe.color')),
        h('span', null, T('role.prefix')), h('span', null, T('role.suffix')), h('span', null, T('role.usage')), h('span')));
      S.roles.forEach((r) => {
        const icon = h('span', { class: 'role-icon', style: `--c:${r.color}` }, ico('t-' + r.type));
        const example = h('small', { class: 'role-example' });
        const refresh = () => {
          icon.style.setProperty('--c', r.color);
          icon.innerHTML = '';
          icon.append(ico('t-' + r.type));
          example.textContent = T('role.example', { name: composeLabel(r, T('role.exampleBase')) });
        };
        const name = h('input', { class: 'input', value: r.name, placeholder: T('role.name') });
        name.addEventListener('input', () => { r.name = name.value.trim() || r.id; saveRoles(); renderPalette(); });
        const type = h('select', { class: 'select' }, M.PARTICIPANT_TYPES.map((t) => h('option', { value: t.v }, t.label)));
        type.value = r.type;
        type.addEventListener('change', () => { r.type = type.value; refresh(); changed(r); });
        const color = h('input', { type: 'color', class: 'role-color', value: r.color, title: T('pe.color') });
        color.addEventListener('input', () => { r.color = color.value.toLowerCase(); refresh(); changed(r); });
        const affix = (key) => {
          const inp = h('input', { class: 'input mono', value: r[key] || '', placeholder: '—', spellcheck: 'false' });
          inp.addEventListener('input', () => { r[key] = inp.value; refresh(); changed(r); });
          // ↵: ön ekten sonra / son ekten önce satır sonu
          const bk = key + 'Break';
          const br = h('button', { class: 'affix-break' + (r[bk] ? ' on' : ''), 'aria-pressed': String(!!r[bk]),
            title: T(key === 'prefix' ? 'role.breakAfter' : 'role.breakBefore') }, ico('enter'));
          br.addEventListener('click', () => {
            if (r[bk]) delete r[bk]; else r[bk] = true;
            br.classList.toggle('on', !!r[bk]);
            br.setAttribute('aria-pressed', String(!!r[bk]));
            refresh(); changed(r);
          });
          return h('div', { class: 'affix-cell' }, key === 'prefix' ? [inp, br] : [br, inp]);
        };
        const used = roleUsage(r.id);
        const del = h('button', { class: 'icon-btn sm del', title: T('delete'), onclick: () => {
          if (used && !confirm(T('role.confirmDelete', { name: r.name, n: used }))) return;
          S.roles = S.roles.filter((x) => x !== r);
          changed(r);
          renderRows();
        } }, ico('trash'));
        refresh();
        list.append(h('div', { class: 'role-row' },
          icon,
          h('div', { class: 'role-name' }, name, example),
          type, color, affix('prefix'), affix('suffix'),
          h('span', { class: 'role-usage', title: T('role.usageTitle') }, T('role.usageN', { n: used })),
          del));
      });
    };
    renderRows();

    const uniqueRoleId = (name) => {
      const base = M.slugify(name).toLowerCase() || 'role';
      let id = base, k = 2;
      while (roleById(id)) id = base + k++;
      return id;
    };
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      try {
        const arr = JSON.parse(await f.text());
        const okType = (t) => M.PARTICIPANT_TYPES.some((x) => x.v === t);
        let n = 0;
        (Array.isArray(arr) ? arr : arr.roles || []).forEach((x) => {
          if (!x || !x.id || !/^[A-Za-z0-9_-]+$/.test(x.id) || !okType(x.type) || !/^#[0-9a-f]{6}$/i.test(x.color)) return;
          const r = { id: x.id, name: String(x.name || x.id), type: x.type, color: x.color.toLowerCase(), prefix: String(x.prefix || ''), suffix: String(x.suffix || '') };
          if (x.prefixBreak) r.prefixBreak = true;
          if (x.suffixBreak) r.suffixBreak = true;
          const i = S.roles.findIndex((y) => y.id === r.id);
          if (i >= 0) { if (!snap.has(r.id)) snap.set(r.id, { ...S.roles[i] }); S.roles[i] = r; } else S.roles.push(r);
          changed(r);
          n++;
        });
        renderRows();
        toast(T('role.imported', { n }));
      } catch (e) { toast(T('role.importFailed'), 'err'); }
    });

    const body = h('div', { class: 'roles' },
      h('p', { class: 'roles-intro' }, T('role.intro')),
      list,
      h('div', { class: 'roles-foot' },
        h('div', { class: 'row', style: 'flex:none' },
          h('button', { class: 'btn sm', onclick: () => {
            const r = { id: uniqueRoleId(T('role.newName')), name: T('role.newName'), type: 'participant', color: PCOLORS[S.roles.length % PCOLORS.length], prefix: '', suffix: '' };
            S.roles.push(r);
            saveRoles(); renderPalette(); renderRows();
            const inputs = $$('.role-name .input', list);
            if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
          } }, ico('plus'), T('role.add')),
          h('button', { class: 'btn sm ghost', title: T('role.presetTitle'), onclick: () => {
            const missing = PRESET_ROLES.filter((x) => !roleById(x.id)).map(presetRole);
            S.roles.push(...missing);
            saveRoles(); renderPalette(); renderRows();
            toast(T('role.presetAdded', { n: missing.length }));
          } }, T('role.preset'))),
        h('div', { class: 'row', style: 'flex:none' },
          h('button', { class: 'btn sm ghost', onclick: () => {
            downloadBlob(new Blob([JSON.stringify(S.roles, null, 2)], { type: 'application/json' }), 'sequence-studio-roles.json');
          } }, ico('download'), T('role.export')),
          h('button', { class: 'btn sm ghost', onclick: () => fileIn.click() }, ico('upload'), T('role.import')),
          fileIn)),
      h('p', { class: 'roles-note' }, ico('help'), T('role.note')));
    openModal(T('role.title'), body, true);
  }

  function openTemplates() {
    const grid = h('div', { class: 'tpl-grid' });
    window.SeqTemplates.forEach((tpl) => {
      const t = tplL(tpl);
      grid.append(h('button', { class: 'tpl', onclick: () => { createDoc(tpl.id === 'blank' ? T('doc.untitled') : t.name, t.code); closeModal(); toast(T('tpl.opened', { name: t.name })); } },
        h('b', null, t.name), h('span', null, t.desc), h('pre', null, t.code.split('\n').slice(0, 9).join('\n'))));
    });
    openModal(T('tpl.title'), grid, true);
  }

  // --- Yardım ---
  function openHelp() {
    const mod = isMac ? '⌘' : 'Ctrl';
    const kb = (k) => k.split('+').map((x) => `<kbd>${x}</kbd>`).join(' ');
    const rows = (arr) => '<table>' + arr.map(([a, b]) => `<tr><td>${a}</td><td>${esc(b)}</td></tr>`).join('') + '</table>';
    const c = (code) => `<code>${esc(code)}</code>`;
    const body = h('div', { html: `
      <div class="help-grid">
        <div>
          <h4>${T('help.builder')}</h4>
          ${rows([
            [T('help.addP'), T('help.addPd')],
            [T('help.drawM'), T('help.drawMd')],
            [T('help.addS'), T('help.addSd')],
            [T('help.addB'), T('help.addBd')],
            [T('help.move'), T('help.moved')],
            [T('help.act'), T('help.actd')],
            [T('help.tone'), T('help.toned')],
            [T('help.goto'), T('help.gotod')],
            [T('help.ref'), T('help.refd')],
          ])}
          <h4 style="margin-top:18px">${T('help.shortcuts')}</h4>
          ${rows([
            [kb(mod + '+Z') + ' / ' + kb(mod + '+Shift+Z'), T('help.k.undo')],
            [kb('Enter'), T('help.k.enter')],
            [kb('Shift+Enter'), T('help.k.shiftEnter')],
            [kb((isMac ? '⌥' : 'Alt') + '+Enter'), T('help.k.newline')],
            [kb(mod + '+D'), T('help.k.dup')],
            [kb('Alt+↑') + ' ' + kb('Alt+↓'), T('help.k.move')],
            [kb('Del'), T('help.k.del')],
            [kb(mod + '+E'), T('help.k.export')],
            [kb(mod + '+K'), T('help.k.search')],
            [kb(mod + '+1') + ' / ' + kb(mod + '+2'), T('help.k.views')],
            [kb(mod + '+B'), T('help.k.collapse')],
            [kb('F'), T('help.k.fullscreen')],
            [kb(mod + '+' + T('help.scroll')), T('help.k.zoom')],
          ])}
        </div>
        <div>
          <h4>${T('help.syntax')}</h4>
          ${rows([
            [c('participant A as Name'), T('help.s.participant')],
            [c('actor U'), T('help.s.actor')],
            [c('participant D@{ "type": "database" }'), T('help.s.typed')],
            [c('A->>B: text'), T('help.s.sync')],
            [c('B-->>A: text'), T('help.s.reply')],
            [c('A-)B: event'), T('help.s.async')],
            [c('A-xB: error'), T('help.s.cross')],
            [c('A->>+B') + ' · ' + c('B-->>-A'), T('help.s.act')],
            [c('loop') + ' … ' + c('end'), T('help.s.loop')],
            [c('alt') + ' … ' + c('else') + ' … ' + c('end'), T('help.s.alt')],
            [c('opt') + ' · ' + c('break'), T('help.s.opt')],
            [c('par') + ' … ' + c('and') + ' … ' + c('end'), T('help.s.par')],
            [c('critical') + ' … ' + c('option') + ' … ' + c('end'), T('help.s.critical')],
            [c('rect rgba(…)') + ' … ' + c('end'), T('help.s.rect')],
            [c('Note over A,B: text'), T('help.s.note')],
            [c('box Aqua Group') + ' … ' + c('end'), T('help.s.box')],
            [c('autonumber'), T('help.s.autonumber')],
          ])}
        </div>
      </div>
      <ul class="help-tips">
        <li>${esc(T('help.tip1'))}</li>
        <li>${esc(T('help.tip2'))}</li>
        <li>${esc(T('help.tip3'))}</li>
      </ul>` });
    openModal(T('help.title'), body, true);
  }

  // ---------------------------------------------------------------------------
  // Panel boyutlandırma
  // ---------------------------------------------------------------------------
  (function setupResizer() {
    const rz = $('#resizer');
    const pane = $('#paneEditor');
    if (S.settings.editorW) pane.style.width = S.settings.editorW + 'px';
    rz.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      rz.setPointerCapture(e.pointerId);
      rz.classList.add('dragging');
      const x0 = e.clientX, w0 = pane.offsetWidth;
      const move = (ev) => {
        const w = clamp(w0 + ev.clientX - x0, 380, window.innerWidth - 360);
        pane.style.width = w + 'px';
      };
      const up = () => {
        rz.removeEventListener('pointermove', move);
        rz.classList.remove('dragging');
        S.settings.editorW = pane.offsetWidth;
        saveSettings();
        if (S.zoom.auto) fitView();
      };
      rz.addEventListener('pointermove', move);
      rz.addEventListener('pointerup', up, { once: true });
    });
    rz.addEventListener('dblclick', () => { pane.style.width = ''; S.settings.editorW = null; saveSettings(); });
  })();
  window.addEventListener('resize', debounce(() => { if (S.zoom.auto) fitView(); }, 150));

  // ---------------------------------------------------------------------------
  // Üst bar ve kontroller
  // ---------------------------------------------------------------------------
  el.undo.addEventListener('click', undo);
  el.redo.addEventListener('click', redo);
  $('#btnTemplates').addEventListener('click', openTemplates);
  $('#btnImport').addEventListener('click', () => el.fileInput.click());
  $('#btnHelp').addEventListener('click', openHelp);
  $('#btnExport').addEventListener('click', openExport);
  $('#btnDocs').addEventListener('click', openDrawer);
  $('#btnHistory').addEventListener('click', openHistory);
  $('#btnSearch').addEventListener('click', openSearch);
  $('#btnDrawerSearch').addEventListener('click', openSearch);
  $('#btnNewDoc').addEventListener('click', () => { createDoc(T('doc.untitled'), tplL(window.SeqTemplates[0]).code); closeDrawer(); });
  $('#btnNewFolder').addEventListener('click', createFolder);
  // Boş alana bırakılan belge köke taşınır; dışarı tıklama taşıma menüsünü kapatır
  docDropZone(el.docList, null);
  el.drawer.addEventListener('click', (e) => { if (!e.target.closest('.move-menu')) closeMoveMenu(); });
  $('#btnLang').addEventListener('click', () => {
    S.settings.lang = I18N.getLang() === 'tr' ? 'en' : 'tr';
    saveSettings();
    applyLang();
  });
  $('[data-close]', el.drawer).addEventListener('click', closeDrawer);
  el.scrim.addEventListener('click', closeDrawer);
  $('#btnTheme').addEventListener('click', () => {
    S.settings.appTheme = appTheme() === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyAppTheme();
    configureMermaid();
    scheduleRender(0);
  });
  el.docName.addEventListener('input', () => {
    if (!S.doc) return;
    S.doc.name = el.docName.value.trim() || T('doc.untitled');
    S.doc.updated = Date.now();
    persistDocs();
  });
  el.docName.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.docName.blur(); });
  let nameBefore = null;
  el.docName.addEventListener('focus', () => { nameBefore = S.doc && S.doc.name; });
  el.docName.addEventListener('change', () => { if (S.doc) propagateRefRename(S.doc.id, nameBefore, S.doc.name); nameBefore = S.doc && S.doc.name; });
  $('#navBack').addEventListener('click', navBack);
  el.mmTheme.addEventListener('change', () => { S.settings.mmTheme = el.mmTheme.value; saveSettings(); configureMermaid(); scheduleRender(0); });
  el.colorize.addEventListener('change', () => { S.settings.colorize = el.colorize.checked; saveSettings(); scheduleRender(0); });
  // Palet şeridi: gruplar içerikleriyle orantılı genişlikte; isteğe bağlı kompakt (tek satır)
  const paletteEl = $('#palette');
  const btnPalToggle = $('#btnPalToggle');
  // Üç grubu, hepsi en az satıra sığacak şekilde genişliklendirir: her grup için "R satır için
  // gereken en küçük genişlik" çip kaydırması simüle edilerek bulunur; toplamın sığdığı en küçük
  // R seçilir, kalan alan gruplara orantılı dağıtılır.
  const CHIP_GAP = 5;
  function rowsAt(ws, W) {
    let rows = 1, line = 0;
    for (const w of ws) {
      if (line && line + CHIP_GAP + w > W) { rows++; line = w; } else line += (line ? CHIP_GAP : 0) + w;
    }
    return rows;
  }
  function minWidthFor(ws, R) {
    let lo = Math.max(...ws), hi = ws.reduce((a, w) => a + w + CHIP_GAP, 0);
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rowsAt(ws, mid) <= R) hi = mid; else lo = mid + 1; }
    return lo;
  }
  function balancePalette() {
    const groups = $$(':scope > .pal-group', paletteEl);
    const widths = groups.map((g) => $$('.chip', g).map((c) => c.getBoundingClientRect().width));
    if (widths.some((ws) => !ws.length || ws.some((w) => !w))) return; // görünmüyor; ResizeObserver tekrar çağırır
    const frame = groups.map((g) => { const cs = getComputedStyle(g); return parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth); });
    const avail = groups.reduce((a, g, i) => a + g.getBoundingClientRect().width - frame[i], 0);
    let need = null;
    for (let R = 1; R <= 8; R++) {
      const mins = widths.map((ws) => minWidthFor(ws, R));
      if (mins.reduce((a, w) => a + w, 0) <= avail - 1 || R === 8) { need = mins; break; }
    }
    groups.forEach((g, i) => { g.style.flex = `${need[i]} 1 ${Math.ceil(need[i] + frame[i] + 1)}px`; });
    requestAnimationFrame(markPalOverflow);
  }
  // Kompakt modda yatay taşan grupları işaretle (sağ kenar solması; sona kaydırınca kalkar)
  function markPalOverflow() {
    $$('.pal-items', paletteEl).forEach((it) => {
      it.classList.toggle('overflowing', it.scrollWidth > it.clientWidth + 1);
      it.classList.toggle('at-end', it.scrollLeft + it.clientWidth >= it.scrollWidth - 2);
    });
  }
  $$('.pal-items', paletteEl).forEach((it) => it.addEventListener('scroll', markPalOverflow, { passive: true }));
  if (window.ResizeObserver) new ResizeObserver(() => balancePalette()).observe(paletteEl);
  function applyPalCompact() {
    const on = !!S.settings.palCompact;
    paletteEl.classList.toggle('compact', on);
    btnPalToggle.title = T(on ? 'pal.expand' : 'pal.compact');
    btnPalToggle.setAttribute('aria-expanded', String(!on));
    requestAnimationFrame(markPalOverflow);
  }
  btnPalToggle.addEventListener('click', () => { S.settings.palCompact = !S.settings.palCompact; saveSettings(); applyPalCompact(); });
  applyPalCompact();

  // Katılımcılar bölümü: varsayılan olarak üstte sabit
  const partSection = $('#partSection');
  const btnPin = $('#btnPinParts');
  function applyPin() {
    const on = S.settings.pinParts !== false;
    partSection.classList.toggle('pinned', on);
    btnPin.classList.toggle('on', on);
    btnPin.setAttribute('aria-pressed', String(on));
    btnPin.title = T(on ? 'pin.off' : 'pin.on');
    updateStuck();
  }
  // Gölge yalnızca bölüm gerçekten üste yapıştığında
  function updateStuck() {
    const on = partSection.classList.contains('pinned');
    partSection.classList.toggle('stuck', on && partSection.getBoundingClientRect().top <= el.bscroll.getBoundingClientRect().top + 1 && el.bscroll.scrollTop > 0);
  }
  el.bscroll.addEventListener('scroll', updateStuck, { passive: true });
  btnPin.addEventListener('click', () => { S.settings.pinParts = !(S.settings.pinParts !== false); saveSettings(); applyPin(); });
  applyPin();

  el.mirror.addEventListener('change', () => { S.settings.mirror = el.mirror.checked; saveSettings(); configureMermaid(); scheduleRender(0); });
  el.autoAct.addEventListener('change', () => {
    if (!S.doc) return;
    S.doc.autoAct = el.autoAct.checked;
    persistDocs();
    // Kapatılınca otomatik düzeltme satırları sıradan (elle düzenlenebilir) aktivasyonlara dönüşür
    if (!el.autoAct.checked) M.walk(S.model.items, (it) => { delete it.auto; });
    // Açılınca hesapla; kapatılınca mevcut işaretler kalır ve elle düzenlenebilir olur
    commit();
    flushHistory();
    toast(T(el.autoAct.checked ? 'act.autoOnToast' : 'act.autoOffToast'));
  });
  el.autonum.addEventListener('change', () => { S.model.autonumber = el.autonum.checked; if (!el.autonum.checked) S.model.autonumberArgs = ''; commit(); flushHistory(); });
  el.title.addEventListener('input', () => { S.model.title = el.title.value.trim(); commit({ rerender: false }); });
  el.title.addEventListener('blur', flushHistory);
  $('#zoomIn').addEventListener('click', () => zoomCenter(1.2));
  $('#zoomOut').addEventListener('click', () => zoomCenter(1 / 1.2));
  $('#zoomFit').addEventListener('click', () => { S.zoom.auto = true; fitView(); });

  // --- Önizleme tam ekran ---
  const panePreview = $('#panePreview');
  const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  const isFullscreen = () => fsElement() === panePreview || panePreview.classList.contains('pseudo-fullscreen');
  function updateFullscreenUi() {
    const on = isFullscreen();
    const b = $('#btnFullscreen');
    b.innerHTML = icon(on ? 'minimize' : 'maximize');
    b.dataset.i18nTitle = on ? 'fs.exit' : 'fs.enter';
    b.title = T(b.dataset.i18nTitle);
    S.zoom.auto = true;
    requestAnimationFrame(fitView);
  }
  function toggleFullscreen() {
    if (isFullscreen()) {
      if (panePreview.classList.contains('pseudo-fullscreen')) { panePreview.classList.remove('pseudo-fullscreen'); updateFullscreenUi(); }
      else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    closePopover();
    const req = panePreview.requestFullscreen || panePreview.webkitRequestFullscreen;
    const fallback = () => { panePreview.classList.add('pseudo-fullscreen'); updateFullscreenUi(); };
    if (!req) return fallback();
    try {
      const p = req.call(panePreview);
      if (p && p.catch) p.catch(fallback);
    } catch (e) { fallback(); }
  }
  $('#btnFullscreen').addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenUi);
  document.addEventListener('webkitfullscreenchange', updateFullscreenUi);

  /** Sol editör panelini gizler / gösterir; çizim yeni alana sığdırılır. */
  function setEditorCollapsed(collapsed) {
    S.settings.editorCollapsed = !!collapsed;
    saveSettings();
    $('#workspace').classList.toggle('editor-collapsed', !!collapsed);
    document.body.classList.toggle('editor-hidden', !!collapsed);
    if (collapsed) closePopover();
    S.zoom.auto = true;
    requestAnimationFrame(fitView);
  }
  $('#btnCollapse').addEventListener('click', () => setEditorCollapsed(true));
  $('#btnExpand').addEventListener('click', () => setEditorCollapsed(false));
  el.zoomVal.addEventListener('click', () => {
    const r = el.viewport.getBoundingClientRect();
    zoomAt(1 / S.zoom.k, r.width / 2, r.height / 2);
  });

  // ---------------------------------------------------------------------------
  // Klavye kısayolları
  // ---------------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;

    if (e.key === 'Escape') {
      if (!el.modalRoot.hidden) return closeModal();
      if (panePreview.classList.contains('pseudo-fullscreen')) return toggleFullscreen();
      if (!el.popover.hidden) return closePopover();
      if (el.drawer.classList.contains('open')) return closeDrawer();
      if (typing) e.target.blur();
      else setSelected(null);
      return;
    }
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); return; }
      if (k === 's') { e.preventDefault(); flushHistory(); doSave(); toast(T('saved.toast')); return; }
      if (k === 'e') { e.preventDefault(); openExport(); return; }
      if (k === 'k') { e.preventDefault(); if (searchUi && !searchUi.root.hidden) closeSearch(); else openSearch(); return; }
      if (k === '1') { e.preventDefault(); setView('builder'); return; }
      if (k === '2') { e.preventDefault(); setView('code'); return; }
      if (k === 'b') { e.preventDefault(); setEditorCollapsed(!S.settings.editorCollapsed); return; }
      if (k === 'd' && currentView() === 'builder' && S.selected) { e.preventDefault(); duplicateNode(S.selected); return; }
    }
    if (!typing && !mod && !e.altKey && (e.key === 'f' || e.key === 'F') && el.modalRoot.hidden) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }
    if (currentView() !== 'builder' || S.settings.editorCollapsed || !S.selected || !el.modalRoot.hidden) return;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      moveNodeBy(S.selected, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (!typing && (e.key === 'Delete' || e.key === 'Backspace')) {
      const f = M.findNode(S.model, S.selected);
      if (f && f.node) { e.preventDefault(); deleteNode(S.selected); }
    }
  });

  window.addEventListener('beforeunload', writeRescue);
  window.addEventListener('pagehide', writeRescue);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') writeRescue(); });

  // ---------------------------------------------------------------------------
  // Başlat
  // ---------------------------------------------------------------------------
  /** Dili uygular ve dinamik arayüzü yeniden çizer. */
  function applyLang() {
    I18N.setLang(S.settings.lang);
    $('#langLabel').textContent = I18N.getLang().toUpperCase();
    document.body.dataset.dropLabel = T('drop.file');
    closePopover();
    applyAppTheme();
    renderPalette();
    applyPin();
    applyPalCompact();
    renderBuilder();
    renderDocList();
    scheduleRender(0);
  }

  async function init() {
    S.settings.lang = I18N.detect(S.settings.lang);
    I18N.setLang(S.settings.lang);
    $('#langLabel').textContent = I18N.getLang().toUpperCase();
    document.body.dataset.dropLabel = T('drop.file');
    applyAppTheme();
    el.mmTheme.value = S.settings.mmTheme;
    el.mirror.checked = !!S.settings.mirror;
    el.colorize.checked = S.settings.colorize !== false;
    configureMermaid();
    // Veri: IndexedDB (gerekirse localStorage'dan taşınır)
    const data = await window.SeqStorage.init();
    S.docs = data.docs;
    S.folders = data.folders || [];
    S.roles = data.roles;
    applyRescue();
    if (!S.settings.firstUse) { S.settings.firstUse = Date.now(); saveSettings(); }
    if (data.migrated && data.migrated.count) toast(T('storage.migrated', { n: data.migrated.count }));
    if (data.mode !== 'idb') setTimeout(() => toast(T('storage.fallback'), 'err'), 600);
    window.SeqStorage.requestPersist().then(() => refreshBackupUi());
    if (!S.roles) { S.roles = PRESET_ROLES.map(presetRole); saveRoles(); }
    renderPalette();
    setView(S.settings.view);
    if (S.settings.editorCollapsed) { $('#workspace').classList.add('editor-collapsed'); document.body.classList.add('editor-hidden'); }

    const fromHash = await loadFromHash();
    if (!fromHash) {
      if (!S.docs.length) {
        const tpl = window.SeqTemplates.find((x) => x.id === 'checkout');
        createDoc(T('doc.sample'), tplL(tpl).code);
      } else {
        openDoc(store.get(LS.cur, null) || S.docs[0].id);
      }
    }
  }
  init();
})();
