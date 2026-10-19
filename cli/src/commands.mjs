// init / add / list / search / diff (login, logout and whoami: account.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { apiUrl, readToken } from './auth.mjs';
import {
  BASE_ITEMS,
  CLI_PACKAGE,
  CONFIG_FILE,
  CORE_THEMES,
  DEFAULT_REGISTRY_URL,
  LIBRARY_PACKAGE,
  MODES,
  PRICING_URL,
  PRO_PACKAGE,
  SITE_URL,
  THEMES,
} from './constants.mjs';
import { collectsComponentCss, destinationOf, planFiles, transformContent, unifiedDiff, updateComponentCss, writeFiles } from './files.mjs';
import {
  declaredPackages,
  detectAlias,
  detectFramework,
  detectPackageManager,
  ensureInside,
  installArgs,
  isCssOnly,
  packageNameOf,
  readConfig,
  readPackageJson,
  tsconfigNotes,
  writeConfig,
} from './project.mjs';
import { CliError, createRegistry, dependencyName, resolveItems, searchItems } from './registry.mjs';
import { applySetup, cssOnlySteps, setupPlan } from './setup.mjs';

/** Project dir from --cwd (relative to where the CLI was started). */
export const projectDirOf = (opts, io) => path.resolve(io.cwd, opts.cwd ?? '.');

/**
 * Registry from --registry (relative to the shell cwd), else valyro.json
 * (relative to the project), else the hosted registry.
 */
export function registryFor(opts, io, config) {
  const options = { fetch: io.fetch, token: readToken(io.env), proUrl: `${apiUrl(io.env)}/registry` };
  if (opts.registry) return createRegistry(opts.registry, { ...options, cwd: io.cwd });
  return createRegistry(config?.registry ?? DEFAULT_REGISTRY_URL, { ...options, cwd: projectDirOf(opts, io) });
}

/** A Pro theme ships as the `<name>-theme` registry item and in the valyro-ui-pro package. */
const isProTheme = (theme) => !CORE_THEMES.includes(theme);

function requireConfig(projectDir) {
  const config = readConfig(projectDir);
  if (!config) {
    throw new CliError(`${CONFIG_FILE} not found in ${projectDir}. Run \`npx ${CLI_PACKAGE} init\` first.`);
  }
  return config;
}

/** Rewords "Not found: <url>" for a component the user asked for. */
async function explainNotFound(promise, registry, refs) {
  try {
    return await promise;
  } catch (error) {
    const ref = error instanceof CliError && error.code === 'NOT_FOUND' ? refs.find((r) => registry.locate(r) === error.key) : undefined;
    if (ref === undefined) throw error;
    throw new CliError(
      `Component "${ref}" not found in ${registry.base}. Try \`npx ${CLI_PACKAGE} search ${ref}\` or \`npx ${CLI_PACKAGE} list\`.`,
      { cause: error },
    );
  }
}

/** Shared by `init` and `add`. */
async function installItems(refs, { config, projectDir, registry, opts, io }) {
  const resolved = await explainNotFound(resolveItems(refs, registry), registry, refs);
  const plan = planFiles(resolved, config, projectDir, (msg) => io.err(`warning: ${msg}`));
  const confirm = io.isTTY && !opts.yes ? (dest) => io.ask(`${dest} differs from the registry. Overwrite? [y/N/a(ll)] `).then(parseAnswer) : undefined;
  const result = await writeFiles(plan, { overwrite: Boolean(opts.overwrite), confirm });

  const names = resolved.map(({ item }) => item.name);
  io.out(`Resolved ${names.join(', ')}`);
  for (const [label, list] of [
    ['created', result.created],
    ['updated', result.updated],
  ]) {
    for (const dest of list) io.out(`  ${label} ${dest}`);
  }
  const componentCss = collectsComponentCss(config) && updateComponentCss(plan, config, projectDir);
  if (componentCss) io.out(`  ${componentCss.created ? 'created' : 'updated'} ${componentCss.dest}`);
  if (result.identical.length) io.out(`  ${result.identical.length} file(s) already up to date`);
  if (result.kept.length) {
    io.err(`Kept ${result.kept.length} locally modified file(s) (re-run with --overwrite to replace):`);
    for (const dest of result.kept) io.err(`  ${dest}`);
  }

  await installPackages(resolved, { projectDir, opts, io });
  return { resolved, result };
}

function parseAnswer(answer) {
  const a = answer.trim().toLowerCase();
  if (a === 'a' || a === 'all') return 'all';
  return a === 'y' || a === 'yes' ? 'yes' : 'no';
}

async function installPackages(resolved, { projectDir, opts, io }) {
  const declared = declaredPackages(readPackageJson(projectDir));
  const missing = (field) => [
    ...new Set(resolved.flatMap(({ item }) => item[field] ?? []).filter((spec) => !declared.has(packageNameOf(spec)))),
  ];
  const pm = detectPackageManager(projectDir, io.env);
  for (const [field, dev] of [
    ['dependencies', false],
    ['devDependencies', true],
  ]) {
    const packages = missing(field);
    if (!packages.length) continue;
    const args = installArgs(pm, packages, { dev });
    if (opts['skip-install']) {
      io.out(`Install the required packages: ${pm} ${args.join(' ')}`);
    } else {
      io.out(`Running ${pm} ${args.join(' ')}`);
      io.run(pm, args, projectDir);
    }
  }
}

/** Import lines for the requested items, plus the directory they are relative to (null with an alias). */
function usage(resolved, config) {
  const installDir = config.installDir.replace(/\\/g, '/');
  const sourceRoot = /^(src|app)\//.exec(installDir)?.[1] ?? null;
  const base = config.alias ?? (sourceRoot ? `./${installDir.slice(sourceRoot.length + 1)}` : `./${installDir}`);
  const lines = resolved
    .filter((r) => r.requested && r.item.meta?.exports)
    .flatMap(({ item }) =>
      Object.entries(item.meta.exports).map(([file, names]) => `import { ${names.join(', ')} } from '${base}/${file}';`),
    );
  return { lines, from: config.alias ? null : sourceRoot ? `${sourceRoot}/` : 'the project root' };
}

export async function init(opts, io) {
  const projectDir = projectDirOf(opts, io);
  const pkg = readPackageJson(projectDir);
  if (!pkg) throw new CliError(`No package.json in ${projectDir}. Run init inside your app (or pass --cwd).`);
  const framework = detectFramework(projectDir, pkg);
  const existing = readConfig(projectDir);
  const interactive = io.isTTY && !opts.yes;

  const choose = async (label, choices, flag, fallback) => {
    const value = flag ?? existing?.[label] ?? (interactive ? await askChoice(io, label, choices, fallback) : fallback);
    if (!choices.includes(value)) throw new CliError(`--${label} must be one of: ${choices.join(', ')}`);
    return value;
  };
  const theme = await choose('theme', THEMES, opts.theme, THEMES[0]);
  const mode = await choose('mode', MODES, opts.mode, MODES[0]);

  // The registry ships React sources; a Vue/Svelte/Angular/Solid app only needs the CSS.
  if (isCssOnly(framework.name)) {
    const pm = detectPackageManager(projectDir, io.env);
    const install = isProTheme(theme)
      ? `${pm} ${installArgs(pm, [`./${PRO_PACKAGE}-<version>.tgz`]).join(' ')}  (the ValyroUI Pro package from your licence, ${PRICING_URL})`
      : `${pm} ${installArgs(pm, [LIBRARY_PACKAGE]).join(' ')}`;
    for (const line of cssOnlySteps(framework.name, { theme, mode, install, siteUrl: SITE_URL })) io.out(line);
    return 0;
  }
  if (isProTheme(theme) && !readToken(io.env)) {
    throw new CliError(
      `The ${theme} theme is part of ValyroUI Pro (${PRICING_URL}). Run \`npx ${CLI_PACKAGE} login\` first, or pick a free theme: ${CORE_THEMES.join(', ')}.`,
    );
  }

  const installDir = (opts.dir ?? existing?.installDir ?? framework.defaultDir).replace(/\\/g, '/').replace(/\/+$/, '');
  ensureInside(projectDir, installDir, `--dir ${installDir}`);
  let registry = existing?.registry ?? DEFAULT_REGISTRY_URL;
  if (opts.registry) {
    if (/^https?:\/\//i.test(opts.registry)) registry = opts.registry.replace(/\/+$/, '');
    else {
      // Local registries are stored relative to the project when inside it, absolute otherwise.
      const abs = path.resolve(io.cwd, opts.registry);
      const rel = path.relative(projectDir, abs);
      registry = rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel.split(path.sep).join('/') || '.';
    }
  }
  const config = {
    registry,
    framework: framework.name,
    installDir,
    alias: opts.alias ?? existing?.alias ?? detectAlias(projectDir, installDir),
    rsc: framework.rsc,
    theme,
    mode,
  };
  writeConfig(projectDir, config);
  io.out(
    `Wrote ${CONFIG_FILE} (framework: ${framework.name}, dir: ${installDir}, alias: ${config.alias ?? 'none'}, package manager: ${detectPackageManager(projectDir, io.env)})`,
  );

  const source = createRegistry(registry, { cwd: projectDir, fetch: io.fetch, token: readToken(io.env), proUrl: `${apiUrl(io.env)}/registry` });
  await installItems([...BASE_ITEMS, ...(isProTheme(theme) ? [`${theme}-theme`] : [])], { config, projectDir, registry: source, opts, io });

  const plan = setupPlan(framework.name, config, projectDir);
  plan.notes.push(...tsconfigNotes(projectDir, installDir));
  if (opts.patch && plan.entry && fs.existsSync(path.join(projectDir, plan.entry))) {
    const file = path.join(projectDir, plan.entry);
    const patched = applySetup(fs.readFileSync(file, 'utf8'), plan, config);
    if ('content' in patched) {
      fs.writeFileSync(file, patched.content);
      io.out(`Patched ${plan.entry}: CSS import and ThemeProvider added.`);
      for (const note of plan.notes) io.out(`Note: ${note}`);
      return 0;
    }
    io.err(`Did not patch ${plan.entry}: ${patched.error}.`);
  }
  io.out(`\nAdd to ${plan.entry ?? 'your app entry'}:\n\n${indent(plan.snippet)}\n`);
  for (const note of plan.notes) io.out(`Note: ${note}`);
  if (!opts.patch && plan.entry) io.out(`Or re-run with --patch to apply it automatically.`);
  return 0;
}

async function askChoice(io, label, choices, fallback) {
  const answer = (await io.ask(`${label[0].toUpperCase()}${label.slice(1)} (${choices.join('/')}) [${fallback}]: `)).trim();
  return answer || fallback;
}

const indent = (text) => text.replace(/^/gm, '  ');

export async function add(opts, positionals, io) {
  if (!positionals.length) throw new CliError('Usage: valyro add <name...>  (see `valyro list`)');
  const projectDir = projectDirOf(opts, io);
  const config = requireConfig(projectDir);
  const registry = registryFor(opts, io, config);
  const { resolved } = await installItems(positionals, { config, projectDir, registry, opts, io });
  const { lines, from } = usage(resolved, config);
  if (lines.length) io.out(`\nUsage${from ? ` (paths relative to ${from})` : ''}:\n${indent(lines.join('\n'))}`);
  return 0;
}

export async function list(opts, io) {
  const projectDir = projectDirOf(opts, io);
  const registry = registryFor(opts, io, readConfig(projectDir));
  let items = await registry.index();
  if (opts.category) {
    items = items.filter((item) => (item.categories ?? []).includes(opts.category));
    if (!items.length) throw new CliError(`No components in category "${opts.category}"`);
  }
  printItems(items, opts, io, { grouped: true });
  return 0;
}

export async function search(opts, positionals, io) {
  const query = positionals.join(' ').trim();
  if (!query) throw new CliError('Usage: valyro search <query>');
  const projectDir = projectDirOf(opts, io);
  const registry = registryFor(opts, io, readConfig(projectDir));
  const found = searchItems(await registry.index(), query);
  if (!found.length && !opts.json) {
    io.out(`No components match "${query}".`);
    return 0;
  }
  printItems(found, opts, io, { grouped: false });
  return 0;
}

function printItems(items, opts, io, { grouped }) {
  if (opts.json) {
    const rows = items.map(({ name, title, description, categories, pro }) => ({ name, title, description, category: categories?.[0] ?? null, pro: pro === true }));
    io.out(JSON.stringify(rows, null, 2));
    return;
  }
  const width = Math.max(0, ...items.map((i) => i.name.length));
  const row = (item) => `  ${item.name.padEnd(width)}  ${item.pro ? '[Pro] ' : ''}${item.description ?? item.title ?? ''}`;
  if (!grouped) {
    for (const item of items) io.out(`${row(item)}${item.categories?.[0] ? `  (${item.categories[0]})` : ''}`);
    return;
  }
  const groups = new Map();
  for (const item of items) {
    const key = item.meta?.categoryTitle ? `${item.meta.categoryTitle} (${item.categories[0]})` : (item.categories?.[0] ?? 'other');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  for (const [title, group] of groups) {
    io.out(`${title}`);
    for (const item of group) io.out(row(item));
    io.out('');
  }
  if (items.some((item) => item.pro)) io.out(`[Pro] items need a ValyroUI Pro licence: ${PRICING_URL}, then \`npx ${CLI_PACKAGE} login\`.`);
}

export async function diff(opts, positionals, io) {
  if (positionals.length !== 1) throw new CliError('Usage: valyro diff <name>');
  const projectDir = projectDirOf(opts, io);
  const config = requireConfig(projectDir);
  const registry = registryFor(opts, io, config);
  const { item } = await explainNotFound(registry.item(positionals[0]), registry, positionals);
  let changed = 0;
  let missing = 0;
  for (const file of item.files ?? []) {
    const dest = destinationOf(file, config);
    const abs = ensureInside(projectDir, dest);
    const expected = transformContent(file.content, dest, config);
    if (!fs.existsSync(abs)) {
      missing++;
      io.out(`missing locally: ${dest}`);
      continue;
    }
    const patch = unifiedDiff(fs.readFileSync(abs, 'utf8'), expected, `local/${dest}`, `registry/${dest}`);
    if (patch) {
      changed++;
      io.out(patch);
    }
  }
  const deps = (item.registryDependencies ?? []).map(dependencyName);
  io.out(
    changed || missing
      ? `${item.name}: ${changed} changed, ${missing} missing file(s)${deps.length ? ` (dependencies not compared: ${deps.join(', ')})` : ''}`
      : `${item.name}: up to date with the registry`,
  );
  return 0;
}

