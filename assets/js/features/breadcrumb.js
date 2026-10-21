/* Sequence Studio — akış yol göstergesi
 *
 * Düzenleyicide üst barda, akış adının önünde akışın klasör yolu: "Ödeme › Kart ›". Her klasör, Akışlar
 * sayfasını o klasör seçili açar ("#/flows?folder=<id>"); klasörsüz akışta gösterge boştur.
 */
(function (Seq) {
  'use strict';
  const { $, S, T, events, h, ico } = Seq.core;

  let last = '';
  function render() {
    const nav = $('#docCrumbs');
    if (!nav) return;
    const path = S.doc ? Seq.folders.pathOf(S.doc.folder) : [];
    const sig = path.map((f) => f.id + ':' + f.name).join('|') + '#' + T('crumb.folderTitle');
    if (sig === last) return;
    last = sig;
    nav.innerHTML = '';
    // İpucu tam yolu verir (dar üst barda yalnızca son klasör görünür)
    path.forEach((f, i) => nav.append(
      h('a', { class: 'crumb', href: '#/flows?folder=' + encodeURIComponent(f.id), title: T('crumb.folderTitle', { name: path.slice(0, i + 1).map((x) => x.name).join(' / ') }) }, ico('folder'), h('span', null, f.name)),
      h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›')));
    nav.hidden = !path.length;
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    ['doc:opened', 'docs:persisted', 'lang:changed'].forEach((e) => events.on(e, render));
  }

  Seq.breadcrumb = { init, render };
})(window.Seq = window.Seq || {});
