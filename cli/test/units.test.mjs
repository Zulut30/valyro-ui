import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { destinationOf, planFiles, transformContent, unifiedDiff } from '../src/files.mjs';
import {
  detectAlias,
  detectFramework,
  detectPackageManager,
  installArgs,
  packageNameOf,
  parseJsonc,
} from '../src/project.mjs';
import { createRegistry, resolveItems, searchItems } from '../src/registry.mjs';
import { BUNDLED_THEMES, CORE_THEMES, THEME_FONTS, THEMES } from '../src/constants.mjs';
import { applySetup, cssOnlySteps, insertImports, setupPlan } from '../src/setup.mjs';
import { ITEMS, fixtureRegistry, tempDir, writeTree, cleanup } from './helpers.mjs';

afterAll(cleanup);

describe('registry resolution', () => {
  it('resolves registryDependencies recursively, dependencies first, each once', async () => {
    const registry = createRegistry(fixtureRegistry());
    const order = await resolveItems(['dialog', 'button'], registry);
    expect(order.map((r) => r.item.name)).toEqual(['styles', 'button', 'theme', 'dialog']);
    expect(order.filter((r) => r.requested).map((r) => r.item.name)).toEqual(['button', 'dialog']);
  });

  it('terminates on dependency cycles', async () => {
    const order = await resolveItems(['cycle-a'], createRegistry(fixtureRegistry()));
    expect(order.map((r) => r.item.name)).toEqual(['cycle-b', 'cycle-a']);
  });

  it('serves canonical item URLs from the configured registry and accepts paths and names', () => {
    const dir = fixtureRegistry();
    const registry = createRegistry(`${dir}/registry.json`);
    expect(registry.locate('https://valyro.xyz/r/button.json')).toBe(path.join(dir, 'button.json'));
    expect(registry.locate('button')).toBe(path.join(dir, 'button.json'));
    expect(registry.locate('./x/item.json')).toBe(path.resolve('./x/item.json'));
    expect(registry.locate('https://other.test/r/a.json')).toBe('https://other.test/r/a.json');
    expect(() => registry.locate('../etc/passwd')).toThrow(/Invalid component name/);
    const http = createRegistry('https://mirror.test/r/');
    expect(http.locate('https://valyro.xyz/r/styles.json')).toBe('https://mirror.test/r/styles.json');
  });

  it('reports HTTP failures and invalid items', async () => {
    const responses = {
      'https://r.test/missing.json': new Response('nope', { status: 404 }),
      'https://r.test/broken.json': new Response('{oops', { status: 200 }),
      'https://r.test/bad.json': new Response(JSON.stringify({ name: 'bad', files: [{ path: 'a' }] })),
      'https://r.test/down.json': new Response('', { status: 503, statusText: 'Service Unavailable' }),
    };
    const fetch = async (url) => responses[url];
    const registry = createRegistry('https://r.test', { fetch });
    await expect(registry.item('missing')).rejects.toMatchObject({ code: 'NOT_FOUND', key: 'https://r.test/missing.json' });
    await expect(registry.item('broken')).rejects.toThrow(/not valid JSON/);
    await expect(registry.item('bad')).rejects.toThrow(/a has no "content"/);
    await expect(registry.item('down')).rejects.toThrow(/503 Service Unavailable/);
    const offline = createRegistry('https://r.test', {
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await expect(offline.item('x')).rejects.toThrow(/Cannot fetch https:\/\/r\.test\/x\.json: fetch failed/);
  });

  it('ranks search results', () => {
    const items = Object.values(ITEMS).filter((i) => i.description);
    expect(searchItems(items, 'button').map((i) => i.name)).toEqual(['button']);
    expect(searchItems(items, 'modal windows').map((i) => i.name)).toEqual(['dialog']);
    expect(searchItems(items, '   ')).toEqual([]);
  });
});

describe('project detection', () => {
  it('detects frameworks and default install dirs', () => {
    const next = writeTree(tempDir(), { 'package.json': { dependencies: { next: '15' } }, 'src/app/page.tsx': '' });
    expect(detectFramework(next)).toEqual({ name: 'next', rsc: true, defaultDir: 'src/components/valyro-ui' });
    const nextRoot = writeTree(tempDir(), { 'package.json': { dependencies: { next: '15' } }, 'app/page.tsx': '' });
    expect(detectFramework(nextRoot)).toMatchObject({ rsc: true, defaultDir: 'components/valyro-ui' });
    const pages = writeTree(tempDir(), { 'package.json': { dependencies: { next: '15' } }, 'pages/index.tsx': '' });
    expect(detectFramework(pages)).toMatchObject({ rsc: false, defaultDir: 'components/valyro-ui' });
    const rr = writeTree(tempDir(), { 'package.json': { devDependencies: { '@react-router/dev': '7', vite: '6' } }, 'app/root.tsx': '' });
    expect(detectFramework(rr)).toEqual({ name: 'react-router', rsc: false, defaultDir: 'app/components/valyro-ui' });
    const astro = writeTree(tempDir(), { 'package.json': { dependencies: { astro: '5' } } });
    expect(detectFramework(astro).name).toBe('astro');
    const vite = writeTree(tempDir(), { 'package.json': { devDependencies: { vite: '7' } }, 'src/main.tsx': '' });
    expect(detectFramework(vite)).toEqual({ name: 'vite', rsc: false, defaultDir: 'src/components/valyro-ui' });
    expect(detectFramework(writeTree(tempDir(), { 'package.json': {} })).name).toBe('unknown');
  });

  it('detects the newer React frameworks before plain bundlers, and CSS-only frameworks', () => {
    const detect = (deps) => detectFramework(writeTree(tempDir(), { 'package.json': { dependencies: deps }, 'src/x.ts': '' }));
    expect(detect({ waku: '1', react: '19' })).toEqual({ name: 'waku', rsc: true, defaultDir: 'src/components/valyro-ui' });
    expect(detect({ '@tanstack/react-start': '1', vite: '8' })).toEqual({ name: 'tanstack-start', rsc: false, defaultDir: 'src/components/valyro-ui' });
    expect(detect({ '@rsbuild/core': '2', react: '19' }).name).toBe('rsbuild');
    expect(detect({ parcel: '2', react: '19' }).name).toBe('parcel');
    expect(detect({ nuxt: '4', vue: '3' }).name).toBe('nuxt');
    expect(detect({ vue: '3', vite: '8' }).name).toBe('vue');
    expect(detect({ '@sveltejs/kit': '2', svelte: '5', vite: '8' }).name).toBe('sveltekit');
    expect(detect({ svelte: '5', vite: '8' }).name).toBe('svelte');
    expect(detect({ '@angular/core': '22' }).name).toBe('angular');
    expect(detect({ '@solidjs/start': '2', 'solid-js': '1' }).name).toBe('solid-start');
    expect(detect({ 'solid-js': '1', vite: '8' }).name).toBe('solid');
    // An Astro site with a Vue integration is still an Astro site.
    expect(detect({ astro: '7', vue: '3' }).name).toBe('astro');
    expect(detect({ 'laravel-vite-plugin': '3', '@inertiajs/react': '3', vite: '8' })).toEqual({
      name: 'laravel-inertia',
      rsc: false,
      defaultDir: 'resources/js/components/valyro-ui',
    });
    expect(detect({ 'laravel-vite-plugin': '3', '@inertiajs/vue3': '3', vue: '3' }).name).toBe('vue');
    expect(detect({ 'electron-vite': '5', vite: '7', react: '19' }).defaultDir).toBe('src/renderer/src/components/valyro-ui');
  });

  it('detects the package manager from lockfiles, packageManager and the user agent', () => {
    const base = { 'package.json': {} };
    expect(detectPackageManager(writeTree(tempDir(), { ...base, 'pnpm-lock.yaml': '' }), {})).toBe('pnpm');
    expect(detectPackageManager(writeTree(tempDir(), { ...base, 'bun.lock': '' }), {})).toBe('bun');
    expect(detectPackageManager(writeTree(tempDir(), { 'package.json': { packageManager: 'yarn@4.1.0' } }), {})).toBe('yarn');
    const monorepo = writeTree(tempDir(), { 'package.json': {}, 'pnpm-lock.yaml': '', 'apps/web/package.json': {} });
    expect(detectPackageManager(path.join(monorepo, 'apps/web'), {})).toBe('pnpm');
    const bare = writeTree(tempDir(), base);
    expect(detectPackageManager(bare, { npm_config_user_agent: 'bun/1.2.0 npm/? node/v22' })).toBe('bun');
    expect(installArgs('npm', ['a'], { dev: true })).toEqual(['install', '--save-dev', 'a']);
    expect(installArgs('pnpm', ['a', 'b'])).toEqual(['add', 'a', 'b']);
    expect(packageNameOf('@scope/pkg@^1.0.0')).toBe('@scope/pkg');
    expect(packageNameOf('left-pad@1')).toBe('left-pad');
  });

  it('parses tsconfig JSONC and maps paths aliases onto the install dir', () => {
    expect(parseJsonc('{ "a": "http://x//y", /* c */ "b": [1, 2,], // d\n }')).toEqual({ a: 'http://x//y', b: [1, 2] });
    const rr = writeTree(tempDir(), { 'tsconfig.json': '{ "compilerOptions": { "paths": { "~/*": ["./app/*"] } } }' });
    expect(detectAlias(rr, 'app/components/valyro-ui')).toBe('~/components/valyro-ui');
    expect(detectAlias(rr, 'components/valyro-ui')).toBeNull();
    const baseUrl = writeTree(tempDir(), { 'jsconfig.json': '{ "compilerOptions": { "baseUrl": "src", "paths": { "@ui/*": ["components/*"] } } }' });
    expect(detectAlias(baseUrl, 'src/components/valyro-ui')).toBe('@ui/valyro-ui');
  });
});

describe('files', () => {
  const config = { installDir: 'src/components/valyro-ui', rsc: false };

  it('maps registry targets into the install dir and guards against traversal', () => {
    expect(destinationOf({ path: 'p', target: 'components/valyro-ui/basic/Button.tsx' }, config)).toBe('src/components/valyro-ui/basic/Button.tsx');
    expect(destinationOf({ path: 'p', target: '~/lib/x.ts' }, config)).toBe('lib/x.ts');
    expect(() => destinationOf({ path: 'p' }, config)).toThrow(/no "target"/);
    const dir = tempDir();
    expect(() => planFiles([{ item: ITEMS.evil }], config, dir)).toThrow(/outside the project/);
  });

  it("strips 'use client' unless the project uses React Server Components", () => {
    const code = "'use client';\n\nexport const a = 1;\n";
    expect(transformContent(code, 'a.tsx', config)).toBe('export const a = 1;\n');
    expect(transformContent(code, 'a.tsx', { ...config, rsc: true })).toBe(code);
    expect(transformContent(code, 'a.css', config)).toBe(code);
  });

  it('warns when two items ship different content for one file', () => {
    const warnings = [];
    const a = { name: 'a', files: [{ path: 'x', content: '1', target: 'components/valyro-ui/x.ts' }] };
    const b = { name: 'b', files: [{ path: 'x', content: '2', target: 'components/valyro-ui/x.ts' }] };
    const plan = planFiles([{ item: a }, { item: b }], config, tempDir(), (w) => warnings.push(w));
    expect(plan).toHaveLength(1);
    expect(plan[0].content).toBe('2');
    expect(warnings[0]).toContain('provided by both "a" and "b"');
  });

  it('produces unified diffs with context', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');
    const after = ['a', 'B', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].join('\n');
    expect(unifiedDiff(before, before, 'x', 'y')).toBe('');
    expect(unifiedDiff(before, after, 'old', 'new')).toBe(
      ['--- old', '+++ new', '@@ -1,5 +1,5 @@', ' a', '-b', '+B', ' c', ' d', ' e', '@@ -8,3 +8,4 @@', ' h', ' i', ' j', '+k', ''].join('\n'),
    );
  });
});

describe('framework setup', () => {
  const config = { installDir: 'src/components/valyro-ui', alias: null, theme: 'vercel', mode: 'dark', rsc: true };

  describe('an opt-in theme', () => {
    const theme = THEMES.find((name) => !BUNDLED_THEMES.includes(name) && !CORE_THEMES.includes(name));
    const optIn = { ...config, theme };

    it('imports its file after styles/index.css and names its fonts, from valyro-ui-pro for a Pro theme', () => {
      const app = writeTree(tempDir(), { 'src/main.tsx': "import App from './App.tsx'\n" });
      const plan = setupPlan('vite', optIn, app);
      expect(plan.imports.slice(0, 2)).toEqual([
        "import './components/valyro-ui/styles/index.css';",
        `import './components/valyro-ui/styles/themes/${theme}.css';`,
      ]);
      expect(plan.notes.join('\n')).toContain(`'valyro-ui-pro/fonts/${THEME_FONTS[theme][0]}.css'`);
      const free = setupPlan('vite', { ...config, theme: 'high-contrast' }, app);
      expect(free.imports[1]).toBe("import './components/valyro-ui/styles/themes/high-contrast.css';");
      expect(free.notes.join('\n')).toContain(`'valyro-ui/fonts/${THEME_FONTS['high-contrast'][0]}.css'`);
    });

    it('links its file from head() in TanStack Start', () => {
      const plan = setupPlan('tanstack-start', optIn, tempDir());
      expect(plan.headLink).toBe("{ rel: 'stylesheet', href: valyroCss }, { rel: 'stylesheet', href: valyroThemeCss }");
      expect(plan.imports[1]).toBe(`import valyroThemeCss from '../components/valyro-ui/styles/themes/${theme}.css?url';`);
    });

    it('prints the package files for CSS-only frameworks: more lines, or more array entries', () => {
      const steps = (framework) => cssOnlySteps(framework, { theme, mode: 'light', install: 'npm i valyro-ui-pro', siteUrl: 'https://x' }).join('\n');
      const files = ['valyro-ui-pro/styles.css', `valyro-ui-pro/themes/${theme}.css`, ...THEME_FONTS[theme].map((id) => `valyro-ui-pro/fonts/${id}.css`)];
      expect(steps('vue')).toContain(files.map((file) => `import '${file}';`).join(`\n${' '.repeat(27)}`));
      expect(steps('nuxt')).toContain(`css: [${files.map((file) => `'${file}'`).join(', ')}],`);
      expect(steps('angular')).toContain(`@import 'valyro-ui-pro/themes/${theme}.css';`);
      const free = cssOnlySteps('vue', { theme: 'high-contrast', mode: 'light', install: 'npm i valyro-ui', siteUrl: 'https://x' }).join('\n');
      expect(free).toContain("import 'valyro-ui/themes/high-contrast.css';");
      expect(free).not.toContain('valyro-ui-pro');
    });
  });

  it('patches a Next.js app layout: imports, provider and <html> attributes', () => {
    const app = writeTree(tempDir(), { 'src/app/layout.tsx': '' });
    const plan = setupPlan('next', config, app);
    expect(plan.entry).toBe('src/app/layout.tsx');
    const layout = [
      "import type { Metadata } from 'next';",
      "import './globals.css';",
      '',
      'export default function RootLayout({ children }: { children: React.ReactNode }) {',
      '  return (',
      '    <html lang="en">',
      '      <body>{children}</body>',
      '    </html>',
      '  );',
      '}',
    ].join('\n');
    const { content } = applySetup(layout, plan, config);
    expect(content).toContain(
      "import './globals.css';\nimport '../components/valyro-ui/styles/index.css';\nimport { ThemeProvider } from '../components/valyro-ui/theme/ThemeProvider';",
    );
    expect(content).toContain('<html data-theme="vercel" data-mode="dark" lang="en">');
    expect(content).toContain('<body><ThemeProvider theme="vercel" mode="dark">{children}</ThemeProvider></body>');
  });

  it('refuses ambiguous anchors instead of guessing', () => {
    const plan = setupPlan('vite', { ...config, rsc: false }, tempDir());
    expect(applySetup('<App />\n<App />', plan, config)).toEqual({ error: expect.stringContaining('found 2') });
  });

  it('wraps <Outlet /> for React Router and imports into Astro frontmatter', () => {
    const rrPlan = setupPlan('react-router', { ...config, installDir: 'app/components/valyro-ui', alias: '~/components/valyro-ui' }, tempDir());
    expect(rrPlan.entry).toBe('app/root.tsx');
    const root = "import { Outlet } from 'react-router';\nexport default function App() {\n  return <Outlet />;\n}\n";
    expect(applySetup(root, rrPlan, config).content).toContain('return <ThemeProvider theme="vercel" mode="dark"><Outlet /></ThemeProvider>;');

    const astroPlan = setupPlan('astro', config, tempDir());
    expect(insertImports('---\nconst a = 1;\n---\n<html>', ["import 'x.css';"], 'Layout.astro')).toBe("---\nimport 'x.css';\nconst a = 1;\n---\n<html>");
    expect(insertImports('<html></html>', ["import 'x.css';"], 'Layout.astro')).toBe("---\nimport 'x.css';\n---\n<html></html>");
    expect(astroPlan.imports).toEqual(["import '../components/valyro-ui/styles/index.css';"]);
  });

  it('patches the TanStack Start root route: ?url stylesheet first in head links, provider and <html> attributes', () => {
    const app = writeTree(tempDir(), { 'src/routes/__root.tsx': '' });
    const plan = setupPlan('tanstack-start', { ...config, rsc: false }, app);
    expect(plan.entry).toBe('src/routes/__root.tsx');
    // The blank template of @tanstack/cli 0.71 (create --blank).
    const root = [
      "import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'",
      '',
      "import appCss from '../styles.css?url'",
      '',
      'export const Route = createRootRoute({',
      '  head: () => ({',
      "    meta: [{ charSet: 'utf-8' }],",
      '    links: [',
      '      {',
      "        rel: 'stylesheet',",
      '        href: appCss,',
      '      },',
      '    ],',
      '  }),',
      '  shellComponent: RootDocument,',
      '})',
      '',
      'function RootDocument({ children }: { children: React.ReactNode }) {',
      '  return (',
      '    <html lang="en">',
      '      <head>',
      '        <HeadContent />',
      '      </head>',
      '      <body>',
      '        {children}',
      '        <Scripts />',
      '      </body>',
      '    </html>',
      '  )',
      '}',
    ].join('\n');
    const { content } = applySetup(root, plan, config);
    expect(content).toContain(
      "import appCss from '../styles.css?url'\nimport valyroCss from '../components/valyro-ui/styles/index.css?url';\nimport { ThemeProvider } from '../components/valyro-ui/theme/ThemeProvider';",
    );
    expect(content).toContain("    links: [\n      { rel: 'stylesheet', href: valyroCss },\n      {\n        rel: 'stylesheet',");
    expect(content).toContain('<html data-theme="vercel" data-mode="dark" lang="en">');
    expect(content).toContain('<ThemeProvider theme="vercel" mode="dark">{children}</ThemeProvider>');
    expect(applySetup(root.replace('links: [', 'styles: ['), plan, config)).toEqual({ error: expect.stringContaining('"links: ["') });
    expect(applySetup('links: []\n{children}', plan, config).content).toContain("links: [{ rel: 'stylesheet', href: valyroCss }]");
    expect(applySetup('links: [{ rel: "icon" }]\n{children}', plan, config).content).toContain("links: [{ rel: 'stylesheet', href: valyroCss }, { rel: \"icon\" }]");
  });

  it('wraps the Waku layout and points at _root.tsx for the <html> attributes', () => {
    const app = writeTree(tempDir(), { 'src/pages/_layout.tsx': '' });
    const plan = setupPlan('waku', config, app);
    expect(plan.entry).toBe('src/pages/_layout.tsx');
    expect(plan.attrs).toBe('');
    expect(plan.notes.join('\n')).toContain('src/pages/_root.tsx');
    const layout = "import '../styles.css';\n\nexport default async function RootLayout({ children }) {\n  return <main>{children}</main>;\n}\n";
    const { content } = applySetup(layout, plan, config);
    expect(content).toContain("import '../styles.css';\nimport '../components/valyro-ui/styles/index.css';");
    expect(content).toContain('<main><ThemeProvider theme="vercel" mode="dark">{children}</ThemeProvider></main>');
  });

  it('wraps <App /> in the Rsbuild, Parcel and electron-vite entries and says where the <html> attributes go', () => {
    const entry = "import { createRoot } from 'react-dom/client';\nimport App from './App';\n\nroot.render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n);\n";
    for (const [framework, file, note] of [
      ['rsbuild', 'src/index.tsx', 'html.template'],
      ['parcel', 'src/index.tsx', 'src/index.html'],
      ['electron-vite', 'src/renderer/src/main.tsx', 'src/renderer/index.html'],
    ]) {
      const plan = setupPlan(framework, { ...config, rsc: false }, writeTree(tempDir(), { [file]: '' }));
      expect(plan.entry, framework).toBe(file);
      expect(plan.attrs, framework).toBe('');
      expect(plan.notes.join('\n'), framework).toContain(note);
      expect(applySetup(entry, plan, config).content, framework).toContain('<ThemeProvider theme="vercel" mode="dark"><App /></ThemeProvider>');
    }
  });

  it('wraps {app} in Inertia 3 withApp, or <App {...props} /> in Inertia 2', () => {
    const cfg = { ...config, rsc: false, installDir: 'resources/js/components/valyro-ui', alias: '@/components/valyro-ui' };
    const plan = setupPlan('laravel-inertia', cfg, writeTree(tempDir(), { 'resources/js/app.tsx': '' }));
    expect(plan.entry).toBe('resources/js/app.tsx');
    expect(plan.notes.join('\n')).toContain('resources/views/app.blade.php');
    const v3 = "import { createInertiaApp } from '@inertiajs/react';\n\nvoid createInertiaApp({\n  withApp(app) {\n    return (\n      <TooltipProvider>\n        {app}\n        <Toaster />\n      </TooltipProvider>\n    );\n  },\n});\n";
    const patched = applySetup(v3, plan, cfg).content;
    expect(patched).toContain("import '@/components/valyro-ui/styles/index.css';\nimport { ThemeProvider } from '@/components/valyro-ui/theme/ThemeProvider';");
    expect(patched).toContain('<ThemeProvider theme="vercel" mode="dark">{app}</ThemeProvider>');
    const v2 = "import { createInertiaApp } from '@inertiajs/react';\n\ncreateInertiaApp({ setup({ el, App, props }) { createRoot(el).render(<App {...props} />); } });\n";
    expect(applySetup(v2, plan, cfg).content).toContain('<ThemeProvider theme="vercel" mode="dark"><App {...props} /></ThemeProvider>');
  });

  it('inserts imports after a leading directive when a file has no imports', () => {
    expect(insertImports("'use client';\nexport {};\n", ["import 'a';"], 'a.tsx')).toBe("'use client';\nimport 'a';\nexport {};\n");
    expect(insertImports('export {};\n', ["import 'a';"], 'a.tsx')).toBe("import 'a';\n\nexport {};\n");
  });
});

describe('fixture sanity', () => {
  it('writes every fixture item', () => {
    const dir = fixtureRegistry();
    expect(fs.readdirSync(dir).sort()).toContain('registry.json');
  });
});
