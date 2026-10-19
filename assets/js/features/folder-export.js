/* Sequence Studio — klasör dışa aktarma
 *
 * Bir klasörü (alt klasörleriyle) seçilen formatta tek bir .zip olarak dışa aktarır.
 */
(function (Seq) {
  'use strict';
  const { I18N, S, T, closeModal, docCode, downloadBlob, el, fileSafe, h, ico, openModal, saveSettings, toast } = Seq.core;

  /** Klasör ağacındaki diyagramları (isteğe bağlı alt klasörlerle) yol bilgisiyle toplar. */
  function collectFolder(folderId, withSubs, base) {
    const f = Seq.drawer.folderById(folderId);
    const dir = (base ? base + '/' : '') + fileSafe(f.name);
    const out = { dirs: [dir], docs: [] };
    S.docs.filter((d) => d.folder === folderId).sort((a, b) => a.name.localeCompare(b.name, I18N.getLang()))
      .forEach((d) => out.docs.push({ d, dir }));
    if (withSubs) Seq.drawer.childFolders(folderId).forEach((sf) => {
      const sub = collectFolder(sf.id, true, dir);
      out.dirs.push(...sub.dirs);
      out.docs.push(...sub.docs);
    });
    return out;
  }

  function openFolderExport(folderId) {
    const f = Seq.drawer.folderById(folderId);
    if (!f) return;
    if (el.code.value !== S.code) Seq.editor.applyCode(el.code.value, 'code');
    const ex = S.settings.exp;
    const hasSubs = Seq.drawer.childFolders(folderId).length > 0;
    let withSubs = true;
    let busy = false;
    const body = h('div');
    const draw = () => {
      body.innerHTML = '';
      const { docs, dirs } = collectFolder(folderId, withSubs);
      body.append(h('p', { class: 'fx-info' }, ico('folder'), h('b', null, f.name),
        h('span', null, T('fx.count', { n: docs.length, m: dirs.length - 1 }))));
      const fmt = Seq.export.formatById(ex.format);
      body.append(Seq.export.formatGrid(ex, draw));
      const seg = (opts, val, on) => h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: v === val ? 'active' : '', onclick: () => { on(v); saveSettings(); draw(); } }, l)));
      if (fmt.options) body.append(...fmt.options(ex, seg));
      // Klasörde referans içeren diyagram varsa: bağlı diyagramları içine çizme seçeneği
      if (docs.some(({ d }) => /@ref\b/.test(docCode(d)))) {
        if (!ex.refs) ex.refs = 'link';
        body.append(h('div', { class: 'opt-row' }, h('label', null, T('exp.refs')),
          seg([['link', T('exp.refsLink')], ['inline', T('exp.refsInline')]], ex.refs, (v) => { ex.refs = v; })));
      }
      if (hasSubs) {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = withSubs;
        cb.addEventListener('change', () => { withSubs = cb.checked; draw(); });
        body.append(h('div', { class: 'opt-row' }, h('label', null, T('fx.subfolders')), h('label', { class: 'fx-check' }, cb, h('span', null, T('fx.subfoldersHint')))));
      }
      body.append(h('p', { class: 'note-line' }, ico('help'), T('fx.note')));
      const status = h('span', { class: 'dim-info' });
      const btn = h('button', { class: 'btn primary', disabled: !docs.length || null }, ico('download'), T('fx.download'));
      btn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        btn.disabled = true;
        const enc = new TextEncoder();
        const entries = dirs.map((d) => ({ path: d + '/', dir: true }));
        const used = new Set();
        const failed = [];
        const ext = fmt.ext;
        try {
          for (let i = 0; i < docs.length; i++) {
            const { d, dir } = docs[i];
            status.textContent = T('fx.progress', { i: i + 1, n: docs.length });
            let name = fileSafe(d.name), k = 2;
            while (used.has(dir + '/' + name + ext)) name = fileSafe(d.name) + ' (' + k++ + ')';
            const path = dir + '/' + name + ext;
            used.add(path);
            let code = docCode(d);
            try {
              if (ex.refs === 'inline' && /@ref\b/.test(code)) code = Seq.refs.expandedDoc(d, code, fmt.kind === 'text').code;
              const blob = await Seq.export.renderFile(fmt, code, d.name);
              entries.push({ path, data: new Uint8Array(await blob.arrayBuffer()) });
            } catch (err) {
              const msg = String((err && (err.message || err.str)) || err).trim().slice(0, 600);
              failed.push('# ' + dir + '/' + d.name + '\n' + msg.split('\n').map((l) => '  ' + l).join('\n'));
            }
          }
          if (failed.length) entries.push({ path: dirs[0] + '/' + T('fx.errorsFile'), data: enc.encode(failed.join('\n\n') + '\n') });
          const zipName = fileSafe(f.name) + '.zip';
          downloadBlob(Seq.zip.makeZip(entries), zipName);
          toast(failed.length ? T('fx.doneWithErrors', { n: docs.length - failed.length, m: failed.length }) : T('fx.done', { n: docs.length, name: zipName }), failed.length ? 'err' : undefined);
          closeModal();
        } catch (err) {
          toast(T('exp.failed', { msg: err.message }), 'err');
        } finally {
          busy = false;
          btn.disabled = false;
          status.textContent = '';
        }
      });
      body.append(h('div', { class: 'export-actions' }, h('div', { class: 'left' }, status), h('div', { class: 'right' }, btn)));
    };
    draw();
    openModal(T('fx.title'), body);
  }

  Seq.folderExport = { openFolderExport };
})(window.Seq = window.Seq || {});
