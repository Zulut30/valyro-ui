import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, SESSION_COOKIE } from '../../server/lib/app.mjs';
import { loadConfig } from '../../server/lib/config.mjs';
import { PURPOSE, seal } from '../../server/lib/tokens.mjs';
import { readSavedToken } from '../src/auth.mjs';
import { run } from '../src/cli.mjs';
import { ITEMS, cleanup, fakeIo, tempDir, writeTree } from './helpers.mjs';

/*
 * The CLI against the real account API (server/, valyro-auth, with a temporary data folder) as production runs it: what
 * needs an account or a licence goes to https://pro.valyro.xyz/api, the anonymous registry stays on https://valyro.xyz/r
 * (#38). The network is the boundary: a fetch double stands in for DNS and TLS of the two hosts and records every
 * request — pro.valyro.xyz/api reaches the local valyro-auth, valyro.xyz/r the files of a free build. A sign-in in the
 * browser is a session cookie of the same server (what GitHub sign-in would leave), so GitHub is not called.
 */

const SECRET = 's'.repeat(48);
const PRO_SOURCE = "'use client';\n\nexport function DataGrid() { return 'pro'; }\n";

const dataGrid = {
  name: 'data-grid',
  type: 'registry:item',
  title: 'Data Grid',
  description: 'Grid for 100,000 rows',
  pro: true,
  registryDependencies: [],
  files: [{ path: 'valyro-ui/productivity/DataGrid.tsx', content: PRO_SOURCE, type: 'registry:file', target: 'components/valyro-ui/productivity/DataGrid.tsx' }],
  categories: ['productivity'],
  meta: { kind: 'ui', category: 'productivity', categoryTitle: 'Productivity', exports: { 'productivity/DataGrid': ['DataGrid'] } },
};
const index = (items) => JSON.stringify({ name: 'valyro-ui', items: items.map(({ files, ...rest }) => ({ ...rest, files: [] })) });

let server;
let local;
let publicDir;
/** Every request the CLI made, as `METHOD url`. */
const requests = [];

beforeAll(async () => {
  // The free build's /r: the core items and the minimal stub of a Pro one (issue #28).
  publicDir = writeTree(tempDir('valyro-public-r-'), {
    'registry.json': JSON.parse(index([ITEMS.styles, ITEMS.button])),
    'styles.json': ITEMS.styles,
    'button.json': ITEMS.button,
    'data-grid.json': { name: 'data-grid', type: 'registry:item', pro: true },
  });
  const proDir = writeTree(tempDir('valyro-pro-r-'), {
    'registry.json': JSON.parse(index([ITEMS.styles, ITEMS.button, dataGrid])),
    'data-grid.json': dataGrid,
  });
  const config = loadConfig({
    GITHUB_CLIENT_ID: 'Iv23liTest',
    GITHUB_CLIENT_SECRET: 'client-secret',
    SESSION_SECRET: SECRET,
    PUBLIC_URL: 'https://pro.valyro.xyz',
    PRO_USERS: 'octocat',
    PRO_REGISTRY_DIR: proDir,
    PUBLIC_REGISTRY_DIR: publicDir,
    TOKENS_FILE: path.join(tempDir('valyro-auth-data-'), 'tokens.json'),
  });
  server = createServer(createApp(config, { log: { info() {}, warn() {}, error() {} }, limits: { auth: 1000, api: 1000 } }));
  local = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
});
afterAll(() => {
  server.close();
  cleanup();
});

/** The two production hosts, as far as the CLI can see them. */
async function hosts(url, init) {
  const href = String(url);
  requests.push(`${init?.method ?? 'GET'} ${href}`);
  if (href.startsWith('https://pro.valyro.xyz/api/')) return fetch(`${local}${href.slice('https://pro.valyro.xyz'.length)}`, init);
  if (href.startsWith('https://valyro.xyz/r/')) {
    const file = path.join(publicDir, href.slice('https://valyro.xyz/r/'.length));
    return fs.existsSync(file) ? new Response(fs.readFileSync(file), { headers: { 'content-type': 'application/json' } }) : new Response('Not Found', { status: 404 });
  }
  throw new TypeError(`fetch failed: no route to ${href} in this test`);
}

/** What signing in to the site with GitHub leaves: octocat's session cookie. */
function session() {
  const iat = Math.floor(Date.now() / 1000);
  return `${SESSION_COOKIE}=${seal(SECRET, PURPOSE.session, { v: 1, sub: 'octocat', uid: 1, iat, exp: iat + 3600 })}`;
}

/** Approves a pending CLI sign-in as the signed-in octocat would on the device page. */
async function approveInBrowser(userCode) {
  const response = await fetch(`${local}/api/cli/device/approve`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: session() }, body: JSON.stringify({ user_code: userCode }) });
  expect(response.status).toBe(200);
}

/** A token made on the account page. */
async function accountPageToken() {
  const response = await fetch(`${local}/api/tokens`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: session() }, body: JSON.stringify({ name: 'CI' }) });
  expect(response.status).toBe(201);
  return (await response.json()).token;
}

function project() {
  return writeTree(tempDir('valyro-app-'), {
    'package.json': { name: 'app', dependencies: { react: '^19.0.0' } },
    'package-lock.json': '{}',
    'valyro.json': { registry: 'https://valyro.xyz/r', framework: 'vite', installDir: 'src/components/valyro-ui', alias: null, rsc: false, theme: 'vercel', mode: 'light' },
  });
}

describe('the CLI on the production hosts (#38)', () => {
  // One account through the whole story: the token login saves is the one whoami and add use.
  const env = { VALYRO_CONFIG_DIR: tempDir('valyro-config-') };

  it('login signs in through pro.valyro.xyz: the approval page and every call of the device flow', async () => {
    requests.length = 0;
    const t = fakeIo(process.cwd(), {
      env,
      fetch: hosts,
      open: () => {},
      sleep: async () => {
        const code = /Your one-time code: (\S+)/.exec(t.text())[1];
        await approveInBrowser(code);
      },
    });
    expect(await run(['login', '--no-browser'], t.io)).toBe(0);
    expect(t.text()).toMatch(/https:\/\/pro\.valyro\.xyz\/#\/device\?code=[A-Z]{4}-[A-Z]{4}/);
    expect(t.text()).toContain('Logged in as octocat');
    expect(requests).toEqual(['POST https://pro.valyro.xyz/api/cli/device', 'POST https://pro.valyro.xyz/api/cli/device/token', 'GET https://pro.valyro.xyz/api/me']);
    expect(readSavedToken(env)).toMatch(/^vlyt_/);
  });

  it('whoami asks pro.valyro.xyz', async () => {
    requests.length = 0;
    const t = fakeIo(process.cwd(), { env, fetch: hosts });
    expect(await run(['whoami'], t.io)).toBe(0);
    expect(t.text()).toContain('octocat (ValyroUI Pro)');
    expect(requests).toEqual(['GET https://pro.valyro.xyz/api/me']);
  });

  it('add takes a Pro component from the licensed API on pro.valyro.xyz, the free items from valyro.xyz/r', async () => {
    requests.length = 0;
    const dir = project();
    const t = fakeIo(dir, { env, fetch: hosts });
    expect(await run(['add', 'data-grid', '--yes', '--skip-install'], t.io)).toBe(0);
    // The project is not RSC, so the file arrives without its 'use client'.
    expect(fs.readFileSync(path.join(dir, 'src/components/valyro-ui/productivity/DataGrid.tsx'), 'utf8')).toBe("export function DataGrid() { return 'pro'; }\n");
    expect(requests).toContain('GET https://valyro.xyz/r/data-grid.json');
    expect(requests).toContain('GET https://pro.valyro.xyz/api/registry/data-grid');
    expect(requests.filter((request) => request.includes('://valyro.xyz/api'))).toEqual([]);
  });

  it('without an account the same add sends to the pricing page on pro.valyro.xyz and never calls the API', async () => {
    requests.length = 0;
    const t = fakeIo(project(), { fetch: hosts });
    expect(await run(['add', 'data-grid', '--yes', '--skip-install'], t.io)).toBe(1);
    expect(t.errors()).toContain('https://pro.valyro.xyz/pricing/');
    expect(requests).toEqual(['GET https://valyro.xyz/r/data-grid.json']);
  });

  it('the hosted MCP server stays on valyro.xyz, where the docs of both sites show it', async () => {
    const t = fakeIo(process.cwd(), { env, fetch: hosts });
    expect(await run(['mcp', 'add', 'claude-code', '--hosted', '--print'], t.io)).toBe(0);
    expect(t.text()).toContain('"url": "https://valyro.xyz/api/mcp"');
    expect(t.text()).not.toContain('pro.valyro.xyz/api');
  });

  it('VALYRO_API_URL still points every account call elsewhere', async () => {
    requests.length = 0;
    const t = fakeIo(process.cwd(), { env: { VALYRO_CONFIG_DIR: tempDir('valyro-config-'), VALYRO_TOKEN: await accountPageToken(), VALYRO_API_URL: `${local}/api` } });
    // The local server is reached without the host double: hosts() would record it and refuse the address.
    t.io.fetch = (url, init) => (String(url).startsWith(local) ? fetch(url, init) : hosts(url, init));
    expect(await run(['whoami'], t.io)).toBe(0);
    expect(t.text()).toContain('octocat (ValyroUI Pro)');
    expect(requests).toEqual([]);
  });
});
