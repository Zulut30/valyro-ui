import { afterAll, describe, expect, it } from 'vitest';
import { categoriesOf, componentSignals, formatComposition, reviewComposition } from '../src/composition.mjs';
import { createMcpHandler } from '../src/mcp.mjs';
import { createRegistry } from '../src/registry.mjs';
import { cleanup, fixtureRegistry } from './helpers.mjs';

afterAll(cleanup);

const item = (name, { css = '', code = '', category = 'effects', pad = 0, dependencies } = {}) => ({
  name,
  title: name,
  categories: [category],
  meta: { category, categoryTitle: category.toUpperCase() },
  ...(dependencies ? { dependencies } : {}),
  files: [
    { path: `valyro-ui/${category}/${name}.css`, content: `${css}\n/*${' '.repeat(pad)}*/` },
    { path: `valyro-ui/${category}/${name}.tsx`, content: `'use client';\n${code}` },
  ],
});

const glow = item('glow', {
  css: '.ui-glow { background: var(--ui-accent); }\n.ui-glow__halo { box-shadow: 0 0 40px var(--ui-accent); }',
  code: "el.addEventListener('pointermove', move); el.addEventListener('pointerleave', reset);\nconst move = () => { el.style.setProperty('--_x', '1px'); };",
});
const aurora = item('aurora', {
  css: '@keyframes ui-aurora { to { transform: rotate(1turn) } }\n.ui-aurora__layer { animation: ui-aurora 20s linear infinite; background: var(--ui-accent); }',
  code: 'export const Aurora = () => null;',
});
const skeleton = item('skeleton', { category: 'basic', css: '@keyframes s { to { opacity: .5 } }\n.ui-skeleton__shimmer { animation: s 1s infinite; }' });
const table = item('table', { category: 'data', pad: 16000, css: '.ui-table td { height: var(--ui-control-h-sm); font-size: var(--ui-text-xs); background: var(--ui-accent); }', code: 'requestAnimationFrame(() => cell.focus());' });
const hero = item('hero', { category: 'marketing', css: '.ui-hero__title { font-size: var(--ui-text-5xl); }', code: 'useReducedMotion();' });
const scene = item('scene', {
  category: 'motion',
  css: '.ui-scene { color: var(--ui-fg); }',
  code: "const tick = () => { ctx.fillRect(0, 0, 1, 1); frame = requestAnimationFrame(tick); };\nframe = requestAnimationFrame(tick);\ncanvas.getContext('2d');",
  dependencies: ['three'],
});

describe('componentSignals', () => {
  it('reads decorative motion, loading loops, type scale and accents from the source', () => {
    expect(componentSignals(glow)).toMatchObject({ motion: { level: 'strong', pointerEffect: true, reducedMotion: false }, accentAtRest: 2, client: true });
    expect(componentSignals(aurora).motion).toMatchObject({ level: 'strong', infinite: true });
    expect(componentSignals(skeleton).motion).toMatchObject({ level: 'subtle', infinite: false });
    expect(componentSignals(table)).toMatchObject({ motion: { level: 'none', frameLoop: false }, scale: 'dense' });
    expect(componentSignals(hero)).toMatchObject({ scale: 'display', largestText: '5xl', motion: { reducedMotion: true } });
    expect(componentSignals(scene)).toMatchObject({ motion: { level: 'strong', frameLoop: true, canvas: true }, npm: ['three'] });
  });
});

describe('reviewComposition', () => {
  it('flags effects overload, motion conflicts, missing reduced motion, accents and mixed densities', () => {
    const signals = [glow, aurora, scene, table, hero, item('glow-2', { css: glow.files[0].content, code: glow.files[1].content })].map(componentSignals);
    const text = reviewComposition(signals, { theme: 'vercel' }).map((f) => `${f.level}: ${f.text}`);
    expect(text.find((t) => t.startsWith('warn: Effects overload'))).toContain('glow, aurora, scene, glow-2');
    expect(text.find((t) => t.startsWith('warn: Motion conflict'))).toContain('glow, glow-2 all react to the pointer');
    expect(text.find((t) => t.startsWith('warn: No prefers-reduced-motion'))).toContain('aurora, scene');
    expect(text.find((t) => t.startsWith('warn: Many accents'))).toContain('glow, aurora, table, glow-2');
    expect(text.find((t) => t.startsWith('warn: Mixed densities'))).toContain('display-scale hero next to dense table');
    expect(text.find((t) => t.startsWith('note: npm dependencies'))).toContain('three');
    expect(text.at(-1)).toContain('https://valyro.xyz/?test=glow&demo=all&theme=vercel');
  });

  it('stays quiet for a calm set', () => {
    const signals = [skeleton, hero].map(componentSignals);
    expect(reviewComposition(signals)).toEqual([]);
    expect(formatComposition(signals, [])).toContain('Findings: none of the automatic checks fired.');
  });
});

describe('categoriesOf', () => {
  it('groups the index by category, without setup items', () => {
    const index = [glow, aurora, hero, { name: 'styles', categories: ['setup'] }];
    expect(categoriesOf(index)).toEqual([
      { id: 'effects', title: 'EFFECTS', names: ['glow', 'aurora'] },
      { id: 'marketing', title: 'MARKETING', names: ['hero'] },
    ]);
  });
});

describe('MCP composition tools', () => {
  const h = createMcpHandler({ registry: createRegistry(fixtureRegistry()), version: '1.0.0' });
  const call = async (name, args) => (await h.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;

  it('lists categories and reviews a set from the registry', async () => {
    expect((await call('list_categories', {})).content[0].text).toContain('- feedback: Feedback (1) — dialog');
    const review = await call('review_composition', { components: ['button', 'dialog'] });
    expect(review.isError).toBe(false);
    expect(review.content[0].text).toContain('| dialog | feedback (Feedback) | none |');
    expect((await call('review_composition', { components: ['nope'] })).isError).toBe(true);
  });
});
