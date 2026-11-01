import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readSavedToken, saveToken } from '../src/auth.mjs';
import { run } from '../src/cli.mjs';
import { registryFor } from '../src/commands.mjs';
import { ACCOUNT_URL, API_URL, DEFAULT_REGISTRY_URL, PRICING_URL, PRO_SITE_URL } from '../src/constants.mjs';
import { createMcpHandler } from '../src/mcp.mjs';
import { createRegistry } from '../src/registry.mjs';
import { ITEMS, cleanup, fakeIo, tempDir, writeTree } from './helpers.mjs';

afterAll(cleanup);

const PRO = 'vlyt_pro_0123456789abcdefghijklmnopqrstuvwxyzAB';
const FREE = 'vlyt_free_0123456789abcdefghijklmnopqrstuvwxyzA';
const PRO_SOURCE = "export function DataGrid() { return 'pro'; }";

/* ── A local stand-in for https://pro.valyro.xyz/api ── */

const api = { requests: [], polls: [], revoked: [], failStart: false };
let server;
let base;

function fakeApi(req, res) {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const auth = req.headers.authorization ?? null;
    api.requests.push({ method: req.method, url: req.url, auth, body: body ? JSON.parse(body) : undefined });
    const json = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    const route = `${req.method} ${req.url}`;
    if (route === 'POST /api/cli/device' && api.failStart) return json(503, { message: 'The sign-in is down.' });
    if (route === 'POST /api/cli/device') {
      // The server builds the approval link from its PUBLIC_URL: production's is the Pro site.
      return json(200, { device_code: 'D'.repeat(43), user_code: 'BCDF-GHJK', verification_url: 'https://pro.valyro.xyz/#/device?code=BCDF-GHJK', interval: 5, expires_in: 600 });
    }
    if (route === 'POST /api/cli/device/token') {
      const next = api.polls.shift() ?? { status: 400, body: { error: 'expired_token' } };
      return json(next.status, next.body);
    }
    if (route === 'GET /api/me') {
      if (auth === `Bearer ${PRO}`) return json(200, { user: { login: 'octocat' }, plan: { tier: 'pro', kind: 'solo' }, token: { id: 'abc', name: 'laptop' } });
      if (auth === `Bearer ${FREE}`) return json(200, { user: { login: 'hubot' }, plan: { tier: 'free' }, token: { id: 'def', name: 'ci' } });
      return json(401, { error: 'invalid_token', message: 'The token is invalid' });
    }
    if (route === 'DELETE /api/tokens/current') {
      if (auth !== `Bearer ${PRO}`) return json(401, { error: 'invalid_token' });
      api.revoked.push(auth);
      return json(200, { revoked: true });
    }
    if (req.method === 'GET' && req.url === '/api/registry/data-grid') {
      if (auth === `Bearer ${PRO}`) return json(200, { ...stub, files: [{ path: 'valyro-ui/productivity/DataGrid.tsx', content: PRO_SOURCE, type: 'registry:file' }] });
      if (auth === `Bearer ${FREE}`) return json(402, { error: 'pro_required' });
      return json(401, { error: 'invalid_token' });
    }
    json(404, { error: 'not_found' });
  });
}

const stub = { name: 'data-grid', title: 'Data Grid', description: 'Grid', pro: true, files: [], categories: ['productivity'], meta: { exports: {} } };

beforeAll(async () => {
  server = createServer(fakeApi);
  base = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/api`)));
});
afterAll(() => server.close());
afterEach(() => {
  api.requests.length = 0;
  api.polls.length = 0;
  api.revoked.length = 0;
  api.failStart = false;
});

/** fakeIo pointed at the local API; never sleeps, records opened URLs. */
function accountIo(overrides = {}) {
  const opened = [];
  const sleeps = [];
  const t = fakeIo(process.cwd(), { open: (url) => opened.push(url), sleep: async (ms) => sleeps.push(ms), ...overrides });
  t.io.env.VALYRO_API_URL = base;
  return { ...t, opened, sleeps };
}

describe('valyro login (device code)', () => {
  it('shows the code, opens the approval page, polls until approved and saves the token (0600)', async () => {
    api.polls.push(
      { status: 400, body: { error: 'authorization_pending' } },
      { status: 400, body: { error: 'slow_down', interval: 10 } },
      { status: 200, body: { token: PRO, token_type: 'bearer', login: 'octocat', id: 'abc', name: 'valyro CLI on laptop' } },
    );
    const t = accountIo();
    expect(await run(['login'], t.io)).toBe(0);
    expect(t.text()).toContain('Your one-time code: BCDF-GHJK');
    expect(t.opened).toEqual(['https://pro.valyro.xyz/#/device?code=BCDF-GHJK']);
    expect(t.sleeps).toEqual([5000, 5000, 10000]);
    expect(api.requests[0]).toMatchObject({ method: 'POST', url: '/api/cli/device', body: { name: expect.stringMatching(/^valyro CLI on /) } });
    expect(api.requests.filter((r) => r.url === '/api/cli/device/token').every((r) => r.body.device_code === 'D'.repeat(43))).toBe(true);
    expect(readSavedToken(t.io.env)).toBe(PRO);
    const file = path.join(t.io.env.VALYRO_CONFIG_DIR, 'auth.json');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ token: PRO, login: 'octocat' });
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(t.text()).toContain('Logged in as octocat');
    expect(t.text()).toContain('Plan: ValyroUI Pro');
  });

  it('--no-browser only prints the URL; a denied or expired code fails without saving', async () => {
    for (const [error, message] of [
      ['access_denied', 'denied in the browser'],
      ['expired_token', 'code expired'],
    ]) {
      api.polls.push({ status: 400, body: { error } });
      const t = accountIo();
      expect(await run(['login', '--no-browser'], t.io)).toBe(1);
      expect(t.opened).toEqual([]);
      expect(t.text()).toContain('https://pro.valyro.xyz/#/device?code=BCDF-GHJK');
      expect(t.errors()).toContain(message);
      expect(readSavedToken(t.io.env)).toBeNull();
    }
  });

  it('sends a failed sign-in to the token page on the Pro site', async () => {
    api.failStart = true;
    const t = accountIo();
    expect(await run(['login'], t.io)).toBe(1);
    expect(t.errors()).toContain('The sign-in is down.');
    expect(t.errors()).toContain('create a token at https://pro.valyro.xyz/account/');
  });

  it('explains an API that is not there', async () => {
    const t = accountIo();
    t.io.env.VALYRO_API_URL = 'http://127.0.0.1:9/api';
    expect(await run(['login'], t.io)).toBe(1);
    expect(t.errors()).toContain('Cannot reach http://127.0.0.1:9/api/cli/device');
    t.io.env.VALYRO_API_URL = 'http://example.com/api';
    expect(await run(['login'], t.io)).toBe(1);
    expect(t.errors()).toContain('VALYRO_API_URL must use https');
  });
});

describe('the CLI addresses', () => {
  it('sends sign-in, pricing, the account and its API to the Pro site; the anonymous registry stays on valyro.xyz (#38)', () => {
    expect(PRO_SITE_URL).toBe('https://pro.valyro.xyz');
    expect(PRICING_URL).toBe('https://pro.valyro.xyz/pricing/');
    expect(ACCOUNT_URL).toBe('https://pro.valyro.xyz/account/');
    expect(DEFAULT_REGISTRY_URL).toBe('https://valyro.xyz/r');
    expect(API_URL).toBe('https://pro.valyro.xyz/api');
  });
});

describe('valyro whoami / logout', () => {
  it('whoami prints the account and plan, or explains a missing or rejected token', async () => {
    const pro = accountIo();
    saveToken(pro.io.env, PRO);
    expect(await run(['whoami'], pro.io)).toBe(0);
    expect(pro.text()).toContain('octocat (ValyroUI Pro)');
    expect(api.requests.at(-1)).toMatchObject({ url: '/api/me', auth: `Bearer ${PRO}` });

    const free = accountIo();
    free.io.env.VALYRO_TOKEN = FREE;
    expect(await run(['whoami'], free.io)).toBe(0);
    expect(free.text()).toContain('hubot (free plan), token from VALYRO_TOKEN');
    expect(free.text()).toContain(PRICING_URL);

    const none = accountIo();
    expect(await run(['whoami'], none.io)).toBe(1);
    expect(none.errors()).toContain('Not logged in');

    const revoked = accountIo();
    revoked.io.env.VALYRO_TOKEN = 'vlyt_revoked_0123456789abcdefghijklmnopqrstu';
    expect(await run(['whoami'], revoked.io)).toBe(1);
    expect(revoked.errors()).toContain('not accepted');
  });

  it('logout revokes the token on the server and deletes it; offline it still deletes it, with a warning', async () => {
    const t = accountIo();
    saveToken(t.io.env, PRO);
    expect(await run(['logout'], t.io)).toBe(0);
    expect(api.revoked).toEqual([`Bearer ${PRO}`]);
    expect(t.text()).toContain('Revoked the token');
    expect(readSavedToken(t.io.env)).toBeNull();

    const offline = accountIo();
    offline.io.env.VALYRO_API_URL = 'http://127.0.0.1:9/api';
    saveToken(offline.io.env, PRO);
    expect(await run(['logout'], offline.io)).toBe(0);
    expect(offline.errors()).toContain('could not revoke');
    expect(readSavedToken(offline.io.env)).toBeNull();

    const nobody = accountIo();
    expect(await run(['logout'], nobody.io)).toBe(0);
    expect(nobody.text()).toContain('Not logged in');
  });
});

describe('local MCP with the account', () => {
  const registry = () => {
    const files = { 'registry.json': { items: [ITEMS.button, stub].map(({ files: f, ...rest }) => rest) }, 'button.json': ITEMS.button, 'styles.json': ITEMS.styles, 'data-grid.json': stub };
    return writeTree(tempDir('valyro-reg-'), files);
  };
  const getComponent = async (token) => {
    const handler = createMcpHandler({ registry: createRegistry(registry(), { token, proUrl: `${base}/registry` }), version: '1' });
    const res = await handler.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_component', arguments: { name: 'data-grid' } } });
    return res.result.content[0].text;
  };

  it('returns Pro source for a Pro token and says why not otherwise', async () => {
    expect(await getComponent(PRO)).toContain(PRO_SOURCE);
    const free = await getComponent(FREE);
    expect(free).toContain('no active ValyroUI Pro licence (402)');
    expect(free).toContain(PRICING_URL);
    expect(free).not.toContain(PRO_SOURCE);
    expect(await getComponent('vlyt_revoked_0123456789abcdefghijklmnopqrstu')).toContain('was not accepted (401)');
    expect(await getComponent(null)).toContain('login');
  });

  it('valyro mcp sends the saved token to VALYRO_API_URL', async () => {
    const t = accountIo();
    saveToken(t.io.env, PRO);
    const handler = createMcpHandler({ registry: registryFor({ registry: registry() }, t.io, null), version: '1' });
    await handler.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_component', arguments: { name: 'data-grid' } } });
    expect(api.requests).toEqual([expect.objectContaining({ url: '/api/registry/data-grid', auth: `Bearer ${PRO}` })]);
  });
});
