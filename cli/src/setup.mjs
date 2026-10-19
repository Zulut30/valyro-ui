// Wiring for `init`: the global CSS import and <ThemeProvider>. Per-framework data lives in frameworks/.

import fs from 'node:fs';
import path from 'node:path';
import { BUNDLED_THEMES, CORE_THEMES, LIBRARY_PACKAGE, PRO_PACKAGE, THEME_FONTS } from './constants.mjs';

/** The npm package with a theme's CSS and fonts: the free core, or ValyroUI Pro for the other themes. */
const packageFor = (theme) => (CORE_THEMES.includes(theme) ? LIBRARY_PACKAGE : PRO_PACKAGE);
import { adapterByName } from './frameworks/index.mjs';

function importBase(entry, config) {
  if (config.alias) return config.alias;
  const rel = path.posix.relative(path.posix.dirname(entry), config.installDir.replace(/\\/g, '/'));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** The adapter's patch data; null for CSS-only and unknown frameworks. */
function patchData(framework, config, projectDir) {
  const adapter = adapterByName(framework);
  if (adapter?.kind !== 'react') return null;
  return typeof adapter.patch === 'function' ? adapter.patch(config, projectDir) : adapter.patch;
}

/**
 * Describes the setup for a project: which file to touch and what to add.
 * @returns {{ entry: string | null, imports: string[], anchor: RegExp | null, attrs: string, headLink?: string | null, snippet: string, notes: string[] }}
 */
export function setupPlan(framework, config, projectDir) {
  const data = patchData(framework, config, projectDir);
  const candidates = data?.entries ?? [];
  const entry = candidates.find((f) => fs.existsSync(path.join(projectDir, f))) ?? candidates[0] ?? null;
  const base = importBase(entry ?? 'index.tsx', config);
  const theme = config.theme ?? 'vercel';
  const mode = config.mode ?? 'light';
  const provider = `<ThemeProvider theme="${theme}" mode="${mode}">`;
  const attrs = `data-theme="${theme}" data-mode="${mode}"`;
  // styles/index.css imports only the bundled themes; the styles item has the other free ones, `<name>-theme` a Pro one.
  const cssFiles = ['styles/index.css', ...(BUNDLED_THEMES.includes(theme) ? [] : [`styles/themes/${theme}.css`])];
  const cssImports = cssFiles.map((file, i) => (data?.cssImport ? data.cssImport(base, file, i) : `import '${base}/${file}';`));
  const headLink = data?.headLink ? cssFiles.map((_, i) => data.headLink(i)).join(', ') : null;
  const providerImport = `import { ThemeProvider } from '${base}/theme/ThemeProvider';`;
  const notes = [];
  if (framework === 'unknown') notes.push('Framework not detected: add the CSS import and ThemeProvider to your app entry.');
  if (data?.note) notes.push(data.note({ attrs, provider }));
  const fonts = THEME_FONTS[theme] ?? [];
  // Registry items are text, so the woff2 files come from the npm package.
  if (fonts.length) {
    notes.push(
      `The ${theme} theme's fonts are self-hosted in the ${packageFor(theme)} package: install it and import ${fonts.map((id) => `'${packageFor(theme)}/fonts/${id}.css'`).join(', ')} (until then text uses metric-matched system fonts).`,
    );
  }

  if (data?.islands) {
    return {
      entry,
      imports: cssImports,
      anchor: null,
      attrs,
      snippet: [`---`, ...cssImports, `---`, `<html lang="en" ${attrs}>`].join('\n'),
      notes,
    };
  }

  // Server-rendered apps also get the attributes on <html> so the first paint uses the theme.
  const ssr = Boolean(data?.ssr);
  return {
    entry,
    imports: [...cssImports, providerImport],
    anchor: data?.anchor ?? null,
    attrs: ssr ? attrs : '',
    headLink,
    snippet: [
      ...cssImports,
      providerImport,
      '',
      ...(headLink ? [`head: () => ({ links: [${headLink}, …] }),`] : []),
      ...(ssr ? [`<html lang="en" ${attrs}>`] : []),
      provider,
      `  ${data?.wrapped ?? '<App />'}`,
      '</ThemeProvider>',
    ].join('\n'),
    notes,
  };
}

/**
 * Applies a setup plan to the entry file's source. Every step must match
 * exactly once, otherwise nothing changes.
 * @returns {{ content: string } | { error: string }}
 */
export function applySetup(source, plan, config) {
  if (source.includes('/styles/index.css') && (plan.anchor === null || source.includes('ThemeProvider'))) {
    return { error: 'already set up' };
  }
  let content = source;
  if (plan.anchor) {
    const matches = [...content.matchAll(plan.anchor)];
    if (matches.length !== 1) return { error: `expected exactly one ${plan.anchor.source} in the file, found ${matches.length}` };
    const [m] = matches;
    const provider = `<ThemeProvider theme="${config.theme ?? 'vercel'}" mode="${config.mode ?? 'light'}">`;
    content = `${content.slice(0, m.index)}${provider}${m[0]}</ThemeProvider>${content.slice(m.index + m[0].length)}`;
  }
  if (plan.headLink) {
    const links = [...content.matchAll(/\blinks:\s*\[/g)];
    if (links.length !== 1) return { error: `expected exactly one "links: [" in head(), found ${links.length}` };
    const at = links[0].index + links[0][0].length;
    const rest = content.slice(at);
    // One link per line stays one per line; `links: []` becomes `links: [link]`.
    const lineBreak = /^[ \t]*\r?\n[ \t]*/.exec(rest)?.[0];
    const link = lineBreak ? `${lineBreak}${plan.headLink},` : /^\s*\]/.test(rest) ? plan.headLink : `${plan.headLink}, `;
    content = `${content.slice(0, at)}${link}${rest}`;
  }
  if (plan.attrs) {
    const html = [...content.matchAll(/<html\b/g)];
    if (html.length === 1 && !/<html\b[^>]*data-theme=/.test(content)) {
      content = `${content.slice(0, html[0].index)}<html ${plan.attrs}${content.slice(html[0].index + 5)}`;
    }
  }
  const inserted = insertImports(content, plan.imports, plan.entry ?? '');
  if (inserted === null) return { error: 'could not find where to add imports' };
  return { content: inserted };
}

const IMPORT_RE = /^import\s[^;]*?['"][^'"\n]+['"];?[ \t]*$|^import\s*['"][^'"\n]+['"];?[ \t]*$/gm;

/** Adds import lines after the last top-level import (inside the frontmatter for .astro). */
export function insertImports(content, lines, file) {
  const block = lines.join('\n');
  if (file.endsWith('.astro')) {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!fm) return `---\n${block}\n---\n${content}`;
    const bodyStart = fm.index + fm[0].indexOf('\n') + 1;
    const body = fm[1];
    const last = [...body.matchAll(IMPORT_RE)].at(-1);
    const at = last ? bodyStart + last.index + last[0].length : bodyStart - 1;
    return `${content.slice(0, at)}\n${block}${content.slice(at)}`;
  }
  const last = [...content.matchAll(IMPORT_RE)].at(-1);
  if (last) {
    const at = last.index + last[0].length;
    return `${content.slice(0, at)}\n${block}${content.slice(at)}`;
  }
  const directive = /^(['"])use client\1;?[ \t]*\r?\n/.exec(content);
  const at = directive ? directive[0].length : 0;
  return `${content.slice(0, at)}${block}\n${at ? '' : '\n'}${content.slice(at)}`;
}

/**
 * The manual setup printed by `init` for a framework that uses only the CSS.
 * `{attrs}`, `{theme}` and `{mode}` in the adapter's lines are filled in here.
 * @param {{ theme: string, mode: string, install: string, siteUrl: string }} options
 * @returns {string[]} output lines
 */
export function cssOnlySteps(framework, { theme, mode, install, siteUrl }) {
  const adapter = adapterByName(framework);
  if (adapter?.kind !== 'css') throw new Error(`No CSS-only setup for "${framework}"`);
  const setup = adapter.manual;
  const fill = (text) =>
    text.replace('{attrs}', `data-theme="${theme}" data-mode="${mode}"`).replace('{theme}', theme).replace('{mode}', mode);
  const css = cssLines(fill(setup.css[1]), packageStylesheets(theme));
  const rows = [
    ['Install the package', install],
    [setup.css[0], packageFor(theme) === LIBRARY_PACKAGE ? css : css.replace(new RegExp(`(['"])${LIBRARY_PACKAGE}/`, 'g'), `$1${PRO_PACKAGE}/`)],
    [setup.theme[0], fill(setup.theme[1])],
  ];
  const width = Math.max(...rows.map(([label]) => label.length)) + 1;
  const pad = ' '.repeat(width + 7);
  return [
    `Detected ${setup.label}. ValyroUI components are React, so ${setup.label} uses the kit's CSS and static markup; no files were changed.`,
    '',
    ...rows.map(([label, value], i) => `  ${i + 1}. ${`${label}:`.padEnd(width + 1)} ${value.replace(/\n/g, `\n${pad}`)}`),
    '  4. Copy markup from the HTML tab of static components (Button, Badge, Card, Alert, TextInput…).',
    '     Interactive components (Select, Dialog, Tabs, toasts…) need React.',
    ...(setup.note ? [`Note: ${setup.note}`] : []),
    '',
    `Guide: ${siteUrl}/#/getting-started/${adapter.guide}`,
  ];
}

/** Stylesheets from the npm package after `valyro-ui/styles.css`: an opt-in theme file, then the theme's fonts. */
function packageStylesheets(theme) {
  return [
    ...(BUNDLED_THEMES.includes(theme) ? [] : [`${LIBRARY_PACKAGE}/themes/${theme}.css`]),
    ...(THEME_FONTS[theme] ?? []).map((id) => `${LIBRARY_PACKAGE}/fonts/${id}.css`),
  ];
}

/**
 * The adapter's stylesheet line extended with more package stylesheets: one more line per file
 * (`import '…';`, `@import '…';`), or more entries in the same array (Nuxt's `css: ['…'],`).
 */
function cssLines(line, extra) {
  const quoted = new RegExp(`(['"])${LIBRARY_PACKAGE}/styles\\.css\\1`);
  const m = quoted.exec(line);
  if (!m || !extra.length) return line;
  const q = m[1];
  if (/\[\s*$/.test(line.slice(0, m.index))) {
    return line.replace(quoted, [`${LIBRARY_PACKAGE}/styles.css`, ...extra].map((file) => `${q}${file}${q}`).join(', '));
  }
  return [line, ...extra.map((file) => line.replace(quoted, `${q}${file}${q}`))].join('\n');
}
