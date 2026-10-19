/* Sequence Studio — açılış
 *
 * Modülleri başlatır, veriyi yükler ve ilk diyagramı açar. Dil değişiminde arayüzü yeniden çizer.
 */
(function (Seq) {
  'use strict';
  const { $, I18N, LS, S, T, el, saveSettings, store, toast, tplL } = Seq.core;

  // ---------------------------------------------------------------------------
  // Başlat
  // ---------------------------------------------------------------------------
  /** Dili uygular ve dinamik arayüzü yeniden çizer. */
  function applyLang() {
    I18N.setLang(S.settings.lang);
    $('#langLabel').textContent = I18N.getLang().toUpperCase();
    document.body.dataset.dropLabel = T('drop.file');
    Seq.participants.closePopover();
    Seq.theme.applyAppTheme();
    Seq.palette.renderPalette();
    Seq.layout.applyPin();
    Seq.palette.applyPalCompact();
    Seq.flow.renderBuilder();
    Seq.drawer.renderDocList();
    Seq.preview.scheduleRender(0);
  }

  async function boot() {
    S.settings.lang = I18N.detect(S.settings.lang);
    I18N.setLang(S.settings.lang);
    $('#langLabel').textContent = I18N.getLang().toUpperCase();
    document.body.dataset.dropLabel = T('drop.file');
    Seq.theme.applyAppTheme();
    el.mmTheme.value = S.settings.mmTheme;
    el.mirror.checked = !!S.settings.mirror;
    el.colorize.checked = S.settings.colorize !== false;
    el.legend.checked = S.settings.legend !== false;
    Seq.theme.configureMermaid();
    // Veri: IndexedDB (gerekirse localStorage'dan taşınır)
    const data = await window.SeqStorage.init();
    S.docs = data.docs;
    S.folders = data.folders || [];
    S.roles = data.roles;
    S.catalog = data.catalog || [];
    Seq.docs.applyRescue();
    if (!S.settings.firstUse) { S.settings.firstUse = Date.now(); saveSettings(); }
    if (data.migrated && data.migrated.count) toast(T('storage.migrated', { n: data.migrated.count }));
    if (data.mode !== 'idb') setTimeout(() => toast(T('storage.fallback'), 'err'), 600);
    window.SeqStorage.requestPersist().then(() => Seq.backup.refreshBackupUi());
    if (!S.roles) { S.roles = Seq.roles.PRESET_ROLES.map(Seq.roles.presetRole); Seq.roles.saveRoles(); }
    Seq.palette.renderPalette();
    Seq.layout.setView(S.settings.view);
    if (S.settings.editorCollapsed) { $('#workspace').classList.add('editor-collapsed'); document.body.classList.add('editor-hidden'); }

    const fromHash = await Seq.share.loadFromHash();
    if (!fromHash) {
      if (!S.docs.length) {
        const tpl = window.SeqTemplates.find((x) => x.id === 'checkout');
        Seq.docs.createDoc(T('doc.sample'), tplL(tpl).code);
      } else {
        Seq.docs.openDoc(store.get(LS.cur, null) || S.docs[0].id);
      }
    }
  }

  /**
   * Modüllerin olay bağlamaları bu sırayla yapılır (önce çekirdek ve tema, en son klavye kısayolları).
   * Modüller yüklenirken birbirine dokunmaz; tüm bağlantılar burada, her şey yüklendikten sonra kurulur.
   */
  const INIT_ORDER = ['core', 'theme', 'drawer', 'preview', 'colors', 'legend', 'code', 'layout', 'roles', 'catalog', 'defsNotice', 'participants', 'flow', 'share',
    'editor', 'help', 'export', 'versions', 'search', 'docs', 'refs', 'lint', 'backlinks', 'backup', 'palette', 'shortcuts'];

  function start() {
    INIT_ORDER.forEach((m) => Seq[m].init());
    $('#btnLang').addEventListener('click', () => {
      S.settings.lang = I18N.getLang() === 'tr' ? 'en' : 'tr';
      saveSettings();
      applyLang();
    });
    boot();
  }

  Seq.main = { start, applyLang };
  start();
})(window.Seq = window.Seq || {});
