/* Sequence Studio — içe aktarma ve paylaşım
 *
 * Dosya içe aktarma (.mmd/.txt/.md, sürükle-bırak) ve sıkıştırılmış paylaşım linki.
 */
(function (Seq) {
  'use strict';
  const { $, I18N, M, S, T, el, toast } = Seq.core;

  // Sayfa dışına dosya sürükleyip bırakma (içe aktarma)
  let fileDragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  // ---------------------------------------------------------------------------
  // İçe aktarma / paylaşım
  // ---------------------------------------------------------------------------
  function importFile(file) {
    const r = new FileReader();
    r.onload = () => {
      let text = String(r.result || '');
      const fence = text.match(/```mermaid\s*\n([\s\S]*?)```/);
      if (fence) text = fence[1];
      if (!/sequenceDiagram/.test(text)) toast(T('import.noSeq'), 'err');
      Seq.docs.createDoc(file.name.replace(/\.(mmd|mermaid|txt|md)$/i, ''), Seq.catalog.stripKnownDefs(text.trim() + '\n'));
      toast(T('import.done', { name: file.name }));
    };
    r.readAsText(file);
  }

  const b64url = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const fromB64url = (s) => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };

  /**
   * Paylaşım linki. Yeni biçim ("y"): ad + girintisi atılmış kod tek parça olarak deflate ile sıkıştırılır
   * (ad URL'de ayrıca kodlanmaz, girinti tekrarları atılır). Açılınca kod standart girintiyle yeniden yazılır.
   * Eski "z"/"b" linkleri açılmaya devam eder.
   */
  const SHARE_WARN_LEN = 8000;
  async function deflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
  }
  async function encodeShare(code, name) {
    const flat = code.split('\n').map((l) => l.trim()).join('\n');
    const bytes = new TextEncoder().encode((name || '').replace(/\n/g, ' ') + '\n' + flat);
    if ('CompressionStream' in window) return 'y' + b64url(await deflate(bytes));
    return 'c' + b64url(bytes);
  }
  /** Döner: { code, name } (eski biçimlerde name = null) */
  async function decodeShare(s) {
    const kind = s[0], bytes = fromB64url(s.slice(1));
    if (kind === 'y' || kind === 'c') {
      const text = kind === 'y' ? await inflate(bytes) : new TextDecoder().decode(bytes);
      const nl = text.indexOf('\n');
      let code = text.slice(nl + 1);
      // Girintiyi geri kazandır (kod Studio biçimindeyse okunup yeniden yazılır)
      try { if (/^\s*sequenceDiagram\b/.test(code)) code = M.serialize(M.parse(code)); } catch (e) { /* olduğu gibi kalsın */ }
      return { code, name: text.slice(0, nl) || null };
    }
    if (kind === 'z') return { code: await inflate(bytes), name: null };
    return { code: new TextDecoder().decode(bytes), name: null };
  }
  async function copyShareLink() {
    const enc = await encodeShare(Seq.catalog.withDefs(S.code), S.doc.name);
    const url = location.href.split('#')[0] + '#s=' + enc;
    try { await navigator.clipboard.writeText(url); toast(T('share.copied')); }
    catch (e) { prompt(T('share.prompt'), url); }
    if (url.length > SHARE_WARN_LEN) setTimeout(() => toast(T('share.long', { n: url.length.toLocaleString(I18N.getLang() === 'tr' ? 'tr-TR' : 'en-US') }), 'err'), 300);
  }
  async function loadFromHash() {
    const m = location.hash.match(/#s=([^&]+)(?:&n=([^&]*))?/);
    if (!m) return false;
    try {
      const { code, name } = await decodeShare(m[1]);
      Seq.docs.createDoc(name || (m[2] ? decodeURIComponent(m[2]) : T('share.docName')), Seq.catalog.stripKnownDefs(code));
      toast(T('share.opened'));
    } catch (e) { toast(T('share.failed'), 'err'); }
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { fileDragDepth++; document.body.classList.add('file-drop'); } });
    window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --fileDragDepth <= 0) { fileDragDepth = 0; document.body.classList.remove('file-drop'); } });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      fileDragDepth = 0;
      document.body.classList.remove('file-drop');
      const f = e.dataTransfer.files[0];
      if (f) importFile(f);
    });
    el.fileInput.addEventListener('change', () => { const f = el.fileInput.files[0]; if (f) importFile(f); el.fileInput.value = ''; });
    $('#btnImport').addEventListener('click', () => el.fileInput.click());
  }

  Seq.share = { init, copyShareLink, loadFromHash };
})(window.Seq = window.Seq || {});
