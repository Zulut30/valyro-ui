// Fitting single components to a site through public tokens only: the component tokens of each
// theme file (--ui-<component>-<property>, "Component tokens" block), the decoration hooks of
// styles/tokens.css, and the semantic tokens a component reads. Never edits component sources.

import { CliError } from './registry.mjs';

const COMPONENT_MARKER = /──\s*Component tokens/;
const UNSAFE_VALUE = /[;{}<>]|\/\*|\*\/|@import|javascript:|expression\s*\(|\\[0-9a-f]/i;
const MAX_VALUE = 400;

/** Custom-property declarations of one block body, in order. */
const declarations = (body) => [...body.matchAll(/(--ui-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]);

/** Body of the first `selector {…}` block (no nested braces in theme blocks). */
function blockBody(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('\n}', open));
}

/**
 * Public tokens from the `styles` registry item: decoration hooks (tokens.css) and, per theme, the
 * light and dark values plus which names are component tokens.
 */
export function parseStyleTokens(stylesItem) {
  const file = (suffix) => stylesItem.files?.find((f) => f.path.endsWith(suffix))?.content ?? '';
  const tokensCss = file('styles/tokens.css');
  const hookBody = /:where\(:root, \[data-theme\]\)\s*\{([^}]*)\}/.exec(tokensCss)?.[1] ?? '';
  const hooks = new Map(declarations(hookBody));
  const themes = new Map();
  for (const f of stylesItem.files ?? []) {
    const id = /styles\/themes\/([\w-]+)\.css$/.exec(f.path)?.[1];
    if (!id) continue;
    const light = blockBody(f.content, `[data-theme='${id}']`) ?? '';
    const dark = blockBody(f.content, `[data-theme='${id}'][data-mode='dark']`) ?? '';
    const marker = light.search(COMPONENT_MARKER);
    themes.set(id, {
      light: new Map(declarations(light)),
      dark: new Map(declarations(dark)),
      semantic: new Set(declarations(marker === -1 ? light : light.slice(0, marker)).map(([n]) => n)),
      component: new Set(marker === -1 ? [] : declarations(light.slice(marker)).map(([n]) => n)),
    });
  }
  if (!themes.size) throw new CliError('The styles registry item has no theme files');
  return { hooks, themes };
}

/** Tokens one component reads, sorted into component tokens, decoration hooks and semantic tokens. */
export function componentTokens(item, styles, themeId) {
  const theme = styles.themes.get(themeId);
  if (!theme) throw new CliError(`Unknown theme "${themeId}"`);
  const read = new Set();
  const classes = [];
  for (const file of item.files ?? []) {
    for (const m of file.content.matchAll(/var\(\s*(--ui-[\w-]+)/g)) read.add(m[1]);
    if (/\.css$/.test(file.path)) for (const m of file.content.matchAll(/\.(ui-[a-z0-9-]+)(?![\w-])/g)) if (!m[1].includes('__')) classes.push(m[1]);
  }
  const groups = { component: [], hook: [], semantic: [] };
  for (const name of [...read].sort()) {
    // A component token is one some theme sets in its Component tokens block (others may leave it to the fallback).
    if ([...styles.themes.values()].some((t) => t.component.has(name))) groups.component.push(name);
    else if (styles.hooks.has(name)) groups.hook.push(name);
    else if (theme.semantic.has(name)) groups.semantic.push(name);
    // Anything else is internal (set inline by the component) and not part of the public surface.
  }
  const root = classes.includes(`ui-${item.name}`) ? `ui-${item.name}` : classes[0] ?? null;
  return { name: item.name, root, ...groups, value: (token, mode = 'light') => (mode === 'dark' ? theme.dark.get(token) : undefined) ?? theme.light.get(token) ?? styles.hooks.get(token) };
}

const normalize = (token) => (token.startsWith('--') ? token : token.startsWith('ui-') ? `--${token}` : `--ui-${token}`);

/**
 * CSS that applies `overrides` ({ token: value }) for the given components. Component tokens go on
 * the theme selector (only that component reads them); hooks and semantic tokens are scoped to the
 * component's root class unless `scope` is "theme", so the rest of the page keeps its look.
 */
export function tuneComponents({ infos, theme, overrides = {}, mode = 'both', scope = 'component' }) {
  const themeSel = `[data-theme='${theme}']`;
  const darkSel = `${themeSel}[data-mode='dark']`;
  const applied = [];
  const rejected = [];
  const themeBlock = new Map();
  const scoped = new Map();
  for (const [rawToken, rawValue] of Object.entries(overrides)) {
    const token = normalize(rawToken.trim());
    const value = String(rawValue).trim();
    if (!/^--ui-[a-z0-9-]+$/.test(token)) {
      rejected.push(`${rawToken}: not a --ui-* token name`);
      continue;
    }
    if (!value || value.length > MAX_VALUE || UNSAFE_VALUE.test(value)) {
      rejected.push(`${token}: unsafe or empty value (no ; { } < > comments, @import, escapes or scripts)`);
      continue;
    }
    const readers = infos.filter((info) => [...info.component, ...info.hook, ...info.semantic].includes(token));
    if (!readers.length) {
      rejected.push(`${token}: none of ${infos.map((i) => i.name).join(', ')} reads it publicly (see the token lists)`);
      continue;
    }
    const isComponentToken = readers.every((info) => info.component.includes(token));
    if (isComponentToken || scope === 'theme') {
      themeBlock.set(token, value);
      applied.push(`${token}: ${value} (${isComponentToken ? 'component token' : 'theme-wide'}; read by ${readers.map((r) => r.name).join(', ')})`);
    } else {
      for (const info of readers) {
        if (!info.root) {
          rejected.push(`${token}: ${info.name} has no root class to scope it to; pass "scope": "theme" to set it theme-wide`);
          continue;
        }
        if (!scoped.has(info.root)) scoped.set(info.root, new Map());
        scoped.get(info.root).set(token, value);
        applied.push(`${token}: ${value} (only inside .${info.root})`);
      }
    }
  }
  const body = (tokens) => [...tokens].map(([t, v]) => `  ${t}: ${v};`).join('\n');
  const blocks = [];
  // A theme's dark block sets many component tokens again, so "both" lists the dark selector too.
  const themeSelectors = mode === 'dark' ? darkSel : mode === 'light' ? themeSel : `${themeSel},\n${darkSel}`;
  if (themeBlock.size) blocks.push(`${themeSelectors} {\n${body(themeBlock)}\n}`);
  for (const [root, tokens] of scoped) {
    const sel = mode === 'dark' ? `${darkSel} .${root}` : mode === 'light' ? `${themeSel}:not([data-mode='dark']) .${root}` : `${themeSel} .${root}`;
    blocks.push(`${sel} {\n${body(tokens)}\n}`);
  }
  if (mode === 'light' && themeBlock.size) {
    // The light block also applies in dark mode unless the theme's dark block redeclares the token.
    applied.push(`note: ${themeSel} also applies in dark mode where the theme has no dark value; pass "mode": "both" to set both`);
  }
  return { css: blocks.join('\n\n'), applied, rejected };
}

/** Token catalogue for the tool when no overrides are given. */
export function formatTokenCatalog(infos, theme) {
  const lines = [`Public tokens in the ${theme} theme (light value; dark value after "/" when it differs):`];
  for (const info of infos) {
    const show = (token) => {
      const light = info.value(token, 'light');
      const dark = info.value(token, 'dark');
      return `${token}: ${light === '' ? '(empty)' : light ?? '(unset)'}${dark !== undefined && dark !== light ? ` / ${dark}` : ''}`;
    };
    lines.push('', `## ${info.name}${info.root ? ` (root class .${info.root})` : ''}`);
    lines.push(info.component.length ? `Component tokens (${info.component.length}):` : 'Component tokens: none');
    lines.push(...info.component.map((t) => `- ${show(t)}`));
    if (info.hook.length) lines.push(`Decoration hooks it reads (${info.hook.length}; "initial" = off):`, ...info.hook.map((t) => `- ${show(t)}`));
    if (info.semantic.length) lines.push(`Semantic tokens it reads (${info.semantic.length}; changing them here scopes them to this component): ${info.semantic.join(', ')}`);
  }
  lines.push('', 'Call again with "overrides": { "<token>": "<value>" } to get the CSS. Values must be plain CSS values; prefer var(--ui-*) references over raw colours so dark mode keeps working.');
  return lines.join('\n');
}
