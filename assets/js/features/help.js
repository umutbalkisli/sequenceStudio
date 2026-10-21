/* Sequence Studio — şablonlar ve yardım
 *
 * Şablon galerisi ve yardım/kısayollar penceresi.
 */
(function (Seq) {
  'use strict';
  const { $, T, closeModal, esc, h, isMac, openModal, toast, tplL } = Seq.core;

  function openTemplates() {
    const grid = h('div', { class: 'tpl-grid' });
    window.SeqTemplates.forEach((tpl) => {
      const t = tplL(tpl);
      grid.append(h('button', { class: 'tpl', onclick: () => { Seq.docs.createDoc(tpl.id === 'blank' ? T('doc.untitled') : t.name, t.code); closeModal(); toast(T('tpl.opened', { name: t.name })); } },
        h('b', null, t.name), h('span', null, t.desc), h('pre', null, t.code.split('\n').slice(0, 9).join('\n'))));
    });
    openModal(T('tpl.title'), grid, true);
  }

  // --- Yardım ---
  function openHelp() {
    const mod = isMac ? '⌘' : 'Ctrl';
    const kb = (k) => k.split('+').map((x) => `<kbd>${x}</kbd>`).join(' ');
    const rows = (arr) => '<table>' + arr.map(([a, b]) => `<tr><td>${a}</td><td>${esc(b)}</td></tr>`).join('') + '</table>';
    const c = (code) => `<code>${esc(code)}</code>`;
    const body = h('div', { html: `
      <div class="help-grid">
        <div>
          <h4>${T('help.builder')}</h4>
          ${rows([
            [T('help.addP'), T('help.addPd')],
            [T('help.nav'), T('help.navd')],
            [T('help.cat'), T('help.catd')],
            [T('help.arch'), T('help.archd')],
            [T('help.pres'), T('help.presd')],
            [T('help.drawM'), T('help.drawMd')],
            [T('help.addS'), T('help.addSd')],
            [T('help.addB'), T('help.addBd')],
            [T('help.move'), T('help.moved')],
            [T('help.act'), T('help.actd')],
            [T('help.tone'), T('help.toned')],
            [T('help.goto'), T('help.gotod')],
            [T('help.ref'), T('help.refd')],
            [T('help.lint'), T('help.lintd')],
          ])}
          <h4 style="margin-top:18px">${T('help.shortcuts')}</h4>
          ${rows([
            [kb(mod + '+Z') + ' / ' + kb(mod + '+Shift+Z'), T('help.k.undo')],
            [kb('Enter'), T('help.k.enter')],
            [kb('Shift+Enter'), T('help.k.shiftEnter')],
            [kb((isMac ? '⌥' : 'Alt') + '+Enter'), T('help.k.newline')],
            [kb(mod + '+D'), T('help.k.dup')],
            [kb('Alt+↑') + ' ' + kb('Alt+↓'), T('help.k.move')],
            [kb('Del'), T('help.k.del')],
            [kb(mod + '+E'), T('help.k.export')],
            [kb(mod + '+K'), T('help.k.search')],
            [kb(mod + '+1') + ' / ' + kb(mod + '+2'), T('help.k.views')],
            [kb(mod + '+B'), T('help.k.collapse')],
            [kb('F'), T('help.k.fullscreen')],
            [kb(mod + '+' + T('help.scroll')), T('help.k.zoom')],
          ])}
        </div>
        <div>
          <h4>${T('help.syntax')}</h4>
          ${rows([
            [c('participant A as Name'), T('help.s.participant')],
            [c('actor U'), T('help.s.actor')],
            [c('participant D@{ "type": "database" }'), T('help.s.typed')],
            [c('A->>B: text'), T('help.s.sync')],
            [c('B-->>A: text'), T('help.s.reply')],
            [c('A-)B: event'), T('help.s.async')],
            [c('A-xB: error'), T('help.s.cross')],
            [c('A->>+B') + ' · ' + c('B-->>-A'), T('help.s.act')],
            [c('loop') + ' … ' + c('end'), T('help.s.loop')],
            [c('alt') + ' … ' + c('else') + ' … ' + c('end'), T('help.s.alt')],
            [c('opt') + ' · ' + c('break'), T('help.s.opt')],
            [c('par') + ' … ' + c('and') + ' … ' + c('end'), T('help.s.par')],
            [c('critical') + ' … ' + c('option') + ' … ' + c('end'), T('help.s.critical')],
            [c('rect rgba(…)') + ' … ' + c('end'), T('help.s.rect')],
            [c('Note over A,B: text'), T('help.s.note')],
            [c('box Aqua Group') + ' … ' + c('end'), T('help.s.box')],
            [c('autonumber'), T('help.s.autonumber')],
          ])}
        </div>
      </div>
      <ul class="help-tips">
        <li>${esc(T('help.tip1'))}</li>
        <li>${esc(T('help.tip2'))}</li>
        <li>${esc(T('help.tip3'))}</li>
      </ul>` });
    openModal(T('help.title'), body, true);
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    $('#btnTemplates').addEventListener('click', openTemplates);
    $('#btnHelp').addEventListener('click', openHelp);
  }

  Seq.help = { init, openTemplates };
})(window.Seq = window.Seq || {});
