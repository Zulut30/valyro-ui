// `valyro mcp add <client>`: adds the ValyroUI MCP server to an AI client's config file. Formats follow
// each client's docs (checked 2026-10): Claude Code, Cursor, VS Code, Windsurf (Devin Desktop), Codex, OpenCode.
//
// Only the `valyro` entry is written: everything else in the file is kept, a changed file is backed up
// first (to <valyro config dir>/backups/, outside the project) and replaced atomically. A file that is not
// plain JSON (comments) is left alone and the snippet printed instead. Project files are meant to be
// committed, so a hosted entry there names the VALYRO_TOKEN variable (or VS Code's secret prompt) instead
// of the token; files in the home folder get the token itself.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apiUrl, authFile, configDir, readToken } from './auth.mjs';
import { ACCOUNT_URL, CLI_PACKAGE, MCP_API_URL } from './constants.mjs';
import { CliError } from './registry.mjs';

export const SERVER_NAME = 'valyro';
export const TOKEN_ENV = 'VALYRO_TOKEN';
export const LOCAL_COMMAND = ['npx', '-y', `${CLI_PACKAGE}@latest`, 'mcp'];
const [COMMAND, ...ARGS] = LOCAL_COMMAND;
const VSCODE_INPUT = 'valyro-token';

const homeOf = (env) => env.HOME || env.USERPROFILE || os.homedir();
const xdgConfig = (env) => env.XDG_CONFIG_HOME || path.join(homeOf(env), '.config');

function vscodeUserDir(env) {
  if (process.platform === 'darwin') return path.join(homeOf(env), 'Library', 'Application Support', 'Code', 'User');
  if (process.platform === 'win32') return path.join(env.APPDATA ?? path.join(homeOf(env), 'AppData', 'Roaming'), 'Code', 'User');
  return path.join(xdgConfig(env), 'Code', 'User');
}

/** Windsurf is now Devin Desktop (~/.config/devin); an existing Windsurf install keeps ~/.codeium/windsurf. */
function windsurfFile(env) {
  const legacy = path.join(homeOf(env), '.codeium', 'windsurf');
  if (fs.existsSync(legacy)) return path.join(legacy, 'mcp_config.json');
  const dir = process.platform === 'win32' && env.APPDATA ? path.join(env.APPDATA, 'devin') : path.join(xdgConfig(env), 'devin');
  return path.join(dir, 'mcp_config.json');
}

/** opencode.json, or an existing opencode.jsonc when there is no .json. */
function opencodeFile(dir) {
  const jsonc = path.join(dir, 'opencode.jsonc');
  const json = path.join(dir, 'opencode.json');
  return !fs.existsSync(json) && fs.existsSync(jsonc) ? jsonc : json;
}

/**
 * `auth.token` is the token itself (home-folder files); without it, each client's way of reading it at start.
 * `file(scope, env, projectDir)` is the config file.
 */
export const CLIENTS = {
  'claude-code': {
    label: 'Claude Code',
    scopes: ['project', 'user'],
    defaultScope: 'project',
    // User scope lives in ~/.claude.json (`claude mcp add --scope user` writes the same key).
    file: (scope, env, projectDir) => (scope === 'project' ? path.join(projectDir, '.mcp.json') : path.join(homeOf(env), '.claude.json')),
    section: 'mcpServers',
    local: () => ({ type: 'stdio', command: COMMAND, args: ARGS }),
    hosted: (url, auth) => ({ type: 'http', url, headers: { Authorization: `Bearer ${auth.token ?? `\${${TOKEN_ENV}}`}` } }),
  },
  cursor: {
    label: 'Cursor',
    scopes: ['project', 'user'],
    defaultScope: 'project',
    file: (scope, env, projectDir) => path.join(scope === 'project' ? projectDir : homeOf(env), '.cursor', 'mcp.json'),
    section: 'mcpServers',
    local: () => ({ type: 'stdio', command: COMMAND, args: ARGS }),
    hosted: (url, auth) => ({ url, headers: { Authorization: `Bearer ${auth.token ?? `\${env:${TOKEN_ENV}}`}` } }),
  },
  vscode: {
    label: 'VS Code',
    scopes: ['project', 'user'],
    defaultScope: 'project',
    file: (scope, env, projectDir) => path.join(scope === 'project' ? path.join(projectDir, '.vscode') : vscodeUserDir(env), 'mcp.json'),
    section: 'servers',
    local: () => ({ type: 'stdio', command: COMMAND, args: ARGS }),
    // VS Code documents no ${env:…} in mcp.json; an input asks once and keeps the token in its secret storage.
    hosted: (url, auth) => ({ type: 'http', url, headers: { Authorization: `Bearer ${auth.token ?? `\${input:${VSCODE_INPUT}}`}` } }),
    inputs: (auth) => (auth.token ? [] : [{ type: 'promptString', id: VSCODE_INPUT, description: `ValyroUI token (${ACCOUNT_URL})`, password: true }]),
  },
  windsurf: {
    label: 'Windsurf',
    scopes: ['user'],
    defaultScope: 'user',
    file: (scope, env) => windsurfFile(env),
    section: 'mcpServers',
    local: () => ({ command: COMMAND, args: ARGS }),
    hosted: (url, auth) => ({ serverUrl: url, headers: { Authorization: `Bearer ${auth.token ?? `\${env:${TOKEN_ENV}}`}` } }),
  },
  codex: {
    label: 'Codex',
    scopes: ['project', 'user'],
    // Codex reads .codex/config.toml only in trusted projects.
    defaultScope: 'user',
    file: (scope, env, projectDir) => path.join(scope === 'project' ? path.join(projectDir, '.codex') : env.CODEX_HOME || path.join(homeOf(env), '.codex'), 'config.toml'),
    toml: true,
  },
  opencode: {
    label: 'OpenCode',
    scopes: ['project', 'user'],
    defaultScope: 'project',
    file: (scope, env, projectDir) => opencodeFile(scope === 'project' ? projectDir : path.join(xdgConfig(env), 'opencode')),
    section: 'mcp',
    newFile: { $schema: 'https://opencode.ai/config.json' },
    local: () => ({ type: 'local', command: LOCAL_COMMAND, enabled: true }),
    hosted: (url, auth) => ({ type: 'remote', url, headers: { Authorization: `Bearer ${auth.token ?? `{env:${TOKEN_ENV}}`}` }, enabled: true }),
  },
};

export const CLIENT_IDS = Object.keys(CLIENTS);

const toml = (value) => JSON.stringify(value);

function codexBlock(kind, url, auth) {
  const lines = [`[mcp_servers.${SERVER_NAME}]`];
  if (kind === 'local') lines.push(`command = ${toml(COMMAND)}`, `args = [${ARGS.map(toml).join(', ')}]`);
  else if (auth.token) lines.push(`url = ${toml(url)}`, `http_headers = { "Authorization" = ${toml(`Bearer ${auth.token}`)} }`);
  else lines.push(`url = ${toml(url)}`, `bearer_token_env_var = ${toml(TOKEN_ENV)}`);
  return lines.join('\n');
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The JSON document with our entry (and VS Code input) set; everything else as it was. */
function mergeJson(doc, client, entry, inputs) {
  const next = { ...doc };
  if (next[client.section] !== undefined && !isObject(next[client.section])) throw new CliError(`"${client.section}" is not an object`);
  next[client.section] = { ...next[client.section], [SERVER_NAME]: entry };
  if (inputs.length) {
    if (next.inputs !== undefined && !Array.isArray(next.inputs)) throw new CliError('"inputs" is not an array');
    const have = new Set((next.inputs ?? []).map((input) => input?.id));
    next.inputs = [...(next.inputs ?? []), ...inputs.filter((input) => !have.has(input.id))];
  }
  return next;
}

/**
 * Codex config.toml with our [mcp_servers.valyro] table (and its sub-tables) replaced or appended.
 * Without a TOML parser, a `valyro` server written another way (inline table, dotted key) is not touched.
 */
function mergeToml(text, block) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const ours = new RegExp(`^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:${SERVER_NAME}|"${SERVER_NAME}"|'${SERVER_NAME}')\\s*(?:\\.[^\\]]*)?\\]\\s*(?:#.*)?$`);
  const keyed = new RegExp(`^\\s*(?:mcp_servers\\s*\\.\\s*)?["']?${SERVER_NAME}["']?\\s*[.=]`);
  const kept = [];
  let table = '';
  let skipping = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      skipping = ours.test(line);
      table = line.replace(/\s+/g, '');
    }
    if (skipping) continue;
    const inServers = table === '[mcp_servers]' || (table === '' && /^\s*mcp_servers\s*\./.test(line));
    if (inServers && keyed.test(line)) throw new CliError(`the "${SERVER_NAME}" MCP server is defined in a form this command does not edit`);
    kept.push(line);
  }
  while (kept.length && !kept.at(-1).trim()) kept.pop();
  return `${kept.length ? `${kept.join(eol)}${eol}${eol}` : ''}${block.split('\n').join(eol)}${eol}`;
}

function backup(env, clientId, file) {
  const dir = path.join(configDir(env), 'backups');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${clientId}-${path.basename(file)}`);
  fs.copyFileSync(file, target);
  fs.chmodSync(target, 0o600);
  return target;
}

function writeAtomic(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, text, { mode });
    fs.chmodSync(temp, mode);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw new CliError(`Cannot write ${file}: ${error.message}`, { cause: error });
  }
}

const display = (file, env, projectDir) => {
  const rel = path.relative(projectDir, file);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  const home = homeOf(env);
  return file.startsWith(`${home}${path.sep}`) ? `~${file.slice(home.length)}` : file;
};

/**
 * @param {{ hosted?: boolean, print?: boolean, scope?: string, cwd?: string }} opts
 * @param {string} clientId
 */
export function mcpAdd(opts, clientId, io, projectDir) {
  const client = CLIENTS[clientId];
  if (!client) throw new CliError(`Unknown client "${clientId}". Clients: ${CLIENT_IDS.join(', ')}.`);
  const scope = opts.scope ?? client.defaultScope;
  if (!client.scopes.includes(scope)) throw new CliError(`${client.label} supports --scope ${client.scopes.join(' or ')}.`);
  const kind = opts.hosted ? 'hosted' : 'local';
  // On valyro.xyz, not on the account API's host (#38): the hosted server is the free site's, as the docs show it.
  const url = `${apiUrl(io.env, MCP_API_URL)}/mcp`;
  const file = client.file(scope, io.env, projectDir);
  const shown = display(file, io.env, projectDir);

  // Never the token in a project file or on screen.
  let auth = {};
  if (kind === 'hosted' && scope === 'user' && !opts.print) {
    const token = readToken(io.env);
    if (!token) throw new CliError(`The hosted server needs your token: run \`npx ${CLI_PACKAGE} login\` first (or set ${TOKEN_ENV}), or use --print.`);
    auth = { token };
  }

  let snippet;
  let render;
  if (client.toml) {
    snippet = codexBlock(kind, url, auth);
    render = (text) => mergeToml(text, snippet);
  } else {
    const entry = kind === 'local' ? client.local() : client.hosted(url, auth);
    const inputs = kind === 'hosted' && client.inputs ? client.inputs(auth) : [];
    snippet = JSON.stringify(mergeJson(client.newFile ?? {}, client, entry, inputs), null, 2);
    render = (text) => {
      let doc = client.newFile ?? {};
      if (text.trim()) {
        try {
          doc = JSON.parse(text);
        } catch (error) {
          throw new CliError('it is not plain JSON (comments or trailing commas?)', { cause: error });
        }
        if (!isObject(doc)) throw new CliError('it is not a JSON object');
      }
      return `${JSON.stringify(mergeJson(doc, client, entry, inputs), null, 2)}\n`;
    };
  }

  const hints = [];
  if (kind === 'hosted' && !auth.token) {
    hints.push(
      clientId === 'vscode'
        ? `VS Code asks for the token when the server first starts: create one at ${ACCOUNT_URL}.`
        : `Set ${TOKEN_ENV} in the environment ${client.label} starts from, to a token from ${ACCOUNT_URL} (or the one \`valyro login\` saved in ${authFile(io.env)}).`,
    );
  }
  if (kind === 'local') hints.push(`It runs \`${LOCAL_COMMAND.join(' ')}\`; Pro components use the token from \`valyro login\`.`);

  if (opts.print) {
    io.out(`# ${client.label}: ${shown}${scope === 'project' ? '' : ' (user)'}`);
    io.out(snippet);
    for (const hint of hints) io.out(`# ${hint}`);
    return 0;
  }

  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  let next;
  try {
    next = render(existing ?? '');
  } catch (error) {
    if (!(error instanceof CliError)) throw error;
    throw new CliError(`${shown} was left unchanged: ${error.message}. Add this to it by hand:\n${snippet}`, { cause: error });
  }
  if (next === existing) {
    io.out(`${client.label} already has the ${kind} ValyroUI MCP server in ${shown}.`);
    return 0;
  }
  const saved = existing === null ? null : backup(io.env, clientId, file);
  const current = existing === null ? 0o644 : fs.statSync(file).mode & 0o777;
  // A file that now holds the token is kept from other users.
  const mode = auth.token ? current & 0o700 : current;
  writeAtomic(file, next, mode);
  io.out(`Added the ${kind} ValyroUI MCP server to ${shown}${saved ? ` (backup: ${saved})` : ''}.`);
  for (const hint of hints) io.out(hint);
  io.out(`Restart ${client.label} or reload its MCP servers to use it.`);
  return 0;
}
