/* Sequence Studio — inline SVG ikonlar (24x24, stroke) */
(function () {
  const P = {
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/>',
    panelClose: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16M15.5 10l-2 2 2 2"/>',
    panelOpen: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16M13.5 10l2 2-2 2"/>',
    maximize: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    minimize: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    logo: '<path d="M6 3v18M18 3v18"/><path d="M6 8h10m-3-3 3 3-3 3"/><path d="M18 16H8m3-3-3 3 3 3"/>',
    check: '<path d="m5 12 4.5 4.5L19 7"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    layout: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/>',
    upload: '<path d="M12 15V3m0 0-4 4m4-4 4 4"/><path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/>',
    download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 15v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    blocks: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>',
    code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/>',
    type: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    link: '<path d="M9 15 15 9"/><path d="M11 6.5 12.6 5a4.2 4.2 0 0 1 6 6L17 12.5M7 11.5 5.4 13a4.2 4.2 0 0 0 6 6L13 17.5"/>',
    grip: '<circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    minus: '<path d="M5 12h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 8V5.5A2.5 2.5 0 0 0 13.5 3h-8A2.5 2.5 0 0 0 3 5.5v8A2.5 2.5 0 0 0 5.5 16H8"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    vector: '<circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M5 17C5 9 9 5 17 5"/><rect x="3" y="3" width="4" height="4" rx="1"/><rect x="17" y="17" width="4" height="4" rx="1"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
    message: '<path d="M3 12h16m-4-4 4 4-4 4"/>',
    reply: '<path d="M21 12H5m4-4-4 4 4 4" stroke-dasharray="3 2.4"/>',
    note: '<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5M8.5 9h7M8.5 12.5h4"/>',
    activate: '<rect x="9" y="3" width="6" height="18" rx="1.5"/><path d="M12 3v18" opacity=".35"/>',
    loop: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    alt: '<path d="M6 3v6a4 4 0 0 0 4 4h8m-3-3 3 3-3 3"/><path d="M6 9v12"/>',
    opt: '<rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke-dasharray="3 2.5"/><path d="m9 12 2 2 4-4"/>',
    par: '<path d="M4 7h13m-3-3 3 3-3 3M4 17h13m-3-3 3 3-3 3"/>',
    critical: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".7" fill="currentColor"/>',
    break: '<path d="M4 12h6M14 12h6M12 4v4M12 16v4"/><path d="m8 8 8 8" />',
    rect: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17" opacity=".5"/>',
    raw: '<path d="M9 7 4 12l5 5M15 7l5 5-5 5"/>',
    more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    collapse: '<path d="m7 15 5-5 5 5"/>',
    swap: '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7 14h10"/>',
    // Katılımcı tipleri
    't-participant': '<rect x="3.5" y="6" width="17" height="12" rx="2.5"/>',
    't-actor': '<circle cx="12" cy="5.5" r="2.7"/><path d="M12 8.5v7M6 11h12M12 15.5l-4.5 6M12 15.5l4.5 6"/>',
    't-boundary': '<path d="M3 6v12M3 12h5"/><circle cx="14.5" cy="12" r="6"/>',
    't-control': '<circle cx="12" cy="13" r="7"/><path d="m10.5 6 3-2.5M10.5 6l3 2.5"/>',
    't-entity': '<circle cx="12" cy="10.5" r="6.5"/><path d="M5 20.5h14"/>',
    't-database': '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13"/><path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" opacity=".5"/>',
    't-collections': '<rect x="6.5" y="4" width="14" height="11" rx="2"/><rect x="3.5" y="8" width="14" height="11" rx="2" fill="var(--ic-fill, transparent)"/>',
    't-queue': '<path d="M5 6.5h12.5a3 5.5 0 0 1 0 11H5a3 5.5 0 0 1 0-11Z"/><path d="M17.5 6.5a3 5.5 0 0 0 0 11"/>',
  };

  function icon(name, cls) {
    const body = P[name] || P.raw;
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }

  function hydrate(root) {
    (root || document).querySelectorAll('i[data-icon]').forEach((el) => {
      el.outerHTML = icon(el.getAttribute('data-icon'));
    });
  }

  window.SeqIcons = { icon, hydrate };
})();
