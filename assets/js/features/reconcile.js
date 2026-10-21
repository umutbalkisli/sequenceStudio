/* Sequence Studio — tembel yayılım (reconcile)
 *
 * Bir katalog öğesi, rol ya da akış adı değiştiğinde diğer akışlar yeniden yazılmaz (paylaşılan çalışma alanında
 * bir kişinin değişikliği yüzlerce akışı birden değiştirip çakışma üretmesin). Bunun yerine tanımlar kısa bir
 * geçmiş tutar ve her akış okunurken güncel tanıma uyarlanır:
 *
 *   katalog öğesi  x.past = [{ name, role, type, color }]                          (en yeni önde)
 *   rol            r.past = [{ type, color, prefix, suffix, prefixBreak?, suffixBreak? }]
 *   akış           d.past = [eski ad]
 *
 * Kurallar (elle yapılmış değişiklik korunur; yalnızca tanımı izleyen değerler güncellenir):
 *   • Öğeye bağlı katılımcı: adı öğenin eski/şimdiki adlarından (rol ekleriyle) biriyse yeni ada geçer;
 *     görünümü (tür, renk, rol) öğenin ya da rolünün eski görünümlerinden biriyse yeni görünüme geçer.
 *   • Yalnızca role bağlı katılımcı: görünüm aynı kuralla; ad, rolün eski ekleriyle yazılmışsa yeni eklerle yazılır.
 *   • Silinen öğe/rol (silme izi): bağ kaldırılır.
 *   • Referans notu: metni hedef akışın eski adlarından biriyse yeni ada geçer.
 *
 * Uyarlama, akış açılırken (docs.openDoc) yapılıp kaydedilir; açılmayan akışlar okunurken (core.docCode: önizleme,
 * mimari görünüm, dışa aktarma, arama…) bellekte uyarlanır. Açık akış tanım değişince hemen uyarlanır.
 */
(function (Seq) {
  'use strict';
  const { M, S, events } = Seq.core;
  const PAST_CAP = 10;
  const MARKER = /%%\s*@(item|role|ref)\b/;

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  /** Geçmişe ekler: aynısı varsa öne alınır; en fazla PAST_CAP kayıt */
  function remember(target, entry, prevPast) {
    const past = (target.past || prevPast || []).filter((e) => !same(e, entry));
    target.past = [entry].concat(past).slice(0, PAST_CAP);
  }

  const roleView = (r) => {
    const v = { type: r.type, color: r.color, prefix: r.prefix || '', suffix: r.suffix || '' };
    if (r.prefixBreak) v.prefixBreak = true;
    if (r.suffixBreak) v.suffixBreak = true;
    return v;
  };
  const itemView = (x) => {
    const lk = Seq.catalog.lookOf(x);
    return { name: x.name, role: x.role || '', type: lk.type, color: lk.color };
  };

  // --- Tanım değişikliklerinin kaydı (değişiklik yerleşince çağrılır; eski hâl geçmişe yazılır) ---
  function roleChanged(old, cur) {
    if (!cur || same(roleView(old), roleView(cur))) return false;
    remember(cur, roleView(old), old.past);
    return true;
  }
  function itemChanged(old, cur) {
    if (!cur) return false;
    const v = itemView(old);
    if (same(v, itemView(cur))) return false;
    remember(cur, v, old.past);
    return true;
  }
  function docRenamed(d, from) {
    if (!d || !from || from === d.name) return false;
    d.past = [from].concat((d.past || []).filter((n) => n !== from && n !== d.name)).slice(0, PAST_CAP);
    return true;
  }

  // --- Uyarlama ---
  const R = () => Seq.roles;
  /** Rolün şimdiki ve eski hâlleri (ek ve görünüm) */
  const roleStates = (id) => { const r = R().roleById(id); return r ? [r].concat(r.past || []) : []; };

  function followItem(p, x, goneRoles) {
    let ch = false;
    const past = x.past || [];
    // Görünüm: öğenin ya da (eski/şimdiki) rollerinin bir hâline eşitse izler; rolü silinmişse her durumda
    const lk = Seq.catalog.lookOf(x);
    const wantRole = lk.role ? lk.role.id : undefined;
    if (p.type !== lk.type || p.color !== lk.color || p.role !== wantRole) {
      const roleIds = new Set([x.role || ''].concat(past.map((e) => e.role || '')).concat(p.role ? [p.role] : []));
      const looks = new Set(past.map((e) => e.type + '|' + e.color));
      roleIds.forEach((id) => roleStates(id).forEach((s) => looks.add(s.type + '|' + s.color)));
      const roleGone = p.role && (goneRoles.has(p.role) || !R().roleById(p.role));
      if (roleGone || looks.has(p.type + '|' + p.color)) { Seq.catalog.applyLook(p, x); ch = true; }
    }
    // Ad: öğenin eski/şimdiki adlarından biri, eski/şimdiki rol ekleriyle yazılmışsa izler
    const label = Seq.catalog.displayName(x);
    if (p.label !== label) {
      const names = [x.name].concat(past.map((e) => e.name));
      const affixes = [{}];
      new Set([x.role || ''].concat(past.map((e) => e.role || ''))).forEach((id) => affixes.push(...roleStates(id)));
      const known = names.some((n) => affixes.some((a) => R().composeLabel(a, n) === p.label));
      if (known) { p.label = label; ch = true; }
    }
    return ch;
  }

  function followRole(p, r) {
    let ch = false;
    const past = r.past || [];
    if (!past.length) return false;
    if ((p.type !== r.type || p.color !== r.color) && past.some((e) => e.type === p.type && e.color === p.color)) {
      p.type = r.type;
      p.color = r.color;
      ch = true;
    }
    // Ad şimdiki eklerle yazılmamışsa, eklerini taşıdığı ilk eski hâle göre yeniden yazılır
    const hasAffix = (a) => !!(a.prefix || a.suffix);
    const base = R().stripAffixes(p.label, r);
    const current = R().composeLabel(r, base) === p.label && (!hasAffix(r) || base !== p.label);
    if (!current) {
      const e = past.find((a) => !hasAffix(a) || R().stripAffixes(p.label, a) !== p.label);
      if (e) {
        const next = R().composeLabel(r, R().stripAffixes(p.label, e));
        if (next !== p.label) { p.label = next; ch = true; }
      }
    }
    return ch;
  }

  /**
   * Modeli güncel tanımlara uyarlar; değiştiyse true. opts.goneItems / opts.goneRoles: silme izi dışında
   * silindiği bilinen kimlikler (ör. depo silme izi tutmuyorsa).
   */
  function model(m, opts) {
    opts = opts || {};
    const goneItems = new Set([].concat(Seq.repo.deleted('catalog'), opts.goneItems || []));
    const goneRoles = new Set([].concat(Seq.repo.deleted('role'), opts.goneRoles || []));
    let ch = false;
    m.participants.forEach((p) => {
      if (p.item) {
        const x = Seq.catalog.itemById(p.item);
        if (x) { ch = followItem(p, x, goneRoles) || ch; return; }
        if (goneItems.has(p.item)) { delete p.item; ch = true; }
      }
      if (p.role) {
        const r = R().roleById(p.role);
        if (r) ch = followRole(p, r) || ch;
        else if (goneRoles.has(p.role)) { delete p.role; ch = true; }
      }
    });
    M.walk(m.items, (it) => {
      if (it.kind !== 'note' || !it.ref) return;
      const d = S.docs.find((x) => x.id === it.ref);
      if (d && it.text !== d.name && (d.past || []).includes(it.text)) { it.text = d.name; ch = true; }
    });
    return ch;
  }

  /** Kodun uyarlanmış hâli (değişiklik yoksa aynı metin) */
  function code(src, opts) {
    src = src || '';
    if (!MARKER.test(src)) return src;
    try {
      const m = M.parse(src);
      return model(m, opts) ? M.serialize(m) : src;
    } catch (e) { return src; }
  }

  // Kayıtlı akışların uyarlanmış kodu önbellekte tutulur; tanımlar değişince önbellek geçersizleşir
  let gen = 0;
  const memo = new Map();
  /** Kayıtlı bir akışın güncel tanımlara uyarlanmış kodu */
  function docCode(d) {
    const src = d.code || '';
    if (!MARKER.test(src)) return src;
    const c = memo.get(d.id);
    if (c && c.src === src && c.gen === gen) return c.out;
    const out = code(src);
    memo.set(d.id, { src, gen, out });
    return out;
  }
  const invalidate = () => { gen++; };

  /** Açık akışı uyarlar (tanım değişince); değiştiyse işlenir ve true döner */
  function current(opts) {
    if (!S.doc || !model(S.model, opts)) return false;
    Seq.editor.commit();
    return true;
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    ['catalog:changed', 'roles:changed', 'doc:renamed', 'doc:deleted', 'app:ready'].forEach((e) => events.on(e, invalidate));
  }

  Seq.reconcile = { init, code, current, docCode, docRenamed, itemChanged, model, roleChanged };
})(window.Seq = window.Seq || {});
