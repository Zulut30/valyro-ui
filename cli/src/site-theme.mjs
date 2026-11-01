// A ValyroUI theme fitted to a client's site: reads brand decisions from their CSS (custom
// properties and a few base rules), turns them into createThemeCSS options, checks WCAG AA contrast
// of the result and fixes what fails. Pure apart from fetchSiteCss, which only reads the URLs it is
// given (stylesheets, or the inline <style> blocks of an HTML page) and never runs scripts.

import { LIBRARY_PACKAGE, SITE_URL, THEMES, THEME_FONTS } from './constants.mjs';
import {
  contrastOf,
  createThemeCSS,
  createThemeTokens,
  formatColor,
  fromOklch,
  parseColor,
  THEME_DEFAULTS,
  tintNeutral,
  toOklch,
} from './generated/create-theme-css.mjs';
import { CliError } from './registry.mjs';

/** Base themes createThemeCSS can refine (the Theme Builder's bases). */
export const BUILDER_BASES = THEMES.filter((name) => name in THEME_DEFAULTS);
export const DENSITIES = ['compact', 'default', 'comfortable'];
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;
const MAX_CSS_CHARS = 2_000_000;
const MAX_URLS = 5;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const round2 = (v) => Math.round(v * 100) / 100;
const ratio = (v) => `${v.toFixed(2)}:1`;

// ── Colours ──────────────────────────────────────────────────────────────────────────────────────

const NAMED = { white: '#ffffff', black: '#000000' };

function hslToRgba(h, s, l, a = 1) {
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => light - sat * Math.min(light, 1 - light) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: 255 * f(0), g: 255 * f(8), b: 255 * f(4), a: clamp(a, 0, 1) };
}

const alphaOf = (raw) => (raw === undefined ? 1 : raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw));

/**
 * Any colour a site stylesheet is likely to hold: hex (3, 4, 6, 8 digits), rgb(a), hsl(a), oklch(),
 * shadcn-style bare HSL triplets (`222 47% 11%`) and white/black. `null` for anything else.
 */
export function parseCssColor(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().toLowerCase().replace(/\s*!important$/, '');
  if (NAMED[s]) return parseColor(NAMED[s]);
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (short) return parseColor(`#${short.slice(1).map((c) => c + c).join('')}`);
  const direct = parseColor(s);
  if (direct) return direct;
  const num = String.raw`(-?[\d.]+)`;
  let m = new RegExp(String.raw`^hsla?\(\s*${num}(?:deg)?[\s,]+${num}%[\s,]+${num}%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$`).exec(s);
  if (m) return hslToRgba(Number(m[1]), Number(m[2]), Number(m[3]), alphaOf(m[4]));
  m = new RegExp(String.raw`^${num}(?:deg)?\s+${num}%\s+${num}%(?:\s*/\s*([\d.]+%?))?$`).exec(s);
  if (m) return hslToRgba(Number(m[1]), Number(m[2]), Number(m[3]), alphaOf(m[4]));
  m = new RegExp(String.raw`^oklch\(\s*${num}(%?)\s+${num}(%?)\s+${num}(?:deg)?(?:\s*/\s*([\d.]+%?))?\s*\)$`).exec(s);
  if (m) {
    const L = Number(m[1]) / (m[2] ? 100 : 1);
    const C = Number(m[3]) * (m[4] ? 0.004 : 1);
    return fromOklch(clamp(L, 0, 1), Math.max(0, C), Number(m[5]), alphaOf(m[6]));
  }
  return null;
}

/** `#rrggbb` of an opaque colour, or `null`. */
function toHex(value) {
  const color = parseCssColor(value);
  return color && color.a >= 0.99 ? formatColor({ ...color, a: 1 }) : null;
}

// ── Reading site CSS ─────────────────────────────────────────────────────────────────────────────

/** Rules of a stylesheet: selector, declarations and the at-rules around them (`@media …`). */
export function parseCssRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const stack = [];
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      stack.push(buf.trim());
      buf = '';
    } else if (ch === '}') {
      const prelude = stack.pop();
      if (prelude && !prelude.startsWith('@')) {
        const declarations = [];
        for (const part of buf.split(';')) {
          const i = part.indexOf(':');
          if (i > 0) declarations.push([part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim()]);
        }
        rules.push({ selector: prelude, declarations, atRules: stack.filter((p) => p.startsWith('@')) });
      }
      buf = '';
    } else {
      buf += ch;
    }
  }
  return rules;
}

const DARK_CONTEXT = /prefers-color-scheme\s*:\s*dark|\.dark\b|\[data-(?:theme|mode|bs-theme)=["']?dark|\.theme-dark|\[class~=["']?dark/i;
const ROOT_SELECTOR = /^(?::root|html|body|:host|\*|\[data-theme[^\]]*\]|\.light|\[data-bs-theme=["']?light["']?\]|:root\s*,\s*\[data-theme[^\]]*\])$/i;
const isLength = (v) => /^-?[\d.]+(px|rem|em)$/.test(v.trim());

/** px of a `12px` / `0.75rem` / `1em` length (rem and em at 16px), else `null`. */
export function lengthToPx(value) {
  const m = /^(-?[\d.]+)(px|rem|em)?$/.exec(String(value).trim());
  if (!m) return null;
  return Number(m[1]) * (m[2] === 'px' || m[2] === undefined ? 1 : 16);
}

/** Replaces `var(--x, fallback)` with the values in `vars` (a Map), nested up to 8 levels. */
export function resolveVars(value, vars, depth = 0) {
  if (depth > 8 || !value.includes('var(')) return value;
  let out = '';
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf('var(', i);
    if (start === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, start);
    let level = 0;
    let end = start + 3;
    for (; end < value.length; end++) {
      if (value[end] === '(') level++;
      else if (value[end] === ')' && --level === 0) break;
    }
    const inner = value.slice(start + 4, end);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? '' : inner.slice(comma + 1).trim();
    const found = vars.get(name);
    out += resolveVars(found ?? fallback, vars, depth + 1);
    i = end + 1;
  }
  return out.trim();
}

const PICKS = {
  accent: [/^--(?:color-)?(?:brand|primary)(?:-color)?(?:-500|-600|-default)?$/, /^--bs-primary$/, /^--(?:color-)?accent(?:-color)?$/, /^--[\w-]*(?:brand|primary)[\w-]*$/, /^--[\w-]*accent[\w-]*$/, /^--[\w-]*(?:cta|link)(?:-color)?$/],
  background: [/^--(?:color-)?(?:background|bg|page-bg|body-bg|bs-body-bg|base-100|canvas)(?:-color)?$/, /^--[\w-]*(?:background|page-bg|body-bg)$/],
  text: [/^--(?:color-)?(?:foreground|fg|text|text-color|body-color|bs-body-color|ink|base-content)$/, /^--[\w-]*(?:foreground|text-color|body-color)$/],
  border: [/^--(?:color-)?(?:border|line|divider|input)(?:-color)?$/, /^--bs-border-color$/],
  fontSans: [/^--(?:font-(?:sans|body|base|family|text|primary|default)|font|font-family(?:-base|-sans)?|bs-body-font-family|default-font-family)$/],
  fontDisplay: [/^--font-(?:display|heading|headings|title|serif-display)$/],
  radius: [/^--(?:radius|border-radius|rounded|radius-(?:md|base|default)|bs-border-radius|corner-radius)$/, /^--[\w-]*radius(?:-md|-base)?$/],
  controlHeight: [/^--[\w-]*(?:control|input|button|btn|field)-(?:height|h|size)(?:-md)?$/],
  spacing: [/^--(?:spacing|space|space-unit|spacing-unit|bs-gutter-x)$/],
};

/** Brand decisions found in a site's CSS, with where each one came from. */
export function extractDesign(css) {
  const rules = parseCssRules(css);
  const vars = new Map();
  const darkVars = new Map();
  for (const rule of rules) {
    const dark = DARK_CONTEXT.test(rule.selector) || rule.atRules.some((a) => DARK_CONTEXT.test(a));
    for (const [prop, value] of rule.declarations) {
      if (!prop.startsWith('--')) continue;
      const target = dark ? darkVars : vars;
      // Root-level declarations win over component-scoped ones of the same name.
      if (!target.has(prop) || ROOT_SELECTOR.test(rule.selector)) target.set(prop, value);
    }
  }
  const design = { sources: {} };
  const take = (key, value, source) => {
    if (value === undefined || value === null || value === '' || design[key] !== undefined) return;
    design[key] = value;
    design.sources[key] = source;
  };
  const accept = {
    accent: (v) => toHex(v),
    background: (v) => toHex(v),
    text: (v) => {
      const c = parseCssColor(v);
      return c && c.a >= 0.5 ? formatColor(c) : null;
    },
    border: (v) => (parseCssColor(v) ? formatColor(parseCssColor(v)) : null),
    fontSans: (v) => (/[a-z]/i.test(v) && !/^var\(/.test(v) ? v.replace(/\s*!important$/, '') : null),
    fontDisplay: (v) => (/[a-z]/i.test(v) && !/^var\(/.test(v) ? v.replace(/\s*!important$/, '') : null),
    radius: (v) => {
      const px = isLength(v) || /^0$/.test(v.trim()) ? lengthToPx(v) : null;
      return px !== null && px >= 0 && px <= 64 ? px : null;
    },
    controlHeight: (v) => {
      const px = isLength(v) ? lengthToPx(v) : null;
      return px !== null && px >= 20 && px <= 80 ? px : null;
    },
    spacing: (v) => {
      const px = isLength(v) ? lengthToPx(v) : null;
      return px !== null && px > 0 && px <= 48 ? px : null;
    },
  };
  for (const [key, patterns] of Object.entries(PICKS)) {
    for (const pattern of patterns) {
      for (const [name, raw] of vars) {
        if (!pattern.test(name)) continue;
        const value = accept[key](resolveVars(raw, vars));
        if (value !== null) {
          take(key, value, `custom property ${name}`);
          break;
        }
      }
      if (design[key] !== undefined) break;
    }
  }
  // Base rules, for sites without custom properties.
  const ruleValue = (selectorRe, props, accepted) => {
    for (const rule of rules) {
      if (rule.atRules.some((a) => DARK_CONTEXT.test(a)) || DARK_CONTEXT.test(rule.selector)) continue;
      if (!rule.selector.split(',').some((s) => selectorRe.test(s.trim()))) continue;
      for (const [prop, raw] of rule.declarations) {
        if (!props.includes(prop)) continue;
        const value = accepted(resolveVars(raw, vars).replace(/\s*!important$/, ''));
        if (value !== null) return [value, `${rule.selector.trim()} { ${prop} }`];
      }
    }
    return [null];
  };
  const fromRule = (key, selectorRe, props) => {
    if (design[key] !== undefined) return;
    const [value, source] = ruleValue(selectorRe, props, accept[key]);
    take(key, value, source);
  };
  fromRule('background', /^(html|body|:root)$/i, ['background-color', 'background']);
  fromRule('text', /^(html|body|:root)$/i, ['color']);
  fromRule('fontSans', /^(html|body|:root)$/i, ['font-family']);
  fromRule('fontDisplay', /^h[12]$/i, ['font-family']);
  fromRule('accent', /^(\.btn-primary|\.button-primary|\.button--primary|button\.primary|\.btn--primary|\.primary-button|\[type=["']?submit["']?\])$/i, ['background-color', 'background']);
  fromRule('accent', /^a$/i, ['color']);
  fromRule('radius', /^(button|\.btn|\.button|input|\.card)$/i, ['border-radius']);
  fromRule('controlHeight', /^(button|\.btn|\.button|input)$/i, ['height', 'min-height']);
  if (design.fontDisplay && design.fontSans && firstFamily(design.fontDisplay) === firstFamily(design.fontSans)) {
    delete design.fontDisplay;
    delete design.sources.fontDisplay;
  }
  design.darkVariables = darkVars.size;
  return design;
}

const firstFamily = (stack) => stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '').toLowerCase();

/**
 * Reads the given URLs only: a stylesheet as is, an HTML page's inline <style> blocks. Linked
 * stylesheets of a page are listed, not fetched; pass them as URLs to include them.
 */
export async function fetchSiteCss(urls, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  if (urls.length > MAX_URLS) throw new CliError(`At most ${MAX_URLS} URLs per call`);
  const sheets = [];
  const notes = [];
  for (const raw of urls) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new CliError(`Not a URL: ${raw}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CliError(`Only http(s) URLs can be read: ${raw}`);
    let res;
    try {
      res = await fetchImpl(url.href, { headers: { accept: 'text/css,text/html;q=0.8' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new CliError(`Cannot fetch ${url.href}: ${error.message}`, { cause: error });
    }
    if (!res.ok) throw new CliError(`${url.href} responded with ${res.status}`);
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    let body = await res.text();
    if (body.length > MAX_CSS_CHARS) {
      body = body.slice(0, MAX_CSS_CHARS);
      notes.push(`${url.href}: only the first ${MAX_CSS_CHARS} characters were read`);
    }
    if (type.includes('text/css') || (!type.includes('html') && /\.css$/i.test(url.pathname))) {
      sheets.push({ source: url.href, css: body });
    } else if (type.includes('html') || /^\s*</.test(body)) {
      const inline = [...body.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
      if (inline.length) sheets.push({ source: `${url.href} (inline <style>)`, css: inline.join('\n') });
      const linked = [...body.matchAll(/<link\b[^>]*>/gi)]
        .map((m) => m[0])
        .filter((tag) => /\brel=["']?[^"'>]*stylesheet/i.test(tag))
        .map((tag) => /\bhref=["']?([^"'\s>]+)/i.exec(tag)?.[1])
        .filter(Boolean)
        .map((href) => new URL(href.replace(/&amp;/g, '&'), url).href);
      if (linked.length) notes.push(`${url.href} links ${linked.length} stylesheet(s), not fetched (pass them in cssUrls to include): ${linked.slice(0, 8).join(', ')}`);
      if (!inline.length && !linked.length) notes.push(`${url.href}: no CSS found in the page`);
    } else {
      notes.push(`${url.href}: ${type || 'unknown content type'} is neither CSS nor HTML; skipped`);
    }
  }
  return { sheets, notes };
}

// ── Character wishes ─────────────────────────────────────────────────────────────────────────────

const CHARACTER = [
  { re: /strict|minimal|clean|corporate|enterprise|business|строг|минимал|корпоратив|делов/i, set: { radius: 0.75, shadow: 0.6 }, why: 'strict / minimal' },
  { re: /friendly|playful|soft|rounded|warm and|дружелюб|игрив|мягк|округл/i, set: { radius: 1.5, shadow: 1.2 }, why: 'friendly / soft' },
  { re: /dense|compact|data|dashboard|admin|плотн|компакт|данн|дашборд|админ|таблиц/i, set: { density: 'compact' }, why: 'dense / data-heavy' },
  { re: /airy|spacious|calm|relaxed|воздуш|просторн|спокойн/i, set: { density: 'comfortable' }, why: 'airy / spacious' },
  { re: /\bflat\b|плоск/i, set: { shadow: 0 }, why: 'flat' },
  { re: /depth|elevated|layered|глубин|объ[её]м|многослой/i, set: { shadow: 1.6 }, why: 'depth' },
  { re: /\bsharp\b|square|острые|квадратн|без скруглен/i, set: { radius: 0 }, why: 'sharp corners' },
  { re: /warm|тёпл|тепл/i, set: { gray: { hue: 56, chroma: 0.012 } }, why: 'warm greys' },
  { re: /\bcool\b|cold|холодн/i, set: { gray: { hue: 257, chroma: 0.035 } }, why: 'cool greys' },
  { re: /glass|frosted|translucent|стекл|матов|полупрозрач/i, set: { base: 'glass' }, why: 'glass material' },
];

/** Options suggested by free-text wishes such as "строгий, плотный, для дашборда". */
export function characterHints(text = '') {
  return CHARACTER.filter((c) => c.re.test(text)).map((c) => ({ set: c.set, why: c.why }));
}

// ── Theme Builder link ───────────────────────────────────────────────────────────────────────────

/** Mirrors GRAYS and FONTS in src/docs/theme-builder.ts (the builder URL accepts only these presets). */
const BUILDER_GRAYS = [
  ['neutral', 0, 0],
  ['slate', 257, 0.035],
  ['zinc', 286, 0.014],
  ['stone', 56, 0.012],
  ['sand', 80, 0.022],
  ['olive', 125, 0.016],
  ['mauve', 320, 0.016],
];
const BUILDER_FONTS = [
  ['geist', /^geist$/],
  ['inter', /^inter$/],
  ['roboto-flex', /^roboto flex$/],
  ['atkinson', /^atkinson hyperlegible/],
  ['serif', /^(source serif|georgia|charter|times)/],
  ['system', /^(-apple-system|system-ui|blinkmacsystemfont|sf pro)/],
  ['grotesk', /^(roboto|helvetica|helvetica neue|arial|arial nova|nimbus sans)$/],
  ['humanist', /^(seravek|gill sans|ubuntu|calibri|dejavu sans|source sans)/],
  ['rounded', /^(ui-rounded|sf pro rounded|quicksand|comfortaa|nunito|manjari)/],
];

const hueDistance = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

function nearestGray(gray) {
  if (!gray || gray.chroma < 0.006) return 'neutral';
  let best = null;
  for (const [id, hue, chroma] of BUILDER_GRAYS.slice(1)) {
    const d = hueDistance(hue, gray.hue) / 180 + Math.abs(chroma - gray.chroma) * 10;
    if (!best || d < best.d) best = { id, d };
  }
  return best.id;
}

const builderFont = (stack) => (stack ? BUILDER_FONTS.find(([, re]) => re.test(firstFamily(stack)))?.[0] : undefined);

export function builderLink(options) {
  const params = new URLSearchParams();
  params.set('theme', options.theme);
  if (options.accent) params.set('accent', options.accent.replace(/^#/, '').toLowerCase());
  if (options.gray) params.set('gray', nearestGray(options.gray));
  if (options.radius !== undefined && options.radius !== 1) params.set('radius', String(options.radius));
  const font = builderFont(options.fontSans);
  if (font) params.set('font', font);
  if (options.density && options.density !== 'default') params.set('density', options.density);
  if (options.shadow !== undefined && options.shadow !== 1) params.set('shadow', String(options.shadow));
  return { url: `${SITE_URL}/#/theme-builder?${params}`, exactFont: !options.fontSans || Boolean(font) };
}

// ── Contrast ─────────────────────────────────────────────────────────────────────────────────────

const TEXT_TOKENS = ['gray-1000', 'gray-900', 'fg', 'fg-muted', 'fg-subtle'];

/** WCAG checks of the generated theme in one mode: text 4.5:1, field edges 3:1. */
export function contrastChecks(options, tokens = createThemeTokens(options)) {
  const defaults = THEME_DEFAULTS[options.theme];
  const out = [];
  for (const mode of ['light', 'dark']) {
    const own = mode === 'light' ? tokens.base : { ...tokens.base, ...tokens.dark };
    const value = (name) => own[name] ?? defaults[mode].neutrals[name] ?? defaults[mode].accent[name];
    const gray = options.gray ? { hue: ((options.gray.hue % 360) + 360) % 360, chroma: clamp(options.gray.chroma, 0, 0.08) } : null;
    const backdrops = defaults[mode].backdrops.map((bd) => (gray ? tintNeutral(bd, gray.hue, gray.chroma) : bd));
    const check = (token, fg, bg, min, group, backdrop) => {
      const fc = parseCssColor(fg);
      const bc = parseCssColor(bg);
      if (fc && bc) out.push({ mode, label: `${token} on ${bg}`, token, backdrop, fg, bg, ratio: contrastOf(fc, bc), min, group });
    };
    const accent = value('accent');
    if (accent) {
      const fg = value('accent-fg') ?? '#ffffff';
      check('accent-fg', fg, accent, AA_TEXT, 'accent', 'accent');
      if (value('accent-hover')) check('accent-fg', fg, value('accent-hover'), AA_TEXT, 'accent', 'accent-hover');
      if (value('accent-text')) backdrops.forEach((bd, i) => check('accent-text', value('accent-text'), bd, AA_TEXT, 'accent-text', i));
    }
    for (const name of TEXT_TOKENS) {
      if (value(name) === undefined || !(name in defaults[mode].neutrals)) continue;
      backdrops.forEach((bd, i) => check(name, value(name), bd, AA_TEXT, 'neutral', i));
    }
    if (value('border-field')) backdrops.forEach((bd, i) => check('border-field', value('border-field'), bd, AA_NON_TEXT, 'edge', i));
  }
  return out;
}

function shiftLightness(hex, delta) {
  const [L, C, H] = toOklch(parseCssColor(hex));
  return formatColor(fromOklch(clamp(L + delta, 0, 1), C, H));
}

/**
 * Fixes contrast failures by adjusting the inputs (never the base theme): the accent's lightness
 * until text on it passes, the grey tint's chroma until neutral text passes.
 */
export function fixContrast(options) {
  const fixed = { ...options };
  const changes = [];
  const failing = (group) => contrastChecks(fixed).filter((c) => c.group === group && c.ratio < c.min);

  const accentFailures = fixed.accent ? failing('accent') : [];
  if (accentFailures.length) {
    const before = fixed.accent;
    const worst = Math.min(...accentFailures.map((c) => c.ratio));
    const lightText = accentFailures[0].fg.toLowerCase() === '#ffffff';
    const passes = (accent) => contrastChecks({ ...fixed, accent }).every((c) => c.group !== 'accent' || c.ratio >= c.min);
    // White text needs a darker fill, dark text a lighter one; the smallest change that passes wins.
    search: for (let i = 1; i <= 60; i++) {
      const step = 0.01 * i * (lightText ? -1 : 1);
      for (const delta of [step, -step]) {
        const candidate = shiftLightness(before, delta);
        if (passes(candidate)) {
          fixed.accent = candidate;
          break search;
        }
      }
    }
    if (fixed.accent !== before) changes.push(`accent ${before} → ${fixed.accent}: text on the original fill reached only ${ratio(worst)} (AA needs ${AA_TEXT}:1)`);
  }

  if (fixed.gray && failing('neutral').length) {
    const before = fixed.gray.chroma;
    while (fixed.gray.chroma > 0.001 && failing('neutral').length) fixed.gray = { ...fixed.gray, chroma: Math.round(fixed.gray.chroma * 500) / 1000 };
    if (failing('neutral').length) fixed.gray = { ...fixed.gray, chroma: 0 };
    changes.push(`grey tint chroma ${before} → ${fixed.gray.chroma}: tinted text fell below ${AA_TEXT}:1`);
  }

  // Field edges: createThemeCSS strengthens the black and white inks a grey tint lightens, so a tint
  // alone keeps --ui-border-field at 3:1; this guard still raises its alpha just enough when an edge
  // ends up below it (a token override can weaken it), up to the base theme's own level when that is
  // already lower (that shortfall is the theme's, not this tool's to change).
  const extra = { light: {}, dark: {} };
  const baseline = contrastChecks({ theme: fixed.theme });
  const checksWith = () => {
    const tokens = createThemeTokens(fixed);
    return contrastChecks(fixed, { base: { ...tokens.base, ...extra.light }, dark: { ...tokens.dark, ...extra.dark } });
  };
  for (const mode of ['light', 'dark']) {
    const edges = () => checksWith().filter((c) => c.mode === mode && c.group === 'edge');
    const own = baseline.filter((c) => c.mode === mode && c.group === 'edge');
    const target = Math.min(AA_NON_TEXT, ...own.map((c) => c.ratio)) - 0.005;
    const failed = edges().filter((c) => c.ratio < target);
    if (!failed.length) continue;
    const ink = parseCssColor(failed[0].fg);
    let value = failed[0].fg;
    for (let alpha = ink.a; alpha <= 1.0001 && edges().some((c) => c.ratio < target); alpha += 0.02) {
      value = formatColor({ ...ink, a: Math.min(1, Math.round(alpha * 100) / 100) });
      extra[mode]['border-field'] = value;
    }
    changes.push(`--ui-border-field (${mode}) ${failed[0].fg} → ${value}: the field edge fell to ${ratio(Math.min(...failed.map((c) => c.ratio)))} (WCAG 1.4.11 needs ${AA_NON_TEXT}:1)`);
  }

  const inherited = (c) => baseline.some((b) => b.mode === c.mode && b.token === c.token && b.backdrop === c.backdrop && b.ratio < b.min);
  const remaining = checksWith()
    .filter((c) => c.ratio < c.min)
    .map((c) => ({ ...c, inherited: inherited(c) }));
  return { options: fixed, extra, changes, remaining, checks: checksWith() };
}

// ── Building the theme ───────────────────────────────────────────────────────────────────────────

function grayFrom(colors) {
  let best = null;
  for (const value of colors) {
    const color = parseCssColor(value);
    if (!color) continue;
    const [L, C, H] = toOklch(color);
    // Neutrals only: near-grey colours with enough lightness range to carry a tint.
    if (C > 0.06 || L < 0.05 || L > 0.995) continue;
    if (!best || C > best.chroma) best = { hue: Math.round(H), chroma: Math.round(Math.min(C, 0.04) * 1000) / 1000 };
  }
  return best && best.chroma >= 0.004 ? best : null;
}

/** Control height decides; else the spacing: a ≤8px value is a unit (Tailwind's 4px), larger ones a base gap (16px). */
const densityFrom = (heightPx, spacingPx) => {
  if (heightPx) return heightPx <= 34 ? 'compact' : heightPx >= 46 ? 'comfortable' : 'default';
  if (!spacingPx) return undefined;
  const gap = spacingPx <= 8 ? spacingPx * 4 : spacingPx;
  return gap < 14 ? 'compact' : gap > 20 ? 'comfortable' : 'default';
};

function fontStack(family, theme) {
  if (!family) return undefined;
  if (/(^|,)\s*(sans-serif|serif|monospace|system-ui|ui-sans-serif|ui-serif|cursive)\s*$/i.test(family)) return family;
  return `${family}, ${THEME_DEFAULTS[theme].fontSans}`;
}

/** Radius input: px (number or "12px"/"0.75rem"), or a multiplier written as "x1.25". */
function radiusFactor(radius, theme) {
  if (radius === undefined || radius === null || radius === '') return undefined;
  if (typeof radius === 'string' && /^x[\d.]+$/i.test(radius.trim())) return clamp(Number(radius.trim().slice(1)), 0, 2);
  const px = typeof radius === 'number' ? radius : lengthToPx(radius);
  if (px === null || !Number.isFinite(px)) throw new CliError(`"radius" must be px (12, "12px", "0.75rem") or a multiplier ("x1.25"), got ${JSON.stringify(radius)}`);
  return round2(clamp(px / THEME_DEFAULTS[theme].radius.md, 0, 2));
}

/**
 * Theme for a client site. Explicit inputs win over values read from `css`, which win over the
 * character wishes. Returns the CSS, a list of what changed and why, the contrast results and links.
 */
export function buildSiteTheme(input = {}) {
  const design = input.css ? extractDesign(input.css) : { sources: {} };
  const hints = characterHints(input.character);
  const notes = [];
  const changes = [];
  const pick = (key) => {
    if (input[key] !== undefined && input[key] !== null && input[key] !== '') return { value: input[key], from: 'given' };
    if (design[key] !== undefined) return { value: design[key], from: design.sources[key] };
    return null;
  };

  // Base theme: a builder base as asked, else the closest one for the requested theme or character.
  let theme = 'vercel';
  if (input.base) {
    if (!THEMES.includes(input.base)) throw new CliError(`Unknown base theme "${input.base}". Themes: ${THEMES.join(', ')}`);
    if (BUILDER_BASES.includes(input.base)) theme = input.base;
    else {
      theme = /glass|frost/.test(input.base) || hints.some((h) => h.set.base === 'glass') ? 'glass' : 'vercel';
      notes.push(
        `createThemeCSS refines only ${BUILDER_BASES.join(' and ')}, so the generated overrides use "${theme}". To keep "${input.base}", use it as is and fit single components with tune_components, or start a new theme file (npm run theme:new in the kit repository).`,
      );
    }
  } else if (hints.some((h) => h.set.base === 'glass')) {
    theme = 'glass';
  }
  changes.push(`base theme: ${theme}${input.base === theme ? ' (as asked)' : input.base ? ` (closest to ${input.base})` : hints.some((h) => h.set.base) ? ' (character: glass material)' : ' (default)'}`);

  const options = { theme };
  const accent = pick('accent');
  if (accent) {
    const hex = toHex(String(accent.value));
    if (!hex) throw new CliError(`"accent" must be an opaque colour, got ${JSON.stringify(accent.value)}`);
    options.accent = hex;
    changes.push(`accent ${hex} (${accent.from})`);
  }

  const neutralSources = ['text', 'background', 'border'].map((k) => pick(k)).filter(Boolean);
  const gray = input.gray ?? grayFrom(neutralSources.map((s) => s.value));
  if (gray) {
    options.gray = { hue: Number(gray.hue), chroma: Number(gray.chroma) };
    changes.push(`grey tint hue ${options.gray.hue}, chroma ${options.gray.chroma} (${input.gray ? 'given' : `from the site's neutrals: ${neutralSources.map((s) => s.from).join(', ')}`})`);
  }

  const radius = pick('radius');
  if (radius) {
    options.radius = radiusFactor(radius.value, theme);
    changes.push(`radius ×${options.radius} (${typeof radius.value === 'number' ? `${radius.value}px` : radius.value}, ${radius.from}; the theme's base radius is ${THEME_DEFAULTS[theme].radius.md}px)`);
  }

  const font = pick('fontSans');
  if (font) {
    options.fontSans = fontStack(String(font.value), theme);
    changes.push(`--ui-font-sans: ${options.fontSans} (${font.from})`);
  }

  const density = input.density ?? densityFrom(design.controlHeight, design.spacing);
  if (density) {
    if (!DENSITIES.includes(density)) throw new CliError(`"density" must be one of ${DENSITIES.join(', ')}`);
    options.density = density;
    const why = input.density ? 'given' : design.controlHeight ? `controls ${design.controlHeight}px high, ${design.sources.controlHeight}` : `spacing unit ${design.spacing}px, ${design.sources.spacing}`;
    changes.push(`density ${density} (${why})`);
  }
  if (input.shadow !== undefined) {
    options.shadow = clamp(Number(input.shadow), 0, 2);
    changes.push(`shadow ×${options.shadow} (given)`);
  }

  for (const hint of hints) {
    const applied = [];
    for (const [key, value] of Object.entries(hint.set)) {
      if (key === 'base' || options[key] !== undefined) continue;
      options[key] = value;
      applied.push(`${key} ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
    if (applied.length) changes.push(`${applied.join(', ')} (character: ${hint.why})`);
  }

  const { options: fixedOptions, extra, changes: fixes, remaining, checks } = fixContrast(options);
  const displayFont = pick('fontDisplay');
  if (displayFont) {
    extra.light['font-display'] = String(displayFont.value);
    changes.push(`--ui-font-display: ${displayFont.value} (${displayFont.from}; a decoration hook for titles and headings)`);
  }
  // Tokens createThemeCSS has no option for: a block after its own, so they win at equal specificity.
  const block = (selector, tokens) => `${selector} {\n${Object.entries(tokens).map(([name, value]) => `  --ui-${name}: ${value};`).join('\n')}\n}`;
  const css = [
    createThemeCSS(fixedOptions),
    Object.keys(extra.light).length ? block(`[data-theme='${theme}']`, extra.light) : '',
    Object.keys(extra.dark).length ? block(`[data-theme='${theme}'][data-mode='dark']`, extra.dark) : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const background = pick('background');
  const text = pick('text');
  if (background && text) {
    const site = contrastOf(parseCssColor(text.value), parseCssColor(background.value));
    notes.push(`The site's own text on its background is ${ratio(site)}${site < AA_TEXT ? ' (below AA; the theme keeps the kit\'s readable text colours)' : ''}.`);
  }
  if (background) notes.push(`Page and surface colours stay the base theme's (createThemeCSS tints them with the grey hue only); the site background ${background.value} is not copied.`);
  if (design.darkVariables) notes.push(`The site defines ${design.darkVariables} dark-mode variables; the dark half of the theme is derived from the same decisions instead.`);
  if (font) {
    const family = firstFamily(options.fontSans);
    const id = family.replace(/\s+/g, '-');
    notes.push(
      Object.values(THEME_FONTS).flat().includes(id)
        ? `"${family}" is hosted by the kit: import ${LIBRARY_PACKAGE}/fonts/${id}.css, or keep the site's own @font-face.`
        : `"${family}" is not hosted by the kit: keep loading it the way the site already does.`,
    );
  }

  return {
    theme,
    options: fixedOptions,
    css,
    changes,
    fixes,
    notes,
    checks,
    remaining,
    design,
  };
}

/** The tool's text: CSS, what changed, contrast and how to preview and apply it. */
export function formatSiteTheme(result, { components = [], fileName = 'valyro-theme.css' } = {}) {
  const { theme, options } = result;
  const builder = builderLink(options);
  const failing = result.remaining;
  const header = [`/* ValyroUI theme for your site · ${theme} base`, ` * Load after ${LIBRARY_PACKAGE}/styles.css; keep <ThemeProvider theme="${theme}">.`, ` * Preview (approximate): ${builder.url}`, ' */'].join('\n');
  const lines = [
    '```css',
    `${header}\n\n${result.css || `/* Same as the default ${theme} theme: nothing to override. */`}`,
    '```',
    '',
    'What was set:',
    ...result.changes.map((c) => `- ${c}`),
  ];
  lines.push('', `Contrast (WCAG AA: text ${AA_TEXT}:1, field edges ${AA_NON_TEXT}:1):`);
  for (const group of ['accent', 'accent-text', 'neutral', 'edge']) {
    for (const mode of ['light', 'dark']) {
      const w = result.checks.filter((c) => c.group === group && c.mode === mode).sort((a, b) => a.ratio - b.ratio)[0];
      if (w) lines.push(`- ${mode}: lowest ${group} ${w.label}: ${ratio(w.ratio)} ${w.ratio >= w.min ? 'pass' : 'FAIL'}`);
    }
  }
  if (result.fixes.length) lines.push('', 'Auto-corrected:', ...result.fixes.map((f) => `- ${f}`));
  const own = failing.filter((c) => !c.inherited);
  const inherited = failing.filter((c) => c.inherited);
  if (own.length) lines.push('', 'Still failing after the fixes (adjust by hand):', ...own.slice(0, 8).map((c) => `- ${c.mode}: ${c.label} ${ratio(c.ratio)} < ${c.min}:1`));
  if (inherited.length) {
    lines.push('', `Below AA in the ${theme} base theme itself (not changed by this theme):`, ...inherited.slice(0, 6).map((c) => `- ${c.mode}: ${c.label} ${ratio(c.ratio)} < ${c.min}:1`));
  }
  if (result.notes.length) lines.push('', 'Notes:', ...result.notes.map((n) => `- ${n}`));
  const ids = components.length ? components : ['button'];
  lines.push(
    '',
    'Preview:',
    `- Theme Builder with these settings: ${builder.url}${builder.exactFont ? '' : ' (the builder offers preset fonts only, so the font differs)'}; the builder takes preset grey tints, so the tint is the nearest preset.`,
    ...ids.flatMap((id) => [`- ${id} in the ${theme} base: ${SITE_URL}/?test=${id}&demo=all&theme=${theme}&mode=light (and &mode=dark); your overrides apply in your app`]),
    '',
    'Apply:',
    `1. Save the CSS as ${fileName} in the app (e.g. src/styles/${fileName}).`,
    `2. Import it after the kit stylesheet: \`import '${LIBRARY_PACKAGE}/styles.css';\` then \`import './styles/${fileName}';\` (source install: after components/valyro-ui/styles/index.css).`,
    `3. Keep \`<ThemeProvider theme="${theme}">\`: the overrides target [data-theme='${theme}'] in light and dark.`,
    ...(THEME_FONTS[theme].length ? [`4. Kit fonts of this base: ${THEME_FONTS[theme].map((id) => `${LIBRARY_PACKAGE}/fonts/${id}.css`).join(', ')} (skip if --ui-font-sans now names the site's font).`] : []),
    'To fit single components further, use tune_components.',
  );
  return lines.join('\n');
}
