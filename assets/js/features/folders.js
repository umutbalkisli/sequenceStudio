/* Sequence Studio — klasörler
 *
 * İç içe klasörler (arayüzden bağımsız işlemler). Akış d.folder ile, klasör f.parent ile üst klasörüne bağlanır;
 * yoksa kökte durur. Akışlar sayfası, yol göstergesi, arama ve klasör dışa aktarma bunları kullanır.
 * Değişiklikler kaydedilir (Seq.docs.persistDocs → "docs:persisted"); ekranlar o olayla yeniden çizilir.
 * Bir klasörün ağaçta açık/kapalı olması kişisel görünüm durumudur: paylaşılan klasör kaydında değil, kişisel
 * ayarlarda (S.settings.foldersCollapsed) tutulur.
 */
(function (Seq) {
  'use strict';
  const { I18N, S, T, saveSettings } = Seq.core;

  const folderById = (id) => id && S.folders.find((f) => f.id === id);
  const childFolders = (parentId) => S.folders.filter((f) => (f.parent || null) === (parentId || null))
    .sort((a, b) => a.name.localeCompare(b.name, I18N.getLang()));
  /** a, b'nin kendisi ya da alt klasörü mü? */
  const isWithin = (a, b) => { for (let f = folderById(a); f; f = folderById(f.parent)) if (f.id === b) return true; return false; };
  // --- Açık/kapalı (kişisel) ---
  const collapsedSet = () => new Set(S.settings.foldersCollapsed || []);
  const isCollapsed = (id) => collapsedSet().has(id);
  function setCollapsed(id, on) {
    const set = collapsedSet();
    if (on === set.has(id)) return;
    if (on) set.add(id); else set.delete(id);
    S.settings.foldersCollapsed = [...set];
    saveSettings();
  }
  /** Klasörü ve tüm üst klasörlerini aç */
  const expandTo = (id) => { for (let f = folderById(id); f; f = folderById(f.parent)) setCollapsed(f.id, false); };
  /** Klasör ve alt klasörlerindeki toplam akış */
  const folderDocCount = (id) => S.docs.filter((d) => d.folder && isWithin(d.folder, id)).length;
  /** Ağaç sırasında klasörler ve derinlikleri */
  const folderTree = (parentId, depth = 0) => childFolders(parentId).flatMap((f) => [{ f, depth }, ...folderTree(f.id, depth + 1)]);
  /** Kökten klasöre giden yol (klasör nesneleri) */
  const pathOf = (id) => { const out = []; for (let f = folderById(id); f; f = folderById(f.parent)) out.unshift(f); return out; };

  /**
   * Silinmiş klasöre işaret eden akış/klasörleri köke alır, döngüleri kırar. Eski sürümlerde klasör kaydında
   * tutulan açık/kapalı durumu kişisel ayarlara taşır.
   */
  function normalize() {
    S.folders.forEach((f) => {
      if (!('collapsed' in f)) return;
      if (f.collapsed) setCollapsed(f.id, true);
      delete f.collapsed;
    });
    S.docs.forEach((d) => { if (d.folder && !folderById(d.folder)) delete d.folder; });
    S.folders.forEach((f) => { if (f.parent && (!folderById(f.parent) || isWithin(f.parent, f.id))) delete f.parent; });
  }

  function createFolder(parentId) {
    if (!Seq.workspace.editable()) return null;
    const base = T('folder.new');
    const siblings = childFolders(parentId);
    let n = base, k = 2;
    while (siblings.some((f) => f.name === n)) n = base + ' (' + k++ + ')';
    const f = { id: 'f' + Seq.docs.newDocId().slice(1), name: n };
    if (parentId) { f.parent = parentId; expandTo(parentId); }
    S.folders.push(f);
    Seq.docs.persistDocs();
    return f;
  }
  function renameFolder(id, name) {
    const f = folderById(id);
    const v = String(name || '').trim();
    if (!f || !v || v === f.name || !Seq.workspace.editable()) return false;
    f.name = v;
    Seq.docs.persistDocs();
    return true;
  }
  /** Klasörü siler; içeriği bir üst düzeye çıkar (dolu klasör için onay sorulur) */
  function deleteFolder(id) {
    if (!Seq.workspace.editable()) return;
    const f = folderById(id);
    if (!f) return;
    const nDocs = S.docs.filter((d) => d.folder === id).length;
    const nSub = S.folders.filter((x) => x.parent === id).length;
    if ((nDocs || nSub) && !confirm(T('folder.confirmDelete', { name: f.name, n: nDocs, m: nSub }))) return;
    S.docs.forEach((d) => { if (d.folder === id) { if (f.parent) d.folder = f.parent; else delete d.folder; } });
    S.folders.forEach((x) => { if (x.parent === id) { if (f.parent) x.parent = f.parent; else delete x.parent; } });
    S.folders = S.folders.filter((x) => x.id !== id);
    Seq.docs.persistDocs();
  }
  function moveDoc(docId, folderId) {
    if (!Seq.workspace.editable()) return;
    const d = S.docs.find((x) => x.id === docId);
    if (!d || (d.folder || null) === (folderId || null)) return;
    if (folderId) d.folder = folderId; else delete d.folder;
    expandTo(folderId);
    Seq.docs.persistDocs();
  }
  function moveFolder(id, parentId) {
    if (!Seq.workspace.editable()) return;
    const f = folderById(id);
    if (!f || (f.parent || null) === (parentId || null) || (parentId && isWithin(parentId, id))) return;
    if (parentId) f.parent = parentId; else delete f.parent;
    expandTo(parentId);
    Seq.docs.persistDocs();
  }

  Seq.folders = {
    childFolders, createFolder, isCollapsed, setCollapsed, deleteFolder, expandTo, folderById, folderDocCount, folderTree, isWithin, moveDoc, moveFolder,
    normalize, pathOf, renameFolder,
  };
})(window.Seq = window.Seq || {});
