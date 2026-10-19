/* Sequence Studio — diyagram menüsü
 *
 * "Diyagramlarım" çekmecesi: iç içe klasörler, sürükle-bırak, taşıma menüsü ve uzun adlar için ipucu.
 */
(function (Seq) {
  'use strict';
  const { $, $$, I18N, S, T, clamp, el, h, ico, timeAgo, tplL, events } = Seq.core;

  // Klasörler (iç içe). Belge d.folder ile, klasör f.parent ile üst klasörüne bağlanır; yoksa kökte durur.
  const folderById = (id) => id && S.folders.find((f) => f.id === id);
  const childFolders = (parentId) => S.folders.filter((f) => (f.parent || null) === (parentId || null))
    .sort((a, b) => a.name.localeCompare(b.name, I18N.getLang()));
  /** a, b'nin kendisi ya da alt klasörü mü? */
  const isWithin = (a, b) => { for (let f = folderById(a); f; f = folderById(f.parent)) if (f.id === b) return true; return false; };
  /** Klasörü ve tüm üst klasörlerini aç */
  const expandTo = (id) => { for (let f = folderById(id); f; f = folderById(f.parent)) f.collapsed = false; };
  /** Klasör ve alt klasörlerindeki toplam diyagram */
  const folderDocCount = (id) => S.docs.filter((d) => d.folder && isWithin(d.folder, id)).length;
  /** Ağaç sırasında klasörler (taşıma menüsü için) */
  const folderTree = (parentId, depth = 0) => childFolders(parentId).flatMap((f) => [{ f, depth }, ...folderTree(f.id, depth + 1)]);

  function createFolder(parentId) {
    const base = T('folder.new');
    const siblings = childFolders(parentId);
    let n = base, k = 2;
    while (siblings.some((f) => f.name === n)) n = base + ' (' + k++ + ')';
    const f = { id: 'f' + Seq.docs.newDocId().slice(1), name: n, collapsed: false };
    if (parentId) { f.parent = parentId; expandTo(parentId); }
    S.folders.push(f);
    Seq.docs.persistDocs();
    renderDocList(f.id);
    return f;
  }
  function deleteFolder(id) {
    const f = folderById(id);
    if (!f) return;
    const nDocs = S.docs.filter((d) => d.folder === id).length;
    const nSub = S.folders.filter((x) => x.parent === id).length;
    if ((nDocs || nSub) && !confirm(T('folder.confirmDelete', { name: f.name, n: nDocs, m: nSub }))) return;
    // İçerik bir üst seviyeye çıkar
    S.docs.forEach((d) => { if (d.folder === id) { if (f.parent) d.folder = f.parent; else delete d.folder; } });
    S.folders.forEach((x) => { if (x.parent === id) { if (f.parent) x.parent = f.parent; else delete x.parent; } });
    S.folders = S.folders.filter((x) => x.id !== id);
    Seq.docs.persistDocs();
    renderDocList();
  }
  function moveDoc(docId, folderId) {
    const d = S.docs.find((x) => x.id === docId);
    if (!d || (d.folder || null) === (folderId || null)) return;
    if (folderId) d.folder = folderId; else delete d.folder;
    expandTo(folderId);
    Seq.docs.persistDocs();
    renderDocList();
  }
  function moveFolder(id, parentId) {
    const f = folderById(id);
    if (!f || (f.parent || null) === (parentId || null) || (parentId && isWithin(parentId, id))) return;
    if (parentId) f.parent = parentId; else delete f.parent;
    expandTo(parentId);
    Seq.docs.persistDocs();
    renderDocList();
  }

  /** Sürükle-bırak: diyagram ya da klasör, bir klasöre veya kök alanına bırakılır. */
  let draggingFolder = null;
  function docDropZone(node, folderId) {
    const accepts = (e) => {
      const t = e.dataTransfer.types;
      if (t.includes('text/x-seq-doc')) return true;
      return t.includes('text/x-seq-folder') && draggingFolder && !(folderId && isWithin(folderId, draggingFolder));
    };
    node.addEventListener('dragover', (e) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      $$('.drop-over', el.drawer).forEach((x) => { if (x !== node) x.classList.remove('drop-over'); });
      node.classList.add('drop-over');
    });
    node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove('drop-over'); });
    node.addEventListener('drop', (e) => {
      const docId = e.dataTransfer.getData('text/x-seq-doc');
      const fId = e.dataTransfer.getData('text/x-seq-folder');
      if (!docId && !fId) return;
      e.preventDefault();
      e.stopPropagation();
      node.classList.remove('drop-over');
      if (docId) moveDoc(docId, folderId);
      else moveFolder(fId, folderId);
    });
  }

  function closeMoveMenu() { $$('.move-menu', el.drawer).forEach((m) => m.remove()); }
  function openMoveMenu(btn, d) {
    const row = btn.closest('.doc-item');
    const had = row.querySelector('.move-menu');
    closeMoveMenu();
    if (had) return;
    const opt = (label, icn, folderId) => h('button', {
      class: 'mm-opt' + ((d.folder || null) === (folderId || null) ? ' current' : ''),
      onclick: (e) => { e.stopPropagation(); closeMoveMenu(); moveDoc(d.id, folderId); },
    }, ico(icn), h('span', null, label));
    const menu = h('div', { class: 'move-menu', onclick: (e) => e.stopPropagation() },
      h('div', { class: 'mm-title' }, T('folder.moveTo')),
      opt(T('folder.root'), 'menu', null),
      folderTree(null).map(({ f, depth }) => {
        const o = opt(f.name, 'folder', f.id);
        o.style.paddingLeft = 8 + depth * 16 + 'px';
        return o;
      }),
      h('button', { class: 'mm-opt', onclick: (e) => {
        e.stopPropagation();
        closeMoveMenu();
        moveDoc(d.id, createFolder().id);
      } }, ico('folderPlus'), h('span', null, T('folder.newEllipsis'))));
    row.append(menu);
  }

  function renderDocItem(d) {
    const item = h('div', { class: 'doc-item' + (S.doc && d.id === S.doc.id ? ' active' : ''), draggable: 'true', onclick: () => { Seq.docs.openDoc(d.id); closeDrawer(); } },
      h('span', { class: 'di-icon' }, ico('logo')),
      h('div', { class: 'di-text' }, h('div', { class: 'di-name' }, d.name), h('div', { class: 'di-meta' }, timeAgo(d.updated))),
      h('div', { class: 'di-actions' },
        h('button', { class: 'icon-btn sm', title: T('folder.moveTo'), onclick: (e) => { e.stopPropagation(); openMoveMenu(e.currentTarget, d); } }, ico('folderMove')),
        h('button', { class: 'icon-btn sm', title: T('duplicate'), onclick: (e) => { e.stopPropagation(); Seq.docs.createDoc(d.name + T('doc.copySuffix'), d.id === S.doc.id ? S.code : d.code, false, d.folder); renderDocList(); } }, ico('copy')),
        h('button', { class: 'icon-btn sm', title: T('delete'), onclick: (e) => { e.stopPropagation(); Seq.docs.deleteDoc(d.id); } }, ico('trash'))));
    item.addEventListener('dragstart', (e) => {
      closeMoveMenu();
      e.dataTransfer.setData('text/x-seq-doc', d.id);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => item.classList.add('dragging'));
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      $$('.drop-over', el.drawer).forEach((x) => x.classList.remove('drop-over'));
    });
    return item;
  }

  function startFolderRename(f, nameEl) {
    const input = h('input', { class: 'fh-input', value: f.name, spellcheck: 'false' });
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (save && v && v !== f.name) { f.name = v; Seq.docs.persistDocs(); }
      renderDocList();
    };
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    const head = nameEl.closest('.folder-head');
    if (head) head.draggable = false; // giriş alanında metin seçimi sürüklemeye dönüşmesin
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  function renderFolder(f, docs, renameId) {
    const name = h('span', { class: 'fh-name' }, f.name);
    const subs = childFolders(f.id);
    const own = docs.filter((d) => d.folder === f.id);
    const head = h('div', { class: 'folder-head', role: 'button', draggable: 'true', 'aria-expanded': String(!f.collapsed),
      onclick: () => { f.collapsed = !f.collapsed; Seq.docs.persistDocs(); renderDocList(); } },
      h('span', { class: 'fh-chev' }, ico('chevron')),
      h('span', { class: 'fh-icon' }, ico('folder')),
      name,
      h('span', { class: 'fh-count', title: T('folder.countTitle') }, folderDocCount(f.id)),
      h('div', { class: 'di-actions' },
        h('button', { class: 'icon-btn sm', title: T('folder.newDoc'), onclick: (e) => {
          e.stopPropagation();
          Seq.docs.createDoc(T('doc.untitled'), tplL(window.SeqTemplates[0]).code, true, f.id);
          closeDrawer();
        } }, ico('plus')),
        h('button', { class: 'icon-btn sm', title: T('folder.newSub'), onclick: (e) => { e.stopPropagation(); createFolder(f.id); } }, ico('folderPlus')),
        h('button', { class: 'icon-btn sm', title: T('fx.title'), onclick: (e) => { e.stopPropagation(); closeDrawer(); Seq.folderExport.openFolderExport(f.id); } }, ico('download')),
        h('button', { class: 'icon-btn sm', title: T('folder.rename'), onclick: (e) => { e.stopPropagation(); startFolderRename(f, name); } }, ico('edit')),
        h('button', { class: 'icon-btn sm', title: T('folder.delete'), onclick: (e) => { e.stopPropagation(); deleteFolder(f.id); } }, ico('trash'))));
    name.addEventListener('dblclick', (e) => { e.stopPropagation(); startFolderRename(f, name); });
    head.addEventListener('dragstart', (e) => {
      e.stopPropagation();
      closeMoveMenu();
      draggingFolder = f.id;
      e.dataTransfer.setData('text/x-seq-folder', f.id);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => box.classList.add('dragging'));
    });
    head.addEventListener('dragend', () => {
      draggingFolder = null;
      box.classList.remove('dragging');
      $$('.drop-over', el.drawer).forEach((x) => x.classList.remove('drop-over'));
    });
    const box = h('div', { class: 'folder' + (f.collapsed ? ' collapsed' : '') }, head);
    if (!f.collapsed) {
      box.append(subs.length || own.length
        ? h('div', { class: 'folder-body' }, subs.map((sf) => renderFolder(sf, docs, renameId)), own.map(renderDocItem))
        : h('div', { class: 'folder-empty' }, T('folder.empty')));
    }
    docDropZone(box, f.id);
    if (renameId === f.id) requestAnimationFrame(() => startFolderRename(f, name));
    return box;
  }

  function renderDocList(renameId) {
    hideNameTip();
    el.docList.innerHTML = '';
    // Silinmiş klasörlere işaret eden belge/klasörleri köke al; döngüleri kır
    S.docs.forEach((d) => { if (d.folder && !folderById(d.folder)) delete d.folder; });
    S.folders.forEach((f) => {
      if (f.parent && (!folderById(f.parent) || isWithin(f.parent, f.id))) delete f.parent;
    });
    const docs = [...S.docs].sort((a, b) => b.updated - a.updated);
    childFolders(null).forEach((f) => el.docList.append(renderFolder(f, docs, renameId)));
    const root = docs.filter((d) => !d.folder);
    if (S.folders.length) el.docList.append(h('div', { class: 'root-label' }, T('folder.root')));
    const rootBox = h('div', { class: 'root-docs' }, root.map(renderDocItem));
    if (S.folders.length && !root.length) rootBox.append(h('div', { class: 'folder-empty' }, T('folder.rootEmpty')));
    el.docList.append(rootBox);
  }
  // Kesilmiş (2 satıra sığmayan) diyagram/klasör adlarının tamamını hover'da gösterir
  const nameTip = h('div', { class: 'name-tip', role: 'tooltip', hidden: true });

  let nameTipTimer = null;
  function hideNameTip() { clearTimeout(nameTipTimer); nameTip.hidden = true; }

  function openDrawer() {
    // Açık belgenin klasörünü göster
    if (S.doc && S.doc.folder) { expandTo(S.doc.folder); Seq.docs.persistDocs(); }
    renderDocList();
    Seq.backup.refreshBackupUi();
    el.drawer.classList.add('open');
    el.scrim.classList.add('show');
  }
  function closeDrawer() { hideNameTip(); closeMoveMenu(); el.drawer.classList.remove('open'); el.scrim.classList.remove('show'); }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    events.on('doc:opened', () => renderDocList());
    events.on('doc:deleted', () => renderDocList());
    document.body.append(nameTip);
    el.docList.addEventListener('mouseover', (e) => {
      const n = e.target.closest('.di-name, .fh-name');
      if (!n || n.contains(e.relatedTarget)) return;
      hideNameTip();
      if (n.scrollHeight <= n.clientHeight + 1) return; // kesilmemiş
      nameTipTimer = setTimeout(() => {
        if (!n.isConnected || !n.matches(':hover')) return;
        nameTip.textContent = n.textContent;
        nameTip.hidden = false;
        const r = n.getBoundingClientRect();
        const w = Math.min(Math.max(r.width, 260), window.innerWidth - 16);
        nameTip.style.width = w + 'px';
        const left = clamp(r.left - 10, 8, window.innerWidth - w - 8);
        const below = r.bottom + 6;
        const top = below + nameTip.offsetHeight > window.innerHeight - 8 ? r.top - nameTip.offsetHeight - 6 : below;
        nameTip.style.left = left + 'px';
        nameTip.style.top = Math.max(8, top) + 'px';
      }, 300);
    });
    el.docList.addEventListener('mouseout', (e) => {
      const n = e.target.closest('.di-name, .fh-name');
      if (n && !n.contains(e.relatedTarget)) hideNameTip();
    });
    el.docList.addEventListener('scroll', hideNameTip, { passive: true });
    el.docList.addEventListener('dragstart', hideNameTip);
    $('#btnDocs').addEventListener('click', openDrawer);
    $('#btnNewDoc').addEventListener('click', () => { Seq.docs.createDoc(T('doc.untitled'), tplL(window.SeqTemplates[0]).code); closeDrawer(); });
    $('#btnNewFolder').addEventListener('click', createFolder);
    // Boş alana bırakılan belge köke taşınır; dışarı tıklama taşıma menüsünü kapatır
    docDropZone(el.docList, null);
    el.drawer.addEventListener('click', (e) => { if (!e.target.closest('.move-menu')) closeMoveMenu(); });
    $('[data-close]', el.drawer).addEventListener('click', closeDrawer);
    el.scrim.addEventListener('click', closeDrawer);
  }

  Seq.drawer = { init, childFolders, closeDrawer, folderById, renderDocList };
})(window.Seq = window.Seq || {});
