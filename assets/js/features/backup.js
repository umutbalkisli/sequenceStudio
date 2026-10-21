/* Sequence Studio — yedekleme
 *
 * Çalışma alanını tek dosyaya yedekleme, geri yükleme (birleştir/değiştir), depolama durumu ve hatırlatma.
 */
(function (Seq) {
  'use strict';
  const { $, I18N, M, S, T, add, closeModal, downloadBlob, h, ico, openModal, saveSettings, timeAgo, toast, tplL, events } = Seq.core;

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
      // Yedek bir çalışma alanının içeriğidir: ad ve diyagram görünümü ayarları da taşınır
      workspace: { id: S.workspace.id, kind: S.workspace.kind, name: S.workspace.name || '', settings: S.workspace.settings || {} },
      docs: S.docs, folders: S.folders, roles: S.roles || [], catalog: S.catalog || [], settings: S.settings, current: S.doc && S.doc.id,
    };
  }
  function downloadBackup() {
    const b = buildBackup();
    const day = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([JSON.stringify(b, null, 1)], { type: 'application/json' }), T('backup.fileName', { date: day }) + '.json');
    S.settings.lastBackup = Date.now();
    saveSettings();
    Seq.docs.persistDocs();
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
    const catalog = (Array.isArray(b.catalog) ? b.catalog : []).filter((x) => x && /^[A-Za-z0-9_-]+$/.test(x.id || '') && typeof x.name === 'string');
    const w = b.workspace && typeof b.workspace === 'object' ? b.workspace : null;
    const workspace = w ? { name: typeof w.name === 'string' ? w.name : '', settings: w.settings && typeof w.settings === 'object' ? w.settings : {} } : null;
    // Geri yüklenen akışlar etkin çalışma alanına bağlanır
    docs.forEach((d) => { d.workspaceId = S.workspace.id; });
    return { docs, folders, roles, catalog, workspace, exportedAt: b.exportedAt, current: b.current };
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
      S.docs.push(Object.assign({}, d, { id: Seq.docs.newDocId(), name: Seq.docs.uniqueDocName(d.name + T('backup.copySuffix')) }));
      copies++;
    });
    const rIds = new Set((S.roles || []).map((r) => r.id));
    bk.roles.forEach((r) => { if (!rIds.has(r.id)) { (S.roles = S.roles || []).push(r); rIds.add(r.id); } });
    const cIds = new Set(S.catalog.map((x) => x.id));
    bk.catalog.forEach((x) => { if (!cIds.has(x.id)) { S.catalog.push(x); cIds.add(x.id); } });
    return { added, copies, same };
  }
  function replaceWithBackup(bk) {
    S.docs = bk.docs;
    S.folders = bk.folders;
    S.roles = bk.roles.length ? bk.roles : Seq.roles.PRESET_ROLES.map(Seq.roles.presetRole);
    S.catalog = bk.catalog;
    // Tümünü değiştir: çalışma alanının adı ve görünüm ayarları da yedekten gelir
    if (bk.workspace) {
      if (bk.workspace.name) Seq.workspace.rename(bk.workspace.name);
      Object.keys(Seq.workspace.APPEARANCE).forEach((k) => { if (k in bk.workspace.settings) Seq.workspace.set(k, bk.workspace.settings[k]); });
    }
  }
  function afterRestore(preferId) {
    Seq.folders.normalize();
    Seq.docs.persistDocs();
    Seq.roles.saveRoles();
    Seq.catalog.saveCatalog();
    Seq.palette.renderPalette();
    const keep = S.doc && S.docs.find((d) => d.id === S.doc.id);
    if (keep && !preferId) { S.doc = keep; Seq.breadcrumb.render(); }
    else if (S.docs.length) { S.doc = null; Seq.docs.openDoc((preferId && S.docs.find((d) => d.id === preferId) ? preferId : S.docs[0].id)); }
    else { S.doc = null; Seq.docs.createDoc(T('doc.untitled'), tplL(window.SeqTemplates[0]).code); }
    refreshBackupUi();
    Seq.defsNotice.check();
  }
  function openRestore(file) {
    if (!Seq.workspace.editable()) return;
    file.text().then((text) => {
      let bk;
      try { bk = parseBackup(text); } catch (e) { return toast(T('backup.invalid'), 'err'); }
      const when = bk.exportedAt ? new Date(bk.exportedAt).toLocaleString(I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
      const choice = (icn, title, desc, cls, onclick) => h('button', { class: 'restore-opt' + (cls ? ' ' + cls : ''), onclick }, ico(icn), h('b', null, title), h('span', null, desc));
      const body = h('div', { class: 'restore' },
        h('p', { class: 'restore-sum' }, ico('file'), h('span', null, T('backup.summary', { date: when, n: bk.docs.length, m: bk.folders.length, k: bk.roles.length, c: bk.catalog.length }))),
        h('div', { class: 'restore-opts' },
          choice('plus', T('backup.merge'), T('backup.mergeDesc'), 'primary', () => {
            if (S.doc && S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
            const r = mergeBackup(bk);
            closeModal();
            afterRestore();
            toast(T('backup.merged', { a: r.added, c: r.copies, s: r.same }));
          }),
          // Tümünü değiştirmek herkesin içeriğini siler: yalnızca çalışma alanı sahibi
          choice('swap', T('backup.replace'), Seq.workspace.can('admin') ? T('backup.replaceDesc', { n: S.docs.length }) : T('backup.replaceAdmin'), 'danger' + (Seq.workspace.can('admin') ? '' : ' disabled'), () => {
            if (!Seq.workspace.editable('admin')) return;
            if (!confirm(T('backup.confirmReplace', { n: S.docs.length }))) return;
            replaceWithBackup(bk);
            closeModal();
            afterRestore(bk.current);
            toast(T('backup.replaced', { n: bk.docs.length }));
          })),
        h('p', { class: 'note-line' }, ico('help'), T('backup.restoreNote')));
      openModal(T('backup.restoreTitle'), body);
    });
  }

  /** Ayarlar › Veri ve yedekleme bölümündeki yedek/depolama kutusu ve Ayarlar düğmesindeki hatırlatma noktası */
  let backupUiTimer = null;
  function scheduleBackupUi() { clearTimeout(backupUiTimer); backupUiTimer = setTimeout(refreshBackupUi, 400); }
  function refreshBackupUi() {
    const due = backupDue();
    $('#btnSettings').classList.toggle('needs-backup', due);
    document.querySelectorAll('.backup-box').forEach((box) => renderBackupBox(box, due));
  }
  function renderBackupBox(box, due) {
    const last = S.settings.lastBackup;
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) openRestore(f); });
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
    Seq.repo.estimate().then((e) => {
      const where = T(e.mode === 'idb' ? 'storage.idb' : 'storage.local');
      // Boyut kendi verimizden (tarayıcının tahmini file:// adreslerinde güvenilir değil)
      const size = T('storage.usage', { size: fmtBytes(e.dataSize) });
      const pers = e.mode === 'idb' && e.persisted != null ? T(e.persisted ? 'storage.persisted' : 'storage.notPersisted') : '';
      usage.textContent = [where, size, pers].filter(Boolean).join(' · ');
      usage.classList.toggle('warn', e.mode !== 'idb');
    });
  }

  function init() {
    events.on('docs:persisted', () => scheduleBackupUi());
  }

  Seq.backup = { init, refreshBackupUi, scheduleBackupUi };
})(window.Seq = window.Seq || {});
