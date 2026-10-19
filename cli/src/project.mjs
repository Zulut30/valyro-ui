// Inspecting the target project: framework, package manager, aliases, config.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CONFIG_FILE, DEFAULT_REGISTRY_URL, MODES, THEMES } from './constants.mjs';
import { ADAPTERS, adapterByName } from './frameworks/index.mjs';
import { srcOr } from './frameworks/shared.mjs';
import { CliError } from './registry.mjs';

const exists = (...parts) => fs.existsSync(path.join(...parts));

/** JSON with comments and trailing commas (tsconfig.json). */
export function parseJsonc(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
    } else {
      out += ch;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function readJsonFile(file, { jsonc = false } = {}) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  try {
    return jsonc ? parseJsonc(text) : JSON.parse(text);
  } catch (error) {
    throw new CliError(`Cannot parse ${file}: ${error.message}`, { cause: error });
  }
}

export const readPackageJson = (dir) => readJsonFile(path.join(dir, 'package.json'));

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

/**
 * Lockfile (searching up to the filesystem root), then `packageManager`, then the invoking agent.
 * With several lockfiles in one directory the newest wins: the SolidStart template ships pnpm-lock.yaml,
 * and `npm install` adds package-lock.json next to it.
 */
export function detectPackageManager(dir, env = process.env) {
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    const found = LOCKFILES.filter(([file]) => exists(current, file)).map(([file, pm]) => ({
      pm,
      mtime: fs.statSync(path.join(current, file)).mtimeMs,
    }));
    if (found.length) return found.reduce((newest, lock) => (lock.mtime > newest.mtime ? lock : newest)).pm;
    const field = readPackageJson(current)?.packageManager;
    if (typeof field === 'string') {
      const pm = field.split('@')[0];
      if (['npm', 'pnpm', 'yarn', 'bun'].includes(pm)) return pm;
    }
    if (path.dirname(current) === current) break;
  }
  const agent = /^(npm|pnpm|yarn|bun)\//.exec(env.npm_config_user_agent ?? '');
  return agent ? agent[1] : 'npm';
}

/**
 * The first adapter in frameworks/index.mjs that matches, or unknown.
 * @returns {{ name: string, rsc: boolean, defaultDir: string }}
 */
export function detectFramework(dir, pkg = readPackageJson(dir) ?? {}) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const adapter of ADAPTERS) {
    const found = adapter.detect(dir, deps);
    if (found) return { name: adapter.name, rsc: found.rsc, defaultDir: found.defaultDir };
  }
  return { name: 'unknown', rsc: false, defaultDir: srcOr(dir, 'components/valyro-ui') };
}

export const isCssOnly = (name) => adapterByName(name)?.kind === 'css';

/** tsconfig.json / jsconfig.json and the configs they list in `references` (Vite: tsconfig.app.json). */
function projectTsconfigs(dir) {
  const configs = [];
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const config = readJsonFile(path.join(dir, name), { jsonc: true });
    if (!config) continue;
    configs.push({ config, file: name });
    for (const ref of config.references ?? []) {
      if (typeof ref?.path !== 'string') continue;
      const refFile = ref.path.endsWith('.json') ? ref.path : path.join(ref.path, 'tsconfig.json');
      const refConfig = readJsonFile(path.join(dir, refFile), { jsonc: true });
      if (refConfig) configs.push({ config: refConfig, file: refFile });
    }
  }
  return configs;
}

/**
 * Import alias for the install dir from tsconfig/jsconfig `paths`, e.g.
 * `@/*` -> `./src/*` and installDir `src/components/valyro-ui` give `@/components/valyro-ui`.
 */
export function detectAlias(dir, installDir) {
  const configs = projectTsconfigs(dir);
  const target = path.resolve(dir, installDir);
  for (const { config, file } of configs) {
    const options = config.compilerOptions ?? {};
    const baseDir = path.resolve(dir, path.dirname(file), options.baseUrl ?? '.');
    for (const [pattern, targets] of Object.entries(options.paths ?? {})) {
      if (!pattern.endsWith('/*') || !Array.isArray(targets) || typeof targets[0] !== 'string' || !targets[0].endsWith('/*')) continue;
      const aliasRoot = path.resolve(baseDir, targets[0].slice(0, -2));
      const rel = path.relative(aliasRoot, target);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return `${pattern.slice(0, -2)}/${rel.split(path.sep).join('/')}`;
    }
  }
  return null;
}

/** The ECMAScript year of a `target` or full `lib` entry (`ES2020`, `ES6`, `ESNext`); null for `DOM`, `ES2021.Intl`… */
function esYear(value) {
  const m = /^es(next|\d+)$/i.exec(String(value));
  if (!m) return null;
  if (/next/i.test(m[1])) return Infinity;
  const n = Number(m[1]);
  return n === 6 ? 2015 : n < 2015 ? 2009 : n;
}

/** compilerOptions with `extends` applied (relative files and packages in node_modules), plus the `include` in effect. */
function resolveTsconfig(file, depth = 0) {
  const config = depth < 8 ? readJsonFile(file, { jsonc: true }) : null;
  if (!config) return { options: {}, include: undefined, base: path.dirname(file) };
  let options = {};
  let include;
  let base = path.dirname(file);
  for (const spec of [config.extends ?? []].flat()) {
    if (typeof spec !== 'string') continue;
    const candidates = /^\.{1,2}[\\/]|^[\\/]|^[a-zA-Z]:/.test(spec)
      ? [path.resolve(path.dirname(file), spec)]
      : [path.join(path.dirname(file), 'node_modules', spec)];
    const found = candidates
      .flatMap((p) => [p, `${p}.json`, path.join(p, 'tsconfig.json')])
      .find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!found) continue;
    const parent = resolveTsconfig(found, depth + 1);
    options = { ...options, ...parent.options };
    if (parent.include) ({ include, base } = parent);
  }
  if (config.include) {
    include = config.include;
    base = path.dirname(file);
  } else if (config.files && !include) {
    include = [];
  }
  return { options: { ...options, ...config.compilerOptions }, include, base };
}

/** Whether an `include` list (default: everything) reaches the install dir. */
function includesDir({ include, base }, target) {
  return (include ?? ['**/*']).some((pattern) => {
    const root = path.resolve(base, String(pattern).split(/[*?{]/)[0] || '.');
    const rel = path.relative(root, target);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

/** Strictness flags the copied ValyroUI sources are not written for. */
const STRICT_FLAGS = ['exactOptionalPropertyTypes', 'noUncheckedIndexedAccess'];

/**
 * Notes for TypeScript settings under which `tsc` fails on the copied sources: they are written against
 * lib ES2023 and without exactOptionalPropertyTypes / noUncheckedIndexedAccess. The Tauri, Rsbuild and
 * Parcel templates set lib ES2020 (the base files already fail), React Router and TanStack Start ES2022
 * (the menus fail); Waku turns both flags on.
 */
export function tsconfigNotes(dir, installDir) {
  const target = path.resolve(dir, installDir);
  const notes = [];
  for (const { file } of projectTsconfigs(dir)) {
    const resolved = resolveTsconfig(path.join(dir, file));
    if (!includesDir(resolved, target)) continue;
    const { lib, target: esTarget } = resolved.options;
    const years = Array.isArray(lib) ? lib.map(esYear).filter((y) => y !== null) : [];
    const year = Array.isArray(lib) ? (years.length ? Math.max(...years) : null) : esTarget ? esYear(esTarget) : null;
    if (year !== null && year < 2023) {
      const setting = Array.isArray(lib) ? `"lib" is ${JSON.stringify(lib)}` : `"target" is "${esTarget}" with no "lib"`;
      notes.push(
        `${file}: ${setting}, but the ValyroUI sources are typed against ES2023 (the base files use Intl hourCycle from ES2021, some components Array.prototype.at and Intl.Segmenter from ES2022, DropdownMenu, ContextMenu and Menu findLastIndex from ES2023), so tsc fails on them: set "lib": ["ES2023", "DOM", "DOM.Iterable"].`,
      );
    }
    const flags = STRICT_FLAGS.filter((flag) => resolved.options[flag] === true);
    if (flags.length) {
      notes.push(
        `${file}: ${flags.join(' and ')} ${flags.length > 1 ? 'are' : 'is'} on; the ValyroUI sources are not written for ${flags.length > 1 ? 'them' : 'it'}, so tsc reports errors in ${installDir}. Turn ${flags.length > 1 ? 'them' : 'it'} off, or install the valyro-ui npm package instead of copying the sources.`,
      );
    }
  }
  return [...new Set(notes)];
}

export function configPath(dir) {
  return path.join(dir, CONFIG_FILE);
}

/** Reads and validates valyro.json; `null` when it does not exist. */
export function readConfig(dir) {
  const config = readJsonFile(configPath(dir));
  if (config === null) return null;
  const fail = (why) => {
    throw new CliError(`${configPath(dir)}: ${why}`);
  };
  if (typeof config !== 'object' || Array.isArray(config)) fail('expected an object');
  if (typeof config.installDir !== 'string' || !config.installDir) fail('"installDir" is required');
  ensureInside(dir, config.installDir, `"installDir" (${config.installDir})`);
  if (config.alias != null && typeof config.alias !== 'string') fail('"alias" must be a string or null');
  if (config.theme !== undefined && !THEMES.includes(config.theme)) fail(`"theme" must be one of ${THEMES.join(', ')}`);
  if (config.mode !== undefined && !MODES.includes(config.mode)) fail(`"mode" must be one of ${MODES.join(', ')}`);
  return { registry: DEFAULT_REGISTRY_URL, rsc: false, alias: null, ...config };
}

export function writeConfig(dir, config) {
  fs.writeFileSync(configPath(dir), `${JSON.stringify(config, null, 2)}\n`);
}

/** Throws unless `rel` resolves inside `dir`; returns the absolute path. */
export function ensureInside(dir, rel, label = rel) {
  const abs = path.resolve(dir, rel);
  const relative = path.relative(dir, abs);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new CliError(`${label} points outside the project directory`);
  }
  return abs;
}

export function installArgs(pm, packages, { dev = false } = {}) {
  const verb = pm === 'npm' ? 'install' : 'add';
  const devFlag = dev ? (pm === 'npm' ? '--save-dev' : '-D') : null;
  return [verb, ...(devFlag ? [devFlag] : []), ...packages];
}

/** `npx` equivalent for printing commands. */
export function dlx(pm) {
  return { npm: 'npx', pnpm: 'pnpm dlx', yarn: 'yarn dlx', bun: 'bunx' }[pm] ?? 'npx';
}

export function runInstall(pm, args, cwd) {
  const result = spawnSync(pm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw new CliError(`Failed to run ${pm}: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) throw new CliError(`${pm} ${args.join(' ')} exited with code ${result.status}`);
}

/** Package names already declared in package.json (any dependency field). */
export function declaredPackages(pkg) {
  return new Set(
    ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((field) => Object.keys(pkg?.[field] ?? {})),
  );
}

/** `@scope/pkg@^1` -> `@scope/pkg`. */
export const packageNameOf = (spec) => (spec.startsWith('@') ? `@${spec.slice(1).split('@')[0]}` : spec.split('@')[0]);
