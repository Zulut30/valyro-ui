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

/**
 * The metadata of a Pro item without its source: title, description, docs link and public exports, no files or
 * dependencies, so `shadcn add` cannot fetch it. The pro edition's `/r` lists Pro items this way, and the hosted MCP
 * server describes them to accounts without a licence.
 */
export const proStub = (item) => ({
  $schema: item.$schema,
  name: item.name,
  type: item.type,
  title: item.title,
  description: item.description,
  pro: true,
  registryDependencies: [],
  files: [],
  docs: `${item.title} is part of ValyroUI Pro (${PRICING_URL}). With a licence: \`npx ${CLI_PACKAGE} login\`, then \`npx ${CLI_PACKAGE} add ${item.name}\`.`,
  categories: item.categories,
  meta: { ...item.meta, pricingUrl: PRICING_URL },
});

/**
 * The free registry has no entry for a Pro item, so a Pro name looks like a typo to someone who is not signed in.
 * Said once for a hosted registry without a token; empty otherwise (the licensed API has already answered).
 */
export const proHint = (registry, name) =>
  registry.kind === 'http' && !registry.hasToken
    ? ` If "${name}" is a ValyroUI Pro item, it needs a licence (${PRICING_URL}); then run \`npx ${CLI_PACKAGE} login\`.`
    : '';

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

  /**
   * The licensed API's answer for `url` as parsed JSON, or the reason it is unavailable. `what` names the item for the
   * messages; `hosted` says the item is not in the free registry at all (so the licence is only a guess at why).
   */
  async function readLicensed(url, what, { key, item, hosted = false } = {}) {
    let res;
    try {
      res = await fetchImpl(url, { headers: { accept: 'application/json', authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new CliError(`Cannot fetch ${url}: ${error.message}`, { cause: error });
    }
    if (res.status === 401) {
      throw new CliError(`Your ValyroUI token was not accepted (401). Sign in again with \`npx ${CLI_PACKAGE} login\`.`, { code: 'PRO_UNAUTHORIZED', key, item });
    }
    if (res.status === 402 || res.status === 403) {
      throw new CliError(
        hosted
          ? `"${what}" is not in the free registry, and your account has no active ValyroUI Pro licence (${res.status}). If it is a Pro item, plans: ${PRICING_URL}`
          : `Your account has no active ValyroUI Pro licence (${res.status}), so "${what}" is not available. Plans: ${PRICING_URL}`,
        { code: 'PRO_LICENSE', key, item },
      );
    }
    if (res.status === 404) throw new CliError(`Not found: ${url}`, { code: 'NOT_FOUND', key });
    if (!res.ok) throw new CliError(`${url} responded with ${res.status} ${res.statusText}`);
    try {
      return JSON.parse(await res.text());
    } catch (error) {
      throw new CliError(`${url} is not valid JSON: ${error.message}`, { cause: error });
    }
  }

  /**
   * The full item from the licensed API, or an explanation of why it is unavailable. `stub` is the public stub of the
   * item (pro.valyro.xyz/r, an older registry) or just `{ name }` when the free registry has no such item.
   */
  async function readPro(stub, key, { hosted = false } = {}) {
    const what = stub.categories?.includes('themes') ? 'theme' : 'component';
    if (!token) {
      throw new CliError(
        `"${stub.name}" is a ValyroUI Pro ${what}. Get a licence at ${PRICING_URL}, then run \`npx ${CLI_PACKAGE} login\` and try again.`,
        { code: 'PRO_REQUIRED', key, item: stub },
      );
    }
    const url = `${proUrl.replace(/\/+$/, '')}/${encodeURIComponent(stub.name)}`;
    const item = await readLicensed(url, stub.name, { key, item: hosted ? undefined : stub, hosted });
    validateItem(item, url);
    if (item.name !== stub.name || isProStub(item)) throw new CliError(`${url} did not return the source of "${stub.name}"`);
    return item;
  }

  const pro = new Map();
  const loadPro = (stub, key, options) => {
    if (!pro.has(key)) pro.set(key, readPro(stub, key, options));
    return pro.get(key);
  };

  /** `<base>/<name>.json` of this registry's own folder -> `name`, else null. */
  const ownName = (key) => (key.startsWith(`${base}/`) ? /^([a-z0-9][a-z0-9._-]*)\.json$/i.exec(key.slice(base.length + 1))?.[1] ?? null : null);

  /** The licensed index (every item, Pro ones included, without file contents), or null when this account has none. */
  let licensedIndex;
  const loadLicensedIndex = () => {
    licensedIndex ??= (async () => {
      if (!token || kind !== 'http') return null;
      try {
        const index = await readLicensed(proUrl.replace(/\/+$/, ''), 'the Pro index');
        return Array.isArray(index?.items) ? index.items.filter((entry) => entry && typeof entry.name === 'string') : null;
      } catch {
        // No Pro licence, a rejected token or no network: the free index still lists the free core.
        return null;
      }
    })();
    return licensedIndex;
  };
  let listedPro = false;

  return {
    kind,
    base,
    locate,
    hasToken: Boolean(token),
    /** True once `index()` has listed the Pro items too (a licensed account on a hosted registry). */
    get proListed() {
      return listedPro;
    },
    /**
     * A Pro stub is swapped for the licensed item; without a licence it fails with code PRO_REQUIRED
     * (or PRO_UNAUTHORIZED / PRO_LICENSE) and the stub as `error.item`. The free hosted registry has no entry for a
     * Pro item at all: its 404 is asked of the licensed API when there is a token (unknown there too: NOT_FOUND),
     * and without one it stays NOT_FOUND (`registry.hasToken` is false: the caller can say a Pro item may be meant).
     * @returns {Promise<{ key: string, item: object }>}
     */
    async item(ref) {
      const key = locate(ref);
      let item;
      try {
        item = await load(key);
      } catch (error) {
        const name = error?.code === 'NOT_FOUND' && kind === 'http' && token ? ownName(key) : null;
        if (!name) throw error;
        return { key, item: await loadPro({ name }, key, { hosted: true }) };
      }
      validateItem(item, key);
      return { key, item: isProStub(item) ? await loadPro(item, key) : item };
    },
    async index() {
      const key = kind === 'http' ? `${base}/registry.json` : path.join(base, 'registry.json');
      const index = await load(key);
      if (!index || !Array.isArray(index.items)) throw new CliError(`${key} is not a registry index (missing "items")`);
      const items = index.items.filter((item) => item && typeof item.name === 'string');
      const licensed = await loadLicensedIndex();
      listedPro = Boolean(licensed);
      return licensed ? mergeIndexes(items, licensed) : items;
    },
  };
}

/**
 * The free index and the licensed one as one list: the licensed order (components, themes, setup items), each entry from
 * the free index where it has one, then whatever only the free index has.
 */
export function mergeIndexes(free, licensed) {
  const freeByName = new Map(free.map((item) => [item.name, item]));
  const seen = new Set();
  const merged = licensed.map((item) => {
    seen.add(item.name);
    return freeByName.get(item.name) ?? item;
  });
  return [...merged, ...free.filter((item) => !seen.has(item.name))];
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

/** `export interface <name> { … }` (with its doc comment) from TypeScript source, or null. */
export function extractInterface(code, name) {
  const m = new RegExp(String.raw`^(?:/\*\*(?:(?!\*/)[\s\S])*\*/\s*)?export\s+interface\s+${name}\b[^{]*\{`, 'm').exec(code);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < code.length; i++) {
    const ch = code[i];
    if (ch === '/' && code[i + 1] === '/') i = code.indexOf('\n', i);
    else if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? -1 : end + 1;
    }
    else if (ch === "'" || ch === '"' || ch === '`') {
      for (i++; i < code.length && code[i] !== ch; i++) if (code[i] === '\\') i++;
    } else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return code.slice(m.index, i + 1);
    if (i < 0) return null;
  }
  return null;
}

/** The `<Export>Props` interfaces of an item's exported components, in export order. */
export function propsOf(item) {
  const code = (item.files ?? []).filter((f) => /\.tsx?$/.test(f.path)).map((f) => f.content).join('\n');
  const names = [...new Set(Object.values(item.meta?.exports ?? {}).flat())];
  return names.map((name) => extractInterface(code, `${name}Props`)).filter(Boolean);
}
