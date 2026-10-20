/* Sequence Studio — diyagram denetimi (arayüz)
 *
 * Kurallar lib/lint.js'tedir (SeqLint). Bu modül diyagram her değiştiğinde denetimi çalıştırır; önizleme
 * başlığındaki rozeti, sorun listesini ve oluşturucudaki adım/katılımcı işaretlerini günceller.
 * Listeden bir soruna tıklayınca ilgili adım (kod görünümündeyse satır) gösterilir.
 *
 * Başka modüller bir kural için metin ve tek tıklık düzeltme ekleyebilir (addRuleUi): ör. katalog modülü
 * "katalog öğesiyle eşleşiyor" bulgusuna "Bağla" düğmesi koyar.
 */
(function (Seq) {
  'use strict';
  const { $, $$, M, S, T, debounce, dropdown, el, events, h, ico, oneLine, participantById } = Seq.core;

  let issues = [];
  let panel = null;
  const badge = () => $('#lintBadge');
  const LEVEL_ICON = { error: 'critical', warning: 'critical', info: 'help' };

  // Kurallara arayüz eklentileri: { describe(issue) → metin, fix(issue) → { label, run(anchor) } | null, ctx: { ad: fn } }
  const ruleUi = new Map();
  /** Bir kural için metin, düzeltme düğmesi ya da denetime verilecek bağlam işlevleri ekler */
  function addRuleUi(rule, ui) { ruleUi.set(rule, ui); }

  // --- Denetim ---
  function run() {
    if (!S.model) return;
    const ctx = { docExists: (id) => S.docs.some((d) => d.id === id), selfId: S.doc && S.doc.id };
    ruleUi.forEach((ui) => Object.assign(ctx, ui.ctx));
    issues = window.SeqLint.run(S.model, ctx);
    updateBadge();
    decorate();
    if (panel) panel.refresh();
  }
  const scheduleRun = debounce(run, 250);

  const pname = (id) => { const p = participantById(id); return oneLine(p ? p.label : id || ''); };
  /** Bulgunun okunur metni (i18n: lint.<kural>) */
  function describe(x) {
    const p = x.params;
    const ui = ruleUi.get(x.rule);
    if (ui && ui.describe) return ui.describe(x);
    if (x.rule === 'emptyBranch') {
      const block = T('step.' + (p.type === 'par_over' ? 'par' : p.type));
      return p.label ? T('lint.emptyBranch', { block, label: oneLine(p.label) }) : T('lint.emptyBranchNoLabel', { block });
    }
    const msg = T('lint.' + x.rule, { p: pname(p.p), from: pname(p.from), to: pname(p.to) });
    return p.text && String(p.text).trim() ? msg + ' — “' + oneLine(p.text).trim() + '”' : msg;
  }
  const topLevel = (list) => window.SeqLint.LEVELS.find((l) => list.some((x) => x.level === l));

  // --- Rozet ---
  function updateBadge() {
    const b = badge();
    if (!b) return;
    b.hidden = !issues.length;
    if (!issues.length) return;
    b.className = 'pill-btn lv-' + topLevel(issues);
    b.lastChild.textContent = issues.length;
    b.title = T('lint.badgeTitle', { n: issues.length });
  }

  // --- Oluşturucudaki işaretler (bilgi düzeyi yalnızca listede görünür) ---
  function decorate() {
    $$('.lint-flag').forEach((e) => e.classList.remove('lint-flag', 'lint-error', 'lint-warning'));
    $$('.lint-dot').forEach((e) => e.remove());
    const byUid = new Map();
    issues.filter((x) => x.level !== 'info').forEach((x) => { if (!byUid.has(x.uid)) byUid.set(x.uid, []); byUid.get(x.uid).push(x); });
    byUid.forEach((list, uid) => {
      const target = el.flow.querySelector(`[data-uid="${uid}"], [data-branch="${uid}"]`) || el.participants.querySelector(`.pcard[data-uid="${uid}"]`);
      if (!target || target.hidden) return;
      const lv = topLevel(list);
      target.classList.add('lint-flag', 'lint-' + lv);
      target.append(h('span', { class: 'lint-dot', title: list.map(describe).join('\n') }, ico(LEVEL_ICON[lv])));
    });
  }

  // --- Sorun listesi ---
  function togglePanel() {
    if (panel) return panel.close();
    panel = dropdown(badge(), renderPanel, { class: 'lint-panel', label: T('lint.title'), onClose: () => { panel = null; } });
  }
  function renderPanel(box) {
    const counts = window.SeqLint.LEVELS.map((l) => [l, issues.filter((x) => x.level === l).length]).filter(([, n]) => n);
    box.append(h('div', { class: 'dd-head' },
      h('b', null, T('lint.title')),
      h('span', { class: 'dd-sum' }, counts.map(([l, n]) => T('lint.count.' + l, { n })).join(' · ')),
      h('button', { class: 'icon-btn sm', title: T('common.close'), onclick: () => panel.close() }, ico('x'))));
    if (!issues.length) { box.append(h('p', { class: 'dd-empty ok' }, ico('check'), T('lint.none'))); return; }
    box.append(h('ul', null, issues.map((x) => {
      const ui = ruleUi.get(x.rule);
      const fix = ui && ui.fix ? ui.fix(x) : null;
      const fixBtn = fix ? h('button', { class: 'btn sm dd-fix' }, fix.label) : null;
      if (fixBtn) fixBtn.addEventListener('click', (e) => { e.stopPropagation(); fix.run(fixBtn); });
      return h('li', { class: 'dd-row' },
        h('button', { class: 'dd-item lv-' + x.level, onclick: () => goTo(x) }, ico(LEVEL_ICON[x.level]), h('span', null, describe(x))),
        fixBtn);
    })));
  }

  /** Bulgunun kaynağını gösterir: kod görünümünde satırı seçer, oluşturucuda adımı/katılımcıyı */
  function goTo(x) {
    if (S.settings.editorCollapsed) Seq.layout.setEditorCollapsed(false);
    if (Seq.layout.currentView() === 'code') {
      const line = codeLineOf(x.uid);
      if (line != null) Seq.code.selectCodeLine(line);
      return;
    }
    if (!Seq.participants.revealCard(x.uid)) Seq.flow.reveal(x.uid);
  }
  /** Modeldeki öğenin koddaki satırı: aynı kod yeniden ayrıştırılıp öğe sırasıyla eşlenir */
  function codeLineOf(uid) {
    const order = (model) => {
      const out = [...model.participants];
      M.walk(model.items, (it) => { out.push(it); if (it.kind === 'block') out.push(...it.branches); });
      return out;
    };
    const i = order(S.model).findIndex((n) => n.uid === uid);
    const n = i >= 0 ? order(M.parse(S.code))[i] : null;
    return n ? n.line : null;
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    badge().addEventListener('click', togglePanel);
    events.on('code:changed', scheduleRun);
    events.on('builder:rendered', run);
    events.on('doc:deleted', run);
  }

  Seq.lint = { init, addRuleUi, issues: () => issues.slice(), run };
})(window.Seq = window.Seq || {});
