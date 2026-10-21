/* Sequence Studio — yönlendirici
 *
 * Uygulama tek sayfadır (file:// ve GitHub Pages'te depolama paylaşılsın diye), ama her ekranın bir adresi
 * vardır: "#/flows", "#/flows/<id>", "#/catalog/<id>", "#/architecture/<odak>", "#/settings/<bölüm>".
 * Böylece derin link verilebilir, tarayıcının geri/ileri düğmeleri çalışır.
 *
 * Ekranlar kendilerini kaydeder (register); yeni ekran eklemek mevcut kodu değiştirmez:
 *   { id, nav, pattern: RegExp, params(match, query) → {…}, mount(params), update?(params), unmount?() }
 * Etkin ekran <body> üzerinde "screen-<id>" sınıfıyla işaretlenir; üst gezinmede nav değeri vurgulanır.
 * Paylaşım linklerinin "#s=…" biçimi "#/" önekiyle çakışmaz.
 */
(function (Seq) {
  'use strict';
  const { S, events } = Seq.core;

  const screens = [];
  let current = null; // { screen, params, path }
  let ready = false;
  let ignoreHash = null; // kendi yazdığımız hash için gelecek hashchange yok sayılır

  function register(screen) { screens.push(screen); }

  /** "#/catalog/x?match=1" → { path: 'catalog/x', query: {match:'1'} } */
  function parse(hash) {
    const raw = String(hash || '').replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    const query = {};
    (qs || '').split('&').filter(Boolean).forEach((kv) => {
      const [k, v] = kv.split('=');
      query[decodeURIComponent(k)] = v == null ? '' : decodeURIComponent(v);
    });
    return { path: path.replace(/\/+$/, ''), query };
  }

  function apply(hash) {
    const { path, query } = parse(hash);
    for (const screen of screens) {
      const m = screen.pattern.exec(path);
      if (!m) continue;
      const params = screen.params ? screen.params(m, query) : {};
      if (current && current.screen === screen && screen.update) {
        current = { screen, params, path };
        screen.update(params);
      } else {
        if (current && current.screen.unmount) current.screen.unmount();
        current = { screen, params, path };
        document.body.className = document.body.className.replace(/\bscreen-[\w-]+\b/g, '').trim();
        document.body.classList.add('screen-' + screen.id);
        document.querySelectorAll('[data-nav]').forEach((a) => {
          const on = a.dataset.nav === screen.nav;
          a.classList.toggle('active', on);
          if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
        screen.mount(params);
      }
      events.emit('route:changed', { screen: screen.id, params });
      return true;
    }
    return false;
  }

  /**
   * Adrese gider ve ekranı hemen (senkron) açar; böylece "akışa git, sonra katılımcıyı göster" gibi ardışık
   * işlemler güvenle yapılabilir. replace: tarayıcı geçmişine yeni kayıt eklemez.
   */
  function go(path, opts) {
    const hash = '#/' + String(path).replace(/^#?\/?/, '');
    if (location.hash !== hash) {
      if (opts && opts.replace) history.replaceState(null, '', hash);
      else { ignoreHash = hash; location.hash = hash; }
    }
    if (!apply(hash)) go('flows', { replace: true });
  }
  /** Akışı düzenleyicide açar */
  const openFlow = (id) => go('flows/' + encodeURIComponent(id));
  /** Etkin ekranı baştan kurar (ör. dil değişince sayfa başlıkları da yenilensin) */
  function remount() {
    if (!current) return;
    const { screen: sc, params: p } = current;
    if (sc.unmount) sc.unmount();
    sc.mount(p);
  }
  const screen = () => (current ? current.screen.id : null);
  const params = () => (current ? current.params : {});

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    window.addEventListener('hashchange', () => {
      if (location.hash === ignoreHash) { ignoreHash = null; return; }
      ignoreHash = null;
      if (!location.hash.startsWith('#/')) return;
      if (!apply(location.hash)) go('flows', { replace: true });
    });
    // Açılış: adres bir ekranı gösteriyorsa ona, yoksa son açılan akışa
    events.on('app:ready', () => {
      ready = true;
      if (location.hash.startsWith('#/') && apply(location.hash)) return;
      go(S.doc ? 'flows/' + S.doc.id : 'flows', { replace: true });
    });
    // Düzenleyicide başka bir akış açılınca adres izler (geri düğmesi önceki akışa döner)
    events.on('doc:opened', ({ doc }) => {
      if (!ready || screen() !== 'editor' || !doc || params().id === doc.id) return;
      openFlow(doc.id);
    });
    // Yeni akış oluşturulunca (şablon, içe aktarma, yeni) düzenleyiciye geçilir
    events.on('doc:created', ({ doc, open }) => { if (ready && open !== false && doc) openFlow(doc.id); });
    // Düzenleyicide açık akış silinirse adres yeni açılana geçer; başka ekrandaysa dokunulmaz
    events.on('doc:deleted', ({ id }) => { if (screen() === 'editor' && params().id === id && S.doc) go('flows/' + S.doc.id, { replace: true }); });
    events.on('lang:changed', () => { if (screen() !== 'editor') remount(); });
  }

  Seq.router = { init, go, openFlow, params, parse, register, remount, screen };
})(window.Seq = window.Seq || {});
