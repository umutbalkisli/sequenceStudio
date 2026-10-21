/* Sequence Studio — ayarlar sayfası
 *
 * "#/settings[/<bölüm>]". Bölümler iki gruptadır:
 *   Çalışma alanı — workspace (ad, diyagram görünümü), roles, data (yedekleme): bu çalışma alanının herkes için
 *                   geçerli ayarları (yerelde yalnızca bu tarayıcı; bulutta çalışma alanı üyeleri arasında paylaşılır)
 *   Kişisel       — general (ad, dil, uygulama teması): yalnızca bu kullanıcı/cihaz
 * Bölümün `perm` alanı gereken yetkidir; yetki yoksa bölüm salt okunur gösterilir.
 * Bölümler bir listede tanımlıdır; yeni bölüm eklemek için satır eklemek yeterlidir.
 */
(function (Seq) {
  'use strict';
  const { $, I18N, S, T, h, ico, saveSettings } = Seq.core;

  const SECTIONS = [
    { id: 'workspace', group: 'ws', icon: 'workspace', label: 'set.workspace', perm: 'admin', build: buildWorkspace },
    { id: 'roles', group: 'ws', icon: 'shapes', label: 'set.roles', perm: 'edit', build: () => Seq.roles.buildPanel() },
    { id: 'data', group: 'ws', icon: 'download', label: 'set.data', build: buildData },
    { id: 'general', group: 'me', icon: 'globe', label: 'set.general', build: buildGeneral },
  ];

  function field(label, control, hint) {
    return h('div', { class: 'set-field' }, h('label', null, label), h('div', null, control, hint ? h('small', null, hint) : null));
  }
  const switchRow = (id, checked, label, onChange) => {
    const cb = h('input', { type: 'checkbox', id });
    cb.checked = checked;
    cb.addEventListener('change', () => onChange(cb.checked));
    return h('label', { class: 'switch' }, cb, h('span', { class: 'switch-ui' }), h('span', null, label));
  };

  // --- Çalışma alanı ---
  function buildWorkspace() {
    const W = Seq.workspace;
    const name = h('input', { class: 'input', id: 'wsName', value: S.workspace.name || '', placeholder: T('ws.localName'), spellcheck: 'false' });
    name.addEventListener('change', () => { W.rename(name.value); renderNav(); });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
    // Mermaid teması: önizleme başlığındaki seçimle aynı seçenekler
    const theme = h('select', { class: 'select', id: 'wsMmTheme' }, [...document.querySelectorAll('#mmTheme option')].map((o) => h('option', { value: o.value }, o.textContent)));
    theme.value = W.get('mmTheme');
    theme.addEventListener('change', () => W.set('mmTheme', theme.value));
    return h('div', { class: 'set-section' },
      h('p', { class: 'roles-intro' }, T(W.isLocal() ? 'set.wsIntroLocal' : 'set.wsIntroCloud')),
      field(T('set.wsName'), name),
      field(T('set.wsKind'), h('span', { class: 'ws-kind' }, ico('workspace'), T(W.isLocal() ? 'ws.kindLocal' : 'ws.kindCloud')), W.isLocal() ? T('ws.cloudNote') : null),
      field(T('set.wsContent'), h('span', { class: 'ws-stats', id: 'wsStats' }, W.stats())),
      h('h3', { class: 'set-sub' }, T('set.appearance')),
      h('p', { class: 'note-line', style: 'margin:0 0 12px' }, ico('help'), T('set.appearanceHint')),
      field(T('set.mmTheme'), theme),
      field(T('set.mirror'), switchRow('wsMirror', !!W.get('mirror'), T('set.mirrorHint'), (v) => W.set('mirror', v))),
      field(T('set.legend'), switchRow('wsLegend', W.get('legend') !== false, T('set.legendHint'), (v) => W.set('legend', v))));
  }
  function buildData() {
    const box = h('div', { class: 'backup-box set-backup' });
    setTimeout(() => Seq.backup.refreshBackupUi(), 0);
    return h('div', { class: 'set-section' },
      h('p', { class: 'roles-intro' }, T('set.dataIntro', { name: Seq.workspace.name() })),
      box,
      h('p', { class: 'note-line' }, ico('help'), T('backup.restoreNote')));
  }

  // --- Kişisel ---
  function buildGeneral() {
    const me = h('input', { class: 'input', id: 'userName', value: Seq.user.name(), placeholder: T('user.namePh'), spellcheck: 'false' });
    me.addEventListener('change', () => Seq.user.rename(me.value));
    me.addEventListener('keydown', (e) => { if (e.key === 'Enter') me.blur(); });
    const lang = h('select', { class: 'select', id: 'setLang' }, I18N.LANGS.map((l) => h('option', { value: l }, T('set.lang.' + l))));
    lang.value = I18N.getLang();
    lang.addEventListener('change', () => { S.settings.lang = lang.value; saveSettings(); Seq.main.applyLang(); });
    const theme = h('select', { class: 'select', id: 'setTheme' }, ['system', 'light', 'dark'].map((t) => h('option', { value: t }, T('set.theme.' + t))));
    theme.value = S.settings.appTheme || 'system';
    theme.addEventListener('change', () => {
      S.settings.appTheme = theme.value;
      saveSettings();
      Seq.theme.applyAppTheme();
      Seq.theme.configureMermaid();
      Seq.preview.scheduleRender(0);
    });
    return h('div', { class: 'set-section' },
      h('p', { class: 'roles-intro' }, T('set.personalIntro')),
      field(T('user.name'), me, T('user.nameHint')),
      field(T('set.language'), lang),
      field(T('set.appTheme'), theme, T('set.themeHint')));
  }

  let current = SECTIONS[0];
  function renderNav() {
    const nav = $('#settingsScreen .set-nav');
    if (!nav) return;
    nav.innerHTML = '';
    const group = (g, title) => [
      h('div', { class: 'set-group' }, title),
      SECTIONS.filter((s) => s.group === g).map((s) => h('a', { href: '#/settings/' + s.id, class: s === current ? 'active' : '', 'data-section': s.id }, ico(s.icon), T(s.label))),
    ];
    nav.append(...group('ws', T('set.groupWs', { name: Seq.workspace.name() })).flat(), ...group('me', T('set.groupMe')).flat());
  }
  function render(section) {
    const root = $('#settingsScreen');
    current = SECTIONS.find((s) => s.id === section) || SECTIONS[0];
    root.innerHTML = '';
    root.append(
      h('div', { class: 'page-head' }, h('h1', null, ico('settings'), T('set.title'))),
      h('div', { class: 'set-body' },
        h('nav', { class: 'set-nav' }),
        h('main', { class: 'set-main' + (current.perm && !Seq.workspace.can(current.perm) ? ' locked' : '') }, h('h2', null, T(current.label)), current.build())));
    renderNav();
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    Seq.router.register({
      id: 'settings', nav: 'settings', pattern: /^settings(?:\/([a-z]+))?$/, params: (m) => ({ section: m[1] || 'workspace' }),
      mount: (p) => { $('#settingsScreen').hidden = false; render(p.section); },
      update: (p) => render(p.section),
      unmount: () => { $('#settingsScreen').hidden = true; },
    });
    // Önizleme başlığından değişen görünüm ayarı bu sayfada da güncel görünsün
    Seq.core.events.on('workspace:changed', ({ key }) => {
      if (Seq.router.screen() !== 'settings' || current.id !== 'workspace') return;
      const sel = $('#wsMmTheme'), mir = $('#wsMirror'), leg = $('#wsLegend');
      if (key === 'mmTheme' && sel) sel.value = Seq.workspace.get('mmTheme');
      if (key === 'mirror' && mir) mir.checked = !!Seq.workspace.get('mirror');
      if (key === 'legend' && leg) leg.checked = Seq.workspace.get('legend') !== false;
    });
  }

  Seq.settingsPage = { init, SECTIONS };
})(window.Seq = window.Seq || {});
