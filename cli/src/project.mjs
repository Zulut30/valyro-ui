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

/** Lockfile (searching up to the filesystem root), then `packageManager`, then the invoking agent. */
export function detectPackageManager(dir, env = process.env) {
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    for (const [file, pm] of LOCKFILES) if (exists(current, file)) return pm;
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

/**
 * Import alias for the install dir from tsconfig/jsconfig `paths`, e.g.
 * `@/*` -> `./src/*` and installDir `src/components/valyro-ui` give `@/components/valyro-ui`.
 */
export function detectAlias(dir, installDir) {
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
