import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { saveToken } from '../src/auth.mjs';
import { run } from '../src/cli.mjs';
import { cleanup, fakeIo, tempDir, writeTree } from './helpers.mjs';

afterAll(cleanup);

const TOKEN = 'vlyt_0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const LOCAL = ['-y', 'valyro-cli@latest', 'mcp'];
const HOSTED = 'https://valyro.xyz/api/mcp';

/** A project and a home folder of their own, a saved token unless `token: null`. */
function setup({ token = TOKEN, files = {}, home = {} } = {}) {
  const project = writeTree(tempDir('valyro-proj-'), files);
  const t = fakeIo(project);
  t.io.env.HOME = writeTree(tempDir('valyro-home-'), home);
  if (token) saveToken(t.io.env, token);
  const read = (file) => fs.readFileSync(path.join(file.startsWith('~/') ? t.io.env.HOME : project, file.replace(/^~\//, '')), 'utf8');
  return { ...t, project, home: t.io.env.HOME, read, json: (file) => JSON.parse(read(file)), add: (...args) => run(['mcp', 'add', ...args], t.io) };
}

const backups = (t) => {
  const dir = path.join(t.io.env.VALYRO_CONFIG_DIR, 'backups');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

describe('valyro mcp add', () => {
  it('claude-code: adds the local server to .mcp.json and keeps the other servers, with a backup', async () => {
    const t = setup({ files: { '.mcp.json': { mcpServers: { other: { command: 'other-mcp' } }, extra: true } } });
    expect(await t.add('claude-code')).toBe(0);
    expect(t.json('.mcp.json')).toEqual({ mcpServers: { other: { command: 'other-mcp' }, valyro: { type: 'stdio', command: 'npx', args: LOCAL } }, extra: true });
    expect(backups(t)).toEqual([expect.stringMatching(/claude-code-\.mcp\.json$/)]);
    expect(t.text()).toContain('Added the local ValyroUI MCP server to .mcp.json');

    // Again: nothing to do, no second backup.
    expect(await t.add('claude-code')).toBe(0);
    expect(t.text()).toContain('already has the local');
    expect(backups(t)).toHaveLength(1);
  });

  it('project files reference VALYRO_TOKEN (or a VS Code prompt), never the token', async () => {
    const t = setup();
    for (const client of ['claude-code', 'cursor', 'vscode', 'opencode']) expect(await t.add(client, '--hosted')).toBe(0);
    expect(await t.add('codex', '--hosted', '--scope', 'project')).toBe(0);
    expect(t.json('.mcp.json').mcpServers.valyro).toEqual({ type: 'http', url: HOSTED, headers: { Authorization: 'Bearer ${VALYRO_TOKEN}' } });
    expect(t.json('.cursor/mcp.json').mcpServers.valyro).toEqual({ url: HOSTED, headers: { Authorization: 'Bearer ${env:VALYRO_TOKEN}' } });
    const vscode = t.json('.vscode/mcp.json');
    expect(vscode.servers.valyro).toEqual({ type: 'http', url: HOSTED, headers: { Authorization: 'Bearer ${input:valyro-token}' } });
    expect(vscode.inputs).toEqual([expect.objectContaining({ type: 'promptString', id: 'valyro-token', password: true })]);
    expect(t.json('opencode.json')).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: { valyro: { type: 'remote', url: HOSTED, headers: { Authorization: 'Bearer {env:VALYRO_TOKEN}' }, enabled: true } },
    });
    expect(t.read('.codex/config.toml')).toBe(`[mcp_servers.valyro]\nurl = "${HOSTED}"\nbearer_token_env_var = "VALYRO_TOKEN"\n`);
    for (const file of ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json', 'opencode.json', '.codex/config.toml']) expect(t.read(file)).not.toContain(TOKEN);
    expect(t.text()).toContain('Set VALYRO_TOKEN in the environment');
  });

  it('user scope: files in the home folder get the token, readable by the user only', async () => {
    const t = setup({ home: { '.cursor/mcp.json': { mcpServers: { keep: { url: 'https://example.com/mcp' } } } } });
    fs.chmodSync(path.join(t.home, '.cursor/mcp.json'), 0o644);
    expect(await t.add('cursor', '--hosted', '--scope', 'user')).toBe(0);
    expect(t.json('~/.cursor/mcp.json').mcpServers).toEqual({ keep: { url: 'https://example.com/mcp' }, valyro: { url: HOSTED, headers: { Authorization: `Bearer ${TOKEN}` } } });
    if (process.platform !== 'win32') expect(fs.statSync(path.join(t.home, '.cursor/mcp.json')).mode & 0o777).toBe(0o600);

    expect(await t.add('claude-code', '--hosted', '--scope', 'user')).toBe(0);
    expect(t.json('~/.claude.json').mcpServers.valyro.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(await t.add('windsurf')).toBe(0);
    expect(t.json('~/.config/devin/mcp_config.json').mcpServers.valyro).toEqual({ command: 'npx', args: LOCAL });
    expect(await t.add('opencode', '--scope', 'user')).toBe(0);
    expect(t.json('~/.config/opencode/opencode.json').mcp.valyro).toEqual({ type: 'local', command: ['npx', ...LOCAL], enabled: true });
    expect(fs.existsSync(path.join(t.project, '.cursor'))).toBe(false);
  });

  it('windsurf keeps an existing ~/.codeium/windsurf install', async () => {
    const t = setup({ home: { '.codeium/windsurf/mcp_config.json': { mcpServers: {} } } });
    expect(await t.add('windsurf', '--hosted')).toBe(0);
    expect(t.json('~/.codeium/windsurf/mcp_config.json').mcpServers.valyro).toEqual({ serverUrl: HOSTED, headers: { Authorization: `Bearer ${TOKEN}` } });
  });

  it('codex: replaces its own table in config.toml and keeps everything else', async () => {
    const before = [
      'model = "gpt-5"',
      '',
      '[mcp_servers.context7]',
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp"]',
      '',
      '[mcp_servers.valyro]',
      'url = "https://old.example/mcp"',
      '',
      '[mcp_servers.valyro.env]',
      'X = "1"',
      '',
      '[profiles.fast]',
      'model = "gpt-5-mini"',
      '',
    ].join('\n');
    const t = setup({ home: { '.codex/config.toml': before } });
    expect(await t.add('codex')).toBe(0);
    const after = t.read('~/.codex/config.toml');
    expect(after).toContain('[mcp_servers.context7]\ncommand = "npx"');
    expect(after).toContain('[profiles.fast]\nmodel = "gpt-5-mini"');
    expect(after).not.toContain('old.example');
    expect(after).not.toContain('[mcp_servers.valyro.env]');
    expect(after.endsWith('[mcp_servers.valyro]\ncommand = "npx"\nargs = ["-y", "valyro-cli@latest", "mcp"]\n')).toBe(true);
    expect(await t.add('codex')).toBe(0);
    expect(t.text()).toContain('already has the local');

    const inline = setup({ home: { '.codex/config.toml': '[mcp_servers]\nvalyro = { command = "x" }\n' } });
    expect(await inline.add('codex')).toBe(1);
    expect(inline.errors()).toContain('left unchanged');
    expect(inline.read('~/.codex/config.toml')).toBe('[mcp_servers]\nvalyro = { command = "x" }\n');
  });

  it('leaves files with comments alone and prints the snippet instead', async () => {
    const jsonc = '{\n  // my servers\n  "servers": {}\n}\n';
    const t = setup({ files: { '.vscode/mcp.json': jsonc } });
    expect(await t.add('vscode')).toBe(1);
    expect(t.errors()).toContain('.vscode/mcp.json was left unchanged: it is not plain JSON');
    expect(t.errors()).toContain('"servers"');
    expect(t.read('.vscode/mcp.json')).toBe(jsonc);
  });

  it('--print writes nothing and never shows the token; bad input is explained', async () => {
    const t = setup();
    expect(await t.add('cursor', '--hosted', '--scope', 'user', '--print')).toBe(0);
    expect(t.text()).toContain('${env:VALYRO_TOKEN}');
    expect(t.text()).not.toContain(TOKEN);
    expect(fs.existsSync(path.join(t.home, '.cursor'))).toBe(false);

    expect(await t.add('emacs')).toBe(1);
    expect(t.errors()).toContain('Clients: claude-code, cursor, vscode, windsurf, codex, opencode');
    expect(await t.add('windsurf', '--scope', 'project')).toBe(1);
    expect(t.errors()).toContain('Windsurf supports --scope user');

    const noToken = setup({ token: null });
    expect(await noToken.add('cursor', '--hosted', '--scope', 'user')).toBe(1);
    expect(noToken.errors()).toContain('valyro-cli login');
    expect(await run(['mcp', '--hosted'], noToken.io)).toBe(1);
  });
});
