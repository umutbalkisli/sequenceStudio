/* Sequence Studio — tema
 *
 * Uygulama teması (açık/koyu/sistem) ve Mermaid yapılandırması (Studio temaları, kağıt arka planı).
 */
(function (Seq) {
  'use strict';
  const { $, S, T, el, events, icon, saveSettings } = Seq.core;

  // ---------------------------------------------------------------------------
  // Tema
  // ---------------------------------------------------------------------------
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const appTheme = () => (S.settings.appTheme === 'system' ? (darkMQ.matches ? 'dark' : 'light') : S.settings.appTheme);
  function applyAppTheme() {
    const t = appTheme();
    document.documentElement.dataset.theme = t;
    const b = $('#btnTheme');
    b.innerHTML = icon(t === 'dark' ? 'sun' : 'moon');
    b.title = T(t === 'dark' ? 'theme.toLight' : 'theme.toDark');
  }

  // ---------------------------------------------------------------------------
  // Mermaid yapılandırması
  // ---------------------------------------------------------------------------
  const FONT = 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const STUDIO = {
    'studio-light': {
      background: '#ffffff', fontFamily: FONT, fontSize: '14px',
      primaryColor: '#eef0ff', primaryBorderColor: '#6c7cff', primaryTextColor: '#1b2030',
      secondaryColor: '#f4f5f8', tertiaryColor: '#f8f9fb', lineColor: '#4b5368', textColor: '#1b2030',
      actorBkg: '#eef0ff', actorBorder: '#6c7cff', actorTextColor: '#1b2030', actorLineColor: '#c4c9d6',
      signalColor: '#3b4255', signalTextColor: '#1b2030',
      labelBoxBkgColor: '#fff3dc', labelBoxBorderColor: '#f0a020', labelTextColor: '#7a4b00', loopTextColor: '#4b5368',
      noteBkgColor: '#fff8d6', noteBorderColor: '#e5c454', noteTextColor: '#4a3d00',
      activationBkgColor: '#e3e7ff', activationBorderColor: '#6c7cff', sequenceNumberColor: '#ffffff',
    },
    'studio-dark': {
      darkMode: true, background: '#12151c', fontFamily: FONT, fontSize: '14px',
      primaryColor: '#1f2647', primaryBorderColor: '#7c8cff', primaryTextColor: '#e7eaf1',
      secondaryColor: '#1b2030', tertiaryColor: '#171b24', lineColor: '#9aa3b5', textColor: '#e7eaf1',
      actorBkg: '#1c2242', actorBorder: '#7c8cff', actorTextColor: '#e7eaf1', actorLineColor: '#384157',
      signalColor: '#c4cad8', signalTextColor: '#e7eaf1',
      labelBoxBkgColor: '#3a2c10', labelBoxBorderColor: '#f0a020', labelTextColor: '#ffd58a', loopTextColor: '#c4cad8',
      noteBkgColor: '#2d2a17', noteBorderColor: '#a08c3c', noteTextColor: '#f2e8bb',
      activationBkgColor: '#283063', activationBorderColor: '#7c8cff', sequenceNumberColor: '#12151c',
    },
  };
  const PAPER_BG = { 'studio-light': '#ffffff', 'studio-dark': '#12151c', default: '#ffffff', neutral: '#ffffff', forest: '#ffffff', dark: '#333333' };
  const STUDIO_CSS = `
    rect.actor, .actor-man circle, rect.note, rect.labelBox { stroke-width: 1.4px; }
    rect.actor { rx: 8px; ry: 8px; }
    rect.note { rx: 6px; ry: 6px; }
    text.actor > tspan { font-weight: 600; }
    .messageText { font-weight: 500; }
    .labelText, .labelText > tspan { font-weight: 700; letter-spacing: .03em; }
    .loopText, .loopText > tspan, .sectionTitle, .sectionTitle > tspan { font-style: italic; }
  `;

  const mmThemeName = () => (S.settings.mmTheme === 'auto' ? (appTheme() === 'dark' ? 'studio-dark' : 'studio-light') : S.settings.mmTheme);

  function configureMermaid() {
    const t = mmThemeName();
    const cfg = {
      startOnLoad: false,
      securityLevel: 'strict',
      fontFamily: FONT,
      htmlLabels: false,
      sequence: {
        useMaxWidth: false, mirrorActors: !!S.settings.mirror, actorMargin: 64, boxMargin: 10, noteMargin: 12,
        messageMargin: 38, boxTextMargin: 6, diagramMarginX: 24, diagramMarginY: 16, wrap: false,
      },
      // Mimari (C4) görünümü
      flowchart: { useMaxWidth: false, htmlLabels: false, curve: 'basis', nodeSpacing: 46, rankSpacing: 80, padding: 14, diagramPadding: 16 },
    };
    if (STUDIO[t]) { cfg.theme = 'base'; cfg.themeVariables = STUDIO[t]; cfg.themeCSS = STUDIO_CSS; }
    else cfg.theme = t;
    mermaid.initialize(cfg);
    el.canvas.style.setProperty('--paper-bg', PAPER_BG[t] || '#ffffff');
    // Sayfanın geneli (mimari ekranı, sunum modu) aynı kâğıt rengini kullanır
    document.documentElement.style.setProperty('--paper-bg', PAPER_BG[t] || '#ffffff');
    events.emit('theme:changed');
  }

  /** Olay bağlamaları ve açılış ayarları (tüm modüller yüklendikten sonra çağrılır). */
  function init() {
    darkMQ.addEventListener('change', () => {
      if (S.settings.appTheme === 'system') { applyAppTheme(); configureMermaid(); Seq.preview.scheduleRender(0); }
    });
    $('#btnTheme').addEventListener('click', () => {
      S.settings.appTheme = appTheme() === 'dark' ? 'light' : 'dark';
      saveSettings();
      applyAppTheme();
      configureMermaid();
      Seq.preview.scheduleRender(0);
    });
    el.mmTheme.addEventListener('change', () => { S.settings.mmTheme = el.mmTheme.value; saveSettings(); configureMermaid(); Seq.preview.scheduleRender(0); });
    el.mirror.addEventListener('change', () => { S.settings.mirror = el.mirror.checked; saveSettings(); configureMermaid(); Seq.preview.scheduleRender(0); });
  }

  Seq.theme = { init, FONT, PAPER_BG, applyAppTheme, configureMermaid, mmThemeName };
})(window.Seq = window.Seq || {});
