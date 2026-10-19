/* Sequence Studio — adım türleri
 *
 * Paletteki akış adımlarının kaydı: her tür simgesini, rengini ve yeni düğümü nasıl oluşturacağını tanımlar.
 * Palet listeyi buradan çizer, akış düzenleyici yeni düğümü buradan ister; yeni bir adım türü eklemek
 * için register yeterlidir (etiket i18n'de step.<id>).
 *
 *   id, icon, color   — kimlik, palet simgesi ve rengi
 *   create(ctx)       — yeni düğüm; katılımcı gerekiyorsa ve yoksa null, kendi uyarısını gösterdiyse false.
 *                       ctx: { P (katılımcılar), sel (seçili mesaj), a, b (ilk iki katılımcı), nextAfter(id) }
 */
(function (Seq) {
  'use strict';
  const { M, S, T, toast } = Seq.core;

  /** Yeni yanıt mesajlarının varsayılan metni (alan odaklanınca seçili gelir, yazınca değişir) */
  const REPLY_TEXT = '✓';

  const steps = [];
  function register(step) { steps.push(step); }
  const get = (id) => steps.find((s) => s.id === id);

  /** Seçili adım bir mesajsa onu döndürür (yeni adımlar ona göre konumlanır) */
  function selectedMessage() {
    const f = S.selected && M.findNode(S.model, S.selected);
    return f && f.node && f.node.kind === 'message' ? f.node : null;
  }

  /** Yeni düğüm oluşturur (bkz. create) */
  function create(id) {
    const step = get(id);
    if (!step) return null;
    const P = S.model.participants;
    const a = P[0] && P[0].id, b = (P[1] || P[0]) && (P[1] || P[0]).id;
    const nextAfter = (pid) => { const i = P.findIndex((p) => p.id === pid); return (P[i + 1] || P[i - 1] || P[i]).id; };
    return step.create({ P, sel: selectedMessage(), a, b, nextAfter });
  }

  const message = (from, to, arrow, text) => ({ uid: M.uid(), kind: 'message', from, to, arrow, act: '', text });
  const block = (type, labels) => ({ uid: M.uid(), kind: 'block', type, branches: labels.map((label) => ({ uid: M.uid(), label, items: [] })) });

  register({
    id: 'message', icon: 'message', color: 'var(--accent)',
    create: ({ P, sel, a, b, nextAfter }) => (!P.length ? null : sel ? message(sel.to, nextAfter(sel.to), '->>', '') : message(a, b, '->>', '')),
  });
  register({
    id: 'reply', icon: 'reply', color: 'var(--muted)',
    create: ({ P, sel, a, b }) => (!P.length ? null : sel ? message(sel.to, sel.from, '-->>', REPLY_TEXT) : message(b, a, '-->>', REPLY_TEXT)),
  });
  register({
    id: 'note', icon: 'note', color: 'var(--c-note)',
    create: ({ P, sel, a }) => (!P.length ? null : { uid: M.uid(), kind: 'note', position: 'right of', targets: [sel ? sel.to : a], text: '' }),
  });
  register({
    id: 'ref', icon: 'link', color: 'var(--c-ref)',
    create: ({ P, sel }) => {
      if (!P.length) return null;
      // Varsayılan hedef: en son düzenlenen diğer diyagram
      const target = S.docs.filter((d) => d !== S.doc).sort((x, y) => (y.updated || 0) - (x.updated || 0))[0];
      if (!target) { toast(T('ref.noTarget'), 'err'); return false; }
      // Tek katılımcıya bağlanır: seçili mesaj varsa mesajın gittiği katılımcı (ayrıntı orada gerçekleşir)
      return { uid: M.uid(), kind: 'note', position: 'over', targets: [sel ? sel.to : P[0].id], text: target.name, ref: target.id };
    },
  });
  // Bloklar: varsayılan dal etiketleriyle
  [
    ['loop', () => [T('bd.loop')]],
    ['alt', () => [T('bd.alt1'), T('bd.alt2')]],
    ['opt', () => [T('bd.opt')]],
    ['par', () => [T('bd.par1'), T('bd.par2')]],
    ['critical', () => [T('bd.crit1'), T('bd.crit2')]],
    ['break', () => [T('bd.break')]],
    ['rect', () => ['rgba(108, 124, 255, 0.12)']],
  ].forEach(([id, labels]) => register({ id, icon: id, color: `var(--c-${id})`, create: () => block(id, labels()) }));
  register({
    id: 'activation', icon: 'activate', color: 'var(--c-activation)',
    create: ({ P, sel, a }) => (!P.length ? null : { uid: M.uid(), kind: 'activation', action: 'activate', participant: sel ? sel.to : a }),
  });
  register({
    id: 'raw', icon: 'raw', color: 'var(--c-raw)',
    create: () => ({ uid: M.uid(), kind: 'raw', text: T('raw.default') }),
  });

  Seq.steps = { REPLY_TEXT, create, get, list: () => steps.slice(), register, selectedMessage };
})(window.Seq = window.Seq || {});
