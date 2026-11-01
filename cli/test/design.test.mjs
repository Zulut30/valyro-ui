import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocsRegistry } from '../../scripts/registry/parse.mjs';
import { parseStyleTokens } from '../src/component-tokens.mjs';
import { apcaContrast, checkContrast, CHECKLIST, matchScreen, planScreen, SCREENS, themeColors } from '../src/design.mjs';
import { createMcpHandler } from '../src/mcp.mjs';
import { extractInterface, propsOf } from '../src/registry.mjs';

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const WHITE = { r: 255, g: 255, b: 255, a: 1 };

const STYLES_ITEM = {
  name: 'styles',
  files: [
    { path: 'valyro-ui/styles/tokens.css', content: ':where(:root, [data-theme]) {\n  --ui-label-transform: initial;\n}\n' },
    {
      path: 'valyro-ui/styles/themes/vercel.css',
      content:
        "[data-theme='vercel'] {\n  --ui-gray-500: #8f8f8f;\n  --ui-bg: #ffffff;\n  --ui-fg: #171717;\n  --ui-fg-subtle: var(--ui-gray-500);\n  --ui-overlay: rgb(0 0 0 / 0.5);\n}\n\n[data-theme='vercel'][data-mode='dark'] {\n  --ui-bg: #0a0a0a;\n  --ui-fg: #ededed;\n}\n",
    },
  ],
};

describe('contrast', () => {
  it('computes APCA Lc with the reference values for black and white', () => {
    expect(apcaContrast(BLACK, WHITE)).toBeCloseTo(106.04, 1);
    expect(apcaContrast(WHITE, BLACK)).toBeCloseTo(-107.88, 1);
    expect(apcaContrast(WHITE, WHITE)).toBe(0);
  });

  it('checks plain colours against the thresholds of their use and proposes a passing colour', () => {
    const [grey, large, icon] = checkContrast([
      { fg: '#999999', bg: '#ffffff' },
      { fg: '#999999', bg: '#ffffff', use: 'large-text' },
      { fg: 'hsl(0 0% 46%)', bg: 'white', use: 'non-text' },
    ]);
    expect(grey.ratio).toBeCloseTo(2.85, 2);
    expect(grey).toMatchObject({ aa: false, aaa: false });
    expect(checkContrast([{ fg: grey.fix, bg: '#ffffff' }])[0].aa).toBe(true);
    expect(large.aa).toBe(false);
    expect(icon).toMatchObject({ aa: true, fix: null });
  });

  it('resolves theme tokens per mode and composites translucent colours', () => {
    const styles = parseStyleTokens(STYLES_ITEM);
    const light = themeColors(styles, 'vercel', 'light');
    const dark = themeColors(styles, 'vercel', 'dark');
    const [subtle] = checkContrast([{ fg: '--ui-fg-subtle', bg: 'var(--ui-bg)' }], { vars: light });
    expect(subtle).toMatchObject({ aa: false, fix: null });
    expect(subtle.fg.resolved).toBe('#8f8f8f');
    expect(checkContrast([{ fg: '--ui-fg', bg: '--ui-bg' }], { vars: dark })[0].ratio).toBeGreaterThan(15);
    // Half-black over the white page is mid grey.
    expect(checkContrast([{ fg: '#ffffff', bg: '--ui-overlay' }], { vars: light })[0].ratio).toBeCloseTo(3.98, 1);
    expect(checkContrast([{ fg: '--ui-fg', bg: '#fff' }])[0].error).toMatch(/give "theme"/);
    expect(checkContrast([{ fg: '--ui-missing', bg: '#fff' }], { vars: light })[0].error).toMatch(/not a plain colour/);
  });
});

describe('screen plans', () => {
  it('matches tasks in English and Russian, short keywords only as whole words', () => {
    expect(matchScreen({ task: 'Sales analytics dashboard for managers' }).id).toBe('dashboard');
    expect(matchScreen({ task: 'нужен лендинг для стартапа' }).id).toBe('landing');
    expect(matchScreen({ task: 'страница настроек профиля' }).id).toBe('settings');
    expect(matchScreen({ task: 'chat with an AI assistant' }).id).toBe('ai-assistant');
    expect(matchScreen({ task: 'detailed email preferences' })?.id).not.toBe('ai-assistant');
    expect(matchScreen({ task: 'xyz' })).toBeNull();
    expect(matchScreen({ screen: 'explainer' }).id).toBe('explainer');
  });

  it('names only components the docs registry has', () => {
    const ids = new Set(parseDocsRegistry(fs.readFileSync(new URL('../../src/docs/registry.ts', import.meta.url), 'utf8')).flatMap((c) => c.items.map((i) => i.id)));
    const unknown = SCREENS.flatMap((s) => s.sections.flatMap((section) => section.names)).filter((n) => !ids.has(n));
    expect(unknown).toEqual([]);
    expect(new Set(SCREENS.map((s) => s.id)).size).toBe(SCREENS.length);
    expect(CHECKLIST.every((g) => g.items.length)).toBe(true);
  });

  it('keeps live preferred names, and searches only for sections that have none', () => {
    const index = [
      { name: 'data-table', title: 'Data Table', description: 'Sortable table', meta: { category: 'data-display' } },
      { name: 'pivot-table', title: 'Pivot', description: 'A table that pivots', meta: { category: 'data-display' } },
      { name: 'styles', title: 'Styles table', categories: ['setup'], meta: { category: 'setup' } },
      { name: 'event-stream', title: 'Event stream', description: 'Recent activity of the team', meta: { category: 'data-display' } },
    ];
    const plan = planScreen(matchScreen({ screen: 'dashboard' }), index);
    expect(plan.find((s) => s.role === 'Detail table').candidates.map((c) => c.name)).toEqual(['data-table']);
    expect(plan.find((s) => s.role === 'Activity').candidates.map((c) => c.name)).toEqual(['event-stream']);
  });
});

describe('props API', () => {
  const code = [
    "import type { ReactNode } from 'react';",
    '/** Props of the button. */',
    'export interface ButtonProps {',
    "  /** Visual style, e.g. '}' never closes early. */",
    "  variant?: 'solid' | 'ghost';",
    '  // a { brace in a comment',
    '  icon?: { start?: ReactNode; end?: ReactNode };',
    '}',
    'export function Button(props: ButtonProps) { return null; }',
  ].join('\n');
  const item = { name: 'button', files: [{ path: 'valyro-ui/basic/Button.tsx', content: code }, { path: 'valyro-ui/basic/Button.css', content: '.x{}' }], meta: { exports: { 'basic/Button': ['Button'] } } };

  it('extracts the props interfaces of the exports, with braces in strings, comments and nested types', () => {
    expect(extractInterface(code, 'ButtonProps')).toBe(code.split('\n').slice(1, 8).join('\n'));
    expect(propsOf(item)).toHaveLength(1);
    expect(extractInterface(code, 'MissingProps')).toBeNull();
  });

  it('get_component returns the props instead of the files without source', async () => {
    const h = createMcpHandler({ registry: { item: async () => ({ item }) }, version: '1.0.0' });
    const res = await h.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_component', arguments: { name: 'button', includeSource: false } } });
    const text = res.result.content[0].text;
    expect(text).toContain('## Props\n\n```ts\n/** Props of the button. */\nexport interface ButtonProps {');
    expect(text).not.toContain('export function Button');
  });
});

describe('MCP design tools', () => {
  const index = [
    { name: 'kpi-group', title: 'KPI Group', meta: { category: 'data-display' } },
    { name: 'line-chart', title: 'Line Chart', pro: true, meta: { category: 'charts' } },
  ];
  const registry = { index: async () => index, item: async (name) => ({ item: { styles: STYLES_ITEM }[name] }) };
  const h = createMcpHandler({ registry, version: '1.0.0' });
  const call = async (name, args) => (await h.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;

  it('plan_screen plans from a task, marks Pro and validates input', async () => {
    const plan = (await call('plan_screen', { task: 'KPI dashboard', theme: 'linear' })).content[0].text;
    expect(plan).toContain('# Analytics or SaaS dashboard — KPI dashboard');
    expect(plan).toContain('Density: compact');
    expect(plan).toMatch(/KPI row — .*: kpi-group/);
    expect(plan).toMatch(/Main chart — .*: line-chart \(Pro\)/);
    expect(plan).toContain('Theme: linear');
    expect((await call('plan_screen', { task: 'qwerty' })).content[0].text).toContain('No screen archetype matches');
    for (const bad of [{}, { screen: 'nope' }, { task: 'dashboard', limit: 9 }, { screen: 'landing', theme: 'nope' }]) {
      expect((await call('plan_screen', bad)).isError).toBe(true);
    }
  });

  it('get_design_checklist puts the screen rules first', async () => {
    const all = (await call('get_design_checklist', {})).content[0].text;
    expect(all).toContain('## Anti-patterns that read as generic AI UI');
    expect(all).toContain('## Motion: soft and smooth');
    expect(all).toContain('## Overlays and focus');
    expect(all).toMatch(/Every interaction played in a real browser, not only in tests or still shots/);
    const form = (await call('get_design_checklist', { screen: 'form' })).content[0].text;
    expect(form.indexOf('## This screen')).toBeLessThan(form.indexOf('## Direction'));
    expect((await call('get_design_checklist', { screen: 'nope' })).isError).toBe(true);
  });

  it('check_contrast reports plain colours once and tokens per mode', async () => {
    const text = (await call('check_contrast', { pairs: [{ fg: '#767676', bg: '#ffffff', label: 'caption' }, { fg: '--ui-fg', bg: '--ui-bg' }] })).content[0].text;
    expect(text).toContain('theme vercel · light');
    expect(text).toContain('theme vercel · dark');
    expect(text.match(/\| caption \|/g)).toHaveLength(1);
    const plain = (await call('check_contrast', { pairs: [{ fg: '#000', bg: '#fff' }] })).content[0].text;
    expect(plain).toContain('| #000 on #fff | text | 21.00:1 | pass | pass |');
    for (const bad of [{ pairs: [] }, { pairs: [{ fg: '#000' }] }, { pairs: [{ fg: '#000', bg: '#fff', use: 'huge' }] }, { pairs: [{ fg: '--ui-fg', bg: '--ui-bg' }], theme: 'nope' }]) {
      expect((await call('check_contrast', bad)).isError).toBe(true);
    }
    expect((await call('check_contrast', { pairs: [{ fg: '--ui-fg', bg: '--ui-bg' }], theme: 'paper' })).content[0].text).toContain('no token file for the paper theme');
  });
});
