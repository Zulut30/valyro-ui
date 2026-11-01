import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocsRegistry } from '../../scripts/registry/parse.mjs';
import { CHOICES, formatChoices, matchChoice } from '../src/choose.mjs';
import { createMcpHandler } from '../src/mcp.mjs';

describe('component choices', () => {
  it('name only components the docs registry has, under unique ids', () => {
    const ids = new Set(parseDocsRegistry(fs.readFileSync(new URL('../../src/docs/registry.ts', import.meta.url), 'utf8')).flatMap((c) => c.items.map((i) => i.id)));
    const named = CHOICES.flatMap((c) => [...c.pick, ...c.switchTo.flatMap((s) => s.to)]);
    expect(named.filter((n) => !ids.has(n))).toEqual([]);
    expect(new Set(CHOICES.map((c) => c.id)).size).toBe(CHOICES.length);
    expect(CHOICES.every((c) => c.pick.length && c.wrong)).toBe(true);
  });

  it('matches jobs in English and Russian', () => {
    expect(matchChoice({ need: 'выбор страны из длинного списка' })[0].id).toBe('one-of-many');
    expect(matchChoice({ need: 'row actions menu' })[0].id).toBe('commands');
    expect(matchChoice({ need: 'подтверждение удаления проекта' })[0].id).toBe('destructive');
    expect(matchChoice({ need: 'enter the price' })[0].id).toBe('number');
    expect(matchChoice({ job: 'rating' }).map((c) => c.id)).toEqual(['rating']);
    expect(matchChoice({ need: 'qwerty' })).toEqual([]);
  });

  it('marks tiers and names missing from the live registry', () => {
    const text = formatChoices(matchChoice({ job: 'one-of-many' }), [{ name: 'select' }, { name: 'combobox', pro: true }]);
    expect(text).toContain('Pick: select\n');
    expect(text).toContain('Switch to combobox (Pro) when the user knows what to type, or more than about 15 options');
    expect(text).toContain('Wrong choice: a dropdown menu');
    expect(text).toContain('Pro licence');
    expect(formatChoices(matchChoice({ job: 'colour' }), [])).toContain('swatch-picker (not in this registry)');
  });
});

describe('choose_component tool', () => {
  const h = createMcpHandler({ registry: { index: async () => [{ name: 'confirm-dialog' }, { name: 'toast' }, { name: 'popover' }] }, version: '1.0.0' });
  const call = async (args) => (await h.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'choose_component', arguments: args } })).result;

  it('lists jobs, answers a need and validates the job id', async () => {
    expect((await call({})).content[0].text).toContain(`${CHOICES.length} jobs`);
    const text = (await call({ need: 'delete a project' })).content[0].text;
    expect(text).toContain('## Confirm a destructive action (`destructive`)');
    expect(text).toContain('Switch to toast when the action can be undone (act at once and offer Undo)');
    expect((await call({ job: 'nope' })).isError).toBe(true);
  });
});
