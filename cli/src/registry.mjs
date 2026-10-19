// Loading registry items from a URL or a local directory and resolving their
// registryDependencies.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_PACKAGE, DEFAULT_REGISTRY_URL, PRICING_URL, PRO_REGISTRY_URL } from './constants.mjs';

/** An expected failure: printed without a stack trace, exit code 1. */
export class CliError extends Error {
  /** @param {string} message @param {{ cause?: unknown, code?: string, key?: string, item?: object }} [options] */
  constructor(message, { cause, code, key, item } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CliError';
    this.code = code;
    this.key = key;
    /** For PRO_REQUIRED: the public stub (title, description, docs link). */
    this.item = item;
  }
}

/** A Pro item in the free registry: metadata only, the source comes from the licensed API. */
export const isProStub = (item) => item?.pro === true && !item.files?.length;

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;
const isHttp = (s) => /^https?:\/\//i.test(s);

/**
 * @param {string} location registry base URL, `file:` URL or directory
 *   (a trailing `/registry.json` is accepted)
 * @param {{ cwd?: string, fetch?: typeof fetch, timeoutMs?: number, token?: string | null, proUrl?: string }} [options]
 *   `token` (from `valyro login`) is sent to `proUrl` only, to fetch the source of Pro items.
 */
export function createRegistry(
  location,
  { cwd = process.cwd(), fetch: fetchImpl = globalThis.fetch, timeoutMs = 20_000, token = null, proUrl = PRO_REGISTRY_URL } = {},
) {
  const trimmed = location.replace(/\/registry\.json$/, '').replace(/\/+$/, '');
  const kind = isHttp(trimmed) ? 'http' : 'dir';
  const base = kind === 'http' ? trimmed : path.resolve(cwd, trimmed.startsWith('file:') ? fileURLToPath(trimmed) : trimmed);
  const cache = new Map();

  /** Turns a name, item URL or `.json` path into a fetchable key (URL or absolute path). */
  function locate(ref) {
    if (typeof ref !== 'string' || !ref) throw new CliError('Empty registry item reference');
    // Items reference each other by their canonical URL; serve those from this registry.
    if (ref.startsWith(`${DEFAULT_REGISTRY_URL}/`) && /^[^/]+\.json$/.test(ref.slice(DEFAULT_REGISTRY_URL.length + 1))) {
      ref = ref.slice(DEFAULT_REGISTRY_URL.length + 1);
    }
    if (isHttp(ref)) return ref;
    if (ref.startsWith('file:')) return fileURLToPath(ref);
    if (ref.endsWith('.json') && (ref.includes('/') || ref.includes('\\'))) return path.resolve(cwd, ref);
    const name = ref.replace(/\.json$/, '');
    if (!NAME_RE.test(name)) throw new CliError(`Invalid component name "${ref}"`);
    return kind === 'http' ? `${base}/${name}.json` : path.join(base, `${name}.json`);
  }

  async function readJson(key) {
    let text;
    if (isHttp(key)) {
      let res;
      try {
        res = await fetchImpl(key, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      } catch (error) {
        throw new CliError(`Cannot fetch ${key}: ${error.message}`, { cause: error });
      }
      if (res.status === 404) throw new CliError(`Not found: ${key}`, { code: 'NOT_FOUND', key });
      if (!res.ok) throw new CliError(`${key} responded with ${res.status} ${res.statusText}`);
      text = await res.text();
    } else {
      try {
        text = await fs.readFile(key, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') throw new CliError(`Not found: ${key}`, { code: 'NOT_FOUND', key });
        throw error;
      }
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new CliError(`${key} is not valid JSON: ${error.message}`, { cause: error });
    }
  }

  const load = (key) => {
    if (!cache.has(key)) cache.set(key, readJson(key));
    return cache.get(key);
  };

  /** The full item from the licensed API, or an explanation of why it is unavailable. */
  async function readPro(stub, key) {
    const what = stub.categories?.includes('themes') ? 'theme' : 'component';
    if (!token) {
      throw new CliError(
        `"${stub.name}" is a ValyroUI Pro ${what}. Get a licence at ${PRICING_URL}, then run \`npx ${CLI_PACKAGE} login\` and try again.`,
        { code: 'PRO_REQUIRED', key, item: stub },
      );
    }
    const url = `${proUrl.replace(/\/+$/, '')}/${encodeURIComponent(stub.name)}`;
    let res;
    try {
      res = await fetchImpl(url, { headers: { accept: 'application/json', authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new CliError(`Cannot fetch ${url}: ${error.message}`, { cause: error });
    }
    if (res.status === 401) {
      throw new CliError(`Your ValyroUI token was not accepted (401). Sign in again with \`npx ${CLI_PACKAGE} login\`.`, { code: 'PRO_UNAUTHORIZED', key, item: stub });
    }
    if (res.status === 402 || res.status === 403) {
      throw new CliError(
        `Your account has no active ValyroUI Pro licence (${res.status}), so "${stub.name}" is not available. Plans: ${PRICING_URL}`,
        { code: 'PRO_LICENSE', key, item: stub },
      );
    }
    if (res.status === 404) throw new CliError(`Not found: ${url}`, { code: 'NOT_FOUND', key });
    if (!res.ok) throw new CliError(`${url} responded with ${res.status} ${res.statusText}`);
    let item;
    try {
      item = JSON.parse(await res.text());
    } catch (error) {
      throw new CliError(`${url} is not valid JSON: ${error.message}`, { cause: error });
    }
    validateItem(item, url);
    if (item.name !== stub.name || isProStub(item)) throw new CliError(`${url} did not return the source of "${stub.name}"`);
    return item;
  }

  const pro = new Map();
  const loadPro = (stub, key) => {
    if (!pro.has(key)) pro.set(key, readPro(stub, key));
    return pro.get(key);
  };

  return {
    kind,
    base,
    locate,
    hasToken: Boolean(token),
    /**
     * A Pro stub is swapped for the licensed item; without a licence it fails with code PRO_REQUIRED
     * (or PRO_UNAUTHORIZED / PRO_LICENSE) and the stub as `error.item`.
     * @returns {Promise<{ key: string, item: object }>}
     */
    async item(ref) {
      const key = locate(ref);
      const item = await load(key);
      validateItem(item, key);
      return { key, item: isProStub(item) ? await loadPro(item, key) : item };
    },
    async index() {
      const key = kind === 'http' ? `${base}/registry.json` : path.join(base, 'registry.json');
      const index = await load(key);
      if (!index || !Array.isArray(index.items)) throw new CliError(`${key} is not a registry index (missing "items")`);
      return index.items.filter((item) => item && typeof item.name === 'string');
    },
  };
}

export function validateItem(item, key) {
  const fail = (why) => {
    throw new CliError(`Invalid registry item ${key}: ${why}`);
  };
  if (!item || typeof item !== 'object' || Array.isArray(item)) fail('not an object');
  if (typeof item.name !== 'string' || !item.name) fail('missing "name"');
  if (item.files !== undefined && !Array.isArray(item.files)) fail('"files" must be an array');
  for (const file of item.files ?? []) {
    if (!file || typeof file.path !== 'string') fail('a file has no "path"');
    if (typeof file.content !== 'string') fail(`${file.path} has no "content"`);
    if (file.target !== undefined && typeof file.target !== 'string') fail(`${file.path} has an invalid "target"`);
  }
  for (const key2 of ['registryDependencies', 'dependencies', 'devDependencies']) {
    const list = item[key2];
    if (list !== undefined && (!Array.isArray(list) || list.some((v) => typeof v !== 'string'))) {
      fail(`"${key2}" must be an array of strings`);
    }
  }
}

/**
 * Loads the requested items and, recursively, their registryDependencies.
 * @returns {Promise<{ key: string, item: object, requested: boolean }[]>}
 *   dependencies before dependents; each item once; deterministic order.
 */
export async function resolveItems(refs, registry) {
  const roots = [...new Set(refs.map((ref) => registry.locate(ref)))];
  const nodes = new Map();
  // Breadth-first, one parallel batch per level.
  let frontier = roots;
  while (frontier.length) {
    const loaded = await Promise.all(frontier.map((key) => registry.item(key)));
    const next = [];
    loaded.forEach(({ item }, i) => {
      const deps = (item.registryDependencies ?? []).map((ref) => registry.locate(ref));
      nodes.set(frontier[i], { item, deps });
      for (const dep of deps) {
        if (!nodes.has(dep) && !frontier.includes(dep) && !next.includes(dep)) next.push(dep);
      }
    });
    frontier = next;
  }

  const order = [];
  const seen = new Set();
  const walk = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    for (const dep of nodes.get(key).deps) walk(dep);
    order.push({ key, item: nodes.get(key).item, requested: roots.includes(key) });
  };
  roots.forEach(walk);
  return order;
}

/** Scores registry index entries against a free-text query (all words must match). */
export function searchItems(items, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    const title = (item.title ?? '').toLowerCase();
    const description = (item.description ?? '').toLowerCase();
    const categories = (item.categories ?? []).join(' ').toLowerCase();
    // Compound parts by either name (`Dialog.Trigger`, `DialogTrigger`), and "compound" for every component with parts.
    const parts = Object.entries(item.meta?.parts ?? {});
    const partText = parts.length ? `compound parts ${parts.flat().join(' ')}`.toLowerCase() : '';
    let score = 0;
    for (const word of words) {
      const s =
        name === word ? 100
        : name.startsWith(word) ? 80
        : name.includes(word) ? 60
        : title.includes(word) ? 50
        : description.includes(word) ? 30
        : partText.includes(word) ? 20
        : categories.includes(word) ? 10
        : 0;
      if (!s) {
        score = 0;
        break;
      }
      score += s;
    }
    if (score) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).map((s) => s.item);
}

export const dependencyName = (ref) => ref.replace(/^.*[/\\]/, '').replace(/\.json$/, '');
