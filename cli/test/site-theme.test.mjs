import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { renderCliTheme, SOURCE, TARGET } from '../../scripts/build-cli-theme.mjs';
import { componentTokens, parseStyleTokens, tuneComponents } from '../src/component-tokens.mjs';
import { createThemeCSS } from '../src/generated/create-theme-css.mjs';
import { createMcpHandler } from '../src/mcp.mjs';
import { createRegistry } from '../src/registry.mjs';
import { buildSiteTheme, characterHints, contrastChecks, extractDesign, fetchSiteCss, fixContrast, formatSiteTheme, parseCssColor } from '../src/site-theme.mjs';
import { cleanup, fixtureRegistry } from './helpers.mjs';

afterAll(cleanup);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hex = (value) => {
  const c = parseCssColor(value);
  return `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
};

describe('createThemeCSS copy in the CLI', () => {
  it('matches src/lib/theme/createThemeCSS.ts (run `node scripts/build-cli-theme.mjs` after changing it)', () => {
    const fresh = renderCliTheme(fs.readFileSync(path.join(root, SOURCE), 'utf8'));
    expect(fs.readFileSync(path.join(root, TARGET), 'utf8').replace(/\r\n/g, '\n')).toBe(fresh);
  });

  it('generates the same CSS as the library', () => {
    expect(createThemeCSS({ theme: 'glass', accent: '#ff2d55', radius: 1.25 })).toMatch(/^\[data-theme='glass'\] \{\n {2}--ui-radius-xs: 10px;/);
  });
});

describe('parseCssColor', () => {
  it('reads the colour syntaxes sites use', () => {
    expect(hex('#0af')).toBe('#00aaff');
    expect(parseCssColor('#00aaff80').a).toBeCloseTo(0.502, 2);
    expect(hex('rgb(10 20 30 / 50%)')).toBe('#0a141e');
    expect(hex('hsl(210deg 40% 50%)')).toBe('#4d80b3');
    expect(hex('hsla(0, 100%, 50%, 0.5)')).toBe('#ff0000');
    expect(hex('222.2 47.4% 11.2%')).toBe('#0f172a');
    expect(hex('oklch(62.8% 0.2577 29.23)')).toBe('#ff0000');
    expect(hex('white')).toBe('#ffffff');
    expect(parseCssColor('var(--x)')).toBeNull();
    expect(parseCssColor('linear-gradient(red, blue)')).toBeNull();
  });
});

describe('extractDesign', () => {
  it('reads shadcn-style variables, ignoring the dark block', () => {
    const design = extractDesign(`
      :root { --background: 0 0% 100%; --foreground: 222.2 84% 4.9%; --primary: 262 83% 58%; --radius: 0.75rem;
              --font-sans: "Manrope", sans-serif; }
      .dark { --primary: 263 70% 50%; --background: 222.2 84% 4.9%; }
      /* --primary: #ff0000 in a comment */`);
    expect(design).toMatchObject({ accent: '#7c3bed', background: '#ffffff', text: '#020817', radius: 12, fontSans: '"Manrope", sans-serif', darkVariables: 2 });
    expect(design.sources.accent).toBe('custom property --primary');
  });

  it('resolves var() chains and Bootstrap / Tailwind names', () => {
    const design = extractDesign(':root { --brand-blue: #0d6efd; --bs-primary: var(--brand-blue); --bs-border-radius: 0.375rem; --spacing: 0.25rem; --bs-body-font-family: system-ui, sans-serif }');
    expect(design).toMatchObject({ accent: '#0d6efd', radius: 6, spacing: 4, fontSans: 'system-ui, sans-serif' });
  });

  it('falls back to base rules when there are no variables', () => {
    const design = extractDesign('body { background: #fffaf0; color: #3b2f2f; font-family: Georgia, serif } h1 { font-family: "Playfair Display", serif } .btn-primary { background-color: #c2410c } button { height: 48px; border-radius: 4px }');
    expect(design).toMatchObject({ background: '#fffaf0', text: '#3b2f2f', accent: '#c2410c', fontSans: 'Georgia, serif', fontDisplay: '"Playfair Display", serif', controlHeight: 48, radius: 4 });
    expect(design.sources.accent).toBe('.btn-primary { background-color }');
  });
});

describe('buildSiteTheme', () => {
  it('turns site CSS into createThemeCSS options; explicit values win', () => {
    const css = ':root { --primary: #7c3aed; --radius: 12px; --foreground: #0f172a; } button { height: 32px }';
    const result = buildSiteTheme({ css, accent: '#0ea5e9', character: 'спокойный, воздушный' });
    expect(result.theme).toBe('vercel');
    expect(result.options).toMatchObject({ accent: '#0ea5e9', radius: 1.5, density: 'compact' });
    expect(result.options.gray.hue).toBeGreaterThan(250);
    expect(result.css).toContain("[data-theme='vercel'] {");
    expect(result.css).toContain('--ui-accent: #0ea5e9;');
    expect(result.css).toContain('--ui-radius-md: 12px;');
    expect(result.changes.join('\n')).toContain('density compact (controls 32px high, button { height })');
  });

  it('maps wishes and non-builder bases', () => {
    expect(characterHints('strict, dense dashboard').map((h) => h.why)).toEqual(['strict / minimal', 'dense / data-heavy']);
    const glass = buildSiteTheme({ accent: '#ff2d55', character: 'frosted glass, soft' });
    expect(glass.theme).toBe('glass');
    expect(glass.options).toMatchObject({ radius: 1.5, shadow: 1.2 });
    const cyber = buildSiteTheme({ accent: '#22c55e', base: 'cyber' });
    expect(cyber.theme).toBe('vercel');
    expect(cyber.notes[0]).toContain('createThemeCSS refines only vercel and glass');
    expect(() => buildSiteTheme({ base: 'nope', accent: '#000' })).toThrow(/Unknown base theme/);
    expect(() => buildSiteTheme({ accent: 'rgba(0, 0, 0, 0.5)' })).toThrow(/opaque/);
  });

  it('auto-corrects an accent no text colour can sit on at 4.5:1', () => {
    expect(contrastChecks({ theme: 'vercel', accent: '#777777' }).some((c) => c.group === 'accent' && c.ratio < 4.5)).toBe(true);
    const result = buildSiteTheme({ accent: '#777777' });
    expect(result.options.accent).not.toBe('#777777');
    expect(result.fixes[0]).toMatch(/^accent #777777 → #[0-9a-f]{6}: text on the original fill reached only 4\.\d\d:1/);
    expect(result.checks.filter((c) => c.ratio < c.min)).toEqual([]);
  });

  it('keeps field edges at 3:1 under a grey tint (createThemeCSS strengthens lifted inks)', () => {
    const tinted = { theme: 'vercel', gray: { hue: 257, chroma: 0.035 } };
    expect(contrastChecks(tinted).filter((c) => c.group === 'edge' && c.ratio < 3)).toEqual([]);
    const fixed = fixContrast(tinted);
    expect(fixed.extra).toEqual({ light: {}, dark: {} });
    expect(fixed.remaining).toEqual([]);
    expect(buildSiteTheme({ text: '#0f172a' }).remaining).toEqual([]);
  });

  it('raises a field edge that falls below 3:1 just enough, per mode', () => {
    // Base themes and grey tints pass now, so weak edges come in through token overrides (as a site's CSS or a
    // Theme Builder export could bring them), one ink per mode.
    const weak = { theme: 'vercel', tokens: { light: { 'border-field': 'rgba(0, 0, 0, 0.2)' }, dark: { 'border-field': 'rgba(255, 255, 255, 0.15)' } } };
    const failing = (options) => contrastChecks(options).filter((c) => c.group === 'edge' && c.ratio < 2.995);
    expect(new Set(failing(weak).map((c) => c.mode))).toEqual(new Set(['light', 'dark']));

    const fixed = fixContrast(weak);
    expect(fixed.remaining).toEqual([]);
    expect(fixed.checks.filter((c) => c.group === 'edge').every((c) => c.ratio >= 2.995)).toBe(true);
    const inks = { light: '0, 0, 0', dark: '255, 255, 255' };
    const start = { light: 0.2, dark: 0.15 };
    for (const mode of ['light', 'dark']) {
      const alpha = Number(new RegExp(`^rgba\\(${inks[mode]}, ([\\d.]+)\\)$`).exec(fixed.extra[mode]['border-field'])?.[1]);
      expect(alpha, mode).toBeGreaterThan(start[mode]);
      // Just enough: one step (0.02) less alpha fails again.
      const less = `rgba(${inks[mode]}, ${Math.round((alpha - 0.02) * 100) / 100})`;
      expect(failing({ ...weak, tokens: { ...weak.tokens, [mode]: { 'border-field': less } } }).some((c) => c.mode === mode), mode).toBe(true);
    }
    expect(fixed.changes).toEqual([
      expect.stringMatching(/^--ui-border-field \(light\) rgba\(0, 0, 0, 0\.2\) → rgba\(0, 0, 0, 0\.\d+\): the field edge fell to 1\.\d\d:1 \(WCAG 1\.4\.11 needs 3:1\)$/),
      expect.stringMatching(/^--ui-border-field \(dark\) rgba\(255, 255, 255, 0\.15\) → rgba\(255, 255, 255, 0\.\d+\): the field edge fell to/),
    ]);

    // Only the failing mode changes.
    const darkOnly = fixContrast({ theme: 'vercel', tokens: { dark: weak.tokens.dark } });
    expect(darkOnly.extra.light).toEqual({});
    expect(darkOnly.extra.dark['border-field']).toBe(fixed.extra.dark['border-field']);
  });

  it("separates the base theme's own shortfalls from new ones", () => {
    const glass = buildSiteTheme({ base: 'glass', accent: '#0071e3' });
    // Every base theme meets AA now, so a shortfall of the base itself is simulated.
    expect(glass.remaining).toEqual([]);
    const gap = { mode: 'light', token: 'fg-subtle', backdrop: 'bg', label: 'fg-subtle on bg', ratio: 4.1, min: 4.5, inherited: true };
    const text = formatSiteTheme({ ...glass, remaining: [gap] }, { components: ['button'] });
    expect(text).toContain('Below AA in the glass base theme itself (not changed by this theme):');
    expect(text).toContain('https://valyro.xyz/#/theme-builder?theme=glass');
    expect(text).toContain('https://valyro.xyz/?test=button&demo=all&theme=glass&mode=light');
    expect(text).toContain("import 'valyro-ui/styles.css';");
  });
});

describe('fetchSiteCss', () => {
  const response = (body, type) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': type }), text: async () => body });

  it('reads only the given URLs: stylesheets, and inline styles of pages', async () => {
    const fetch = vi.fn(async (url) =>
      url.endsWith('.css')
        ? response(':root { --primary: #e11d48 }', 'text/css; charset=utf-8')
        : response('<html><head><link rel="stylesheet" href="/app.css"><style>body { color: #111 }</style><script>alert(1)</script></head></html>', 'text/html'),
    );
    const { sheets, notes } = await fetchSiteCss(['https://example.com/', 'https://example.com/theme.css'], { fetch });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sheets.map((s) => s.css)).toEqual(['body { color: #111 }', ':root { --primary: #e11d48 }']);
    expect(notes[0]).toContain('not fetched (pass them in cssUrls to include): https://example.com/app.css');
  });

  it('rejects other schemes and too many URLs', async () => {
    await expect(fetchSiteCss(['file:///etc/passwd'], { fetch: vi.fn() })).rejects.toThrow(/Only http\(s\)/);
    await expect(fetchSiteCss(['javascript:alert(1)'], { fetch: vi.fn() })).rejects.toThrow(/Only http\(s\)/);
    await expect(fetchSiteCss(Array(6).fill('https://a.test/x.css'), { fetch: vi.fn() })).rejects.toThrow(/At most 5/);
  });
});

const STYLES_ITEM = {
  name: 'styles',
  files: [
    { path: 'valyro-ui/styles/tokens.css', content: ':where(:root, [data-theme]) {\n  --ui-label-transform: initial;\n  --ui-badge-radius: initial;\n}\n' },
    {
      path: 'valyro-ui/styles/themes/vercel.css',
      content:
        "[data-theme='vercel'] {\n  --ui-accent: #0070f3;\n  --ui-radius-button: 6px;\n  /* ── Component tokens: --ui-<component>-<property> ── */\n  --ui-button-solid-glow: 0 0 #0000;\n}\n\n[data-theme='vercel'][data-mode='dark'] {\n  --ui-button-solid-glow: 0 0 8px #0070f3;\n}\n",
    },
  ],
};
const BUTTON_ITEM = {
  name: 'button',
  files: [
    { path: 'valyro-ui/basic/Button.css', content: '.ui-button { border-radius: var(--ui-radius-button); text-transform: var(--ui-label-transform); box-shadow: var(--ui-button-solid-glow); background: var(--ui-accent); width: var(--ui-button-width-internal); }\n.ui-button__icon { }' },
  ],
};

describe('component tokens', () => {
  const styles = parseStyleTokens(STYLES_ITEM);
  const info = componentTokens(BUTTON_ITEM, styles, 'vercel');

  it('sorts what a component reads into public groups', () => {
    expect(info).toMatchObject({ root: 'ui-button', component: ['--ui-button-solid-glow'], hook: ['--ui-label-transform'], semantic: ['--ui-accent', '--ui-radius-button'] });
    expect(info.value('--ui-button-solid-glow', 'dark')).toBe('0 0 8px #0070f3');
  });

  it('writes overrides through public tokens only, scoping global ones to the component', () => {
    const { css, applied, rejected } = tuneComponents({
      infos: [info],
      theme: 'vercel',
      overrides: { 'button-solid-glow': '0 0 0 2px var(--ui-accent-soft)', '--ui-label-transform': 'uppercase', '--ui-gap': '4px', '--ui-accent': 'red; } body { display: none' },
    });
    expect(css).toBe(
      "[data-theme='vercel'],\n[data-theme='vercel'][data-mode='dark'] {\n  --ui-button-solid-glow: 0 0 0 2px var(--ui-accent-soft);\n}\n\n[data-theme='vercel'] .ui-button {\n  --ui-label-transform: uppercase;\n}",
    );
    expect(applied).toHaveLength(2);
    expect(rejected.map((r) => r.split(':')[0])).toEqual(['--ui-gap', '--ui-accent']);
  });
});

describe('MCP theme tools', () => {
  const fakeRegistry = { index: async () => [{ name: 'button' }], item: async (name) => ({ item: { styles: STYLES_ITEM, button: BUTTON_ITEM }[name] }) };
  const call = async (h, name, args) => (await h.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;

  it('create_site_theme builds from CSS, validates input and names', async () => {
    const h = createMcpHandler({ registry: createRegistry(fixtureRegistry()), version: '1.0.0' });
    const ok = await call(h, 'create_site_theme', { css: ':root { --primary: #16a34a; --radius: 4px }', components: ['button'] });
    expect(ok.isError).toBe(false);
    expect(ok.content[0].text).toContain('Read: "css" (');
    expect(ok.content[0].text).toContain('--ui-accent: #16a34a;');
    expect((await call(h, 'create_site_theme', {})).isError).toBe(true);
    expect((await call(h, 'create_site_theme', { accent: '#16a34a', components: ['nope'] })).content[0].text).toContain('Unknown component(s): nope');
  });

  it('tune_components lists tokens, then returns CSS', async () => {
    const h = createMcpHandler({ registry: fakeRegistry, version: '1.0.0' });
    expect((await call(h, 'tune_components', { components: ['button'] })).content[0].text).toContain('- --ui-button-solid-glow: 0 0 #0000 / 0 0 8px #0070f3');
    const tuned = (await call(h, 'tune_components', { components: ['button'], overrides: { '--ui-radius-button': '0px' } })).content[0].text;
    expect(tuned).toContain("[data-theme='vercel'] .ui-button {\n  --ui-radius-button: 0px;\n}");
    expect((await call(h, 'tune_components', { components: ['button'], theme: 'nope' })).isError).toBe(true);
  });
});
