import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocsRegistry } from '../../scripts/registry/parse.mjs';
import { createMcpHandler } from '../src/mcp.mjs';
import { formatMotionSpec, matchMotion, MOTION_SPECS } from '../src/motion-spec.mjs';

const read = (rel) => fs.readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

describe('motion specs', () => {
  it('name only kit components and tokens that exist', () => {
    const ids = new Set(parseDocsRegistry(read('src/docs/registry.ts')).flatMap((c) => c.items.map((i) => i.id)));
    expect(MOTION_SPECS.flatMap((s) => s.kit).filter((n) => !ids.has(n))).toEqual([]);
    const styles = ['src/lib/styles/tokens.css', 'src/lib/styles/motion.css', 'src/lib/styles/themes/vercel.css'].map(read).join('\n');
    const tokens = new Set([...JSON.stringify(MOTION_SPECS).matchAll(/--ui-[\w-]+/g)].map((m) => m[0]));
    expect([...tokens].filter((t) => !styles.includes(`${t}:`))).toEqual([]);
    expect(new Set(MOTION_SPECS.map((s) => s.id)).size).toBe(MOTION_SPECS.length);
  });

  it('uses no raw durations and no linear easing', () => {
    const text = JSON.stringify(MOTION_SPECS.map(({ enter, exit, css }) => ({ enter, exit, css })));
    expect(text).not.toMatch(/\b\d+m?s\b(?![^(]*\*)/);
    expect(text).not.toMatch(/\blinear\b(?!\()/);
  });

  it('matches interactions in English and Russian, with close seconds', () => {
    expect(matchMotion({ intent: 'dialog' }).map((s) => s.id)).toEqual(['dialog']);
    expect(matchMotion({ query: 'анимация счётчика KPI' })[0].id).toBe('number');
    expect(matchMotion({ query: 'draggable bottom sheet' })[0].id).toBe('sheet');
    expect(matchMotion({ query: 'drag a card and release it' })[0].id).toBe('drag-release');
    expect(matchMotion({ query: 'accordion inside a dialog' }).map((s) => s.id)).toEqual(expect.arrayContaining(['expand', 'dialog']));
    expect(matchMotion({ query: 'qwerty' })).toEqual([]);
    expect(formatMotionSpec(matchMotion({ intent: 'press' }), { liveNames: new Set(['button']) })).toContain('Already moves this way in the kit: button (');
  });
});

describe('get_motion_spec tool', () => {
  const registry = { index: async () => [{ name: 'popover' }, { name: 'select' }] };
  const h = createMcpHandler({ registry, version: '1.0.0' });
  const call = async (args) => (await h.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_motion_spec', arguments: args } })).result;

  it('lists intents, returns one spec with live kit names and rejects unknown intents', async () => {
    expect((await call({})).content[0].text).toContain(`${MOTION_SPECS.length} interactions`);
    const text = (await call({ intent: 'popover' })).content[0].text;
    expect(text).toContain('## Popover, menu, dropdown or select list (`popover`) — productive');
    expect(text).toContain('- Enter: calc(var(--ui-duration-slow) * 1.36) var(--ui-spring-snappy)');
    expect(text).toContain('Already moves this way in the kit: popover, select (');
    expect(text).toContain('Play the interaction in a real browser');
    expect((await call({ intent: 'nope' })).isError).toBe(true);
    expect((await call({ query: 'qwerty' })).content[0].text).toContain('No interaction matches');
  });
});
