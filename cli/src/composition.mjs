// How well a set of ValyroUI components fits together on one view. Everything is derived from the
// registry: the index (categories and their titles) and each item's own source files (motion,
// accent use, type scale, client-only code, size, npm dependencies). No component list is kept here.

import { SITE_URL } from './constants.mjs';
import { dependencyName } from './registry.mjs';

const SCALE = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl'];
/** Selectors that apply only in some state or variant: pseudo-classes, data- and aria- attributes, :not(). */
const STATE = /:(hover|focus|focus-visible|focus-within|active|checked|disabled|invalid|indeterminate|placeholder-shown)\b|\[(?:aria-|data-)|:not\(/;
/** Loops that belong to a loading or live state rather than decoration. */
const LOADING = /skeleton|shimmer|load|spinner|pending|progress|busy|stream|typing|thinking|record|live|status|running|caret|placeholder|indeterminate/i;
const ACCENT_PROPS = /^(background|background-color|background-image|box-shadow|filter)$/;

/** Category id → title and item names, in registry order (setup items left out). */
export function categoriesOf(index) {
  const map = new Map();
  for (const item of index) {
    const id = item.meta?.category ?? item.categories?.[0];
    if (!id || id === 'setup') continue;
    if (!map.has(id)) map.set(id, { id, title: item.meta?.categoryTitle ?? id, names: [] });
    map.get(id).names.push(item.name);
  }
  return [...map.values()];
}

function cssRules(css) {
  const rules = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: m[1].trim(), body: m[2] });
  }
  return rules;
}

/** Signals read from one registry item's own files. */
export function componentSignals(item) {
  const files = item.files ?? [];
  const css = files.filter((f) => /\.css$/.test(f.path)).map((f) => f.content).join('\n');
  const code = files.filter((f) => !/\.css$/.test(f.path)).map((f) => f.content).join('\n');
  const all = `${css}\n${code}`;

  const keyframes = (css.match(/@keyframes\b/g) ?? []).length;
  // Endless animation at rest; loops scoped to a loading or live state (skeletons, spinners, streaming) do not count.
  const infinite =
    cssRules(css).some((rule) => /animation(?:-iteration-count)?\s*:[^;]*\binfinite\b/.test(rule.body) && !STATE.test(rule.selector) && !LOADING.test(rule.selector)) ||
    /(?:iterations|repeat|iterationCount)\s*:\s*Infinity/.test(code);
  // A loop: a callback that schedules itself again (one-off focus or measuring calls do not).
  const frameLoop = [...code.matchAll(/requestAnimationFrame\(\s*([A-Za-z_$][\w$]*)\s*\)/g)].some(([, name]) => {
    const def = code.search(new RegExp(String.raw`(?:function\s+${name}\s*\(|(?:const|let)\s+${name}\s*=)`));
    return def !== -1 && code.slice(def, def + 2000).includes(`requestAnimationFrame(${name})`);
  });
  // Drawing on a canvas (a canvas only used to measure text does not count).
  const canvas = /getContext\(/.test(code) && /\.(?:fillRect|drawImage|putImageData|arc|lineTo|bezierCurveTo|drawArrays|drawElements)\(/.test(code);
  // Effects write private custom properties per event; tooltips and menus move elements instead.
  const writesVars = /style\.setProperty\(\s*['"`]--/.test(code);
  // Hover effects follow the pointer in and out; drag handles (pointer capture, pointerup) are interaction, not decoration.
  const pointerEffect =
    writesVars && /pointermove|mousemove|onPointerMove|onMouseMove|deviceorientation/i.test(code) && /pointerleave|onPointerLeave|mouseleave|onMouseLeave/i.test(code);
  // Scroll-linked scenes redraw per frame; CSS scroll timelines (edge shadows, reading progress) stay subtle.
  const scrollTimeline = /animation-timeline|view-timeline|scroll-timeline/.test(css);
  const scrollEffect = writesVars && frameLoop && /addEventListener\(\s*['"]scroll['"]/.test(code);
  const drag = /setPointerCapture|pointerup|onPointerUp/i.test(code);
  const decorative = pointerEffect || scrollEffect || infinite || (canvas && frameLoop) || (frameLoop && writesVars && !drag);
  const level = decorative ? 'strong' : keyframes || frameLoop || scrollTimeline ? 'subtle' : 'none';
  const reducedMotion = /prefers-reduced-motion|useReducedMotion|reducedMotion/i.test(all);

  // Accent at rest: rules without state selectors that paint with the accent or primary colour.
  let accentAtRest = 0;
  for (const rule of cssRules(css)) {
    if (STATE.test(rule.selector) || rule.selector.startsWith('@')) continue;
    const paints = rule.body.split(';').some((decl) => {
      const i = decl.indexOf(':');
      return i > 0 && ACCENT_PROPS.test(decl.slice(0, i).trim()) && /var\(--ui-(?:accent|primary)(?:-hover)?\)/.test(decl.slice(i + 1));
    });
    if (paints) accentAtRest++;
  }

  const sizes = [...all.matchAll(/--ui-text-(\w+)/g)].map((m) => SCALE.indexOf(m[1])).filter((i) => i >= 0);
  const largest = sizes.length ? SCALE[Math.max(...sizes)] : null;
  const kb = Math.round(files.reduce((n, f) => n + f.content.length, 0) / 1024);
  // Display scale: hero-size type. Dense: a sizeable component built from small controls and small type.
  const display = largest !== null && SCALE.indexOf(largest) >= SCALE.indexOf('3xl');
  const dense = !display && kb >= 15 && /--ui-control-h-sm|--ui-text-xs/.test(css) && (largest === null || SCALE.indexOf(largest) <= SCALE.indexOf('md'));

  return {
    name: item.name,
    title: item.title ?? item.name,
    category: item.meta?.category ?? item.categories?.[0] ?? '',
    categoryTitle: item.meta?.categoryTitle ?? '',
    motion: { level, keyframes, infinite, frameLoop, canvas, pointerEffect, scrollEffect, reducedMotion },
    accentAtRest,
    scale: display ? 'display' : dense ? 'dense' : 'regular',
    largestText: largest,
    client: files.some((f) => /^\s*['"]use client['"]/.test(f.content)),
    kb,
    npm: item.dependencies ?? [],
    registryDeps: (item.registryDependencies ?? []).map(dependencyName),
  };
}

/** Findings for one view: anti-patterns first ("warn"), then things to keep an eye on ("note"). */
export function reviewComposition(signals, { theme } = {}) {
  const findings = [];
  const warn = (text) => findings.push({ level: 'warn', text });
  const note = (text) => findings.push({ level: 'note', text });
  const names = (list) => list.map((s) => s.name).join(', ');

  const seen = new Set();
  const dupes = signals.filter((s) => (seen.has(s.name) ? true : (seen.add(s.name), false)));
  if (dupes.length) note(`Listed twice: ${names(dupes)}. Fine for repeated content (cards), not for page chrome.`);

  const strong = signals.filter((s) => s.motion.level === 'strong');
  const moving = signals.filter((s) => s.motion.level !== 'none');
  if (strong.length >= 2) warn(`Effects overload: ${strong.length} strong motion components (${names(strong)}). Keep one hero effect per view; make the others static or move them to their own section.`);
  else if (moving.length >= 4) note(`${moving.length} animated components (${names(moving)}): stagger them or keep the quieter ones static.`);
  const pointer = signals.filter((s) => s.motion.pointerEffect);
  if (pointer.length >= 2) warn(`Motion conflict: ${names(pointer)} all react to the pointer; together they compete for attention and frame time. Keep one.`);
  const scroll = signals.filter((s) => s.motion.scrollEffect);
  if (scroll.length >= 2) warn(`Motion conflict: ${names(scroll)} are all driven by scrolling; keep one scroll-linked effect per screen height.`);
  const noReduced = signals.filter((s) => (s.motion.infinite || s.motion.frameLoop || s.motion.canvas) && !s.motion.reducedMotion);
  if (noReduced.length) warn(`No prefers-reduced-motion handling found in the source of ${names(noReduced)}: check it stops or calms down with reduced motion before shipping.`);

  // Small accent marks (an active indicator, a progress fill) are normal; many accent fills across several components are not.
  const accented = signals.filter((s) => s.accentAtRest > 0);
  if (accented.length >= 3 && accented.reduce((n, s) => n + s.accentAtRest, 0) >= 4) warn(`Many accents: ${names(accented)} paint with the accent colour at rest. Keep one primary accent element per view; switch the rest to neutral or secondary variants.`);

  const display = signals.filter((s) => s.scale === 'display');
  const dense = signals.filter((s) => s.scale === 'dense');
  if (display.length && dense.length) warn(`Mixed densities: display-scale ${names(display)} next to dense ${names(dense)}. Put them in separate sections with their own spacing, and keep one density (theme density token) per region.`);
  if (display.length >= 3) note(`${display.length} display-scale components (${names(display)}): only one should own the h1; the others use h2 or smaller.`);

  const categories = new Map();
  for (const s of signals) categories.set(s.category, [...(categories.get(s.category) ?? []), s.name]);
  if (categories.size >= 6) note(`${categories.size} kinds of UI in one view (${[...categories.keys()].join(', ')}): check the reading order still has one clear primary task.`);

  const kb = signals.reduce((n, s) => n + s.kb, 0);
  const npm = [...new Set(signals.flatMap((s) => s.npm))];
  const heavy = signals.filter((s) => s.motion.canvas || s.kb >= 40);
  if (kb >= 200 || heavy.length >= 2) note(`Weight: about ${kb} KB of source${heavy.length ? `; heaviest ${names(heavy)}` : ''}. Lazy-load what sits below the fold.`);
  if (npm.length) note(`npm dependencies to add: ${npm.join(', ')}.`);
  const client = signals.filter((s) => s.client);
  if (client.length === signals.length && signals.length > 3) note('Every component is client-only: keep static content around them server-rendered.');

  if (theme) note(`Check every component in the ${theme} theme, light and dark: ${signals.map((s) => `${SITE_URL}/?test=${s.name}&demo=all&theme=${theme}`).join(' ')}`);
  return findings;
}

export function formatComposition(signals, findings, { theme } = {}) {
  const yes = (v) => (v ? 'yes' : '–');
  const lines = [
    `${signals.length} components${theme ? ` · theme ${theme}` : ''}`,
    '',
    '| component | category | motion | reduced motion | accent at rest | type scale | client | KB | npm |',
    '|---|---|---|---|---|---|---|---|---|',
    ...signals.map((s) =>
      [
        s.name,
        s.categoryTitle ? `${s.category} (${s.categoryTitle})` : s.category,
        s.motion.level,
        s.motion.level === 'none' ? '–' : yes(s.motion.reducedMotion),
        s.accentAtRest || '–',
        `${s.scale}${s.largestText ? ` (≤ ${s.largestText})` : ''}`,
        yes(s.client),
        s.kb,
        s.npm.join(' ') || '–',
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
    ),
    '',
    findings.length ? 'Findings:' : 'Findings: none of the automatic checks fired.',
    ...findings.map((f) => `- [${f.level}] ${f.text}`),
    '',
    'Still check by hand (the registry cannot tell): one h1 and one primary action per view, reading and focus order, contrast of your own content, empty / loading / error states, and that every section earns its place.',
  ];
  return lines.join('\n');
}
