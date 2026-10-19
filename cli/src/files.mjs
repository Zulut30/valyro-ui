// Mapping registry files into the project, writing them and diffing them.

import fs from 'node:fs';
import path from 'node:path';
import { KIT_TARGET_PREFIX } from './constants.mjs';
import { ensureInside } from './project.mjs';
import { CliError } from './registry.mjs';

/** Project-relative destination (posix) of a registry file. */
export function destinationOf(file, config) {
  const target = (file.target ?? '').replace(/\\/g, '/');
  if (!target) throw new CliError(`${file.path}: registry file has no "target"`);
  const installDir = config.installDir.replace(/\\/g, '/').replace(/\/+$/, '');
  if (target.startsWith(KIT_TARGET_PREFIX)) return `${installDir}/${target.slice(KIT_TARGET_PREFIX.length)}`;
  return target.replace(/^~\//, '');
}

const SCRIPT_RE = /\.[cm]?[jt]sx?$/;

/** Registry files carry `'use client'`; drop it outside React Server Components projects. */
export function transformContent(content, dest, config) {
  if (config.rsc || !SCRIPT_RE.test(dest)) return content;
  return content.replace(/^(['"])use client\1;?[ \t]*\r?\n(?:[ \t]*\r?\n)?/, '');
}

/**
 * @param {{ item: object }[]} resolved items in install order
 * @returns {{ dest: string, abs: string, content: string, item: string }[]}
 */
export function planFiles(resolved, config, projectDir, warn = () => {}) {
  const byDest = new Map();
  for (const { item } of resolved) {
    for (const file of item.files ?? []) {
      const dest = destinationOf(file, config);
      const abs = ensureInside(projectDir, dest, `${item.name}: target "${file.target}"`);
      const content = transformContent(file.content, dest, config);
      const previous = byDest.get(dest);
      if (previous && previous.content !== content) {
        warn(`${dest} is provided by both "${previous.item}" and "${item.name}" with different content; using "${item.name}".`);
      }
      byDest.set(dest, { dest, abs, content, item: item.name });
    }
  }
  return [...byDest.values()];
}

/**
 * Writes planned files. Identical files are skipped; differing files are
 * overwritten with `overwrite`, otherwise `confirm(dest)` decides
 * ('yes' | 'no' | 'all'); without `confirm` they are kept.
 */
export async function writeFiles(plan, { overwrite = false, confirm } = {}) {
  const result = { created: [], updated: [], identical: [], kept: [] };
  let overwriteAll = overwrite;
  for (const file of plan) {
    if (fs.existsSync(file.abs)) {
      const current = fs.readFileSync(file.abs, 'utf8');
      if (current === file.content) {
        result.identical.push(file.dest);
        continue;
      }
      if (!overwriteAll) {
        const answer = confirm ? await confirm(file.dest) : 'no';
        if (answer === 'all') overwriteAll = true;
        else if (answer !== 'yes') {
          result.kept.push(file.dest);
          continue;
        }
      }
      fs.writeFileSync(file.abs, file.content);
      result.updated.push(file.dest);
    } else {
      fs.mkdirSync(path.dirname(file.abs), { recursive: true });
      fs.writeFileSync(file.abs, file.content);
      result.created.push(file.dest);
    }
  }
  return result;
}

/** Unified diff of two texts (empty string when equal). */
export function unifiedDiff(before, after, fromLabel, toLabel, context = 3) {
  if (before === after) return '';
  const a = before.split('\n');
  const b = after.split('\n');
  // Longest common subsequence table, filled from the end.
  const n = a.length;
  const m = b.length;
  if ((n + 1) * (m + 1) > 25_000_000) {
    return `--- ${fromLabel}\n+++ ${toLabel}\n(files differ; too large to diff: ${n} vs ${m} lines)\n`;
  }
  const lcs = new Uint32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[at(i, j)] = a[i] === b[j] ? lcs[at(i + 1, j + 1)] + 1 : Math.max(lcs[at(i + 1, j)], lcs[at(i, j + 1)]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push({ t: ' ', line: a[i], i: i++, j: j++ });
    else if (i < n && (j >= m || lcs[at(i + 1, j)] >= lcs[at(i, j + 1)])) ops.push({ t: '-', line: a[i], i: i++, j });
    else ops.push({ t: '+', line: b[j], i, j: j++ });
  }

  const out = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  const changed = ops.flatMap((o, idx) => (o.t === ' ' ? [] : [idx]));
  // Changes closer than 2*context lines share a hunk.
  const groups = [];
  for (const idx of changed) {
    const group = groups.at(-1);
    if (group && idx - group[1] <= context * 2) group[1] = idx;
    else groups.push([idx, idx]);
  }
  for (const [first, last] of groups) {
    const hunk = ops.slice(Math.max(0, first - context), Math.min(ops.length, last + context + 1));
    const oldLen = hunk.filter((o) => o.t !== '+').length;
    const newLen = hunk.filter((o) => o.t !== '-').length;
    const oldStart = oldLen ? hunk[0].i + 1 : hunk[0].i;
    const newStart = newLen ? hunk[0].j + 1 : hunk[0].j;
    out.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
    for (const o of hunk) out.push(`${o.t}${o.line}`);
  }
  return `${out.join('\n')}\n`;
}
