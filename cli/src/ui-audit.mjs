// A deterministic design and accessibility linter for app code built with ValyroUI: line-level rules
// (raw colours, removed focus rings, clickable divs, `transition: all`, scale(0), gradient text,
// generic-AI tells, …) that an agent can run after every UI edit. Regex heuristics, no AST and no
// LLM: findings point at lines to look at, not proofs. Reads only the files it is given.

import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './registry.mjs';

const CODE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|html?)$/i;
const STYLE = /\.(?:css|scss|sass|less|pcss)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.svelte-kit', '.turbo', '.vercel', '.cache', 'storybook-static']);
const MAX_FILES = 400;
const MAX_BYTES = 1_000_000;
const MAX_FINDINGS = 200;
const IGNORE = /valyro-audit-ignore(?:\s+([\w,\s-]+))?/;

/** Severity: error = an accessibility barrier, warn = breaks the theme or the motion rules, note = a generic-UI tell to look at. */
export const AUDIT_RULES = {
  'zoom-disabled': { level: 'error', text: 'Zoom is disabled (user-scalable=no or maximum-scale=1); people who need to enlarge text cannot (WCAG 1.4.4).' },
  'focus-removed': { level: 'error', text: 'Focus outline removed and no :focus-visible style in this file; keep the kit focus ring (--ui-focus-ring) or draw a visible one.' },
  'clickable-div': { level: 'error', text: 'onClick on a <div> or <span> without a role: not reachable by keyboard. Use a <button>, a link or the kit Button.' },
  'img-alt': { level: 'error', text: '<img> without alt: give a description, or alt="" when it is decorative.' },
  'positive-tabindex': { level: 'error', text: 'Positive tabIndex reorders focus away from the reading order; use 0 or -1.' },
  'raw-colour': { level: 'warn', text: 'Hard-coded colour outside a token definition: it ignores the theme and dark mode. Use a --ui-* token (check_contrast measures tokens).' },
  'transition-all': { level: 'warn', text: '`transition: all` animates layout and colour together and fights the kit; list the properties (transform, opacity) and use --ui-duration*.' },
  'scale-zero': { level: 'warn', text: 'Animating from scale(0) looks like popping out of nothing; start at 0.95 with opacity, from the trigger side.' },
  'gradient-text': { level: 'warn', text: 'Gradient text (background-clip: text): hurts legibility and contrast and is a common generic-AI tell; use solid --ui-fg or --ui-accent-text.' },
  'hover-weight': { level: 'warn', text: 'font-weight changes on :hover: the text reflows and neighbours jump. Change colour or underline instead.' },
  'tiny-text': { level: 'warn', text: 'Text below 12px is hard to read; use the theme scale (--ui-text-xs and up).' },
  'endless-motion': { level: 'warn', text: 'An endless animation with no prefers-reduced-motion handling in this file: give it a static fallback (or [data-ui-motion=reduce]).' },
  'linear-motion': { level: 'warn', text: 'Linear easing on a UI transition starts and stops with a jolt; ease with --ui-ease or a spring (--ui-spring-smooth, --ui-spring-snappy). Linear suits only constant motion: spinners, marquees, time or scroll progress.' },
  'harsh-overshoot': { level: 'warn', text: 'A cubic-bezier that overshoots this far snaps and wobbles; use --ui-spring-snappy or --ui-spring-smooth, and --ui-spring-bouncy only for a playful moment.' },
  'raw-duration': { level: 'warn', text: 'Hard-coded transition time and no reduced-motion handling in this file: it ignores the theme tempo and keeps moving for people who asked for less motion. Use --ui-duration* (springs: calc(var(--ui-duration-slow) * 1.36) with --ui-spring-snappy).' },
  'layout-motion': { level: 'warn', text: 'Animating or dragging with layout properties (left, top, width, height, margin) re-lays out every frame and stutters; move with transform and opacity.' },
  'drag-touch-action': { level: 'note', text: 'A pointer drag with no touch-action in this file: on touch screens the page scroll fights the drag and it jerks. Set touch-action (none, pan-y or pan-x) on the handle, here or in its CSS.' },
  'hover-only': { level: 'warn', text: 'Opens on mouse enter but not on focus: keyboard and touch users never see it. Add onFocus (and a tap), or use the kit Tooltip, HoverCard or Popover.' },
  'placeholder-label': { level: 'warn', text: 'An <input> whose only label is its placeholder: it disappears while typing and many screen readers skip it. Wrap the control in FormField or give it a <label>.' },
  'loading-disabled': { level: 'warn', text: 'disabled while loading: the button shrinks or loses focus and nobody hears why. Use the Button loading prop, which keeps its width and announces the wait.' },
  'native-dialog': { level: 'warn', text: 'window.alert, confirm or prompt blocks the page and ignores the theme; use ConfirmDialog, Dialog or a toast.' },
  'timed-unmount': { level: 'note', text: 'Closing after a setTimeout guesses the exit length, so the exit is cut or lags; let the kit overlay or usePresence keep the element until its exit animation ends.' },
  'sticky-hover': { level: 'note', text: 'A hover transform outside @media (hover: hover): on touch screens it sticks after a tap. Gate decorative hover motion behind (hover: hover) and (pointer: fine).' },
  'vague-label': { level: 'note', text: 'A vague button label (Submit, OK, Click here): name the action, verb plus object ("Save draft", "Delete project").' },
  'fast-flash': { level: 'error', text: 'An endless animation faster than about three cycles a second can trigger seizures (WCAG 2.3.1); slow it down or make it play once.' },
  'img-size': { level: 'warn', text: '<img> without width and height (or an aspect ratio): the page jumps when it loads. Reserve its size.' },
  'tooltip-unfocusable': { level: 'warn', text: 'A Tooltip around a span, div, img or svg: keyboard users never reach it. Put it on a button or link, or give the trigger tabIndex={0} and a label.' },
  'destructive-primary': { level: 'warn', text: 'A destructive action styled as the primary button: use variant="danger" and keep the safe choice prominent; irreversible deletes confirm, best by typing the name.' },
  'palette-colour': { level: 'warn', text: 'A Tailwind palette colour (blue-500, gray-200) in app code ignores the theme and dark mode; use the --ui-* tokens (bg-[var(--ui-surface)]) or a kit component variant.' },
  'blur-fallback': { level: 'note', text: 'backdrop-filter with no prefers-reduced-transparency fallback in this file: give glass an opaque or tinted fallback, and keep blur off the content layer.' },
  'locale-hardcoded': { level: 'note', text: 'Numbers or dates formatted for a fixed en-US locale: format with the user\'s locale (Intl without a fixed locale, or the app\'s locale setting).' },
  'raw-model-html': { level: 'error', text: 'Model output injected as HTML (dangerouslySetInnerHTML with a message or completion): a script-injection hole. Render it as Markdown into kit components, or in a sandboxed frame.' },
  'number-type': { level: 'warn', text: 'type="number" on a phone, card, postal code, PIN or money field: spinners, lost leading zeros and wrong keyboards. Use type="text" with inputMode="numeric" (or the kit phone-input, card-input, masked-input, number-input).' },
  'otp-autofill': { level: 'warn', text: 'A one-time-code field without autoComplete="one-time-code": SMS autofill and password managers cannot fill it. The kit otp-input sets it.' },
  'streaming-live-region': { level: 'warn', text: 'A live region on streaming text: screen readers hear every token. Announce the finished answer once (a polite status), not the stream.' },
  'webgl-no-pause': { level: 'warn', text: 'A WebGL canvas with no off-screen pause in this file (IntersectionObserver, useInView or visibilitychange): it burns battery and frames while nobody sees it.' },
  'hover-only-actions': { level: 'warn', text: 'Row or card actions shown only on hover (opacity-0 … group-hover:opacity-100): keyboard and touch users never see them. Show them on focus-within too, or always.' },
  'tabs-navigation': { level: 'note', text: 'Tabs that change the route: tabs switch panels inside a page; navigation between pages uses links (sidebar, navbar, breadcrumbs).' },
  'toast-validation': { level: 'note', text: 'A toast for a field error: it vanishes and is not tied to the field. Show the error at the field (FormField error) and focus it.' },
  'viewport-height': { level: 'note', text: '100vh (h-screen) on phones is taller than the visible area behind the browser bars; use 100dvh (h-dvh) for full-height sheets, drawers and shells.' },
  'safe-area': { level: 'note', text: 'A fixed bar at the bottom with no safe-area inset: the home indicator covers it on phones. Add padding-bottom: env(safe-area-inset-bottom).' },
  'touchmove-passive': { level: 'note', text: 'A touchmove listener without { passive }: scrolling waits for JavaScript. Mark it passive, or set touch-action on the element instead of preventDefault.' },
  'autoplay-media': { level: 'warn', text: 'Autoplaying audio, or video without muted: never start sound on its own; video needs muted and a pause control.' },
  'ai-gradient': { level: 'note', text: 'Violet, indigo or fuchsia gradient: the most common generic-AI tell. Use the theme accent on a neutral ground unless the brand is purple.' },
  'emoji-icon': { level: 'note', text: 'Emoji used as an icon: it renders differently per platform and reads as placeholder; use the kit icons or an SVG with a label.' },
  'filler-copy': { level: 'note', text: 'Filler or buzzword copy (lorem ipsum, "unlock", "supercharge", "seamless", "revolutionise", "elevate your"): write what the product actually does.' },
  'ease-in': { level: 'note', text: 'ease-in on UI motion feels sluggish at the start; enter and exit with ease-out (the --ui-ease* tokens), move with ease-in-out.' },
  'z-index-war': { level: 'note', text: 'z-index of 1000 or more: kit overlays manage their own stacking through portals; a huge z-index usually hides a layering problem.' },
};

const RAW_COLOUR = /(?:^|[^\w&-])(#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4}))\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[\d.]/i;
/** Pictographs, without the ©, ® and ™ signs that legal lines use. */
const EMOJI = /(?![©®™])\p{Extended_Pictographic}/u;
const FILLER = /lorem ipsum|\bunlock (?:your|the)\b|\bsupercharg|\bseamless(?:ly)?\b|\brevolutioni[sz]e|\belevate your\b/i;

/** Opening tags (`<img …>`, `<div …>`) with their start line, spanning several lines when props wrap. */
function* tags(text, names) {
  const re = new RegExp(String.raw`<(${names})\b`, 'g');
  for (const m of text.matchAll(re)) {
    let end = m.index;
    let depth = 0;
    for (; end < text.length; end++) {
      const ch = text[end];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth <= 0) break;
    }
    yield { name: m[1], body: text.slice(m.index, end + 1), line: text.slice(0, m.index).split('\n').length };
  }
}

/** Findings for one file's text. `file` only decides which rules apply (code or style). */
export function auditText(text, file) {
  const isStyle = STYLE.test(file);
  const isCode = CODE.test(file);
  const lines = text.split(/\r?\n/);
  const found = [];
  const add = (rule, line, excerpt) => found.push({ file, line, rule, ...AUDIT_RULES[rule], excerpt: excerpt.trim().slice(0, 120) });

  const hasFocusVisible = /focus-visible/.test(text);
  const hasReducedMotion = /prefers-reduced-motion|data-ui-motion|useReducedMotion|reducedMotion/i.test(text);
  const isDrag = /pointermove|onPointerMove|mousemove|onMouseMove/.test(text);
  const hasTouchAction = /touch-action|touchAction|\btouch-(?:none|pan-[xy])\b/.test(text);
  const hasHoverMedia = /hover\s*:\s*hover/.test(text);
  const hasReducedTransparency = /prefers-reduced-transparency/.test(text);
  const hasDynamicViewport = /\b\d+[dsl]vh\b|\bh-[dsl]vh\b/.test(text);
  const hasOffscreenPause = /IntersectionObserver|useInView|visibilitychange|document\.hidden/.test(text);
  let inHover = false;

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.replace(/\/\/.*$|\/\*.*?\*\//g, (c) => (IGNORE.test(c) ? c : ''));
    if (/^\s*(?:\*|\/\/)/.test(raw) && !IGNORE.test(raw)) return;
    // Defining a custom property is where raw colours belong.
    const definesToken = /^\s*--[\w-]+\s*:/.test(line) || /['"]--[\w-]+['"]\s*:/.test(line);

    if (/user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\.0)?\b/i.test(line)) add('zoom-disabled', n, raw);
    if (!hasFocusVisible && /outline\s*:\s*(?:none|0)\b|\boutline-none\b|outline:\s*['"]?none/.test(line)) add('focus-removed', n, raw);
    if (/tabindex\s*=\s*["']?[1-9]|tabIndex=\{\s*[1-9]/i.test(line)) add('positive-tabindex', n, raw);
    const rawColour = isStyle
      ? [...line.matchAll(/(?:^|[{;])\s*(--)?[\w-]+\s*:\s*([^;{}]*)/g)].some((d) => !d[1] && !/url\(/.test(d[2]) && RAW_COLOUR.test(d[2]))
      : !definesToken && RAW_COLOUR.test(line) && /style=|className=|class=|\bcolor\s*:|background|border|fill|stroke|shadow|\[#/.test(line);
    if (rawColour) add('raw-colour', n, raw);
    if (/transition(?:-property)?\s*:\s*all\b|\btransition-all\b|transition:\s*['"]all/.test(line)) add('transition-all', n, raw);
    if (/scale\(\s*0(?:\.0+)?\s*\)|scale:\s*['"]?0['"]?\s*[;,}]|\bscale-0\b/.test(line)) add('scale-zero', n, raw);
    if (/background-clip\s*:\s*text|backgroundClip:\s*['"]text|\bbg-clip-text\b/.test(line)) add('gradient-text', n, raw);
    if (/font-size\s*:\s*(?:[0-9]|1[01])(?:\.\d+)?px|fontSize:\s*(?:[0-9]|1[01])\b|text-\[(?:[0-9]|1[01])px\]/.test(line)) add('tiny-text', n, raw);
    if (!hasReducedMotion && /\binfinite\b|\banimate-(?:spin|ping|pulse|bounce)\b|repeat:\s*Infinity/.test(line)) add('endless-motion', n, raw);
    if (/\b(?:from|via|to)-(?:purple|violet|indigo|fuchsia)-\d{2,3}\b|linear-gradient\([^)]*(?:purple|violet|indigo|#(?:7c3aed|8b5cf6|6366f1|a855f7|4f46e5|9333ea))/i.test(line)) add('ai-gradient', n, raw);
    if (/\bease-in\b(?!-)/.test(line)) add('ease-in', n, raw);
    // Softness: eased starts and stops, springs without a jolt, the theme's tempo, transform-only movement.
    // Values of transition declarations only: CSS `transition…: …;` and JS `transition…: '…'`.
    const transitions = [
      ...[...line.matchAll(/(?<![\w-])transition(?:-timing-function|-duration|-property)?\s*:\s*([^;{}'"`]+)/g)].map((m) => m[1]),
      ...[...line.matchAll(/\btransition(?:TimingFunction|Duration|Property)?:\s*(['"`])(.*?)\1/g)].map((m) => m[2]),
    ]
      .map((v) => v.replace(/var\([^)]*\)|calc\([^)]*\)|linear\([^)]*\)/g, ' token '))
      // A 0s transition is a delayed switch (visibility after a fade), not motion.
      .filter((v) => !/(?:^|[\s,])0+(?:\.0+)?m?s\b/.test(v));
    if (transitions.some((v) => /\blinear\b/.test(v)) || /\bease-linear\b|\b(?:easing|ease):\s*['"]linear['"]/.test(line)) add('linear-motion', n, raw);
    if ([...line.matchAll(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g)].some((m) => [m[2], m[4]].some((y) => Number(y) > 1.4 || Number(y) < -0.4))) add('harsh-overshoot', n, raw);
    if (!hasReducedMotion && !definesToken && (transitions.some((v) => /(?:^|[\s,])\d*\.?\d+m?s\b/.test(v)) || /\bduration-\d{2,4}\b/.test(line))) add('raw-duration', n, raw);
    if (transitions.some((v) => /(?:^|[\s,])(?:left|top|right|bottom|width|height|margin(?:-\w+)?|padding(?:-\w+)?)(?=[\s,]|$)/.test(v)) || (isDrag && /\.style\.(?:left|top|right|bottom|width|height)\s*=/.test(line))) add('layout-motion', n, raw);
    if (isDrag && !hasTouchAction && /setPointerCapture/.test(line)) add('drag-touch-action', n, raw);
    if (/disabled=\{\s*!?\s*(?:is)?(?:loading|submitting|pending|saving|fetching)\b/i.test(line)) add('loading-disabled', n, raw);
    if (/\bwindow\.(?:alert|confirm|prompt)\(|(?<![\w.])(?:alert|confirm)\(\s*['"`]/.test(line)) add('native-dialog', n, raw);
    if (/setTimeout\(\s*\(\)\s*=>\s*\{?\s*(?:set\w*(?:Open|Visible|Shown|Mounted)\w*|on(?:Close|Dismiss))\(\s*(?:false|null)?\s*\)/.test(line)) add('timed-unmount', n, raw);
    if (isCode && />\s*(?:Submit|OK|Ok|Click here)\s*<\//.test(line)) add('vague-label', n, raw);
    if (/animation(?:-duration)?\s*:[^;]*?(?:^|[\s:])(?:0?\.(?:[0-2]\d*|3[0-2]\d*)s|(?:[1-9]\d|[12]\d\d|3[0-2]\d)ms)\b[^;]*\binfinite\b/.test(line)) add('fast-flash', n, raw);
    if (isCode && /\b(?:bg|text|border|from|via|to|ring|fill|stroke|outline|divide|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/.test(line)) add('palette-colour', n, raw);
    if (!hasReducedTransparency && /backdrop-filter\s*:\s*(?!none)|backdropFilter:\s*['"`](?!none)|\bbackdrop-blur(?:-\w+)?\b/.test(line)) add('blur-fallback', n, raw);
    if (isCode && /dangerouslySetInnerHTML=\{\{\s*__html:\s*[^}]*\b(?:message|content|completion|output|response|answer|reply|chunk)/i.test(line)) add('raw-model-html', n, raw);
    if (isCode && /aria-live=["'](?:polite|assertive)["'][^>]*>\s*\{[^}]*\b(?:stream|delta|partial|chunk|tokens?)\w*/i.test(line)) add('streaming-live-region', n, raw);
    if (isCode && /\bopacity-0\b[^"'`]*\bgroup-hover:opacity-100\b/.test(line) && !/focus-within|focus-visible/.test(line)) add('hover-only-actions', n, raw);
    if (isCode && /<Tabs\b[^>]*onValueChange=\{[^}]*(?:router\.(?:push|replace)|navigate\()/.test(line)) add('tabs-navigation', n, raw);
    if (isCode && /\btoast(?:\.error)?\(\s*['"`][^'"`]*\b(?:is required|required|invalid|must be|is not valid)\b/i.test(line)) add('toast-validation', n, raw);
    if (!hasDynamicViewport && /(?<![\w-])(?:max-)?height\s*:\s*['"]?100vh\b|\bh-screen\b/.test(line)) add('viewport-height', n, raw);
    if (!/safe-area-inset|pb-safe|safe-bottom/.test(line) && (/position\s*:\s*fixed[^}]*\bbottom\s*:\s*0\b/.test(line) || /\bfixed\b[^"'`]*\bbottom-0\b/.test(line))) add('safe-area', n, raw);
    if (/addEventListener\(\s*['"]touchmove['"](?![^)]*passive)/.test(line)) add('touchmove-passive', n, raw);
    if (isCode && !hasOffscreenPause && /getContext\(\s*['"]webgl2?['"]|<Canvas\b/.test(line)) add('webgl-no-pause', n, raw);
    if (/(?:toLocale(?:String|DateString|TimeString)|Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat))\(\s*(?:[\w.]+\s*,\s*)?['"]en-US['"]/.test(line)) add('locale-hardcoded', n, raw);
    if (/z-index\s*:\s*\d{4,}|zIndex:\s*\d{4,}|\bz-\[\d{4,}\]/.test(line)) add('z-index-war', n, raw);
    if (isCode && !isStyle) {
      if (EMOJI.test(line)) add('emoji-icon', n, raw);
      if (/\bhover:font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/.test(line)) add('hover-weight', n, raw);
      if (FILLER.test(line)) add('filler-copy', n, raw);
    }

    // :hover blocks in stylesheets (and <style> blocks): a weight change there reflows text.
    if (/:hover\b[^{]*\{/.test(line)) inHover = true;
    if (inHover && /font-weight\s*:/.test(line)) add('hover-weight', n, raw);
    if (inHover && !hasHoverMedia && /(?:^|[{;\s])(?:transform|translate|scale)\s*:/.test(line)) add('sticky-hover', n, raw);
    if (inHover && /\}/.test(line)) inHover = false;
  });

  if (isCode) {
    for (const tag of tags(text, 'img')) {
      if (!/\balt\s*=/.test(tag.body) && !/\{\.\.\./.test(tag.body)) add('img-alt', tag.line, tag.body);
      if (!/\{\.\.\./.test(tag.body) && !(/\bwidth\s*=/.test(tag.body) && /\bheight\s*=/.test(tag.body)) && !/aspect|fill\b/i.test(tag.body)) add('img-size', tag.line, tag.body.split('\n')[0]);
    }
    // A Tooltip whose first child cannot take focus.
    for (const m of text.matchAll(/<Tooltip\b[^>]*>\s*<(span|div|img|svg|p)\b([^>]*)>/g)) {
      if (!/\btabIndex\s*=/.test(m[2])) add('tooltip-unfocusable', text.slice(0, m.index).split('\n').length, m[0].split('\n')[0]);
    }
    for (const m of text.matchAll(/<Button\b([^>]*)>\s*(?:Delete|Remove|Destroy|Erase|Discard)\b/g)) {
      if (/variant=["'](?:primary|accent)["']/.test(m[1]) || !/variant=/.test(m[1])) add('destructive-primary', text.slice(0, m.index).split('\n').length, m[0].split('\n')[0]);
    }
    for (const tag of tags(text, 'div|span')) if (/\bonClick\s*=/.test(tag.body) && !/\brole\s*=/.test(tag.body)) add('clickable-div', tag.line, tag.body.split('\n')[0]);
    for (const tag of tags(text, '[A-Za-z][\\w.]*')) {
      if (/\bonMouseEnter\s*=/.test(tag.body) && !/\bonFocus\s*=/.test(tag.body)) add('hover-only', tag.line, tag.body.split('\n')[0]);
    }
    for (const tag of tags(text, 'input')) {
      const field = /\b(?:name|id|autoComplete|placeholder|aria-label)=["']([^"']*)["']/g;
      const names = [...tag.body.matchAll(field)].map((m) => m[1]).join(' ');
      if (/type=["']number["']/.test(tag.body) && /phone|tel\b|zip|postal|card|otp|pin\b|cvc|cvv|price|amount|iban/i.test(names)) add('number-type', tag.line, tag.body.split('\n')[0]);
      if (/\botp\b|one-?time|verification|2fa|sms code/i.test(names) && !/autoComplete=["']one-time-code["']/.test(tag.body)) add('otp-autofill', tag.line, tag.body.split('\n')[0]);
    }
    for (const tag of tags(text, 'input')) {
      if (/\bplaceholder\s*=/.test(tag.body) && !/\b(?:aria-label|aria-labelledby|id)\s*=|\{\.\.\./.test(tag.body) && !/type=["'](?:hidden|submit|button|checkbox|radio)["']/.test(tag.body)) add('placeholder-label', tag.line, tag.body.split('\n')[0]);
    }
    for (const tag of tags(text, 'audio|video')) {
      if (/\bautoPlay\b|\bautoplay\b/.test(tag.body) && (tag.name === 'audio' || !/\bmuted\b/.test(tag.body))) add('autoplay-media', tag.line, tag.body.split('\n')[0]);
    }
  }

  // Waivers: `valyro-audit-ignore [rule, …]` on the line or the one above.
  return found.filter((f) => {
    for (const at of [f.line - 1, f.line - 2]) {
      const m = IGNORE.exec(lines[at] ?? '');
      if (m && (!m[1] || m[1].split(/[\s,]+/).includes(f.rule))) return false;
    }
    return true;
  });
}

/**
 * Files to audit from project-relative paths (files or folders, recursed). The kit's own install dir
 * and build folders are skipped; nothing outside the project is read.
 */
export function collectFiles(projectDir, paths, { skip = [] } = {}) {
  const root = fs.realpathSync(projectDir);
  const skipped = skip.map((rel) => path.resolve(root, rel));
  const files = [];
  const visit = (abs) => {
    if (files.length >= MAX_FILES || skipped.some((s) => abs === s || abs.startsWith(s + path.sep))) return;
    const real = fs.realpathSync(abs);
    if (path.relative(root, real).startsWith('..')) return;
    const stat = fs.statSync(real);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(real).sort()) if (!SKIP_DIRS.has(name)) visit(path.join(abs, name));
    } else if ((CODE.test(abs) || STYLE.test(abs)) && !/\.(?:test|spec|stories|d)\.[cm]?[jt]sx?$/.test(abs) && stat.size <= MAX_BYTES) {
      files.push(abs);
    }
  };
  for (const rel of paths) {
    // Same check as project.mjs ensureInside, kept local so the hosted server can bundle this module alone.
    const abs = path.resolve(root, rel);
    const relative = path.relative(root, abs);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new CliError(`${rel} points outside the project directory`);
    if (!fs.existsSync(abs)) throw new CliError(`${rel} does not exist in the project`);
    visit(abs);
  }
  return { files, root, truncated: files.length >= MAX_FILES };
}

/** Findings for project-relative paths, with file names relative to the project and `/` separators. */
export function auditProject(projectDir, paths, options = {}) {
  const { files, root, truncated } = collectFiles(projectDir, paths, options);
  const findings = files.flatMap((abs) => auditText(fs.readFileSync(abs, 'utf8'), path.relative(root, abs).split(path.sep).join('/')));
  return { findings, scanned: files.length, truncated };
}

export function formatAudit(findings, { scanned, truncated = false } = {}) {
  const order = { error: 0, warn: 1, note: 2 };
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level] || a.file.localeCompare(b.file) || a.line - b.line);
  const count = (level) => findings.filter((f) => f.level === level).length;
  const lines = [
    `UI audit: ${scanned} file(s)${truncated ? ` (stopped at ${MAX_FILES})` : ''} · ${count('error')} error, ${count('warn')} warn, ${count('note')} note.`,
    ...(findings.length ? [''] : ['', 'No rule fired. This is a line-level check: still walk get_design_checklist on screenshots.']),
    ...sorted.slice(0, MAX_FINDINGS).map((f) => `${f.file}:${f.line} [${f.level}] ${f.rule} — ${f.text}\n    ${f.excerpt}`),
  ];
  if (sorted.length > MAX_FINDINGS) lines.push(`… and ${sorted.length - MAX_FINDINGS} more; audit fewer files at a time.`);
  if (findings.length) {
    lines.push('', 'Heuristics, not proofs: fix what is real; silence a deliberate exception with a `valyro-audit-ignore <rule>` comment on the line above, and say why.');
  }
  // Code shows what is written, not how it moves.
  lines.push('', 'Then play every interaction in a real browser (hover, press, open and close, drag and release with a fast flick, interrupting an animation, keyboard, touch, reduced motion): motion must start and stop softly, spring back and drag without stutter. Tests and still screenshots do not show that.');
  return lines.join('\n');
}
