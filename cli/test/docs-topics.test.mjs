import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOCS_TOPICS, formatTopic, searchTopics } from '../src/docs-topics.mjs';

const headlessSource = fs.readFileSync(new URL('../../src/lib/headless.ts', import.meta.url), 'utf8');

describe('docs topics', () => {
  it('finds topics by keyword or by every word of the query', () => {
    expect(searchTopics('headless').map((t) => t.id)).toEqual(['headless']);
    expect(searchTopics('React 18').map((t) => t.id)).toEqual(['react-versions']);
    expect(searchTopics('tailwind utilities').map((t) => t.id)).toEqual(['tailwind']);
    expect(searchTopics('android').map((t) => t.id)).toEqual(['react-native']);
    expect(searchTopics('Dialog.Trigger').map((t) => t.id)).toEqual(['compound']);
    expect(searchTopics('   ')).toEqual([]);
    expect(formatTopic(DOCS_TOPICS[0])).toMatch(/^# Headless hooks[\s\S]*\nDocs: https:\/\/valyro\.xyz\/#\/getting-started\/headless$/);
  });

  it('names only hooks that valyro-ui/headless exports', () => {
    const text = DOCS_TOPICS.find((t) => t.id === 'headless').text;
    const named = [...new Set(text.match(/\buse[A-Z]\w+|\b(?:Slot|Portal|mergeRefs|composeHandlers|withRef|cleanupRef)\b/g))];
    expect(named.length).toBeGreaterThan(15);
    expect(named.filter((name) => !new RegExp(`\\b${name}\\b`).test(headlessSource))).toEqual([]);
  });

  it('lists the components that have compound parts in src/lib', () => {
    const text = DOCS_TOPICS.find((t) => t.id === 'compound').text;
    const lib = new URL('../../src/lib/components/', import.meta.url);
    const withParts = fs
      .readdirSync(lib, { recursive: true })
      .filter((file) => /\.tsx$/.test(file) && !/\.test\./.test(file))
      .flatMap((file) => [...fs.readFileSync(new URL(file, lib), 'utf8').matchAll(/^export const (\w+) = withRef\((?:(?!^export )[\s\S])*?^\}, \{/gm)].map((m) => m[1]));
    expect(withParts.length).toBe(35);
    for (const name of withParts) expect(text, name).toContain(name);
  });
});
