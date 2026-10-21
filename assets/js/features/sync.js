/* Sequence Studio — dışarıdan gelen değişiklikler
 *
 * Depo ("repo:remote") başka bir sekmede yapılan değişikliği bildirince (bulut sürümünde: başka bir üyenin
 * değişikliği) kayıtlar bellekteki duruma öğe öğe işlenir; ekranlar olaylarla yenilenir:
 *
 *   • Klasör, rol, katalog: öğe yerinde güncellenir, eklenir ya da silinir; sıra depodaki sıraya göre kurulur.
 *     Bu sekmede henüz yazılmamış başka öğelerdeki değişiklikler korunur.
 *   • Akış: açık değilse yerinde güncellenir. Açık akış değiştiyse ve burada kaydedilmemiş değişiklik yoksa
 *     güncel hâli yüklenir; varsa çakışma çubuğu sorar: "Diğer sekmedekini yükle" ya da "Benimkini koru"
 *     (korunursa bir sonraki kayıt diğerinin üstüne yeni revizyon olarak yazılır).
 *   • Çalışma alanı: ad, görünüm ve yetki uygulanır.
 *   • "repo:stale": veritabanı başka sekmede yükseltildi; yenileme çağrısı gösterilir.
 */
(function (Seq) {
  'use strict';
  const { $, S, T, add, el, events, h, ico, toast } = Seq.core;

  const LIST = { folder: 'folders', role: 'roles', catalog: 'catalog' };

  /** Nesneyi yerinde başka bir nesnenin içeriğine çevirir (ekranlardaki referanslar geçerli kalsın) */
  function replaceIn(target, data) {
    Object.keys(target).forEach((k) => { if (!(k in data)) delete target[k]; });
    Object.assign(target, data);
  }

  /** Kayıtları bir listeye işler; döner: yeni liste */
  function merge(list, records, type) {
    let out = (list || []).slice();
    records.forEach((r) => {
      const i = out.findIndex((x) => x.id === r.id);
      if (r.meta.deleted || r.data == null) { if (i >= 0) out.splice(i, 1); return; }
      if (i >= 0) replaceIn(out[i], r.data); else out.push(JSON.parse(JSON.stringify(r.data)));
    });
    if (type !== 'doc') {
      const pos = (x) => Seq.repo.pos(type, x.id);
      out = out.map((x, i) => [x, i]).sort((a, b) => pos(a[0]) - pos(b[0]) || a[1] - b[1]).map(([x]) => x);
    }
    return out;
  }

  // --- Açık akış ---
  const box = () => $('#syncNotice');
  const hideConflict = () => { const b = box(); if (b) b.hidden = true; };
  /** Açık akışta burada yazılmamış değişiklik var mı: editör kayıttan ileride ya da akış son yazılan hâlden farklı */
  const dirty = (rec) => !!S.doc && (S.code !== S.doc.code || el.code.value !== S.code || Seq.docs.editPending() || JSON.stringify(S.doc) !== rec.prevJson);

  function loadTheirs(data) {
    replaceIn(S.doc, data);
    Seq.editor.applyCode(S.doc.code, 'load');
    Seq.editor.resetHistory();
    el.docName.value = S.doc.name;
    events.emit('doc:opened', { doc: S.doc });
  }
  /** Buradaki hâl korunur: editördeki son metin kaydedilir (diğerinin üstüne yeni revizyon olarak) */
  function keepMine() {
    hideConflict();
    if (el.code.value !== S.code) Seq.editor.applyCode(el.code.value, 'code');
    if (S.doc.code !== S.code) { S.doc.code = S.code; S.doc.updated = Date.now(); }
    Seq.docs.persistDocs();
  }
  function showConflict(data) {
    const b = box();
    if (!b) return;
    b.innerHTML = '';
    add(b,
      ico('critical'),
      h('div', { class: 'nt-text' }, h('b', null, T('sync.conflict'))),
      h('div', { class: 'nt-actions' },
        h('button', { class: 'btn primary sm', onclick: () => { hideConflict(); loadTheirs(data); } }, T('sync.takeTheirs')),
        h('button', { class: 'btn ghost sm', onclick: keepMine }, T('sync.keepMine'))));
    b.hidden = false;
  }

  function applyDocs(records) {
    const cur = S.doc;
    const own = cur && records.find((r) => r.id === cur.id);
    const others = records.filter((r) => r !== own);
    if (others.length) S.docs = merge(S.docs, others, 'doc');
    if (own) {
      if (own.meta.deleted || own.data == null) {
        toast(T('sync.deleted', { name: cur.name }), 'err');
        S.docs = S.docs.filter((d) => d !== cur);
        S.doc = null;
        hideConflict();
        if (S.docs.length) Seq.router.openFlow(S.docs[0].id);
        else Seq.router.go('flows');
      } else if (JSON.stringify(own.data) !== JSON.stringify(cur)) {
        if (dirty(own)) showConflict(own.data);
        else { loadTheirs(own.data); toast(T('sync.updated', { name: cur.name })); }
      }
    }
    events.emit('docs:persisted');
  }

  function applyList(type, records) {
    const key = LIST[type];
    S[key] = merge(S[key], records, type);
    Seq.palette.renderPalette();
    if (type === 'catalog') events.emit('catalog:changed');
    if (type === 'role') events.emit('roles:changed');
    if (type === 'folder') { Seq.folders.normalize(); events.emit('docs:persisted'); }
    // Değişen tanımlar açık akışa uygulanır (tembel yayılım)
    if (type !== 'folder' && Seq.workspace.can('edit')) Seq.reconcile.current();
  }

  function onRemote({ type, records }) {
    if (type === 'workspace') return Seq.workspace.applyRemote(records[0]);
    if (type === 'doc') return applyDocs(records);
    if (LIST[type]) applyList(type, records);
  }

  /** Tüm ekranlarda görünen, kapatılamayan yenileme çağrısı */
  function onStale() {
    if ($('#staleBanner')) return;
    document.body.append(h('div', { class: 'notice warn stale-banner', id: 'staleBanner', role: 'alert' },
      ico('critical'), h('div', { class: 'nt-text' }, h('b', null, T('ws.stale'))),
      h('div', { class: 'nt-actions' }, h('button', { class: 'btn primary sm', onclick: () => location.reload() }, T('ws.reload')))));
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    events.on('repo:remote', onRemote);
    events.on('repo:stale', onStale);
    events.on('doc:opened', hideConflict);
  }

  Seq.sync = { init, merge };
})(window.Seq = window.Seq || {});
