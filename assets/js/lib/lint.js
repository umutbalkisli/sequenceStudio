/* Sequence Studio — diyagram denetimi
 *
 * Modeli kurallardan geçirip olası hataları ve gözden kaçanları bulur. DOM'a ve dile bağlı değildir:
 * her bulgu kural kimliği, düzeyi, ilgili öğenin uid'si ve parametreleriyle döner; metni arayüz üretir
 * (i18n anahtarı lint.<kural>). Tarayıcıda window.SeqLint, Node'da module.exports.
 *
 * Kural: { id, level: 'error' | 'warning' | 'info', check(model, ctx, report) }
 *   report(uid, params) bir bulgu ekler.
 *   ctx: { docExists(id) → bool, selfId, catalogMatch(p) → [öğe id] (kataloğa bağlanabilecek öğeler) }
 * Yeni kural eklemek için register yeterlidir.
 */
(function (root) {
  'use strict';

  const LEVELS = ['error', 'warning', 'info'];
  const rules = [];
  function register(rule) { rules.push(rule); }

  /** Öğeleri belge sırasıyla gezer; bloklarda kollara iner. fn(item, block, branch) */
  function walk(items, fn, block, branch) {
    for (const it of items) {
      fn(it, block, branch);
      if (it.kind === 'block') it.branches.forEach((br) => walk(br.items, fn, it, br));
    }
  }
  const messages = (model) => { const out = []; walk(model.items, (it) => { if (it.kind === 'message') out.push(it); }); return out; };
  const isCall = (a) => a === '->>' || a === '->';
  const isReply = (a) => a.startsWith('--');

  // --- Kurallar ---

  // Bağlantı silinmiş bir diyagrama gidiyor
  register({
    id: 'brokenRef', level: 'error',
    check(model, ctx, report) {
      if (!ctx.docExists) return;
      walk(model.items, (it) => { if (it.kind === 'note' && it.ref && !ctx.docExists(it.ref)) report(it.uid, { ref: it.ref }); });
    },
  });

  // Bağlantı diyagramın kendisine gidiyor
  register({
    id: 'selfRef', level: 'warning',
    check(model, ctx, report) {
      if (!ctx.selfId) return;
      walk(model.items, (it) => { if (it.kind === 'note' && it.ref === ctx.selfId) report(it.uid, {}); });
    },
  });

  // Mermaid'in doğrusal aktivasyon sayacını izler: aktif değilken kapatma (Mermaid hata verir) ve
  // hiç kapanmayan aktivasyon (Mermaid çizmez).
  function activationIssues(model) {
    const open = new Map(); // katılımcı → açan öğelerin uid'leri
    const inactive = [];
    const push = (p, uid) => { if (!open.has(p)) open.set(p, []); open.get(p).push(uid); };
    const pop = (p, uid) => { const s = open.get(p); if (s && s.length) s.pop(); else inactive.push({ uid, p }); };
    walk(model.items, (it) => {
      if (it.kind === 'message') {
        if (it.act === '+') push(it.to, it.uid);
        else if (it.act === '-') pop(it.from, it.uid);
      } else if (it.kind === 'activation') {
        if (it.action === 'activate') push(it.participant, it.uid);
        else pop(it.participant, it.uid);
      }
    });
    const unclosed = [];
    open.forEach((uids, p) => uids.forEach((uid) => unclosed.push({ uid, p })));
    return { inactive, unclosed };
  }
  register({
    id: 'inactiveDeactivate', level: 'error',
    check(model, ctx, report) { activationIssues(model).inactive.forEach(({ uid, p }) => report(uid, { p })); },
  });
  register({
    id: 'unclosedActivation', level: 'warning',
    check(model, ctx, report) { activationIssues(model).unclosed.forEach(({ uid, p }) => report(uid, { p })); },
  });

  // Yanıtı olmayan senkron çağrı. Yalnızca yanıt kullanan (istek/yanıt üslubundaki) diyagramlarda bakılır;
  // kuyruklara giden çağrılar yanıt beklemez. Kollara bölünmüş yanıtlarda yanlış alarm vermemek için
  // çağrıdan sonra herhangi bir yerde yanıt olması yeterli sayılır.
  register({
    id: 'unansweredCall', level: 'warning',
    check(model, ctx, report) {
      const msgs = messages(model);
      if (!msgs.some((m) => isReply(m.arrow) && m.from !== m.to)) return;
      const types = new Map(model.participants.map((p) => [p.id, p.type]));
      msgs.forEach((m, i) => {
        if (!isCall(m.arrow) || m.from === m.to || types.get(m.to) === 'queue') return;
        const answered = msgs.slice(i + 1).some((r) => isReply(r.arrow) && r.from === m.to && r.to === m.from);
        if (!answered) report(m.uid, { from: m.from, to: m.to, text: m.text || '' });
      });
    },
  });

  // Tanımlı ama hiçbir adımda geçmeyen katılımcı
  register({
    id: 'unusedParticipant', level: 'warning',
    check(model, ctx, report) {
      const used = new Set();
      walk(model.items, (it) => {
        if (it.kind === 'message') { used.add(it.from); used.add(it.to); }
        else if (it.kind === 'note') (it.targets || []).forEach((t) => used.add(t));
        else if (it.kind === 'activation') used.add(it.participant);
      });
      model.participants.forEach((p) => { if (!used.has(p.id)) report(p.uid, { p: p.id }); });
    },
  });

  // Aynı adı taşıyan katılımcılar (önizlemede ayırt edilemez)
  register({
    id: 'duplicateLabel', level: 'warning',
    check(model, ctx, report) {
      const seen = new Set();
      model.participants.forEach((p) => {
        const k = String(p.label || p.id).trim().toLocaleLowerCase();
        if (seen.has(k)) report(p.uid, { p: p.id });
        seen.add(k);
      });
    },
  });

  // Boş blok kolu (otomatik aktivasyon satırları sayılmaz)
  register({
    id: 'emptyBranch', level: 'warning',
    check(model, ctx, report) {
      walk(model.items, (it) => {
        if (it.kind !== 'block') return;
        it.branches.forEach((br, i) => {
          if (!br.items.some((x) => !x.auto)) report(br.uid, { type: it.type, index: i, label: it.type === 'rect' && i === 0 ? '' : br.label || '' });
        });
      });
    },
  });

  // Kataloğa bağlı olmayan ama adı bir katalog öğesiyle eşleşen katılımcı (mimari görünüme yansımaz)
  register({
    id: 'catalogMatch', level: 'info',
    check(model, ctx, report) {
      if (!ctx.catalogMatch) return;
      model.participants.forEach((p) => {
        if (p.item) return;
        const items = ctx.catalogMatch(p) || [];
        if (items.length) report(p.uid, { p: p.id, items });
      });
    },
  });

  // Metni olmayan mesaj
  register({
    id: 'emptyMessage', level: 'info',
    check(model, ctx, report) {
      messages(model).forEach((m) => { if (!String(m.text || '').trim()) report(m.uid, { from: m.from, to: m.to }); });
    },
  });

  /**
   * Tüm kuralları çalıştırır. Bulgular düzeye göre (hata → uyarı → bilgi), aynı düzeyde kural sırasıyla gelir.
   * Döner: [{ rule, level, uid, params }]
   */
  function run(model, ctx) {
    const out = [];
    for (const rule of rules) {
      try {
        rule.check(model, ctx || {}, (uid, params) => out.push({ rule: rule.id, level: rule.level, uid, params: params || {} }));
      } catch { /* hatalı kural diğerlerini durdurmaz */ }
    }
    return out.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  }

  const api = { LEVELS, register, rules, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SeqLint = api;
})(typeof window !== 'undefined' ? window : globalThis);
