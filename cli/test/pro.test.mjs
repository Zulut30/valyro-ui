import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readToken } from '../src/auth.mjs';
import { run } from '../src/cli.mjs';
import { PRICING_URL, PRO_REGISTRY_URL } from '../src/constants.mjs';
import { createMcpHandler } from '../src/mcp.mjs';
import { createRegistry } from '../src/registry.mjs';
import { ITEMS, cleanup, fakeIo, tempDir, writeTree } from './helpers.mjs';

afterAll(cleanup);

const TOKEN = 'vly_0123456789abcdef0123';

/** The public stub, as scripts/registry/build.mjs publicRegistry() writes it. */
const stub = {
  name: 'data-grid',
  type: 'registry:item',
  title: 'Data Grid',
  description: 'Grid for 100,000 rows',
  pro: true,
  registryDependencies: [],
  files: [],
  categories: ['productivity'],
  meta: { kind: 'ui', category: 'productivity', categoryTitle: 'Productivity', docsUrl: 'https://valyro.xyz/#/productivity/data-grid', exports: { 'productivity/DataGrid': ['DataGrid'] } },
};
const themeStub = { ...stub, name: 'material-theme', title: 'Material theme', categories: ['themes'], meta: { kind: 'theme', theme: 'material' } };

/** What the licensed API returns: the full item, depending on a free one. */
const full = {
  ...stub,
  registryDependencies: ['https://valyro.xyz/r/button.json'],
  files: [
    { path: 'valyro-ui/productivity/DataGrid.tsx', content: "'use client';\n\nexport function DataGrid() { return null; }\n", type: 'registry:file', target: 'components/valyro-ui/productivity/DataGrid.tsx' },
  ],
};

function proRegistry() {
  const items = { ...ITEMS, 'data-grid': stub, 'material-theme': themeStub };
  const files = { 'registry.json': { name: 'valyro-ui', items: Object.values(items).map(({ files: f, ...rest }) => ({ ...rest, files: [] })) } };
  for (const [name, item] of Object.entries(items)) files[`${name}.json`] = item;
  return writeTree(tempDir('valyro-reg-'), files);
}

function app(registry) {
  return writeTree(tempDir('valyro-app-'), {
    'package.json': { name: 'app', dependencies: { react: '^19.0.0' } },
    'package-lock.json': '{}',
    'valyro.json': { registry, framework: 'vite', installDir: 'src/components/valyro-ui', alias: null, rsc: false, theme: 'vercel', mode: 'light' },
  });
}

/** fetch double for the licensed API: records requests, answers with `status`. */
function proApi(status = 200, body = full) {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, authorization: init?.headers?.authorization });
    return new Response(JSON.stringify(body), { status, statusText: String(status) });
  };
  return { fetch, requests };
}

describe('ValyroUI Pro in the CLI', () => {
  it('add explains a Pro component without a token, with the pricing link', async () => {
    const registry = proRegistry();
    const t = fakeIo(app(registry));
    expect(await run(['add', 'data-grid'], t.io)).toBe(1);
    expect(t.errors()).toContain('"data-grid" is a ValyroUI Pro component');
    expect(t.errors()).toContain(PRICING_URL);
    expect(t.errors()).toContain('valyro-cli login');
  });

  it('login --token stores the token for the current user only; VALYRO_TOKEN overrides it', async () => {
    const scripted = fakeIo(process.cwd());
    expect(await run(['login', '--token', `  ${TOKEN}\n`], scripted.io)).toBe(0);
    expect(readToken(scripted.io.env)).toBe(TOKEN);
    const file = path.join(scripted.io.env.VALYRO_CONFIG_DIR, 'auth.json');
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readToken({ ...scripted.io.env, VALYRO_TOKEN: 'from-env-0123456789' })).toBe('from-env-0123456789');
  });

  it('login --token refuses obvious paste mistakes', async () => {
    const bad = fakeIo(process.cwd());
    expect(await run(['login', '--token', 'Bearer abc def'], bad.io)).toBe(1);
    expect(bad.errors()).toContain('does not look like a ValyroUI token');
  });

  it('with a token, add fetches Pro items from the licensed API with Bearer auth and installs their dependencies', async () => {
    const registry = proRegistry();
    const api = proApi();
    const t = fakeIo(app(registry), { fetch: api.fetch });
    t.io.env.VALYRO_TOKEN = TOKEN;
    expect(await run(['add', 'data-grid', '--skip-install'], t.io)).toBe(0);
    expect(api.requests).toEqual([{ url: `${PRO_REGISTRY_URL}/data-grid`, authorization: `Bearer ${TOKEN}` }]);
    const dir = path.join(t.io.cwd, 'src/components/valyro-ui');
    expect(fs.existsSync(path.join(dir, 'productivity/DataGrid.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'basic/Button.tsx'))).toBe(true);
  });

  it('explains a rejected token (401) and a missing licence (402)', async () => {
    for (const [status, message] of [
      [401, 'was not accepted (401)'],
      [402, 'no active ValyroUI Pro licence (402)'],
    ]) {
      const api = proApi(status, { error: 'nope' });
      const t = fakeIo(app(proRegistry()), { fetch: api.fetch });
      t.io.env.VALYRO_TOKEN = TOKEN;
      expect(await run(['add', 'data-grid'], t.io)).toBe(1);
      expect(t.errors()).toContain(message);
    }
  });

  it('sends the token to the licensed API only', async () => {
    const requests = [];
    const fetch = async (url, init) => {
      requests.push({ url, authorization: init?.headers?.authorization });
      const name = url.replace(/^.*\/([^/]+?)(\.json)?$/, '$1');
      const body = url.startsWith(PRO_REGISTRY_URL) ? full : { 'data-grid': stub, button: ITEMS.button, styles: ITEMS.styles }[name];
      return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
    };
    const registry = createRegistry('https://mirror.test/r', { fetch, token: TOKEN });
    await registry.item('data-grid');
    expect(requests.filter((r) => r.authorization).map((r) => r.url)).toEqual([`${PRO_REGISTRY_URL}/data-grid`]);
  });

  it('init with a Pro theme needs a token, then installs the <name>-theme item', async () => {
    const registry = proRegistry();
    const project = () =>
      writeTree(tempDir('valyro-app-'), { 'package.json': { name: 'app', dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^8.0.0' } }, 'src/main.tsx': '' });
    const t = fakeIo(project());
    expect(await run(['init', '--registry', registry, '--theme', 'material', '--yes'], t.io)).toBe(1);
    expect(t.errors()).toContain('The material theme is part of ValyroUI Pro');
    expect(fs.existsSync(path.join(t.io.cwd, 'valyro.json'))).toBe(false);

    const theme = { ...themeStub, files: [{ path: 'valyro-ui/styles/themes/material.css', content: '[data-theme=material]{}\n', type: 'registry:file', target: 'components/valyro-ui/styles/themes/material.css' }] };
    const api = proApi(200, theme);
    const ok = fakeIo(project(), { fetch: api.fetch });
    ok.io.env.VALYRO_TOKEN = TOKEN;
    expect(await run(['init', '--registry', registry, '--theme', 'material', '--yes', '--skip-install'], ok.io)).toBe(0);
    expect(api.requests.map((r) => r.url)).toEqual([`${PRO_REGISTRY_URL}/material-theme`]);
    expect(fs.existsSync(path.join(ok.io.cwd, 'src/components/valyro-ui/styles/themes/material.css'))).toBe(true);
  });

  it('list marks Pro items', async () => {
    const t = fakeIo(process.cwd());
    expect(await run(['list', '--registry', proRegistry()], t.io)).toBe(0);
    expect(t.text()).toMatch(/data-grid\s+\[Pro\] Grid/);
    expect(t.text()).toContain(PRICING_URL);
  });
});

describe('ValyroUI Pro in the MCP server', () => {
  const handler = (options = {}) => createMcpHandler({ registry: createRegistry(proRegistry(), options), packageManager: 'npm', version: '1.0.0' });
  const call = async (h, name, args) => (await h.handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).result;

  it('marks Pro items in listings and describes them without source', async () => {
    const h = handler();
    expect((await call(h, 'list_components', {})).content[0].text).toContain('- data-grid (Pro): Data Grid');
    const got = await call(h, 'get_component', { name: 'data-grid' });
    expect(got.isError).toBe(false);
    expect(got.content[0].text).toContain('ValyroUI Pro');
    expect(got.content[0].text).toContain(PRICING_URL);
    expect(got.content[0].text).toContain('productivity/DataGrid: DataGrid');
    expect(got.content[0].text).not.toContain('```');
    const install = await call(h, 'get_install_command', { names: ['button', 'data-grid'] });
    expect(install.content[0].text).toContain('ValyroUI Pro (licence');
  });

  it('reads Pro source only with a licence', async () => {
    const review = await call(handler(), 'review_composition', { components: ['data-grid'] });
    expect(review.isError).toBe(true);
    expect(review.content[0].text).toContain('ValyroUI Pro');
    const licensed = await call(handler({ token: TOKEN, fetch: proApi().fetch }), 'get_component', { name: 'data-grid' });
    expect(licensed.content[0].text).toContain('export function DataGrid');
  });
});
