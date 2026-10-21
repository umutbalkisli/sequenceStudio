/* Sequence Studio — değişiklik kümesi (saf mantık)
 *
 * Bir koleksiyonun (akışlar, klasörler, roller, katalog) son yazılan hâliyle yeni hâlini karşılaştırır ve
 * yalnızca değişen öğeler için kayıt üretir. Her kayıt üstveri taşır; senkronizasyon ve çakışma algılama
 * bunun üzerine kurulur:
 *
 *   kayıt  = { id, pos, data, meta }       data: öğenin kendisi (silinmişse null), pos: listedeki sıra
 *   meta   = { rev, createdAt, createdBy, updatedAt, updatedBy, deleted? }
 *
 * Listeden çıkan öğe silinmez; "silme izi" (deleted: true, rev artmış) bırakılır ki başka cihaz da silindiğini
 * öğrenebilsin. Durum (state) bellekte tutulan son yazılan hâldir: Map(id → { json, pos, meta }).
 * Tarayıcıda window.SeqChangeset, Node'da module.exports.
 */
(function (root) {
  'use strict';

  /** Depodan okunan kayıtlardan durum ve (silinmemiş) öğe listesi; sıra pos'a göre */
  function fromRecords(records) {
    const state = new Map();
    const live = [];
    (records || []).forEach((r) => {
      if (!r || r.id == null || !r.meta) return;
      state.set(r.id, { json: r.data == null ? null : JSON.stringify(r.data), pos: r.pos || 0, meta: r.meta });
      if (!r.meta.deleted && r.data != null) live.push(r);
    });
    live.sort((a, b) => (a.pos || 0) - (b.pos || 0));
    return { state, items: live.map((r) => r.data) };
  }

  /**
   * Yeni liste için yazılacak kayıtlar. ctx: { now, by, ordered } (zaman, yazan kullanıcı; ordered: false ise
   * sıra takip edilmez — akışlar gibi sırası anlamsız koleksiyonlarda başa ekleme tüm listeyi yeniden yazdırmasın).
   * Döner: { puts: [kayıt], next: yeni durum }; değişiklik yoksa puts boştur.
   */
  function diff(state, list, ctx) {
    const puts = [];
    const next = new Map(state);
    const seen = new Set();
    (list || []).forEach((e, i) => {
      if (!e || e.id == null || seen.has(e.id)) return;
      const pos = ctx.ordered === false ? 0 : i;
      seen.add(e.id);
      const json = JSON.stringify(e);
      const prev = state.get(e.id);
      if (prev && !prev.meta.deleted && prev.json === json && prev.pos === pos) return;
      const meta = prev
        ? Object.assign({}, prev.meta, { rev: prev.meta.rev + 1, updatedAt: ctx.now, updatedBy: ctx.by })
        : { rev: 1, createdAt: ctx.now, createdBy: ctx.by, updatedAt: ctx.now, updatedBy: ctx.by };
      delete meta.deleted;
      puts.push({ id: e.id, pos, data: JSON.parse(json), meta });
      next.set(e.id, { json, pos, meta });
    });
    state.forEach((v, id) => {
      if (seen.has(id) || v.meta.deleted) return;
      const meta = Object.assign({}, v.meta, { rev: v.meta.rev + 1, updatedAt: ctx.now, updatedBy: ctx.by, deleted: true });
      puts.push({ id, pos: v.pos, data: null, meta });
      next.set(id, { json: null, pos: v.pos, meta });
    });
    return { puts, next };
  }

  /** Silinmiş öğelerin kimlikleri (tembel yayılım: silinen öğeye bağlı katılımcıların bağı açılırken kalkar) */
  const deletedIds = (state) => [...state].filter(([, v]) => v.meta.deleted).map(([id]) => id);

  const api = { fromRecords, diff, deletedIds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeqChangeset = api;
})(typeof window !== 'undefined' ? window : globalThis);
