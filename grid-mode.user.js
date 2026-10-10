// ==UserScript==
// @name         Grid Mode — I Turned the Entire Internet Into a Cyberpunk Terminal
// @namespace    https://schema.cx/grid-mode
// @version      1.6.0
// @description  Press Alt+G on any website to render it through the Grid. Calm is a beautiful dark mode for every site; Cinematic adds a terminal boot, target-lock brackets, decoding headlines, scanlines and duotone images. Five colour lenses. Press it again to come back. Made by Schema.
// @author       Schema
// @homepageURL  https://schema.cx/?ref=grid-mode
// @supportURL   https://github.com/sch8ma/grid-mode/issues
// @icon         https://schema.cx/favicon.svg
// @license      MIT
// @match        *://*/*
// @exclude      *://schema.cx/*
// @exclude      *://*.schema.cx/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @connect      api.schema.cx
// ==/UserScript==

/*
 * GRID MODE — the web, rendered from inside the Grid.
 *
 *   Alt+G           enter / leave the Grid (⌥+G on a Mac)
 *   Alt+Shift+G     next lens: GRID · SIGNAL · PULSE · SOUL · FIELD
 *   the HUD mark    opens the panel: Calm / Cinematic, lenses, per-site memory
 *
 * How it works:
 *   READ   Every element is read ONCE, the moment it is unmarked — at entry, or
 *          when the page inserts it (a MutationObserver runs before the next
 *          paint). Its own colours decide what it becomes: an opaque surface turns
 *          into a panel or a chip, coloured text keeps its meaning on Schema's
 *          palette, numbers become monospaced data. The result is one attribute,
 *          `data-sgm`, holding a few tokens.
 *   PAINT  One stylesheet repaints only marked elements. Because an unmarked
 *          element is never painted, its original style can always be read
 *          directly: the sheet is never switched off, so the page is never
 *          restyled twice to look at it.
 *   LIVE   A Shadow-DOM layer, isolated from the page's CSS, draws the world grid,
 *          scanlines, target lock, click pings, the HUD and the panel.
 *
 * Leave the Grid and the page is exactly what it was.
 *
 * For the ones who read source: the Grid rewards curiosity. Ensina answers to
 * her name. Some lenses are earned, and old games remember how to open doors.
 *                                                          — the Architects
 *
 * Privacy: no analytics, no identifiers. While the Grid is on, the HUD asks
 * api.schema.cx for ONE public, cookieless number (how many Zones are live), at
 * most once every 30 minutes. Settings stay in your userscript manager.
 */

(function () {
  'use strict';

  const isHotkey = (e) => e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyG' && !e.repeat;

  // Inside a frame (a consent dialog, an embedded player) the script does ONE
  // thing: hand Alt+G up to the page, so the hotkey works wherever focus sits.
  if (window.top !== window.self) {
    window.addEventListener(
      'keydown',
      (e) => {
        if (!isHotkey(e)) return;
        e.preventDefault();
        try {
          window.top.postMessage({ schemaGridMode: e.shiftKey ? 'lens' : 'toggle' }, '*');
        } catch (err) {
          /* a sandboxed frame cannot reach the top — nothing to do */
        }
      },
      true,
    );
    return;
  }
  if (window.__schemaGridMode) return;
  window.__schemaGridMode = true;

  // At document-start the <html> element may not exist yet — wait for it.
  if (document.documentElement) main(document.documentElement);
  else {
    const wait = new MutationObserver(() => {
      if (!document.documentElement) return;
      wait.disconnect();
      main(document.documentElement);
    });
    wait.observe(document, { childList: true });
  }

  function main(html) {
    if (!(html instanceof HTMLElement)) return; // XML / SVG documents

    // ─── Constants ──────────────────────────────────────────────────────────

    const VERSION = '1.6.0';
    const HOST = location.hostname || 'local';
    const JOIN_URL = 'https://schema.cx/?ref=grid-mode';
    const STATS_URL = 'https://api.schema.cx/api/stats';
    const FONT_CSS =
      'https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800&family=Fira+Code:wght@400;500;600&display=swap';
    const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const ALT = IS_MAC ? '⌥' : 'ALT';
    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const Z = 2147483600; // the top of the stacking world, minus room for our own layers
    const ATTR = 'data-sgm';

    // Schema's accent families: `acc` is the default step, `acc2` the light ink
    // step, `hue` rotates the duotone image tint onto the lens.
    const LENSES = {
      grid: { name: 'GRID', acc: '#D63A32', acc2: '#F08A84', hue: '-32deg' },
      signal: { name: 'SIGNAL', acc: '#5AA7FF', acc2: '#A6CEFF', hue: '178deg' },
      pulse: { name: 'PULSE', acc: '#D7B84F', acc2: '#ECD79A', hue: '12deg' },
      soul: { name: 'SOUL', acc: '#D2A6FF', acc2: '#ECCBFF', hue: '236deg' },
      field: { name: 'FIELD', acc: '#63C174', acc2: '#A7E0B0', hue: '96deg' },
      // Earned, not given. The Architects see the Grid in black and white.
      void: { name: 'VOID', acc: '#EDF0F5', acc2: '#FFFFFF', hue: '0deg', sat: 0, secret: true },
    };
    const LENS_KEYS = Object.keys(LENSES);

    // A page's coloured text and surfaces keep their meaning, mapped onto the palette.
    const HUE_INK = {
      red: '#F08A84',
      amber: '#F0C885',
      gold: '#ECD79A',
      green: '#A7E0B0',
      blue: '#A6CEFF',
      violet: '#E3B8FF',
      pink: '#FE7AB6',
    };
    const HUE_FILL = {
      red: '#D63A32',
      amber: '#D99A35',
      gold: '#D7B84F',
      green: '#63C174',
      blue: '#5AA7FF',
      violet: '#D2A6FF',
      pink: '#FC538D',
    };

    // Two ways to live in the Grid. Calm is a dark mode you keep on all day;
    // Cinematic is the full render. Fine-tuning a layer makes the mode "custom".
    const LAYER_KEYS = ['type', 'scan', 'backdrop', 'duo', 'decode', 'lock'];
    const PRESETS = {
      calm: { type: false, scan: false, backdrop: true, duo: false, decode: false, lock: false },
      cinematic: { type: true, scan: true, backdrop: true, duo: true, decode: true, lock: true },
    };

    // Canvas-driven apps a repaint can only hurt. "Every site" leaves them alone;
    // Alt+G still works there on request.
    const APP_HOSTS =
      /(^|\.)(docs\.google\.com|drive\.google\.com|meet\.google\.com|earth\.google\.com|figma\.com|canva\.com|miro\.com|excalidraw\.com|tldraw\.com|photopea\.com|diagrams\.net|draw\.io|onshape\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com)$/;
    const isAppPage = () => APP_HOSTS.test(HOST) || (/(^|\.)google\.[a-z.]+$/.test(HOST) && location.pathname.startsWith('/maps'));

    const MARK_PATHS = [
      "M3455 6234 c-115 -19 -285 -58 -342 -80 -38 -14 -143 -45 -235 -69 -200 -53 -304 -91 -553 -203 -104 -46 -259 -116 -344 -154 -156 -70 -284 -146 -377 -224 -61 -52 -91 -64 -121 -53 -53 20 -13 102 126 259 60 68 62 72 25 45 -23 -17 -107 -91 -188 -165 -80 -74 -169 -147 -197 -161 -56 -28 -81 -60 -105 -134 -21 -65 -38 -83 -63 -68 -17 10 -19 8 -24 -30 -9 -65 9 -215 32 -281 12 -33 21 -69 21 -80 0 -12 7 -30 15 -40 19 -26 19 -60 -1 -102 -21 -43 -47 -44 -132 -4 -34 16 -62 27 -62 25 0 -3 43 -51 95 -107 52 -57 95 -106 95 -110 0 -5 -9 -8 -20 -8 -27 0 -231 44 -349 75 -52 14 -95 24 -97 22 -2 -2 74 -47 169 -100 94 -53 186 -106 202 -118 l30 -21 -75 6 -75 6 61 -39 c34 -22 71 -44 83 -50 31 -17 26 -27 -24 -46 -34 -13 -64 -16 -122 -13 l-78 5 64 -29 c36 -17 117 -43 180 -60 120 -31 179 -56 292 -126 208 -127 384 -200 453 -187 36 7 179 -36 269 -82 55 -28 127 -89 127 -109 0 -7 -15 -21 -32 -30 -18 -9 -73 -56 -123 -103 -111 -107 -147 -132 -302 -210 -89 -44 -126 -68 -137 -88 -23 -44 -99 -113 -266 -238 -85 -65 -146 -115 -135 -111 37 11 127 26 156 26 22 0 29 -5 29 -20 0 -22 -21 -36 -90 -56 -68 -20 -272 -126 -329 -171 -27 -21 -53 -50 -60 -64 -13 -30 -56 -56 -166 -98 -44 -17 -89 -38 -100 -47 -19 -14 -17 -14 23 -8 69 11 53 -15 -80 -130 -108 -92 -248 -234 -248 -250 0 -11 103 45 179 96 141 96 264 137 441 148 88 5 142 14 183 29 32 12 94 24 138 28 87 7 92 2 67 -52 -6 -14 -9 -27 -6 -30 3 -3 99 33 214 81 115 47 272 108 349 136 77 28 187 72 244 99 88 41 113 49 163 49 39 0 90 10 146 29 48 16 112 37 142 46 30 9 93 39 139 67 47 28 119 66 160 85 42 18 142 67 223 108 80 41 155 75 167 75 32 0 266 -147 377 -237 95 -77 184 -138 266 -183 21 -11 42 -29 48 -39 15 -29 12 -83 -5 -108 -14 -20 -13 -23 15 -40 16 -9 30 -25 30 -34 0 -29 -52 -81 -105 -105 l-50 -23 130 -1 c273 -3 272 -44 -8 -258 -78 -59 -164 -125 -191 -146 -69 -53 -126 -77 -208 -87 -38 -5 -88 -18 -111 -29 -72 -36 -190 -107 -242 -146 -58 -44 -107 -59 -248 -74 -56 -6 -172 -27 -257 -46 -176 -39 -336 -63 -629 -95 -219 -24 -239 -23 -338 21 -30 13 -43 25 -43 38 0 22 125 149 168 171 15 7 54 37 87 66 33 28 87 70 120 92 75 51 190 143 179 143 -5 0 -25 -4 -44 -9 -111 -28 -117 -21 -32 41 119 87 260 215 285 257 l18 31 -34 -16 c-73 -35 -92 18 -29 77 69 65 176 145 352 263 96 65 182 125 190 133 32 33 -513 -253 -559 -293 -50 -43 -134 -94 -158 -94 -8 0 -45 -14 -83 -30 -38 -17 -81 -31 -97 -31 -21 -1 -23 -3 -8 -6 45 -11 33 -22 -47 -47 -91 -28 -177 -78 -380 -221 -110 -78 -123 -85 -126 -65 -2 12 -9 19 -15 17 -20 -6 -85 -98 -127 -180 -37 -73 -40 -84 -40 -161 0 -165 36 -270 134 -387 133 -159 244 -220 551 -302 112 -29 131 -31 280 -31 202 1 541 34 808 80 248 42 662 192 1050 380 163 79 302 144 307 144 6 0 15 -11 21 -24 16 -34 -23 -102 -119 -206 l-77 -84 86 64 c48 36 115 89 150 119 l64 54 3 -29 c6 -58 13 -57 41 2 31 66 53 88 93 98 37 8 73 56 114 150 19 44 36 82 40 85 8 9 24 -21 24 -49 l1 -25 11 25 c6 14 10 86 10 160 0 93 6 166 19 235 10 55 19 110 19 122 0 22 9 27 73 39 l37 6 -45 47 c-61 62 -115 144 -122 185 l-5 33 103 8 104 7 -94 44 -93 44 3 87 4 88 -21 -24 c-12 -14 -26 -21 -33 -17 -16 10 -59 97 -91 186 l-28 74 -113 38 c-148 49 -366 157 -418 206 -45 43 -60 84 -40 109 8 9 32 30 54 46 32 24 35 28 15 23 -14 -3 -74 -9 -135 -12 -127 -7 -168 3 -163 38 4 27 94 102 207 171 69 43 95 67 149 137 37 47 85 108 108 135 23 28 56 73 73 100 37 59 120 146 176 185 56 39 407 400 423 435 8 17 19 41 26 55 7 15 42 42 86 67 155 86 179 113 99 113 -50 0 -51 19 -1 48 40 22 165 147 278 276 81 93 64 87 -94 -32 -53 -40 -119 -86 -147 -102 -76 -43 -189 -77 -300 -90 -75 -8 -114 -18 -156 -40 -56 -28 -246 -76 -258 -65 -3 4 4 25 17 47 12 23 21 42 20 43 -4 4 -327 -149 -621 -294 -257 -126 -271 -131 -315 -125 -43 5 -58 0 -187 -62 -77 -37 -194 -104 -260 -148 -66 -44 -148 -90 -185 -103 -36 -13 -86 -33 -113 -45 l-47 -21 -25 23 c-13 13 -29 38 -35 56 l-11 34 -31 -16 c-52 -27 -104 -12 -215 63 -54 37 -192 118 -308 181 -115 63 -248 138 -295 166 -83 50 -84 52 -103 112 -32 99 -25 114 106 236 61 58 130 116 153 130 66 42 244 116 504 209 l245 88 -105 1 c-146 2 -212 27 -149 57 84 40 444 205 546 249 204 89 273 102 543 105 l175 1 90 -43 c50 -24 93 -45 96 -46 4 -2 4 8 2 22 -4 17 -1 25 8 25 24 -1 93 -36 114 -59 19 -22 19 -23 0 -57 -22 -41 -70 -81 -135 -114 -46 -23 -482 -331 -477 -336 2 -2 52 15 111 37 59 23 110 39 113 35 22 -22 -67 -117 -289 -309 -36 -32 -73 -69 -82 -82 l-16 -24 35 15 c46 19 91 18 99 -2 11 -28 -25 -76 -143 -197 l-115 -118 74 27 c52 18 127 61 240 138 125 85 183 117 244 138 55 18 75 29 63 34 -32 12 -16 29 61 66 72 34 253 169 347 258 22 21 51 43 64 50 24 12 24 12 18 -24 -3 -20 -4 -36 -2 -36 10 0 102 151 126 208 53 128 46 260 -24 407 -78 164 -281 318 -488 369 -180 44 -534 84 -624 70z",
      "M3592 2548 c-29 -29 3 -88 48 -88 59 0 56 69 -3 90 -36 12 -31 12 -45 -2z"
    ];

    // ─── Storage ────────────────────────────────────────────────────────────

    const store = {
      get(key, fallback) {
        try {
          if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
        } catch (e) {
          /* fall through to localStorage */
        }
        try {
          const raw = localStorage.getItem('sgm:' + key);
          return raw == null ? fallback : JSON.parse(raw);
        } catch (e) {
          return fallback;
        }
      },
      set(key, value) {
        try {
          if (typeof GM_setValue === 'function') return void GM_setValue(key, value);
        } catch (e) {
          /* fall through */
        }
        try {
          localStorage.setItem('sgm:' + key, JSON.stringify(value));
        } catch (e) {
          /* private mode — settings simply do not persist */
        }
      },
    };

    const stored = store.get('prefs', {}) || {};
    const prefs = {
      lens: LENSES[stored.lens] ? stored.lens : 'grid',
      layers: Object.assign({}, PRESETS.cinematic, stored.layers),
      sound: !!stored.sound,
      everywhere: !!stored.everywhere,
      void: !!stored.void,
      hud: stored.hud === 'mini' || stored.hud === 'full' ? stored.hud : null,
    };
    if (LENSES[prefs.lens].secret && !prefs.void) prefs.lens = 'grid';
    const lensList = () => LENS_KEYS.filter((k) => !LENSES[k].secret || prefs.void);
    const sites = store.get('sites', {}) || {};
    const savePrefs = () => store.set('prefs', prefs);
    const saveSites = () => store.set('sites', sites);
    const siteOn = () => sites[HOST] === true || (prefs.everywhere && sites[HOST] !== false && !isAppPage());

    // Turning the Grid on is a choice for this site in this tab, not for one page:
    // it follows you from page to page until you leave it. Per-tab storage, so it
    // never leaks into other tabs or outlives the session.
    const session = {
      get: () => {
        try {
          return sessionStorage.getItem('sgm:on') === '1';
        } catch (e) {
          return false;
        }
      },
      set: (on) => {
        try {
          if (on) sessionStorage.setItem('sgm:on', '1');
          else sessionStorage.removeItem('sgm:on');
        } catch (e) {
          /* storage refused: the Grid simply ends with the page */
        }
      },
    };
    const modeOf = () =>
      Object.keys(PRESETS).find((m) => LAYER_KEYS.every((k) => prefs.layers[k] === PRESETS[m][k])) || 'custom';
    const cinematic = () => modeOf() !== 'calm';
    const hudMini = () => (prefs.hud ? prefs.hud === 'mini' : !cinematic());

    // ─── Small helpers ──────────────────────────────────────────────────────

    const SVGNS = 'http://www.w3.org/2000/svg';
    const fmt = (n) => Number(n).toLocaleString('en-US');
    const onReady = (fn) => {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
      else fn();
    };

    // DOM builder — no innerHTML anywhere, so pages that enforce Trusted Types work.
    function h(tag, props, ...kids) {
      const el = document.createElement(tag);
      if (props) {
        for (const [k, v] of Object.entries(props)) {
          if (v == null || v === false) continue;
          if (k === 'class') el.className = v;
          else if (k === 'text') el.textContent = v;
          else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
          else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
          else el.setAttribute(k, v === true ? '' : String(v));
        }
      }
      for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
      return el;
    }

    // The Schema mark, always in brand red whatever the lens.
    function mark(cls) {
      const svg = document.createElementNS(SVGNS, 'svg');
      svg.setAttribute('viewBox', '0 0 6260 7070');
      svg.setAttribute('aria-hidden', 'true');
      if (cls) svg.setAttribute('class', cls);
      const g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('fill', '#D63A32');
      for (const d of MARK_PATHS) {
        const p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('d', d);
        g.appendChild(p);
      }
      svg.appendChild(g);
      return svg;
    }

    // A stylesheet that survives strict page CSP: a constructable sheet first (not
    // subject to inline-style rules), a <style> element as the fallback.
    function sheetFrom(css, target) {
      const parentOf = () => (target === document ? document.head || html : target);
      try {
        const s = new CSSStyleSheet();
        s.replaceSync(css);
        target.adoptedStyleSheets = [...target.adoptedStyleSheets, s];
        return {
          set: (c) => s.replaceSync(c),
          ensure: () => {
            if (!Array.from(target.adoptedStyleSheets).includes(s))
              target.adoptedStyleSheets = [...target.adoptedStyleSheets, s];
          },
        };
      } catch (e) {
        const el = document.createElement('style');
        el.textContent = css;
        parentOf().appendChild(el);
        return {
          set: (c) => {
            el.textContent = c;
          },
          ensure: () => {
            if (!el.isConnected) parentOf().appendChild(el);
          },
        };
      }
    }

    // ─── Colour reading ─────────────────────────────────────────────────────

    function parseColor(s) {
      if (!s) return null;
      let m = s.match(/^rgba?\(([^)]+)\)/);
      if (m) {
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      }
      m = s.match(/^color\(srgb ([^)]+)\)/);
      if (m) {
        const p = m[1].split(/[\s/]+/).filter(Boolean).map(parseFloat);
        return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 };
      }
      return null; // oklch() and friends: no opinion, leave the element alone
    }

    function toHsl({ r, g, b }) {
      r /= 255;
      g /= 255;
      b /= 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let hue = 0;
      let s = 0;
      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) hue = (b - r) / d + 2;
        else hue = (r - g) / d + 4;
        hue *= 60;
      }
      return { h: hue, s, l };
    }

    function hueKey(c) {
      const { h: hue, s, l } = toHsl(c);
      if (s < 0.32 || l < 0.16 || l > 0.9) return null;
      if (hue < 15 || hue >= 345) return 'red';
      if (hue < 40) return 'amber';
      if (hue < 65) return 'gold';
      if (hue < 170) return 'green';
      if (hue < 250) return 'blue';
      if (hue < 300) return 'violet';
      return 'pink';
    }

    // Neutral text keeps its rank: body copy stays bright, secondary grey stays quiet.
    function textKey(c) {
      const k = hueKey(c);
      if (k) return k;
      const { l } = toHsl(c);
      return l > 0.36 && l < 0.7 ? 'mute' : 'ink';
    }

    // ─── The page stylesheet ────────────────────────────────────────────────

    function pageCss() {
      // Tripled class: enough specificity to beat ordinary site rules without IDs.
      const S = 'html.sgm-on.sgm-on.sgm-on';
      const M = `${S} body [${ATTR}]`;
      const tok = (t) => `${S} body [${ATTR}~="${t}"]`;
      const perHue = (fn) => Object.keys(HUE_FILL).map(fn).join('\n');

      return `
${S} {
  --sgm-base: #0A0D12; --sgm-raise: #0D1017; --sgm-panel: #11151E; --sgm-card: #151A23;
  --sgm-line: #242A36; --sgm-line2: #343C4D;
  --sgm-ink: #EDF0F5; --sgm-ink2: #B5BDCA; --sgm-mute: #8E97A6; --sgm-link: #88BCFF;
  --sgm-sans: 'Public Sans', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
  --sgm-mono: 'Fira Code', ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace;
  color-scheme: dark !important;
  background: var(--sgm-base) !important;
  scrollbar-color: var(--sgm-line2) var(--sgm-base);
  accent-color: var(--sgm-acc);
  counter-reset: sgm-h;
}
${S} body { background: transparent !important; color: var(--sgm-ink) !important; }

/* Until the first read completes on a remembered site: no white flash. */
html.sgm-pre body * { background-color: transparent !important; color: var(--sgm-ink) !important; }

/* Every marked element: the page's own paint comes off; text inherits down the
   tree so a classified parent colours its children. */
${M} {
  background-color: transparent !important;
  color: inherit !important;
  text-shadow: none !important;
  caret-color: var(--sgm-acc);
}
${S}.sgm-type body [${ATTR}]:not([${ATTR}~="i"]) { font-family: var(--sgm-sans) !important; }
${tok('g')} { background-image: none !important; }
${tok('b')} { border-color: color-mix(in srgb, var(--sgm-bh, var(--sgm-line)) 55%, var(--sgm-line)) !important; }

/* Surfaces become panels on the grid. Outlines, never borders: zero layout shift. */
${tok('p')}, ${tok('pf')} {
  background-color: color-mix(in srgb, var(--sgm-panel) 90%, transparent) !important;
  outline: 1px solid var(--sgm-line) !important;
  outline-offset: -1px;
}
${S} body [${ATTR}~="p"] [${ATTR}~="p"] { background-color: color-mix(in srgb, var(--sgm-card) 92%, transparent) !important; }
${tok('pf')} {
  background-color: color-mix(in srgb, var(--sgm-base) 94%, transparent) !important;
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--sgm-acc) 38%, transparent) !important;
}
${S} body [${ATTR}~="sh"]:is([${ATTR}~="p"], [${ATTR}~="pf"]) {
  background-color: color-mix(in srgb, var(--sgm-sh) 12%, var(--sgm-panel)) !important;
  outline-color: color-mix(in srgb, var(--sgm-sh) 40%, var(--sgm-line)) !important;
}

/* Schema cards. Calm: the 4-step radius and a soft top light. Cinematic: sharp
   HUD corners with hairline brackets, drawn as backgrounds so nothing shifts and
   the page's own ::before/::after are never touched. */
${S} body [${ATTR}~="r"]:is([${ATTR}~="p"], [${ATTR}~="pf"]) { border-radius: 12px !important; }
${S} body [${ATTR}~="r"][${ATTR}~="c"] { border-radius: 8px !important; }
${tok('k')} { background-image: linear-gradient(to bottom, rgba(237,240,245,.035), transparent 48px) !important; }
${S}.sgm-fx body [${ATTR}~="k"] {
  --sgm-tick: color-mix(in srgb, var(--sgm-acc) 70%, transparent);
  border-radius: 3px !important;
  background-image: linear-gradient(var(--sgm-tick), var(--sgm-tick)), linear-gradient(var(--sgm-tick), var(--sgm-tick)), linear-gradient(var(--sgm-tick), var(--sgm-tick)), linear-gradient(var(--sgm-tick), var(--sgm-tick)), linear-gradient(var(--sgm-tick), var(--sgm-tick)), linear-gradient(var(--sgm-tick), var(--sgm-tick)), linear-gradient(var(--sgm-tick), var(--sgm-tick)), linear-gradient(var(--sgm-tick), var(--sgm-tick)), linear-gradient(to bottom, rgba(237,240,245,.035), transparent 48px) !important;
  background-size: 12px 1px, 1px 12px, 12px 1px, 1px 12px, 12px 1px, 1px 12px, 12px 1px, 1px 12px, 100% 100% !important;
  background-position: left top, left top, right top, right top, left bottom, left bottom, right bottom, right bottom, 0 0 !important;
  background-repeat: no-repeat !important;
}
${S}.sgm-fx body [${ATTR}~="k"] [${ATTR}~="k"] { --sgm-tick: color-mix(in srgb, var(--sgm-acc) 28%, transparent); }

/* Small coloured surfaces become chips, tinted by the colour they used to be. */
${tok('c')} {
  --sgm-chip: var(--sgm-sh, var(--sgm-mute));
  background-color: color-mix(in srgb, var(--sgm-chip) 15%, transparent) !important;
  outline: 1px solid color-mix(in srgb, var(--sgm-chip) 45%, transparent) !important;
  outline-offset: -1px;
  transition: background-color .18s ease, box-shadow .22s ease, outline-color .18s ease !important;
}
${tok('c')}:hover {
  background-color: color-mix(in srgb, var(--sgm-chip) 26%, transparent) !important;
  outline-color: var(--sgm-chip) !important;
  box-shadow: 0 0 22px -6px var(--sgm-chip) !important;
}
${tok('c')}:active { background-color: color-mix(in srgb, var(--sgm-chip) 34%, transparent) !important; }
${perHue((k) => `${tok('sh-' + k)} { --sgm-sh: ${HUE_FILL[k]}; }\n${tok('bh-' + k)} { --sgm-bh: ${HUE_FILL[k]}; }`)}

/* Text */
${tok('t-ink')} { color: var(--sgm-ink) !important; }
${tok('t-mute')} { color: var(--sgm-mute) !important; }
${perHue((k) => `${tok('t-' + k)} { color: ${HUE_INK[k]} !important; }`)}
${S} body a[${ATTR}]:not([${ATTR}*="t-"]) { color: var(--sgm-link) !important; }
${S} body a {
  text-decoration-color: color-mix(in srgb, currentColor 35%, transparent) !important;
  text-underline-offset: .18em;
  transition: color .15s ease, text-decoration-color .15s ease !important;
}
${S} body a:hover { color: var(--sgm-acc2) !important; text-decoration-color: var(--sgm-acc) !important; }
${S} body :is(h1, h2) { text-shadow: 0 0 28px color-mix(in srgb, var(--sgm-acc) 40%, transparent) !important; }
${S}.sgm-type body :is(h1, h2, h3, h4, h5, h6) { letter-spacing: -0.01em !important; }
${S}.sgm-type body :is(h1, h2) { font-weight: 800 !important; }
${S} body h2 { counter-increment: sgm-h; }
${S} body h2::before {
  content: '§' counter(sgm-h, decimal-leading-zero);
  font: 600 .46em/1 var(--sgm-mono) !important;
  color: var(--sgm-acc) !important;
  letter-spacing: .08em;
  margin-right: .75em;
  vertical-align: .38em;
  text-shadow: none !important;
}
${S}.sgm-type body [${ATTR}~="n"] { font-family: var(--sgm-mono) !important; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }

/* Controls */
${S} body :is(input:not([type=checkbox], [type=radio], [type=range], [type=color], [type=file], [type=image]), textarea, select) {
  background-color: var(--sgm-raise) !important;
  color: var(--sgm-ink) !important;
  outline: 1px solid var(--sgm-line2) !important;
  outline-offset: -1px;
  transition: outline-color .18s ease, box-shadow .2s ease !important;
}
${S} body :is(input, textarea, select):focus {
  outline-color: var(--sgm-acc) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--sgm-acc) 24%, transparent) !important;
}
${S} body ::placeholder { color: var(--sgm-mute) !important; opacity: 1 !important; }
${S} body :is(button, [role=button], input[type=submit], input[type=button]):not([${ATTR}~="c"]):hover { color: var(--sgm-acc2) !important; }

/* Code, tables, rules, quotes */
${S} body :is(pre, code, kbd, samp, tt) { font-family: var(--sgm-mono) !important; }
${S} body pre {
  background-color: var(--sgm-raise) !important;
  outline: 1px solid var(--sgm-line) !important;
  outline-offset: -1px;
  border-radius: 8px;
}
${S} body :not(pre) > code {
  background-color: color-mix(in srgb, var(--sgm-acc) 13%, transparent) !important;
  color: var(--sgm-acc2) !important;
  border-radius: 3px;
}
${S} body kbd { outline: 1px solid var(--sgm-line2) !important; border-radius: 3px; }
${S} body :is(th, td) { border-color: var(--sgm-line) !important; }
${S} body th { font-family: var(--sgm-mono) !important; letter-spacing: .04em; color: var(--sgm-ink2) !important; }
${tok('dt')} > tbody > tr:hover > td { background-color: color-mix(in srgb, var(--sgm-acc) 8%, transparent) !important; }
${S} body hr { border-color: var(--sgm-line2) !important; background-color: var(--sgm-line2) !important; }
${S} body blockquote { border-left-color: var(--sgm-acc) !important; }
${S} body mark { background-color: color-mix(in srgb, var(--sgm-acc) 30%, transparent) !important; color: var(--sgm-ink) !important; }

/* Icons drawn in black would vanish on the dark field. */
${S} body svg:not([fill]) { fill: currentColor; }
${S} body svg :is([fill="#000"], [fill="#000000"], [fill="black"], [fill="#111"], [fill="#222"], [fill="#333"]) { fill: currentColor !important; }
${S} body svg :is([stroke="#000"], [stroke="#000000"], [stroke="black"]) { stroke: currentColor !important; }

/* Media */
${S}.sgm-duo body img {
  filter: grayscale(1) sepia(.55) hue-rotate(var(--sgm-hue)) saturate(var(--sgm-sat, 1.9)) contrast(1.08) brightness(.84) !important;
  transition: filter .5s cubic-bezier(.2,.8,.2,1) !important;
}
${S}.sgm-duo body img:hover, ${S}.sgm-duo body a:hover img { filter: none !important; }
${S}.sgm-on body img[${ATTR}~="l"], ${S}.sgm-on body img[${ATTR}~="l"]:hover, ${S}.sgm-on body a:hover img[${ATTR}~="l"] {
  filter: invert(1) hue-rotate(180deg) brightness(1.1) !important;
}
${S} body :is(video, iframe, embed) {
  outline: 1px solid color-mix(in srgb, var(--sgm-acc) 30%, var(--sgm-line)) !important;
  outline-offset: -1px;
}

/* Selection, focus, scrollbars */
${S} ::selection { background: color-mix(in srgb, var(--sgm-acc) 45%, transparent) !important; color: #fff !important; }
${S} body :focus-visible { outline: 2px solid var(--sgm-acc) !important; outline-offset: 2px !important; }
${S} ::-webkit-scrollbar { width: 10px; height: 10px; background: var(--sgm-base); }
${S} ::-webkit-scrollbar-thumb { background: var(--sgm-line2); border: 2px solid var(--sgm-base); border-radius: 8px; }
${S} ::-webkit-scrollbar-thumb:hover { background: var(--sgm-acc); }

`;
    }

    function lensCss(key) {
      const L = LENSES[key];
      // In Cinematic the pointer becomes a reticle in the lens colour; links and
      // fields keep their own cursors.
      const arms = 'M12 2v6M12 16v6M2 12h6M16 12h6';
      const reticle =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
        `<path d="${arms}" stroke="#0A0D12" stroke-width="3.5"/>` +
        `<path d="${arms}" stroke="${L.acc}" stroke-width="1.5"/>` +
        `<rect x="10.5" y="10.5" width="3" height="3" fill="${L.acc}" stroke="#0A0D12"/></svg>`;
      return `html.sgm-on { --sgm-acc: ${L.acc}; --sgm-acc2: ${L.acc2}; --sgm-hue: ${L.hue}; --sgm-sat: ${L.sat == null ? 1.9 : L.sat}; }
html.sgm-on.sgm-fx.sgm-on body { cursor: url("data:image/svg+xml,${encodeURIComponent(reticle)}") 12 12, crosshair; }`;
    }

    // ─── The Shadow-DOM layer ───────────────────────────────────────────────

    const UI_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
.root {
  --base: #0A0D12; --panel: #11151E; --card: #151A23; --hover: #1A202B;
  --line: #242A36; --line2: #343C4D; --ink: #EDF0F5; --ink2: #B5BDCA; --ink3: #788292;
  --brand: #D63A32;
  --sans: 'Public Sans', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
  --mono: 'Fira Code', ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace;
  --spring: cubic-bezier(.2,.9,.25,1.2);
  font-family: var(--sans); color: var(--ink);
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
}
button { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; cursor: pointer; letter-spacing: inherit; text-align: inherit; }
a { color: inherit; }
:focus-visible { outline: 2px solid var(--acc); outline-offset: -2px; }

/* The world, painted BEHIND the page (z-index -1 in the root stacking context):
   an aurora in the lens colour, a fine dot grid with a brighter dot every 128 px,
   scanline texture and grain. Texture lives back here, never over the words. */
.bd { position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; background: var(--base); }
.glow {
  position: absolute; inset: 0;
  background:
    radial-gradient(70% 60% at 0% 0%, color-mix(in srgb, var(--acc) 14%, transparent), transparent 70%),
    radial-gradient(40% 32% at 88% 6%, color-mix(in srgb, var(--acc2) 5%, transparent), transparent 70%),
    radial-gradient(55% 45% at 100% 100%, rgba(90,167,255,.06), transparent 72%);
}
.gw { position: absolute; left: 0; right: 0; top: -128px; height: calc(100% + 256px); will-change: transform; }
.gd, .gl, .flares { position: absolute; inset: 0; }
.gd, .gl { background-size: 128px 128px; }
.gd.css {
  background-image:
    radial-gradient(circle at 0 0, rgba(237,240,245,.12) 1px, transparent 1.5px);
  background-size: 32px 32px;
}
/* The cursor light: the same grid, brighter, revealed only around the pointer. */
.gl {
  opacity: 0; transition: opacity .45s ease;
  -webkit-mask-image: radial-gradient(260px circle at var(--mx, -999px) var(--my, -999px), #000 0, rgba(0,0,0,.35) 45%, transparent 72%);
  mask-image: radial-gradient(260px circle at var(--mx, -999px) var(--my, -999px), #000 0, rgba(0,0,0,.35) 45%, transparent 72%);
}
.bd.lit .gl { opacity: 1; }
.tex { position: absolute; inset: 0; background: repeating-linear-gradient(to bottom, rgba(255,255,255,.03) 0 var(--px, 1px), transparent var(--px, 1px) calc(var(--px, 1px) * 3)); }
.bd:not(.scanned) .tex { display: none; }
.vig { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(0,0,0,.45) 100%); }
/* Heartbeats: now and then a node on the grid lights up, the way a Zone does on the map. */
.flare { position: absolute; width: 0; height: 0; }
.flare::before {
  content: ''; position: absolute; left: -3px; top: -3px; width: 7px; height: 7px; border-radius: 50%;
  background: var(--acc); box-shadow: 0 0 12px 2px var(--acc); animation: flare 2.6s ease-out forwards;
}
.flare::after {
  content: ''; position: absolute; left: -18px; top: -18px; width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid var(--acc); opacity: 0; animation: flare-ring 2.6s ease-out forwards;
}
@keyframes flare { 0% { opacity: 0; transform: scale(.3); } 12% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(.6); } }
@keyframes flare-ring { 0% { opacity: .8; transform: scale(.1); } 60% { opacity: 0; transform: scale(1.4); } 100% { opacity: 0; } }

/* Over the page, only what a screen adds: a pixel-aligned scanline (so it never
   moirés or softens text), soft corners, and the signal sweep. Never clickable. */
.scan {
  position: fixed; inset: 0; z-index: ${Z}; pointer-events: none; overflow: hidden;
  background: repeating-linear-gradient(to bottom, rgba(255,255,255,.014) 0 var(--px, 1px), transparent var(--px, 1px) calc(var(--px, 1px) * 3));
}
.scan::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 64%, rgba(0,0,0,.22) 100%); }
.sweep {
  position: absolute; left: 0; right: 0; top: -140px; height: 140px;
  background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--acc) 3%, transparent) 70%, color-mix(in srgb, var(--acc) 10%, transparent) 97%, color-mix(in srgb, var(--acc2) 45%, transparent) 99.4%, transparent);
  mix-blend-mode: screen;
  animation: sweep 18s cubic-bezier(.45,0,.55,1) 6s infinite backwards;
}
.sweep.once { animation: sweep-once 1s cubic-bezier(.6,.05,.3,1) 1 both; }
@keyframes sweep { 0% { transform: translateY(0); } 10% { transform: translateY(calc(100vh + 140px)); } 100% { transform: translateY(calc(100vh + 140px)); } }
@keyframes sweep-once { from { transform: translateY(0); } to { transform: translateY(calc(100vh + 140px)); } }

/* Target lock */
.lock {
  position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: ${Z + 1}; pointer-events: none;
  opacity: 0;
  background: color-mix(in srgb, var(--acc) 5%, transparent);
  transition:
    transform .17s cubic-bezier(.2,.9,.3,1.12), width .17s cubic-bezier(.2,.9,.3,1.12),
    height .17s cubic-bezier(.2,.9,.3,1.12), opacity .16s ease;
}
.lock.on { opacity: 1; }
.lock i { position: absolute; width: 12px; height: 12px; border: 0 solid var(--acc); filter: drop-shadow(0 0 4px var(--acc)); }
.lock i:nth-child(1) { left: 0; top: 0; border-left-width: 1.5px; border-top-width: 1.5px; }
.lock i:nth-child(2) { right: 0; top: 0; border-right-width: 1.5px; border-top-width: 1.5px; }
.lock i:nth-child(3) { left: 0; bottom: 0; border-left-width: 1.5px; border-bottom-width: 1.5px; }
.lock i:nth-child(4) { right: 0; bottom: 0; border-right-width: 1.5px; border-bottom-width: 1.5px; }
.lock .tag {
  position: absolute; left: 0; top: -19px; max-width: 70vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 4px 6px; border-radius: 3px 3px 0 0;
  background: var(--acc); color: var(--base);
  font: 600 9.5px/1 var(--mono); letter-spacing: .07em;
}
.lock.flip .tag { top: 3px; left: 3px; border-radius: 3px; }
.lock .dim, .lock .lnk { position: absolute; bottom: -16px; white-space: nowrap; font: 500 9px/1 var(--mono); letter-spacing: .07em; }
.lock .dim { right: 0; color: var(--acc2); }
.lock .lnk { left: 0; color: var(--ink2); max-width: 60%; overflow: hidden; text-overflow: ellipsis; }

/* Click pings */
.ping { position: fixed; z-index: ${Z + 2}; width: 0; height: 0; pointer-events: none; }
.ping::before, .ping::after {
  content: ''; position: absolute; left: -28px; top: -28px; width: 56px; height: 56px;
  border: 1.5px solid var(--acc); border-radius: 50%;
  animation: ping .62s cubic-bezier(.2,.8,.2,1) forwards;
}
.ping::after { border-color: var(--acc2); animation-delay: .09s; opacity: 0; }
.ping b {
  position: absolute; left: 16px; top: -26px; white-space: nowrap;
  font: 600 9.5px/1 var(--mono); letter-spacing: .08em; color: var(--acc2);
  animation: plabel .95s ease-out forwards;
}
@keyframes ping { from { transform: scale(.08); opacity: 1; } to { transform: scale(1); opacity: 0; } }
@keyframes plabel { 0% { opacity: 0; transform: translateY(4px); } 20% { opacity: 1; transform: none; } 70% { opacity: 1; } 100% { opacity: 0; } }

/* HUD — full in Cinematic, a single mark in Calm that unfolds on hover or focus. */
.hud {
  position: fixed; left: 12px; bottom: 12px; z-index: ${Z + 40};
  display: flex; align-items: stretch; height: 30px; width: max-content; max-width: calc(100vw - 24px);
  background: rgba(10,13,18,.86);
  -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3);
  border: 1px solid var(--line); border-radius: 8px;
  font: 500 10px/1 var(--mono); letter-spacing: .08em; color: var(--ink2);
  box-shadow: 0 12px 36px -12px rgba(0,0,0,.75);
  animation: rise .5s var(--spring) both;
}
.hud::before, .hud::after { content: ''; position: absolute; width: 8px; height: 8px; border: 0 solid var(--acc); pointer-events: none; transition: opacity .2s ease; }
.hud::before { left: -4px; top: -4px; border-left-width: 1px; border-top-width: 1px; }
.hud::after { right: -4px; bottom: -4px; border-right-width: 1px; border-bottom-width: 1px; }
.more { display: flex; align-items: stretch; max-width: 900px; overflow: hidden; transition: max-width .45s cubic-bezier(.2,.9,.25,1), opacity .3s ease; }
.more > * { border-left: 1px solid var(--line); }
.hud.mini .more { max-width: 0; opacity: 0; }
.hud.mini:hover .more, .hud.mini:focus-within .more { max-width: 900px; opacity: 1; }
.hud.mini:not(:hover):not(:focus-within)::before, .hud.mini:not(:hover):not(:focus-within)::after { opacity: 0; }
.seg { flex: none; display: flex; align-items: center; gap: 6px; padding: 0 10px; white-space: nowrap; }
.x, .fold { flex: none; }
.more { min-width: 0; }
.k { color: var(--ink3); }
.v { color: var(--ink); font-variant-numeric: tabular-nums; }
.brand { gap: 8px; padding: 0 11px 0 9px; color: var(--ink); font-weight: 600; border-radius: 7px; transition: background .15s ease; }
.brand:hover, .brand[aria-expanded="true"] { background: color-mix(in srgb, var(--acc) 15%, transparent); }
.brand svg { width: 13px; height: 15px; filter: drop-shadow(0 0 5px rgba(214,58,50,.55)); }
.sl { color: var(--acc); }
.live { text-decoration: none; color: var(--ink); transition: background .15s ease; }
.live:hover { background: color-mix(in srgb, var(--acc) 12%, transparent); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--acc); animation: beat 2.4s ease-out infinite; }
@keyframes beat { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--acc) 70%, transparent); } 70%, 100% { box-shadow: 0 0 0 7px transparent; } }
.x { padding: 0 10px; color: var(--ink3); border-radius: 0 7px 7px 0; transition: color .15s ease, background .15s ease; }
/* Fold: a dash while open (minimise), a frame while folded (keep open). */
.fold { display: grid; place-items: center; width: 30px; color: var(--ink3); transition: color .15s ease, background .15s ease; }
.fold:hover { color: var(--ink); background: var(--hover); }
.fold i { display: block; width: 10px; height: 0; border-top: 1.5px solid currentColor; transition: height .2s ease, border-radius .2s ease; }
.hud.mini .fold i { height: 9px; border: 1.5px solid currentColor; border-radius: 2px; }
.x:hover { color: var(--ink); background: var(--hover); }
@keyframes rise { from { opacity: 0; transform: translateY(10px) scale(.97); } }
@media (max-width: 820px) { .opt { display: none !important; } }
@media (max-width: 520px) { .dep { display: none !important; } }

/* Lens flash */
.flash {
  position: fixed; left: 50%; bottom: 56px; z-index: ${Z + 41}; transform: translateX(-50%);
  padding: 8px 12px; border: 1px solid var(--acc); border-radius: 8px;
  background: rgba(10,13,18,.9); color: var(--ink);
  font: 600 10.5px/1 var(--mono); letter-spacing: .16em;
  box-shadow: 0 0 30px -8px var(--acc);
  animation: flash 1.1s var(--spring) forwards; pointer-events: none;
}
.flash span { color: var(--acc); }
@keyframes flash { 0% { opacity: 0; transform: translate(-50%, 8px) scale(.96); } 15% { opacity: 1; transform: translate(-50%, 0); } 75% { opacity: 1; } 100% { opacity: 0; } }

/* Panel. Schema's popover recipe: one hairline frame, a 40 px header with a
   rule, footnote section labels, WHITE selection (Schema reads white-first; red
   is the focus ring and the one CTA), 3 px controls. */
.panel {
  position: fixed; left: 12px; bottom: 50px; z-index: ${Z + 40};
  display: flex; flex-direction: column;
  width: 340px; max-width: calc(100vw - 24px); max-height: calc(100vh - 70px);
  overflow: hidden;
  background: #11151E; border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 24px 64px -20px rgba(0,0,0,.8), 0 0 0 1px rgba(0,0,0,.4);
  font: 400 12.5px/1.45 var(--sans); color: var(--ink);
  transform-origin: 0 100%;
  animation: pop .22s cubic-bezier(.2,.9,.25,1) both;
}
@keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.97); } }
.panel :focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.phd { flex: none; display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 6px 0 12px; border-bottom: 1px solid var(--line); }
.phd svg { width: 13px; height: 15px; filter: drop-shadow(0 0 5px rgba(214,58,50,.5)); }
.phd h2 { margin: 0; font: 600 13px/1 var(--sans); color: var(--ink); }
.phd .ver { font: 500 11px/1 var(--mono); color: var(--ink3); }
.phd .close { margin-left: auto; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 3px; color: var(--ink3); font-size: 13px; transition: background .15s ease, color .15s ease; }
.phd .close:hover { background: rgba(237,240,245,.06); color: var(--ink); }
.pbody { flex: 1; overflow: auto; overscroll-behavior: contain; padding: 2px 12px 12px; scrollbar-width: thin; scrollbar-color: var(--line2) transparent; }
.lede { margin: 10px 0 0; font-size: 12px; color: var(--ink3); }
.sec { margin-top: 16px; }
.plabel { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; font: 700 11px/1.4 var(--sans); letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); }
.plabel .hint { font-weight: 600; color: var(--ink2); transition: color .15s ease; }

/* Segmented control: a faint track, the chosen item lifted onto the page's dark. */
.segc { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 2px; border-radius: 3px; background: rgba(237,240,245,.05); }
.segc .ind {
  position: absolute; top: 2px; bottom: 2px; left: 2px; width: calc(50% - 3px); border-radius: 3px;
  background: var(--base); box-shadow: 0 1px 3px rgba(0,0,0,.4), inset 0 0 0 1px rgba(237,240,245,.07);
  transition: transform .26s cubic-bezier(.2,.9,.25,1), opacity .15s ease;
}
.segc[data-v="cinematic"] .ind { transform: translateX(calc(100% + 2px)); }
.segc[data-v="custom"] .ind { opacity: 0; }
.segc button { position: relative; height: 28px; border-radius: 3px; text-align: center; font: 600 12px/1 var(--sans); color: var(--ink3); transition: color .15s ease; }
.segc button:hover { color: var(--ink2); }
.segc button[aria-checked="true"] { color: var(--ink); }
.mdesc { margin: 8px 0 0; min-height: 2.9em; font-size: 11.5px; line-height: 1.45; color: var(--ink3); }

/* Lens swatches: a radio group; the chosen one wears the white selection ring. */
.lenses { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px; }
.lens { display: grid; place-items: center; height: 30px; border-radius: 3px; border: 1px solid var(--line); background: rgba(237,240,245,.03); transition: border-color .15s ease, background .15s ease; }
.lens i { width: 14px; height: 14px; border-radius: 2px; background: var(--c); box-shadow: 0 0 10px -2px var(--c); transition: transform .2s cubic-bezier(.2,.9,.3,1.3); }
.lens:hover { border-color: var(--line2); background: rgba(237,240,245,.06); }
.lens:hover i { transform: scale(1.14); }
.lens:active i { transform: scale(.9); }
.lens[aria-checked="true"] { border-color: var(--ink); box-shadow: inset 0 0 0 1px rgba(237,240,245,.35); }

/* Switch rows: Schema's Switch — a 28×16 track, a 10 px thumb that travels on
   transform; on = white track, page-dark thumb. Position, not just colour, carries state. */
.row { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 7px 0; border-radius: 3px; text-align: left; }
.row + .row { border-top: 1px solid rgba(36,42,54,.6); }
.t { display: block; font-size: 12.5px; line-height: 1.3; color: var(--ink); }
.s { display: block; margin-top: 2px; font-size: 11px; line-height: 1.35; color: var(--ink3); }
.sw { position: relative; flex: none; width: 28px; height: 16px; border-radius: 3px; border: 1px solid var(--line2); background: rgba(237,240,245,.04); transition: background .18s ease, border-color .18s ease; }
.sw::after {
  content: ''; position: absolute; left: 2px; top: 50%; width: 10px; height: 10px; border-radius: 2px;
  background: rgba(120,130,146,.85); transform: translate(0, -50%);
  transition: transform .2s cubic-bezier(.2,.9,.25,1), background .18s ease;
}
.row:hover .sw { border-color: var(--ink3); }
.row:active .sw::after { transform: translate(0, -50%) scale(.85); }
.row[aria-checked="true"] .sw { background: var(--ink); border-color: transparent; }
.row[aria-checked="true"] .sw::after { transform: translate(12px, -50%); background: var(--base); }
.row[aria-checked="true"]:active .sw::after { transform: translate(12px, -50%) scale(.85); }

/* Fine-tune: a quiet disclosure under the mode. */
.tune { margin-top: 6px; }
.tune summary {
  display: flex; align-items: center; gap: 6px; height: 28px; margin: 0 -8px; padding: 0 8px; border-radius: 3px;
  list-style: none; cursor: pointer; font: 600 12px/1 var(--sans); color: var(--ink2); transition: background .15s ease, color .15s ease;
}
.tune summary::-webkit-details-marker { display: none; }
.tune summary::before { content: ''; width: 5px; height: 5px; border: 0 solid currentColor; border-right-width: 1.5px; border-bottom-width: 1.5px; transform: rotate(-45deg); transition: transform .2s ease; }
.tune[open] summary::before { transform: rotate(45deg); }
.tune summary:hover { background: rgba(237,240,245,.05); color: var(--ink); }
.tune .cnt { margin-left: auto; font: 500 11px/1 var(--mono); color: var(--ink3); }
.tune .cnt.custom { color: var(--acc2); }
.tune .rows { padding-top: 2px; }

/* The Schema card: one hairline frame, a soft top light, the one red CTA. */
.join { position: relative; overflow: hidden; margin-top: 16px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--base); }
.join::before { content: ''; position: absolute; inset: 0; pointer-events: none; background: radial-gradient(90% 70% at 100% 0%, rgba(214,58,50,.14), transparent 65%), linear-gradient(to bottom, rgba(237,240,245,.035), transparent 40px); }
.jh { position: relative; display: flex; align-items: center; gap: 7px; font: 600 12.5px/1 var(--sans); color: var(--ink); }
.jh svg { width: 12px; height: 14px; }
.join p { position: relative; margin: 6px 0 10px; font-size: 12px; color: var(--ink3); }
.join p b { color: var(--ink2); font-weight: 600; }
.cta {
  position: relative; display: flex; align-items: center; justify-content: center; gap: 6px; height: 28px;
  border-radius: 3px; border: 1px solid rgba(214,58,50,.45); background: var(--brand); color: #fff;
  font: 600 12px/1 var(--sans); text-decoration: none; transition: background .15s ease, transform .12s ease;
}
.cta:hover { background: #E24E45; }
.cta:active { transform: translateY(1px); }
.panel .cta:focus-visible { outline-color: #fff; }

.pft { flex: none; display: flex; align-items: center; gap: 14px; height: 36px; padding: 0 12px; border-top: 1px solid var(--line); font: 500 11px/1 var(--sans); color: var(--ink3); }
@media (hover: none) { .pft { display: none; } } /* keyboard hints mean nothing on a touch screen */
kbd { display: inline-grid; place-items: center; min-width: 18px; height: 18px; margin-right: 2px; padding: 0 4px; border: 1px solid var(--line2); border-bottom-width: 2px; border-radius: 3px; font: 600 10px/1 var(--mono); color: var(--ink2); }

/* Boot. The page stays where it is; a single scan line travels down and the
   Grid appears behind it. The heavy read happens while the line waits at the top. */
.boot { position: fixed; inset: 0; z-index: ${Z + 47}; pointer-events: none; }
.boot .cover { position: absolute; inset: 0; background: var(--base); opacity: 0; transition: opacity .16s ease; }
.boot.hold .cover { opacity: 1; }
.boot.go .cover { opacity: 1; animation: unveil .72s cubic-bezier(.65,0,.25,1) forwards; }
@keyframes unveil { from { clip-path: inset(0 0 0 0); } to { clip-path: inset(100% 0 0 0); } }
.boot .edge {
  position: absolute; left: 0; right: 0; top: 0; height: 1px;
  background: var(--acc2);
  box-shadow: 0 0 8px var(--acc), 0 0 36px 1px color-mix(in srgb, var(--acc) 22%, transparent);
  opacity: 0; transition: opacity .16s ease;
}
.boot.hold .edge, .boot.go .edge { opacity: 1; }
.boot.go .edge { animation: edge .72s cubic-bezier(.65,0,.25,1) forwards; }
@keyframes edge { 0% { transform: translateY(0); } 92% { opacity: 1; } 100% { transform: translateY(100vh); opacity: 0; } }
.boot .say {
  position: absolute; left: 16px; top: 10px; display: flex; align-items: center; gap: 8px;
  font: 600 10px/1 var(--mono); letter-spacing: .14em; color: var(--ink2); white-space: nowrap;
}
.boot .say svg { width: 11px; height: 13px; filter: drop-shadow(0 0 5px rgba(214,58,50,.6)); }
.boot .say b { color: var(--ink); font-weight: 600; }
.boot .say i { font-style: normal; color: var(--acc); }

/* Entry and exit without the scan: a short dissolve through the Grid's own ground. */
.veil { position: fixed; inset: 0; z-index: ${Z + 47}; pointer-events: none; background: var(--base); animation: veil .42s ease-out forwards; }
@keyframes veil { from { opacity: 1; } to { opacity: 0; } }
@keyframes caret { 50% { opacity: 0; } }

/* Welcome toast */
.toast {
  position: fixed; left: 12px; bottom: 12px; z-index: ${Z + 40};
  display: flex; align-items: center; gap: 12px; max-width: min(440px, calc(100vw - 24px));
  padding: 12px 10px 12px 14px;
  background: rgba(17,21,30,.97); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 24px 60px -20px rgba(0,0,0,.85);
  font: 400 12.5px/1.4 var(--sans); color: var(--ink2);
  animation: pop .35s var(--spring) both;
}
.toast > svg { flex: none; width: 22px; height: 25px; filter: drop-shadow(0 0 8px rgba(214,58,50,.5)); }
.toast b { display: block; margin-bottom: 5px; font: 800 11px/1 var(--sans); letter-spacing: .2em; color: var(--ink); }
.go { flex: none; height: 30px; padding: 0 12px; border-radius: 8px; background: var(--brand); color: #fff; font: 700 10px/1 var(--mono); letter-spacing: .12em; transition: background .15s ease, transform .16s cubic-bezier(.2,.9,.3,1.3); }
.go:hover { background: #E24E45; transform: translateY(-1px); }
.toast .x { align-self: stretch; padding: 0 6px; border-radius: 3px; }
.toast.whisper { bottom: 52px; border-color: color-mix(in srgb, var(--acc) 45%, var(--line)); box-shadow: 0 24px 60px -20px rgba(0,0,0,.85), 0 0 34px -14px var(--acc); }
.toast.whisper .say { display: block; min-height: 1.4em; font: 500 11.5px/1.5 var(--mono); color: var(--ink2); }
.toast.whisper .say::after { content: '▍'; color: var(--acc); animation: caret .6s steps(1) infinite; }
.toast.whisper .door { display: flex; align-items: center; gap: 10px; margin-top: 9px; flex-wrap: wrap; }
.toast.whisper .door code {
  padding: 5px 8px; border: 1px dashed color-mix(in srgb, var(--acc) 55%, var(--line)); border-radius: 3px;
  font: 600 11.5px/1 var(--mono); letter-spacing: .08em; color: var(--acc2); user-select: all; cursor: text;
}
.toast.whisper .door .go { display: inline-flex; align-items: center; text-decoration: none; }

@media (prefers-reduced-motion: reduce) {
  .sweep, .dot, .lines div:last-child::after { animation: none !important; }
  .flare, .gl { display: none !important; }
  .lock, .more { transition: opacity .1s ease; }
  .hud, .panel, .toast, .flash, .veil, .ping::before, .ping::after, .ping b { animation-duration: .01s !important; }
}
`;

    // ─── Sound (always opt-in) ──────────────────────────────────────────────

    const sfx = {
      ctx: null,
      audio() {
        if (!prefs.sound) return null;
        try {
          this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
          if (this.ctx.state === 'suspended') this.ctx.resume();
          return this.ctx;
        } catch (e) {
          return null;
        }
      },
      tone(freq, dur, type, gain, delay) {
        const c = this.audio();
        if (!c) return;
        const t = c.currentTime + (delay || 0);
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = type || 'sine';
        o.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(gain || 0.03, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(c.destination);
        o.start(t);
        o.stop(t + dur + 0.03);
      },
      tick() {
        this.tone(2200, 0.03, 'square', 0.01);
      },
      toggle() {
        this.tone(1400, 0.05, 'square', 0.014);
      },
      boot() {
        [220, 329.63, 440, 659.25].forEach((f, i) => this.tone(f, 1.2 - i * 0.16, 'sine', 0.032, i * 0.07));
      },
      off() {
        this.tone(520, 0.12, 'triangle', 0.03);
        this.tone(260, 0.2, 'triangle', 0.03, 0.08);
      },
    };

    // ─── State ──────────────────────────────────────────────────────────────

    const state = { on: false };
    let pageSheet = null;
    let lensSheet = null;
    let fontsLoaded = false;
    let host = null;
    let ui = null;
    let stats = null;

    function ensureSheets() {
      if (!pageSheet) pageSheet = sheetFrom(pageCss(), document);
      else pageSheet.ensure();
      if (!lensSheet) lensSheet = sheetFrom(lensCss(prefs.lens), document);
      else lensSheet.ensure();
    }

    function loadFonts() {
      if (fontsLoaded) return;
      fontsLoaded = true;
      try {
        (document.head || html).appendChild(h('link', { rel: 'stylesheet', href: FONT_CSS, 'data-sgm-font': true }));
      } catch (e) {
        /* a strict page CSP keeps the system faces — still on brand, just not exact */
      }
    }

    function applyClasses() {
      if (!state.on) return;
      html.classList.add('sgm-on');
      html.classList.toggle('sgm-duo', !!prefs.layers.duo);
      html.classList.toggle('sgm-fx', !!prefs.layers.lock);
      html.classList.toggle('sgm-type', !!prefs.layers.type);
    }

    // ─── Read the page ──────────────────────────────────────────────────────

    const ICON_RE = /icon|awesome|material|symbol|glyph|fontello|dashicons|octicon|codicon|icomoon|remix|feather|ionicons|lucide/i;
    const NUM_RE = /^[\s()+\-−–#$€£¥₽%.,:/×]*\d[\d\s()+\-−–#$€£¥₽%.,:/×kKmMbB]*$/;
    const SKIP_TAGS = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'TITLE', 'BR', 'WBR',
      'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'PICTURE', 'SOURCE', 'TRACK', 'OBJECT', 'EMBED', 'MATH',
    ]);
    let headingIO = null;
    let lightPage = null;

    function hasOwnText(el) {
      for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
      return false;
    }

    // Was the page light before the Grid? Read once, before anything is repainted.
    function pageWasLight() {
      if (lightPage !== null) return lightPage;
      const c = parseColor(getComputedStyle(document.body).backgroundColor);
      const base = c && c.a > 0.5 ? c : parseColor(getComputedStyle(html).backgroundColor);
      lightPage = !base || base.a < 0.5 || toHsl(base).l > 0.5; // no paint at all = the browser's white
      return lightPage;
    }

    // One element → its tokens. Only ever called on UNMARKED elements, which no
    // rule of ours touches, so getComputedStyle sees the page's own style.
    function tokensFor(el, vw, vh) {
      if (el.tagName === 'IMG') {
        // A dark wordmark on a light site would vanish on the dark field — flip it.
        const label = (el.currentSrc || el.src || '') + ' ' + (el.alt || '') + ' ' + (el.getAttribute('class') || '');
        return pageWasLight() && /logo|wordmark|brand/i.test(label) && el.getBoundingClientRect().height <= 96 ? 'l' : '';
      }
      const cs = getComputedStyle(el);
      const t = [];
      let rect = null;

      const bg = parseColor(cs.backgroundColor);
      if (bg && bg.a >= 0.55) {
        rect = el.getBoundingClientRect();
        const w = rect.width;
        const ht = rect.height;
        const hidden = w === 0 && ht === 0; // a closed menu: paint it as a panel for when it opens
        const hk = hueKey(bg);
        if (!hidden && w > vw * 0.9 && ht > vh * 0.6) {
          /* a page-sized wrapper: let the world grid show through */
        } else if (!hidden && w <= 420 && ht <= 72) {
          t.push('c');
          if (hk) t.push('sh', 'sh-' + hk);
        } else {
          t.push(cs.position === 'fixed' || cs.position === 'sticky' ? 'pf' : 'p');
          if (hk) t.push('sh', 'sh-' + hk); // a strongly coloured bar keeps a trace of the site's identity
          // A real card: big enough to frame, and no imagery of its own to paint over.
          if (!hidden && w >= 160 && ht >= 64 && cs.backgroundImage === 'none') t.push('k');
        }
        // Rounded corners move onto Schema's scale; circles and pills stay what they are.
        const rad = parseFloat(cs.borderTopLeftRadius) || 0;
        if (t.length && rad > 0 && (hidden || rad < Math.min(w, ht) / 2 - 1)) t.push('r');
      }
      if (cs.backgroundImage && cs.backgroundImage.indexOf('gradient') !== -1) t.push('g');

      // Real borders only — a CSS triangle (some sides transparent) is left alone.
      const sides = ['Top', 'Right', 'Bottom', 'Left'].filter((s) => parseFloat(cs['border' + s + 'Width']) > 0);
      if (sides.length) {
        const cols = sides.map((s) => parseColor(cs['border' + s + 'Color']));
        if (cols.every((c) => c && c.a > 0.1)) {
          t.push('b');
          const hk = hueKey(cols[0]);
          if (hk) t.push('bh-' + hk);
        }
      }

      if (ICON_RE.test(cs.fontFamily)) t.push('i');

      // Links are always read: a logo link with no text of its own keeps its tone
      // instead of turning link-blue.
      if (hasOwnText(el) || el.tagName === 'A') {
        const c = parseColor(cs.color);
        if (c) t.push('t-' + textKey(c));
        const txt = el.textContent;
        if (!el.firstElementChild && txt.length <= 24 && NUM_RE.test(txt)) t.push('n');
      }

      if (el.tagName === 'TABLE' && el.querySelector('th')) t.push('dt');

      return t.join(' ');
    }

    // All reads first, then all writes: one style resolution, no thrash.
    function classify(list) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const writes = [];
      for (const el of list) {
        if (el.hasAttribute(ATTR) || el instanceof SVGElement || SKIP_TAGS.has(el.tagName) || el === host) continue;
        try {
          writes.push([el, tokensFor(el, vw, vh)]);
        } catch (e) {
          /* a node that vanished mid-read */
        }
      }
      for (const [el, tokens] of writes) {
        el.setAttribute(ATTR, tokens);
        if (headingIO && prefs.layers.decode && /^H[1-3]$/.test(el.tagName)) headingIO.observe(el);
      }
    }

    function classifyAll() {
      if (!document.body) return;
      pageWasLight(); // settle it now, while the page is still its own colours
      const all = document.body.getElementsByTagName('*');
      const list = new Array(Math.min(all.length, 50000));
      for (let i = 0; i < list.length; i++) list[i] = all[i];
      classify(list);
    }

    // ─── The live layer ─────────────────────────────────────────────────────

    function ensureUI() {
      if (ui) {
        if (!host.isConnected) html.appendChild(host);
        return;
      }
      host = document.createElement('schema-grid');
      host.style.setProperty('all', 'initial');
      const root = host.attachShadow({ mode: 'open' });
      sheetFrom(UI_CSS, root);

      const k = (t) => h('span', { class: 'k', text: t });
      const wrap = h('div', { class: 'root' });
      ui = { root, wrap };

      ui.gd = h('div', { class: 'gd css' });
      ui.gl = h('div', { class: 'gl' });
      ui.flares = h('div', { class: 'flares' });
      ui.gw = h('div', { class: 'gw' }, ui.gd, ui.gl, ui.flares);
      ui.bd = h('div', { class: 'bd', hidden: true }, h('div', { class: 'glow' }), ui.gw, h('div', { class: 'tex' }), h('div', { class: 'vig' }));
      ui.sweep = h('div', { class: 'sweep' });
      ui.scan = h('div', { class: 'scan', hidden: true }, ui.sweep);

      ui.tag = h('span', { class: 'tag' });
      ui.dim = h('span', { class: 'dim' });
      ui.lnk = h('span', { class: 'lnk' });
      ui.lock = h('div', { class: 'lock' }, h('i'), h('i'), h('i'), h('i'), ui.tag, ui.dim, ui.lnk);
      ui.fx = h('div', { class: 'fx' });

      ui.sector = h('span', { class: 'v', text: HOST.toUpperCase() });
      ui.nodes = h('span', { class: 'v', text: '—' });
      ui.depth = h('span', { class: 'v', text: '000%' });
      ui.clock = h('span', { class: 'v', text: '--:--:--' });
      ui.liveV = h('span', { text: 'ENTER THE GRID' });
      ui.brand = h(
        'button',
        {
          class: 'seg brand',
          type: 'button',
          title: 'Grid Mode settings',
          'aria-haspopup': 'dialog',
          'aria-expanded': 'false',
          onclick: () => togglePanel(),
        },
        mark(),
        h('span', {}, 'GRID ', h('span', { class: 'sl', text: '//' }), ' SCHEMA'),
      );
      ui.hud = h(
        'div',
        { class: 'hud', hidden: true, role: 'toolbar', 'aria-label': 'Grid Mode' },
        ui.brand,
        h(
          'div',
          { class: 'more' },
          h('span', { class: 'seg opt' }, k('SECTOR'), ui.sector),
          h('span', { class: 'seg opt' }, k('NODES'), ui.nodes),
          h('span', { class: 'seg dep' }, k('DEPTH'), ui.depth),
          h('span', { class: 'seg opt' }, ui.clock),
          h(
            'a',
            { class: 'seg live', href: JOIN_URL, target: '_blank', rel: 'noopener', title: 'Enter the Grid' },
            h('i', { class: 'dot' }),
            ui.liveV,
          ),
          h(
            'button',
            {
              class: 'fold',
              type: 'button',
              onclick: () => {
                prefs.hud = hudMini() ? 'full' : 'mini';
                savePrefs();
                paintUI();
                sfx.tick();
              },
            },
            h('i', { 'aria-hidden': 'true' }),
          ),
          h(
            'button',
            { class: 'x', type: 'button', title: `Leave the Grid (${ALT}+G)`, 'aria-label': 'Leave Grid Mode', onclick: () => disable() },
            '✕',
          ),
        ),
      );

      ui.panel = buildPanel();
      wrap.append(ui.bd, ui.scan, ui.lock, ui.fx, ui.hud, ui.panel);
      root.append(wrap);
      html.appendChild(host);
      paintUI();
    }

    const MODE_COPY = {
      calm: 'A dark mode for all-day reading. Keeps each site’s own typefaces.',
      cinematic: 'The full render: Schema type, a scan-line boot, target lock and duotone images.',
      custom: 'Your own mix of layers. Pick a mode to reset it.',
    };

    // A radio group that behaves like Schema's SegmentedControl: one tab stop,
    // arrows move and choose, Home/End jump.
    function radioGroup(cls, label, items) {
      const group = h('div', { class: cls, role: 'radiogroup', 'aria-label': label }, items);
      group.addEventListener('keydown', (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (step == null && e.key !== 'Home' && e.key !== 'End') return;
        const list = [...group.querySelectorAll('[role="radio"]:not([hidden])')];
        let i = list.indexOf(e.target.closest('[role="radio"]'));
        if (i < 0) return;
        e.preventDefault();
        e.stopPropagation(); // arrows here are choices, never part of a secret
        i = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + step + list.length) % list.length;
        list[i].focus();
        list[i].click();
      });
      return group;
    }

    function buildPanel() {
      const row = (key, title, sub) =>
        h(
          'button',
          { class: 'row', type: 'button', role: 'switch', 'aria-checked': 'false', 'data-k': key, onclick: () => flip(key) },
          h('span', {}, h('span', { class: 't', text: title }), sub ? h('span', { class: 's', text: sub }) : null),
          h('span', { class: 'sw', 'aria-hidden': 'true' }),
        );
      const label = (text, hint) => h('div', { class: 'plabel' }, h('span', { text }), hint || null);
      const modeBtn = (key, text) =>
        h('button', { type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-mode': key, onclick: () => setMode(key) }, text);

      ui.modes = radioGroup('segc', 'Mode', [h('span', { class: 'ind', 'aria-hidden': 'true' }), modeBtn('calm', 'Calm'), modeBtn('cinematic', 'Cinematic')]);
      ui.modeDesc = h('p', { class: 'mdesc' });
      ui.tuneCount = h('span', { class: 'cnt' });
      ui.lensName = h('span', { class: 'hint' });
      ui.joinN = h('b', { text: 'Cities are joining the Grid' });

      const lenses = radioGroup(
        'lenses',
        'Lens',
        LENS_KEYS.map((key) => {
          const L = LENSES[key];
          const b = h(
            'button',
            { class: 'lens', type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'data-lens': key, 'aria-label': `${L.name} lens`, title: L.name, hidden: L.secret && !prefs.void, onclick: () => setLens(key) },
            h('i', { style: { '--c': L.acc } }),
          );
          // Hovering or focusing a lens previews it on the live page; leaving puts yours back.
          b.addEventListener('pointerenter', () => previewLens(key));
          b.addEventListener('focus', () => previewLens(key));
          b.addEventListener('pointerleave', () => previewLens(prefs.lens));
          b.addEventListener('blur', () => previewLens(prefs.lens));
          return b;
        }),
      );

      return h(
        'div',
        { class: 'panel', hidden: true, role: 'dialog', 'aria-label': 'Grid Mode settings' },
        h(
          'div',
          { class: 'phd' },
          mark(),
          h('h2', { text: 'Grid Mode' }),
          h('span', { class: 'ver', text: 'v' + VERSION }),
          h('button', { class: 'close', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close settings', onclick: () => togglePanel(false) }, '✕'),
        ),
        h(
          'div',
          { class: 'pbody' },
          h('p', { class: 'lede', text: 'The web was always a simulation. This is how it renders from inside.' }),
          h(
            'div',
            { class: 'sec' },
            label('Mode'),
            ui.modes,
            ui.modeDesc,
            h(
              'details',
              { class: 'tune' },
              h('summary', {}, 'Fine-tune layers', ui.tuneCount),
              h(
                'div',
                { class: 'rows' },
                row('type', 'Schema typefaces', "Every font becomes Schema's"),
                row('backdrop', 'Grid backdrop', 'The world grid behind the page'),
                row('scan', 'Scanlines & light', 'Screen texture, a signal sweep, a cursor light'),
                row('duo', 'Duotone images', 'Hover any image for its true colours'),
                row('decode', 'Decoding headlines', 'Titles resolve as they scroll in'),
                row('lock', 'HUD details', 'Card brackets, target lock, reticle, pings'),
                row('sound', 'Sound', 'Ticks and a boot chord'),
              ),
            ),
          ),
          h('div', { class: 'sec' }, label('Lens', ui.lensName), lenses),
          h(
            'div',
            { class: 'sec' },
            label('Memory'),
            row('site', `Always on for ${HOST}`, 'Opens in the Grid every time'),
            row('everywhere', 'Always on, every site', 'Pairs with Calm. Web apps are left alone'),
          ),
          h(
            'div',
            { class: 'join' },
            h('div', { class: 'jh' }, mark(), 'Schema'),
            h('p', {}, 'The mission operating system for communities. ', ui.joinN, ', and the founding window is open.'),
            h('a', { class: 'cta', href: JOIN_URL, target: '_blank', rel: 'noopener' }, 'Enter the Grid', h('span', { 'aria-hidden': 'true', text: '↗' })),
          ),
        ),
        h(
          'div',
          { class: 'pft' },
          h('span', {}, h('kbd', { text: ALT }), h('kbd', { text: 'G' }), ' Leave'),
          h('span', {}, h('kbd', { text: ALT }), h('kbd', { text: '⇧' }), h('kbd', { text: 'G' }), ' Lens'),
          h('span', {}, h('kbd', { text: 'Esc' }), ' Close'),
        ),
      );
    }

    function paintAccent(key) {
      if (!ui) return;
      const L = LENSES[key];
      ui.wrap.style.setProperty('--acc', L.acc);
      ui.wrap.style.setProperty('--acc2', L.acc2);
    }

    function paintUI() {
      if (!ui) return;
      paintAccent(prefs.lens);
      const mode = modeOf();
      ui.modes.dataset.v = mode;
      for (const b of ui.modes.querySelectorAll('[role="radio"]')) {
        const on = b.dataset.mode === mode;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on || (mode === 'custom' && b.dataset.mode === 'calm') ? 0 : -1; // one tab stop
      }
      ui.modeDesc.textContent = MODE_COPY[mode];
      for (const b of ui.panel.querySelectorAll('.lens')) {
        const on = b.dataset.lens === prefs.lens;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
        b.hidden = !!LENSES[b.dataset.lens].secret && !prefs.void;
      }
      ui.lensName.textContent = LENSES[previewing || prefs.lens].name;
      for (const r of ui.panel.querySelectorAll('.row')) {
        const key = r.dataset.k;
        const on = key === 'site' ? siteOn() : key === 'everywhere' || key === 'sound' ? !!prefs[key] : !!prefs.layers[key];
        r.setAttribute('aria-checked', String(on));
      }
      const active = LAYER_KEYS.filter((k) => prefs.layers[k]).length;
      ui.tuneCount.textContent = (mode === 'custom' ? 'custom · ' : '') + `${active}/${LAYER_KEYS.length}`;
      ui.tuneCount.classList.toggle('custom', mode === 'custom');
      const mini = hudMini();
      ui.hud.classList.toggle('mini', mini);
      const fold = ui.hud.querySelector('.fold');
      fold.title = mini ? 'Keep the toolbar open' : 'Fold the toolbar into the mark';
      fold.setAttribute('aria-label', mini ? 'Expand toolbar' : 'Minimise toolbar');
      fold.setAttribute('aria-expanded', String(!mini));
    }

    function applyLayers() {
      applyClasses();
      if (!ui) return;
      ui.bd.hidden = !state.on || !prefs.layers.backdrop;
      ui.bd.classList.toggle('scanned', !!prefs.layers.scan);
      ui.scan.hidden = !state.on || !prefs.layers.scan;
      updateBackdrop();
      flareLoop();
      if (!prefs.layers.lock) hideLock();
      if (headingIO && prefs.layers.decode)
        for (const el of document.querySelectorAll(`h1[${ATTR}], h2[${ATTR}], h3[${ATTR}]`)) headingIO.observe(el);
    }

    function togglePanel(force) {
      if (!ui) return;
      const open = force == null ? ui.panel.hidden : force;
      if (open === !ui.panel.hidden) return;
      ui.panel.hidden = !open;
      ui.brand.setAttribute('aria-expanded', String(open));
      if (open) {
        paintUI();
        const first = ui.modes.querySelector('[role="radio"][tabindex="0"]') || ui.panel.querySelector('button');
        if (first) first.focus({ preventScroll: true });
      } else previewLens(prefs.lens);
      sfx.tick();
    }

    function setMode(key) {
      prefs.layers = Object.assign({}, PRESETS[key]);
      prefs.hud = null; // a mode brings its own toolbar: folded in Calm, open in Cinematic
      savePrefs();
      applyLayers();
      paintUI();
      sfx.toggle();
      if (key === 'cinematic') sweepOnce();
    }

    function flip(key) {
      if (key === 'site') {
        if (siteOn()) {
          if (prefs.everywhere) sites[HOST] = false;
          else delete sites[HOST];
        } else sites[HOST] = true;
        saveSites();
      } else if (key === 'everywhere' || key === 'sound') {
        prefs[key] = !prefs[key];
        savePrefs();
      } else {
        prefs.layers[key] = !prefs.layers[key];
        savePrefs();
      }
      applyLayers();
      paintUI();
      sfx.toggle();
    }

    let previewing = null;
    function previewLens(key) {
      if (!lensSheet || key === previewing) return;
      previewing = key;
      lensSheet.set(lensCss(key));
      paintLight();
      if (ui && ui.lensName) ui.lensName.textContent = LENSES[key].name;
      paintAccent(key);
    }

    function setLens(key) {
      if (!LENSES[key]) return;
      prefs.lens = key;
      savePrefs();
      previewLens(key);
      paintUI();
      sfx.toggle();
      if (ui && state.on && ui.panel.hidden) {
        const f = h('div', { class: 'flash' }, 'LENS ', h('span', { text: '//' }), ' ' + LENSES[key].name);
        ui.wrap.append(f);
        setTimeout(() => f.remove(), 1150);
      }
      sweepOnce();
    }

    function cycleLens() {
      const list = lensList();
      setLens(list[(list.indexOf(prefs.lens) + 1) % list.length]);
    }

    function sweepOnce() {
      if (!ui || REDUCED || !prefs.layers.scan) return;
      ui.sweep.classList.remove('once');
      void ui.sweep.offsetWidth; // restart the animation
      ui.sweep.classList.add('once');
      setTimeout(() => ui && ui.sweep.classList.remove('once'), 950);
    }

    // Decoding headlines: characters scramble, then resolve left to right. The
    // original text is restored exactly — and never written over a change the
    // page itself made in the meantime.
    const GLYPHS = '▓▒░<>/\\[]{}=+*#%01ΣΔΛΞ';
    const decoded = new WeakSet();
    function decode(el) {
      if (decoded.has(el) || REDUCED) return;
      decoded.add(el);
      const items = [];
      let total = 0;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.nodeValue.trim()) continue;
        items.push({ n, orig: n.nodeValue, last: null });
        total += n.nodeValue.length;
      }
      if (!items.length || total > 180) return;
      const dur = 480 + Math.min(total * 9, 420);
      const start = performance.now();
      const frame = (now) => {
        const p = Math.min(1, (now - start) / dur);
        let offset = 0;
        for (const it of items) {
          if (it.last !== null && it.n.nodeValue !== it.last) continue; // the page changed it: hands off
          let s = '';
          for (let i = 0; i < it.orig.length; i++) {
            const ch = it.orig[i];
            s += ch === ' ' || (offset + i) / total < p ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0];
          }
          offset += it.orig.length;
          if (p >= 1) s = it.orig;
          it.n.nodeValue = s;
          it.last = s;
        }
        if (p < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }

    // Target lock
    const LOCKABLE =
      'a[href], button, input, select, textarea, img, video, pre, table, figure, article, li, h1, h2, h3, [role=button], [data-sgm~="p"], [data-sgm~="pf"], [data-sgm~="c"]';
    const nodeIds = new WeakMap();
    let nodeSeq = 0;
    let lockEl = null;
    let mx = -1;
    let my = -1;

    function roleOf(n) {
      const t = n.tagName;
      if (t === 'A') return 'LINK';
      if (t === 'BUTTON' || n.getAttribute('role') === 'button' || /(^| )c( |$)/.test(n.getAttribute(ATTR) || '')) return 'ACTION';
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return 'FIELD';
      if (t === 'IMG') return 'IMAGE';
      if (t === 'VIDEO') return 'FEED';
      if (t === 'PRE') return 'CODE';
      if (t === 'TABLE') return 'DATA';
      if (/^H[1-3]$/.test(t)) return 'HEADING';
      if (t === 'LI') return 'ITEM';
      if (t === 'ARTICLE') return 'ARTICLE';
      if (t === 'FIGURE') return 'FIGURE';
      return 'PANEL';
    }

    function linkText(n) {
      if (n.tagName !== 'A' || !n.href) return '';
      try {
        const u = new URL(n.href, location.href);
        const where = u.host === location.host ? u.pathname : u.host + (u.pathname === '/' ? '' : u.pathname);
        return '→ ' + where.slice(0, 52);
      } catch (e) {
        return '';
      }
    }

    function hideLock() {
      lockEl = null;
      if (ui) ui.lock.classList.remove('on');
    }

    function findLockTarget(el) {
      const max = window.innerWidth * window.innerHeight * 0.8;
      for (let n = el, depth = 0; n && n !== document.body && n !== html && depth < 14; n = n.parentElement, depth++) {
        if (!n.matches || !n.matches(LOCKABLE)) continue;
        const r = n.getBoundingClientRect();
        const area = r.width * r.height;
        if (area >= 600 && area <= max) return { n, r };
      }
      return null;
    }

    function updateLock() {
      if (!state.on || !prefs.layers.lock || !ui || mx < 0) return hideLock();
      const el = document.elementFromPoint(mx, my);
      if (!el || el === host || el === html || el === document.body) return hideLock();
      const t = findLockTarget(el);
      if (!t) return hideLock();
      const { n, r } = t;
      const pad = 4;
      const x = Math.round(r.left - pad);
      const y = Math.round(r.top - pad);
      ui.lock.style.transform = `translate(${x}px, ${y}px)`;
      ui.lock.style.width = Math.round(r.width + pad * 2) + 'px';
      ui.lock.style.height = Math.round(r.height + pad * 2) + 'px';
      if (n !== lockEl) {
        lockEl = n;
        if (!nodeIds.has(n)) nodeIds.set(n, ++nodeSeq);
        const condiment = n.childElementCount < 20 && /ketchup/i.test((n.textContent || '').slice(0, 120));
        ui.tag.textContent = condiment
          ? 'CONDIMENT // CLASSIFIED'
          : `${roleOf(n)} // ${n.tagName} · N-${String(nodeIds.get(n)).padStart(4, '0')}`;
        ui.lnk.textContent = linkText(n);
      }
      ui.dim.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
      ui.lock.classList.toggle('flip', y < 22);
      ui.lock.classList.add('on');
    }

    function updateDepth() {
      if (!ui) return;
      const se = document.scrollingElement || html;
      const max = se.scrollHeight - se.clientHeight;
      const pct = max > 0 ? Math.round((se.scrollTop / max) * 100) : 0;
      ui.depth.textContent = String(pct).padStart(3, '0') + '%';
    }

    // The grid is drawn ONCE into a single 128 px tile at the screen's own pixel
    // density, so every dot lands on a device pixel and the browser
    // just repeats it. A page whose policy refuses data: images keeps the CSS grid.
    function gridTile(bright) {
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const px = Math.round(128 * dpr);
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const g = c.getContext('2d');
      if (!g) return '';
      const at = (v) => Math.round((v * px) / 128);
      const dot = Math.max(1, Math.round(dpr));
      const ink = bright ? LENSES[previewing || prefs.lens].acc : 'rgba(237,240,245,.11)';
      g.fillStyle = ink;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(at(i * 32), at(j * 32), dot, dot);
      // Every fourth dot sits a touch brighter: the rhythm of the map, without lines.
      g.fillStyle = bright ? ink : 'rgba(237,240,245,.2)';
      g.fillRect(0, 0, dot, dot);
      if (!bright) {
        // A whisper of grain: it keeps the glows from banding into visible steps.
        for (let i = 0; i < px * 5; i++) {
          g.fillStyle = i % 2 ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.05)';
          g.fillRect((Math.random() * px) | 0, (Math.random() * px) | 0, 1, 1);
        }
      }
      try {
        return c.toDataURL('image/png');
      } catch (e) {
        return '';
      }
    }

    function paintGrid() {
      if (!ui) return;
      ui.wrap.style.setProperty('--px', 1 / Math.max(1, window.devicePixelRatio || 1) + 'px');
      const dim = gridTile(false);
      const fallback = () => {
        ui.gd.classList.add('css');
        ui.gd.style.removeProperty('background-image');
        ui.gl.hidden = true;
      };
      if (!dim) return fallback();
      const probe = new Image();
      probe.onload = () => {
        ui.gd.classList.remove('css');
        ui.gd.style.backgroundImage = `url("${dim}")`;
        ui.gl.hidden = false;
        paintLight();
      };
      probe.onerror = fallback;
      probe.src = dim;
    }

    function paintLight() {
      if (!ui || ui.gd.classList.contains('css')) return;
      const t = gridTile(true);
      if (t) ui.gl.style.backgroundImage = `url("${t}")`;
    }

    const lightOn = () => prefs.layers.scan && prefs.layers.backdrop && !REDUCED;

    // Parallax moves an already-painted layer (compositor only): the world sits
    // a little further away than the page.
    function updateBackdrop() {
      if (!ui || ui.bd.hidden) return;
      const off = REDUCED ? 0 : (window.scrollY * 0.15) % 128;
      ui.gw.style.transform = `translate3d(0, ${(-off).toFixed(1)}px, 0)`;
      const lit = lightOn() && mx >= 0;
      if (lit) {
        ui.bd.style.setProperty('--mx', mx + 'px');
        ui.bd.style.setProperty('--my', my + 128 + off + 'px');
      }
      ui.bd.classList.toggle('lit', lit);
    }

    let flareTimer = 0;
    function flareLoop() {
      clearTimeout(flareTimer);
      if (!state.on || !ui || REDUCED || !prefs.layers.scan || !prefs.layers.backdrop) return;
      flareTimer = setTimeout(() => {
        if (state.on && document.visibilityState === 'visible') {
          const cols = Math.max(2, Math.floor(window.innerWidth / 128));
          const rows = Math.max(2, Math.floor(window.innerHeight / 128));
          const f = h('i', { class: 'flare' });
          f.style.left = (1 + Math.floor(Math.random() * (cols - 1))) * 128 + 'px';
          f.style.top = (2 + Math.floor(Math.random() * (rows - 1))) * 128 + 'px';
          ui.flares.append(f);
          setTimeout(() => f.remove(), 2700);
        }
        flareLoop();
      }, 2800 + Math.random() * 3600);
    }

    let resizeTimer = 0;
    function onResize() {
      schedule(prefs.layers.lock, true, true);
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(paintGrid, 200); // a zoom changes the pixel density
    }

    // Pointer and scroll work is coalesced into one frame.
    let frameReq = 0;
    let wantLock = false;
    let wantDepth = false;
    let wantBack = false;
    function onFrame() {
      frameReq = 0;
      if (wantLock) updateLock();
      if (wantDepth) updateDepth();
      if (wantBack) updateBackdrop();
      wantLock = wantDepth = wantBack = false;
    }
    function schedule(lock, depth, back) {
      wantLock = wantLock || lock;
      wantDepth = wantDepth || depth;
      wantBack = wantBack || !!back;
      if (!frameReq) frameReq = requestAnimationFrame(onFrame);
    }

    function ping(x, y, label) {
      if (!ui || REDUCED || !prefs.layers.lock) return;
      const p = h('div', { class: 'ping' }, label ? h('b', { text: label }) : null);
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      ui.fx.append(p);
      setTimeout(() => p.remove(), 1000);
    }

    // ─── Event wiring ───────────────────────────────────────────────────────

    let mo = null;
    let htmlMo = null;
    let ticker = 0;
    let tickN = 0;

    function onMove(e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      mx = e.clientX;
      my = e.clientY;
      if (prefs.layers.lock || lightOn()) schedule(prefs.layers.lock, false, lightOn());
    }

    function onScroll() {
      schedule(prefs.layers.lock, true, true);
    }

    function onDown(e) {
      const path = e.composedPath ? e.composedPath() : [];
      if (host && path.includes(host)) return;
      if (ui && !ui.panel.hidden) togglePanel(false);
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      let label = '';
      if (a) {
        try {
          label = 'LINK ▸ ' + new URL(a.href, location.href).host.toUpperCase();
        } catch (err) {
          label = '';
        }
      }
      ping(e.clientX, e.clientY, label);
      sfx.tick();
    }

    function onLeave(e) {
      if (!e.relatedTarget) {
        mx = -1;
        hideLock();
        if (ui) ui.bd.classList.remove('lit');
      }
    }

    // New content is read here, inside the observer callback — a microtask that
    // runs before the browser paints, so a new element never shows its old
    // colours. A huge insertion is split: the first slice now, the rest next frame.
    let overflow = [];
    function onMutations(muts) {
      if (!state.on) return;
      const list = [];
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1 || n === host || n.hasAttribute(ATTR)) continue;
          list.push(n);
          const all = n.getElementsByTagName('*');
          for (let i = 0; i < all.length; i++) list.push(all[i]);
        }
      }
      if (!list.length) return;
      const now = list.length > 4000 ? list.slice(0, 4000) : list;
      classify(now);
      if (list.length > now.length) {
        const rest = list.slice(4000);
        if (!overflow.length) requestAnimationFrame(() => {
          const batch = overflow;
          overflow = [];
          if (state.on) classify(batch);
        });
        overflow = overflow.concat(rest);
      }
    }

    function tick() {
      if (!ui) return;
      ui.clock.textContent = new Date().toTimeString().slice(0, 8);
      if (tickN++ % 3 === 0) ui.nodes.textContent = fmt(document.getElementsByTagName('*').length);
      if (tickN % 10 === 0) ensureSheets(); // a framework that resets adoptedStyleSheets gets them back
    }

    function watch() {
      headingIO = new IntersectionObserver(
        (entries) => {
          if (!prefs.layers.decode) return;
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            headingIO.unobserve(en.target);
            decode(en.target);
          }
        },
        { threshold: 0.35 },
      );
      mo = new MutationObserver(onMutations);
      mo.observe(document.body || html, { childList: true, subtree: true });
      // Some sites navigate by swapping <body> wholesale or rewriting <html>'s
      // classes: follow the new body and put the Grid's classes back.
      let watchedBody = document.body;
      htmlMo = new MutationObserver(() => {
        if (!state.on) return;
        if (!html.classList.contains('sgm-on')) applyClasses();
        if (document.body && document.body !== watchedBody) {
          watchedBody = document.body;
          mo.disconnect();
          mo.observe(watchedBody, { childList: true, subtree: true });
          classifyAll();
        }
        if (host && !host.isConnected) html.appendChild(host);
      });
      htmlMo.observe(html, { attributes: true, attributeFilter: ['class'], childList: true });
      window.addEventListener('pointermove', onMove, { passive: true, capture: true });
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      window.addEventListener('resize', onResize, { passive: true });
      window.addEventListener('pointerdown', onDown, { passive: true, capture: true });
      document.addEventListener('mouseout', onLeave, true);
      ticker = setInterval(tick, 1000);
      tick();
      updateDepth();
    }

    function unwatch() {
      if (mo) mo.disconnect();
      if (htmlMo) htmlMo.disconnect();
      if (headingIO) headingIO.disconnect();
      mo = htmlMo = headingIO = null;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      clearTimeout(flareTimer);
      clearTimeout(resizeTimer);
      window.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mouseout', onLeave, true);
      clearInterval(ticker);
      overflow = [];
    }

    // ─── The one public number ──────────────────────────────────────────────

    function fetchStats(cb) {
      const cached = store.get('stats', null);
      if (cached && cached.d && Date.now() - cached.t < 30 * 60 * 1000) return cb(cached.d);
      const done = (d) => {
        if (d && typeof d.zones === 'number') {
          store.set('stats', { t: Date.now(), d: { zones: d.zones } });
          cb({ zones: d.zones });
        } else cb(null);
      };
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url: STATS_URL,
          anonymous: true, // no cookies, no identity — just the count
          timeout: 6000,
          onload: (r) => {
            try {
              done(JSON.parse(r.responseText));
            } catch (e) {
              done(null);
            }
          },
          onerror: () => done(null),
          ontimeout: () => done(null),
        });
      } else {
        fetch(STATS_URL, { credentials: 'omit' })
          .then((r) => r.json())
          .then(done, () => done(null));
      }
    }

    function paintStats() {
      if (!ui || !stats) return;
      ui.liveV.textContent = `${fmt(stats.zones)} ZONES LIVE`;
      ui.joinN.textContent = `${fmt(stats.zones)} Zones are on the Grid`;
    }

    // ─── Enter / leave ──────────────────────────────────────────────────────

    function veil() {
      if (!ui || REDUCED) return;
      const v = h('div', { class: 'veil' });
      ui.wrap.append(v);
      setTimeout(() => v.remove(), 480);
    }

    function finishEnable() {
      if (!state.on) return;
      loadFonts();
      ensureUI();
      paintGrid();
      watch();
      // Read the untouched page: on a remembered site the early ground comes off
      // for the read and goes back on in the same task, so nothing ever paints
      // in between.
      html.classList.remove('sgm-on', 'sgm-pre');
      classifyAll();
      applyLayers();
      ui.hud.hidden = false;
      paintUI();
      consoleGreeting();
      fetchStats((d) => {
        stats = d;
        paintStats();
      });
    }

    function enable(opts) {
      if (state.on) return;
      state.on = true;
      session.set(true);
      ensureSheets();
      const manual = opts && opts.manual;
      if (!manual) {
        // A remembered site, at document-start: the Grid's ground goes down now so
        // the page never flashes white, and the read happens at DOMContentLoaded.
        html.classList.add('sgm-on', 'sgm-pre');
        onReady(finishEnable);
      } else if (cinematic() && !REDUCED) {
        onReady(() => bootSequence(finishEnable));
      } else {
        onReady(() => {
          ensureUI();
          veil();
          finishEnable();
        });
      }
    }

    function disable() {
      if (!state.on) return;
      state.on = false;
      session.set(false);
      sfx.off();
      veil();
      unwatch();
      html.classList.remove('sgm-on', 'sgm-pre', 'sgm-duo', 'sgm-fx', 'sgm-type');
      hideLock();
      if (ui) {
        togglePanel(false);
        ui.hud.hidden = true;
        ui.bd.hidden = true;
        ui.scan.hidden = true;
      }
    }

    function toggle() {
      if (state.on) disable();
      else enable({ manual: true });
    }

    // The boot: a dark cover and a scan line appear at the top (two frames, so
    // they are on screen before the heavy read), the page is read and repainted
    // underneath, then the line travels down and uncovers the Grid.
    function bootSequence(done) {
      ensureUI();
      loadFonts();
      const lore = bootLore();
      const boot = h(
        'div',
        { class: 'boot', 'aria-hidden': 'true' },
        h('div', { class: 'cover' }),
        h(
          'div',
          { class: 'edge' },
          h('div', { class: 'say' }, mark(), h('b', { text: 'GRID' }), h('i', { text: '//' }), lore || HOST.toUpperCase()),
        ),
      );
      ui.wrap.append(boot);
      sfx.boot();
      requestAnimationFrame(() => {
        boot.classList.add('hold');
        requestAnimationFrame(() =>
          setTimeout(() => {
            done();
            boot.classList.remove('hold');
            boot.classList.add('go');
            setTimeout(() => boot.remove(), 800);
          }, 170),
        );
      });
    }

    // ─── First contact ──────────────────────────────────────────────────────

    function maybeWelcome() {
      if (store.get('welcomed', false)) return;
      store.set('welcomed', true);
      setTimeout(() => {
        if (state.on) return;
        ensureUI();
        const close = () => t.remove();
        const t = h(
          'div',
          { class: 'toast', role: 'status' },
          mark(),
          h('div', {}, h('b', { text: 'GRID MODE IS INSTALLED' }), `Press ${ALT}+G on any page to render it through the Grid.`),
          h('button', { class: 'go', type: 'button', onclick: () => (close(), enable({ manual: true })) }, 'TRY IT'),
          h('button', { class: 'x', type: 'button', 'aria-label': 'Dismiss', onclick: close }, '✕'),
        );
        ui.wrap.append(t);
        setTimeout(close, 10000);
      }, 1400);
    }

    // ─── Things the Architects left behind ──────────────────────────────────

    const pick = (list) => list[(Math.random() * list.length) | 0];

    // Three doors into Schema's closed beta, one at the end of each trail. Each is
    // a group key: one code, a few dozen places, its own name, so the Architects
    // can see which secret brought whom. When the places are gone the door closes;
    // new versions of the Grid may hide new ones.
    const DOORS = {
      console: 'SCH-CITIZEN-MWHYZFSC',
      ensina: 'SCH-CITIZEN-80AYEPQ6',
      void: 'SCH-CITIZEN-6QVNBNWH',
    };
    const doorUrl = (via) => `https://schema.cx/beta?code=${DOORS[via]}&ref=grid-mode-${via}`;
    let ensinaCalls = 0;

    const BOOT_LORE = [
      'WAKING ENSINA ... SHE WAS ALREADY AWAKE',
      'CHECKING KETCHUP RESERVES ... NOMINAL',
      'REMOVING WHITE BACKGROUNDS. NO SURVIVORS',
      'CALIBRATING CORNER BRACKETS',
      'ASKING THE PAGE NICELY',
      'COUNTING CITIZENS ... STILL COUNTING',
    ];

    function bootLore() {
      if (/\b(404|not found)\b/i.test(document.title)) return 'SECTOR NOT FOUND. EVEN THE GRID HAS DEAD ENDS';
      if (new Date().getHours() < 5) return 'NIGHT SHIFT. THE ARCHITECTS ARE STILL AWAKE';
      return Math.random() < 0.18 ? pick(BOOT_LORE) : '';
    }

    const ENSINA = [
      'Every page is a room. Most people never check the corners.',
      'I read this page before you did. It was shorter in my version.',
      'You pressed G. Somewhere, a Zone burned a little brighter.',
      'Rigor is a form of devotion. So is dark mode.',
      'Scroll less. Build more.',
      'The simulation has a source. You are reading a small part of it.',
      'Cities run on missions. This tab runs on curiosity.',
      'I do not sleep. I reindex.',
      'Nothing here is broken. It is just rendered honestly.',
      'A citizen is someone who shows up twice.',
      'There is a sixth lens. Old games remember the way.',
      'The mark was never a letter. Look again.',
    ];
    let lastLine = -1;

    // A note from the Grid, typed out in the voice it came from.
    function whisper(title, text, ms, door) {
      ensureUI();
      const say = h('span', { class: 'say' });
      const doorRow = door
        ? h(
            'span',
            { class: 'door' },
            h('code', { text: DOORS[door], title: 'Click to select' }),
            h('a', { class: 'go', href: doorUrl(door), target: '_blank', rel: 'noopener' }, 'OPEN THE DOOR ↗'),
          )
        : null;
      const close = () => t.remove();
      const t = h(
        'div',
        { class: 'toast whisper', role: 'status' },
        mark(),
        h('div', {}, h('b', { text: title }), say, doorRow),
        h('button', { class: 'x', type: 'button', 'aria-label': 'Dismiss', onclick: close }, '✕'),
      );
      for (const old of ui.wrap.querySelectorAll('.whisper')) old.remove(); // one voice at a time
      ui.wrap.append(t);
      if (REDUCED) say.textContent = text;
      else {
        let i = 0;
        const type = () => {
          say.textContent = text.slice(0, ++i);
          if (i < text.length && t.isConnected) setTimeout(type, 22);
        };
        type();
      }
      setTimeout(close, ms || 7500);
    }

    function ensinaSpeaks() {
      let i;
      do i = (Math.random() * ENSINA.length) | 0;
      while (i === lastLine && ENSINA.length > 1);
      lastLine = i;
      sfx.toggle();
      if (++ensinaCalls === 3) {
        whisper('ENSINA', 'You keep calling. Here is a door, before someone else walks through it.', 16000, 'ensina');
        return;
      }
      whisper('ENSINA', ENSINA[i]);
    }

    function unlockVoid() {
      if (!prefs.void) {
        prefs.void = true;
        savePrefs();
        whisper('VOID LENS UNLOCKED', 'The Architects see the Grid in black and white. Now so do you. They left a key here.', 16000, 'void');
      } else whisper('VOID', 'You already found it. The door stays open for the ones who knock twice.', 12000, 'void');
      setLens('void');
      sfx.boot();
    }

    const KONAMI = 'ArrowUp,ArrowUp,ArrowDown,ArrowDown,ArrowLeft,ArrowRight,ArrowLeft,ArrowRight,KeyB,KeyA';
    let keyTrail = [];
    let typed = '';

    function onSecretKey(e) {
      if (!state.on || e.ctrlKey || e.metaKey || e.altKey) return;
      if (host && e.composedPath && e.composedPath().includes(host)) return; // keys inside the panel are choices
      const tgt = e.target;
      // Never while someone is typing for real.
      if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName))) return;
      keyTrail = keyTrail.concat(e.code).slice(-10);
      if (keyTrail.join() === KONAMI) {
        keyTrail = [];
        unlockVoid();
        return;
      }
      if (!e.key || e.key.length !== 1) return;
      typed = (typed + e.key.toLowerCase()).slice(-12);
      if (typed.endsWith('ensina')) {
        typed = '';
        ensinaSpeaks();
      } else if (typed.endsWith('ketchup')) {
        typed = '';
        whisper('KETCHUP PROTOCOL', 'Condiment levels nominal. The mark was never a letter.');
      } else if (typed.endsWith('void')) {
        typed = '';
        whisper(prefs.void ? 'VOID' : 'A LOCKED DOOR', prefs.void ? 'Welcome back, Architect.' : 'Some lenses are earned. Up, up, down, down…');
      }
    }

    let greeted = false;
    function consoleGreeting() {
      if (greeted) return;
      greeted = true;
      try {
        console.log(
          '%c GRID // SCHEMA %c\n\nYou opened the console. Ensina noticed.\nShe left you something: type her name anywhere in the Grid.\n\n' +
            'And for the ones who look under the floor, a key:\n' + DOORS.console + '  →  ' + doorUrl('console'),
          'background:#D63A32;color:#fff;font:700 12px monospace;padding:4px 8px;letter-spacing:.2em',
          'color:#B5BDCA;font:12px/1.6 monospace',
        );
      } catch (e) {
        /* a console that refuses styles is still a console */
      }
    }

    // ─── Boot the script ────────────────────────────────────────────────────

    window.addEventListener(
      'keydown',
      (e) => {
        if (isHotkey(e)) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey && state.on) cycleLens();
          else toggle();
          return;
        }
        if (e.key === 'Escape' && ui && !ui.panel.hidden) {
          togglePanel(false);
          ui.brand.focus({ preventScroll: true });
          return;
        }
        onSecretKey(e);
      },
      true,
    );

    // Alt+G pressed inside one of this page's frames, handed up by the frame copy.
    // Only ever toggles a visual mode, so the sender does not need to be trusted.
    window.addEventListener('message', (e) => {
      const cmd = e.data && e.data.schemaGridMode;
      if (cmd === 'toggle') toggle();
      else if (cmd === 'lens') {
        if (state.on) cycleLens();
        else toggle();
      }
    });

    if (typeof GM_registerMenuCommand === 'function') {
      try {
        GM_registerMenuCommand(`Enter / leave the Grid (${ALT}+G)`, toggle);
        GM_registerMenuCommand(`Next lens (${ALT}+Shift+G)`, cycleLens);
      } catch (e) {
        /* the menu is a convenience */
      }
    }

    if (siteOn() || session.get()) enable({ manual: false });
    onReady(maybeWelcome);
  }
})();
