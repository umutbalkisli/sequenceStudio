/* Sequence Studio — çalışma alanı
 *
 * Tüm içerik (akışlar, klasörler, roller, katalog) ve diyagram görünümü ayarları bir çalışma alanına aittir.
 * Yerel sürümde tek ve sabit bir çalışma alanı vardır ("Yerel çalışma alanı"); kullanıcı yenisini açamaz,
 * yalnızca adını ve görünüm ayarlarını değiştirebilir. Bulut sürümünde aynı yapı, ekip üyeleri arasında
 * paylaşılan birden çok çalışma alanına genişler (bkz. docs/ARCHITECTURE.md).
 *
 * Kişisel ayarlar (dil, uygulama teması, yerleşim) çalışma alanından bağımsızdır ve S.settings'te kalır.
 *
 * Yetki: çalışma alanı kaydındaki rol (owner | editor | viewer) izinleri belirler. Yerelde kullanıcı sahiptir;
 * bulutta rol üyelikten gelir. Düzenleme izni yoksa uygulama salt okunur çalışır (body.readonly): düzenleme
 * arayüzü kilitlenir, değişiklik yapan işlemler editable() ile reddedilir ve depo yazmaz.
 */
(function (Seq) {
  'use strict';
  const { $, S, T, dropdown, events, h, ico, saveSettings, toast } = Seq.core;

  /** Çalışma alanına ait diyagram görünümü ayarları ve varsayılanları */
  const APPEARANCE = { mmTheme: 'auto', mirror: true, legend: true };

  const ws = () => S.workspace;
  const isLocal = () => ws().kind === 'local';
  /** Görünen ad (ad verilmediyse yerel çalışma alanının varsayılan adı) */
  const name = () => (ws().name && ws().name.trim()) || T('ws.localName');
  const save = () => Seq.repo.saveWorkspace(ws()).catch(Seq.docs.storageError);

  // --- Yetkiler ---
  const PERMS = { owner: ['edit', 'admin'], editor: ['edit'], viewer: [] };
  const role = () => (PERMS[ws().role] ? ws().role : 'owner');
  /** İzin: 'edit' (içerik değiştirme) | 'admin' (çalışma alanı ayarları) */
  const can = (perm) => PERMS[role()].includes(perm);
  let deniedAt = 0;
  /** Değişiklik yapan işlemlerin başında çağrılır; izin yoksa (art arda tek) uyarı gösterip false döner */
  function editable() {
    if (can('edit')) return true;
    if (Date.now() - deniedAt > 3000) { deniedAt = Date.now(); toast(T('ws.readonlyDenied'), 'err'); }
    return false;
  }
  function applyPermissions() {
    document.body.classList.toggle('readonly', !can('edit'));
    ['#code', '#docName', '#diagramTitle'].forEach((sel) => { const n = $(sel); if (n) n.readOnly = !can('edit'); });
  }

  /** Çalışma alanı ayarı (yoksa varsayılan) */
  function get(key) {
    const st = ws().settings || {};
    return key in st ? st[key] : APPEARANCE[key];
  }
  function set(key, value) {
    ws().settings = Object.assign({}, ws().settings, { [key]: value });
    save();
    events.emit('workspace:changed', { key });
  }
  function rename(value) {
    const v = String(value || '').trim();
    if (v === (ws().name || '')) return;
    ws().name = v;
    save();
    updateBadge();
    events.emit('workspace:changed', { key: 'name' });
  }

  /**
   * Açılış: depodan gelen çalışma alanını etkinleştirir. Görünüm ayarları önceki sürümlerde kişisel ayarlarda
   * tutuluyordu; ilk açılışta oradan alınır ve kişisel ayarlardan silinir.
   */
  function load(w) {
    S.workspace = Object.assign({ kind: 'local', name: '' }, w);
    if (!S.workspace.settings) {
      S.workspace.settings = {};
      Object.keys(APPEARANCE).forEach((k) => { if (S.settings[k] !== undefined) S.workspace.settings[k] = S.settings[k]; });
      save();
    }
    if (Object.keys(APPEARANCE).some((k) => k in S.settings)) {
      Object.keys(APPEARANCE).forEach((k) => delete S.settings[k]);
      saveSettings();
    }
    applyPermissions();
    updateBadge();
  }

  /** Özet sayılar (rozet ve ayarlar sayfası için) */
  const stats = () => T('ws.stats', { n: S.docs.length, m: S.folders.length, c: (S.catalog || []).length, r: (S.roles || []).length });

  // --- Üst bardaki rozet: etkin çalışma alanı (yerelde yeni çalışma alanı açılamaz) ---
  function updateBadge() {
    const b = $('#btnWorkspace');
    if (!b) return;
    b.querySelector('span').textContent = name();
    b.title = T('ws.badgeTitle', { name: name() }) + (can('edit') ? '' : ' · ' + T('ws.readonly'));
  }
  let panel = null;
  function openPanel() {
    if (panel) return panel.close();
    panel = dropdown($('#btnWorkspace'), (box) => {
      box.append(
        h('div', { class: 'dd-head' }, h('b', null, T('ws.title')), h('span', { class: 'dd-sum' })),
        h('div', { class: 'ws-card current' },
          h('span', { class: 'ws-icon' }, ico('workspace')),
          h('span', { class: 'ws-text' }, h('b', null, name()), h('small', null, T(isLocal() ? 'ws.kindLocal' : 'ws.kindCloud'))),
          ico('check')),
        h('p', { class: 'ws-role' }, T('ws.roleLabel'), ' ', h('b', null, T('ws.role.' + role()))),
        can('edit') ? null : h('p', { class: 'note-line warn' }, ico('lock'), T('ws.readonlyNote')),
        h('p', { class: 'ws-stats' }, stats()),
        h('a', { class: 'dd-item', href: '#/settings/workspace', onclick: () => panel.close() }, ico('settings'), h('span', null, T('ws.settings'))),
        isLocal() ? h('p', { class: 'note-line' }, ico('help'), T('ws.cloudNote')) : null);
    }, { class: 'ws-panel', label: T('ws.title'), onClose: () => { panel = null; } });
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    $('#btnWorkspace').addEventListener('click', openPanel);
    events.on('lang:changed', updateBadge);
  }

  Seq.workspace = { init, APPEARANCE, can, editable, get, isLocal, load, name, rename, role, set, stats };
})(window.Seq = window.Seq || {});
