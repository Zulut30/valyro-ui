// Contract between the docs guides, the CLI framework adapters and the docs usage snippets.
// The checklist these tests enforce is at the top of cli/src/frameworks/index.mjs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { FRAMEWORKS as DOCS_FRAMEWORKS, STYLE_ENTRY, usageSnippets } from '../../src/docs/framework-usage.ts';
import { frameworkGuides } from '../../src/docs/guides/frameworks.ts';
import { SITE_URL } from '../src/constants.mjs';
import { ADAPTERS, MANUAL_ONLY_GUIDES } from '../src/frameworks/index.mjs';
import { detectFramework } from '../src/project.mjs';
import { applySetup, cssOnlySteps, setupPlan } from '../src/setup.mjs';
import { cleanup, tempDir, writeTree } from './helpers.mjs';

afterAll(cleanup);

const REGISTRY = 'cli/src/frameworks/index.mjs';
const GUIDES = 'frameworkGuides in src/docs/guides/frameworks.ts';
const USAGE = 'src/docs/framework-usage.ts';
const THIS_FILE = 'cli/test/frameworks.test.mjs';

const CLIENT_ENTRY = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

/**
 * A minimal project per adapter (several when it has variants): dependencies for package.json and
 * the files detection and patching look at. React fixtures include the entry file to patch, with
 * whatever the adapter needs in it (the wrapped element, <html> for SSR, head() links…).
 * @type {Record<string, { deps: Record<string, string>, files?: Record<string, string> } | { deps: Record<string, string>, files?: Record<string, string> }[]>}
 */
const FIXTURES = {
  next: [
    {
      deps: { next: '16', react: '19' },
      files: {
        'app/layout.tsx': `import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      },
    },
    {
      deps: { next: '16', react: '19' },
      files: {
        'pages/_app.tsx': `import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
`,
      },
    },
  ],
  astro: {
    deps: { astro: '7', '@astrojs/react': '5', vue: '3' },
    files: { 'src/layouts/Layout.astro': `---\nimport '../styles/global.css';\n---\n<html lang="en">\n  <body><slot /></body>\n</html>\n` },
  },
  waku: {
    deps: { waku: '1', react: '19' },
    files: {
      'src/pages/_layout.tsx': `import '../styles.css';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return <main>{children}</main>;
}
`,
    },
  },
  'tanstack-start': {
    deps: { '@tanstack/react-start': '1', vite: '8' },
    files: {
      'src/routes/__root.tsx': `import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router';
import appCss from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}
`,
    },
  },
  'react-router': {
    deps: { 'react-router': '7', '@react-router/dev': '7', vite: '8' },
    files: {
      'app/root.tsx': `import { Outlet, Scripts } from 'react-router';

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}<Scripts /></body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
`,
    },
  },
  'laravel-inertia': {
    deps: { 'laravel-vite-plugin': '3', '@inertiajs/react': '3', vite: '8' },
    files: {
      'resources/js/app.tsx': `import { createInertiaApp } from '@inertiajs/react';

void createInertiaApp({
  withApp(app) {
    return <TooltipProvider>{app}</TooltipProvider>;
  },
});
`,
    },
  },
  'electron-vite': { deps: { 'electron-vite': '5', vite: '7', react: '19' }, files: { 'src/renderer/src/main.tsx': CLIENT_ENTRY } },
  nuxt: { deps: { nuxt: '4', vue: '3' } },
  sveltekit: { deps: { '@sveltejs/kit': '2', svelte: '5', vite: '8' } },
  svelte: { deps: { svelte: '5', vite: '8' } },
  angular: { deps: { '@angular/core': '22' } },
  'solid-start': { deps: { '@solidjs/start': '2', 'solid-js': '1' } },
  solid: { deps: { 'solid-js': '1', vite: '8' } },
  vue: { deps: { vue: '3', vite: '8' } },
  rsbuild: { deps: { '@rsbuild/core': '2', react: '19' }, files: { 'src/index.tsx': CLIENT_ENTRY } },
  parcel: { deps: { parcel: '2', react: '19' }, files: { 'src/index.tsx': CLIENT_ENTRY } },
  vite: { deps: { vite: '8', react: '19' }, files: { 'src/main.tsx': CLIENT_ENTRY } },
};

const guideIds = frameworkGuides.map((guide) => guide.id);

describe('docs guides and CLI adapters', () => {
  it('every guide has a CLI adapter or a manual-only entry', () => {
    const covered = new Set([...ADAPTERS.map((a) => a.guide), ...MANUAL_ONLY_GUIDES.map((m) => m.guide)]);
    const missing = guideIds.filter((id) => !covered.has(id));
    expect(
      missing,
      `No CLI adapter for guide(s) ${missing.join(', ')}. Add cli/src/frameworks/<name>.mjs with guide: '<id>' and list it in ADAPTERS ` +
        `in ${REGISTRY}, or add { guide: '<id>', kind: 'react' | 'css' | 'native', reason: '…' } to MANUAL_ONLY_GUIDES there.`,
    ).toEqual([]);
  });

  it('adapters and manual-only entries name existing guides, and no guide is both', () => {
    const refs = [...ADAPTERS.map((a) => [`adapter "${a.name}"`, a.guide]), ...MANUAL_ONLY_GUIDES.map((m) => ['MANUAL_ONLY_GUIDES', m.guide])];
    const stale = refs.filter(([, id]) => !guideIds.includes(id)).map(([who, id]) => `${who} -> '${id}'`);
    expect(stale, `${stale.join(', ')}: no such guide id in ${GUIDES}. Fix the id in ${REGISTRY} or add the guide.`).toEqual([]);
    const both = MANUAL_ONLY_GUIDES.filter((m) => ADAPTERS.some((a) => a.guide === m.guide)).map((m) => m.guide);
    expect(both, `Guide(s) ${both.join(', ')} have an adapter: remove them from MANUAL_ONLY_GUIDES in ${REGISTRY}.`).toEqual([]);
  });

  it('every adapter module is registered and well-formed', () => {
    const dir = fileURLToPath(new URL('../src/frameworks/', import.meta.url));
    const modules = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && f !== 'index.mjs' && f !== 'shared.mjs');
    const unregistered = modules.filter((f) => !ADAPTERS.some((a) => `${a.name}.mjs` === f));
    expect(unregistered, `Import ${unregistered.join(', ')} in ${REGISTRY} and add it to ADAPTERS (name must match the file name).`).toEqual([]);
    expect(new Set(ADAPTERS.map((a) => a.name)).size, 'adapter names must be unique').toBe(ADAPTERS.length);
    for (const a of ADAPTERS) {
      expect(['react', 'css'], `${a.name}: kind`).toContain(a.kind);
      expect(typeof a.detect, `${a.name}: detect`).toBe('function');
      if (a.kind === 'react') expect(a.patch, `${a.name}: React adapters need patch data`).toBeTruthy();
      else expect(a.manual, `${a.name}: CSS-only adapters need manual steps`).toBeTruthy();
    }
  });
});

describe('adapter fixtures', () => {
  it('every adapter has a fixture project', () => {
    const missing = ADAPTERS.filter((a) => !FIXTURES[a.name]).map((a) => a.name);
    expect(missing, `Add a minimal project for ${missing.join(', ')} to FIXTURES in ${THIS_FILE}: package.json deps and, for React, the entry file.`).toEqual([]);
    const stale = Object.keys(FIXTURES).filter((name) => !ADAPTERS.some((a) => a.name === name));
    expect(stale, `FIXTURES in ${THIS_FILE} has entries for unknown adapters`).toEqual([]);
  });

  const config = (detected) => ({ installDir: detected.defaultDir, alias: null, rsc: detected.rsc, theme: 'glass', mode: 'dark' });

  describe.each(ADAPTERS.filter((a) => FIXTURES[a.name]).map((a) => [a.name, a]))('%s', (name, adapter) => {
    const projects = () => [FIXTURES[name]].flat().map(({ deps, files = {} }) => writeTree(tempDir(), { 'package.json': { dependencies: deps }, ...files }));

    it('is detected from its fixture', () => {
      for (const dir of projects()) {
        const detected = detectFramework(dir);
        expect(detected.name, `fixture for "${name}" is detected as "${detected.name}": check the detection order in ADAPTERS (${REGISTRY})`).toBe(name);
      }
    });

    if (adapter.kind === 'react') {
      it('patches the entry: CSS import and ThemeProvider (or the documented manual variant)', () => {
        for (const dir of projects()) {
          const cfg = config(detectFramework(dir));
          const plan = setupPlan(name, cfg, dir);
          expect(plan.entry && fs.existsSync(path.join(dir, plan.entry)), `the fixture for "${name}" needs its entry file ${plan.entry}`).toBe(true);
          const source = fs.readFileSync(path.join(dir, plan.entry), 'utf8');
          const result = applySetup(source, plan, cfg);
          expect(result.error, `applySetup on ${plan.entry}`).toBeUndefined();
          for (const line of plan.imports) expect(result.content).toContain(line);
          if (plan.anchor) {
            expect(result.content).toContain(`<ThemeProvider theme="glass" mode="dark">${source.match(plan.anchor)[0]}</ThemeProvider>`);
          } else {
            // Astro: no app root to wrap, the notes say where ThemeProvider goes.
            expect(plan.notes.join('\n')).toContain('<ThemeProvider theme="glass" mode="dark">');
          }
          if (plan.attrs) expect(result.content).toContain(`<html ${plan.attrs}`);
          if (plan.headLink) expect(result.content).toContain(plan.headLink);
          expect(applySetup(result.content, plan, cfg)).toEqual({ error: 'already set up' });
        }
      });
    } else {
      it('prints manual steps naming the files and the guide', () => {
        const text = cssOnlySteps(name, { theme: 'glass', mode: 'dark', install: 'npm install valyro-ui', siteUrl: SITE_URL }).join('\n');
        expect(text).toContain(`Detected ${adapter.manual.label}`);
        expect(text).toContain(`${adapter.manual.css[0]}:`);
        expect(text).toContain(`${adapter.manual.theme[0]}:`);
        expect(text).toContain('glass');
        expect(text).not.toMatch(/\{(attrs|theme|mode)\}/);
        expect(text).toContain(`${SITE_URL}/#/getting-started/${adapter.guide}`);
      });
    }
  });
});

describe('docs usage snippets', () => {
  it('every React guide is in the docs picker with a stylesheet entry and usage snippets', () => {
    const reactGuides = new Set([
      ...ADAPTERS.filter((a) => a.kind === 'react').map((a) => a.guide),
      ...MANUAL_ONLY_GUIDES.filter((m) => m.kind === 'react').map((m) => m.guide),
    ]);
    const problems = [];
    for (const guide of reactGuides) {
      const framework = DOCS_FRAMEWORKS.find((f) => f.guideIds.includes(guide));
      if (!framework) {
        problems.push(`guide '${guide}': add { id: '${guide}', label: '…', group: 'react', guideIds: ['${guide}'] } to FRAMEWORKS in ${USAGE}`);
        continue;
      }
      if (framework.group !== 'react') problems.push(`FRAMEWORKS '${framework.id}' in ${USAGE}: group must be 'react' (guide '${guide}' is React)`);
      if (!STYLE_ENTRY[framework.id]) {
        problems.push(`add STYLE_ENTRY['${framework.id}'] to ${USAGE}: the file from guide '${guide}' that imports the stylesheet`);
      }
      for (const isStatic of [true, false]) {
        const snippets = usageSnippets(framework.id, ['Button'], '<Button>Deploy</Button>', isStatic);
        if (!snippets.length || !snippets.some((s) => s.filename && s.code.includes('<Button>Deploy</Button>'))) {
          problems.push(`usageSnippets('${framework.id}') in ${USAGE} must render the component (add a case if src/Example.tsx is the wrong place)`);
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it("an adapter's kind matches the docs picker group of its guide", () => {
    const mismatched = ADAPTERS.flatMap((a) => {
      const framework = DOCS_FRAMEWORKS.find((f) => f.guideIds.includes(a.guide));
      return framework && framework.group !== a.kind ? [`${a.name} (${a.kind}) vs FRAMEWORKS '${framework.id}' (${framework.group})`] : [];
    });
    expect(mismatched, `Fix the adapter kind in ${REGISTRY} or the group in ${USAGE}`).toEqual([]);
  });
});
