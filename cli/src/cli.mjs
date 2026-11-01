// Argument parsing and command dispatch. `run()` never calls process.exit, so
// it is testable; it resolves to the exit code.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { CLI_PACKAGE, DEFAULT_REGISTRY_URL, MCP_API_URL, MODES, PRICING_URL, PRO_SITE_URL, THEMES } from './constants.mjs';
import { login, logout, whoami } from './account.mjs';
import { add, diff, init, list, projectDirOf, registryFor, search } from './commands.mjs';
import { CLIENT_IDS, mcpAdd } from './mcp-clients.mjs';
import { createMcpHandler, serveStdio } from './mcp.mjs';
import { detectPackageManager, readConfig, runInstall } from './project.mjs';
import { CliError } from './registry.mjs';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const COMMON = {
  registry: { type: 'string' },
  cwd: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

const COMMON_HELP = [
  ['--registry <url|dir>', `Registry URL or local directory (default: valyro.json, then ${DEFAULT_REGISTRY_URL})`],
  ['--cwd <dir>', 'Project directory (default: current directory)'],
  ['-h, --help', 'Show help'],
];

export const COMMANDS = {
  init: {
    summary: 'Write valyro.json, install styles + ThemeProvider, wire them into the app',
    usage: 'init [options]',
    positionals: [0, 0],
    options: {
      ...COMMON,
      dir: { type: 'string' },
      alias: { type: 'string' },
      theme: { type: 'string' },
      mode: { type: 'string' },
      patch: { type: 'boolean' },
      overwrite: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      'skip-install': { type: 'boolean' },
    },
    help: [
      ['--dir <path>', 'Install directory (default: src/components/valyro-ui, app/… for React Router)'],
      ['--alias <prefix>', 'Import alias for the install dir (default: from tsconfig paths)'],
      ['--theme <name>', `Theme: ${THEMES.join(' | ')}`],
      ['--mode <name>', `Mode: ${MODES.join(' | ')}`],
      ['--patch', 'Add the CSS import and <ThemeProvider> to the app entry file'],
      ['--overwrite', 'Overwrite locally modified files'],
      ['-y, --yes', 'No prompts (defaults; keep modified files unless --overwrite)'],
      ['--skip-install', 'Print the npm install command instead of running it'],
    ],
  },
  add: {
    summary: 'Add components and their dependencies',
    usage: 'add <name|url|path.json...> [options]',
    positionals: [1, Infinity],
    options: {
      ...COMMON,
      overwrite: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      'skip-install': { type: 'boolean' },
    },
    help: [
      ['--overwrite', 'Overwrite locally modified files'],
      ['-y, --yes', 'No prompts (keep modified files unless --overwrite)'],
      ['--skip-install', 'Print the npm install command instead of running it'],
    ],
  },
  list: {
    summary: 'List available components',
    usage: 'list [options]',
    positionals: [0, 0],
    options: { ...COMMON, category: { type: 'string' }, json: { type: 'boolean' } },
    help: [
      ['--category <id>', 'Only this category (basic, forms, charts, …)'],
      ['--json', 'Machine-readable output'],
    ],
  },
  search: {
    summary: 'Search components by name or description',
    usage: 'search <query...> [options]',
    positionals: [1, Infinity],
    options: { ...COMMON, json: { type: 'boolean' } },
    help: [['--json', 'Machine-readable output']],
  },
  diff: {
    summary: 'Show differences between installed files and the registry',
    usage: 'diff <name> [options]',
    positionals: [1, 1],
    options: COMMON,
    help: [],
  },
  login: {
    summary: 'Sign in through the browser (one-time code) and save a token for ValyroUI Pro',
    usage: 'login [options]',
    positionals: [0, 0],
    options: { token: { type: 'string' }, 'no-browser': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
    help: [
      ['--token <token>', 'Save this token instead (CI, or a token from the account page; or set VALYRO_TOKEN)'],
      ['--no-browser', 'Print the approval URL instead of opening it'],
    ],
  },
  logout: {
    summary: `Revoke the saved token on ${new URL(PRO_SITE_URL).host} and delete it`,
    usage: 'logout',
    positionals: [0, 0],
    options: { help: { type: 'boolean', short: 'h' } },
    help: [],
  },
  whoami: {
    summary: 'Show the account and plan of the token in use',
    usage: 'whoami',
    positionals: [0, 0],
    options: { help: { type: 'boolean', short: 'h' } },
    help: [],
  },
  mcp: {
    summary: 'Run the MCP server on stdio, or `mcp add <client>` to add it to an AI client',
    usage: 'mcp [add <client>] [options]',
    positionals: [0, 2],
    options: { ...COMMON, hosted: { type: 'boolean' }, print: { type: 'boolean' }, scope: { type: 'string' } },
    help: [
      ['add <client>', `Add the server to a client's config: ${CLIENT_IDS.join(', ')}`],
      ['--hosted', `With add: the hosted server (${MCP_API_URL}/mcp, your token) instead of the local one`],
      ['--scope <scope>', 'With add: project (files in the project) or user (your home folder); default per client'],
      ['--print', 'With add: print the config instead of writing it'],
    ],
  },
};

const table = (rows) => {
  const width = Math.max(...rows.map(([a]) => a.length));
  return rows.map(([a, b]) => `  ${a.padEnd(width)}  ${b}`).join('\n');
};

export function helpText(command) {
  if (command) {
    const spec = COMMANDS[command];
    const common = spec.options.registry ? COMMON_HELP : COMMON_HELP.filter(([flag]) => flag.startsWith('-h'));
    return `Usage: valyro ${spec.usage}\n\n${spec.summary}\n\nOptions:\n${table([...spec.help, ...common])}\n`;
  }
  return [
    `valyro ${VERSION} — install ValyroUI components into your project`,
    '',
    'Usage: valyro <command> [options]',
    '',
    'Commands:',
    table(Object.entries(COMMANDS).map(([name, spec]) => [name, spec.summary])),
    '',
    'Global options:',
    table([['-h, --help', 'Show help (valyro <command> --help for details)'], ['-v, --version', 'Show version']]),
    '',
    `Examples:\n  npx ${CLI_PACKAGE} init\n  npx ${CLI_PACKAGE} add button dialog data-table\n  npx ${CLI_PACKAGE} search date`,
    '',
    `ValyroUI Pro components and themes (marked [Pro] in list): ${PRICING_URL}, then \`${CLI_PACKAGE} login\`.`,
    '',
  ].join('\n');
}

/**
 * @returns {{ command: string | null, values: Record<string, any>, positionals: string[], help?: boolean, version?: boolean }}
 */
export function parseCli(argv) {
  const index = argv.findIndex((arg) => !arg.startsWith('-'));
  if (index === -1) {
    const { values } = parseArgs({
      args: argv,
      options: { help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
      strict: true,
    });
    return { command: null, values, positionals: [], help: Boolean(values.help), version: Boolean(values.version) };
  }
  const command = argv[index];
  const spec = COMMANDS[command];
  if (!spec) throw new CliError(`Unknown command "${command}". Run \`valyro --help\` for the list of commands.`);
  const rest = [...argv.slice(0, index), ...argv.slice(index + 1)];
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: spec.options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new CliError(`${error.message}\nRun \`valyro ${command} --help\` for usage.`, { cause: error });
  }
  const { values, positionals } = parsed;
  if (values.help) return { command, values, positionals, help: true };
  const [min, max] = spec.positionals;
  if (positionals.length < min || positionals.length > max) {
    throw new CliError(`Usage: valyro ${spec.usage}`);
  }
  return { command, values, positionals };
}

/** Real process I/O; tests pass their own. */
export function processIo() {
  let rl;
  return {
    cwd: process.cwd(),
    env: process.env,
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    fetch: globalThis.fetch,
    stdin: process.stdin,
    stdout: process.stdout,
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    ask(question) {
      rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
      return new Promise((resolve) => rl.question(question, resolve));
    },
    run: runInstall,
    /** Best effort: the URL is printed as well. */
    open(url) {
      const [command, args] =
        process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.on('error', (error) => process.stderr.write(`Could not open a browser (${error.message}); open the URL above.\n`));
      child.unref();
    },
    close: () => rl?.close(),
  };
}

export async function run(argv, io = processIo()) {
  try {
    const { command, values, positionals, help, version } = parseCli(argv);
    if (version) {
      io.out(VERSION);
      return 0;
    }
    if (help || !command) {
      (command || help ? io.out : io.err)(helpText(command ?? undefined).trimEnd());
      return help ? 0 : 1;
    }
    switch (command) {
      case 'init':
        return await init(values, io);
      case 'add':
        return await add(values, positionals, io);
      case 'list':
        return await list(values, io);
      case 'search':
        return await search(values, positionals, io);
      case 'diff':
        return await diff(values, positionals, io);
      case 'login':
        return await login(values, io);
      case 'logout':
        return await logout(values, io);
      case 'whoami':
        return await whoami(values, io);
      case 'mcp': {
        const projectDir = projectDirOf(values, io);
        if (positionals.length) {
          if (positionals[0] !== 'add' || positionals.length !== 2) throw new CliError(`Usage: valyro mcp add <${CLIENT_IDS.join('|')}> [--hosted] [--scope project|user] [--print]`);
          return mcpAdd(values, positionals[1], io, projectDir);
        }
        if (values.hosted || values.print || values.scope) throw new CliError('--hosted, --scope and --print go with `valyro mcp add <client>`.');
        const config = readConfig(projectDir);
        const handler = createMcpHandler({
          registry: registryFor(values, io, config),
          packageManager: detectPackageManager(projectDir, io.env),
          version: VERSION,
          config,
          projectDir,
        });
        await serveStdio(handler, { input: io.stdin, output: io.stdout, log: io.err });
        return 0;
      }
    }
    throw new Error(`unhandled command ${command}`);
  } catch (error) {
    if (error instanceof CliError) {
      io.err(`error: ${error.message}`);
      return 1;
    }
    throw error;
  } finally {
    io.close?.();
  }
}
