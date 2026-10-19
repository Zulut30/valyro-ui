import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCli, run, VERSION } from '../src/cli.mjs';
import { CliError } from '../src/registry.mjs';
import { fakeIo, fixtureRegistry, tempDir, writeTree, cleanup } from './helpers.mjs';

afterAll(cleanup);

const VITE_MAIN = [
  "import { StrictMode } from 'react'",
  "import { createRoot } from 'react-dom/client'",
  "import App from './App.tsx'",
  '',
  "createRoot(document.getElementById('root')!).render(",
  '  <StrictMode>',
  '    <App />',
  '  </StrictMode>,',
  ')',
  '',
].join('\n');

function viteProject() {
  return writeTree(tempDir('valyro-app-'), {
    'package.json': { name: 'app', dependencies: { react: '^19.0.0' }, devDependencies: { vite: '^7.0.0' } },
    'package-lock.json': '{}',
    'tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
    'tsconfig.app.json': '{\n  // comment\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] }, },\n}',
    'src/main.tsx': VITE_MAIN,
  });
}

describe('parseCli', () => {
  it('parses commands, positionals and options', () => {
    expect(parseCli(['add', 'button', 'dialog', '--overwrite', '--registry', './r'])).toEqual({
      command: 'add',
      values: { overwrite: true, registry: './r' },
      positionals: ['button', 'dialog'],
    });
    expect(parseCli(['--version'])).toMatchObject({ command: null, version: true });
    expect(parseCli(['diff', '-h'])).toMatchObject({ command: 'diff', help: true });
  });

  it('rejects unknown commands, unknown options and wrong arity', () => {
    expect(() => parseCli(['deploy'])).toThrow(/Unknown command "deploy"/);
    expect(() => parseCli(['list', '--bogus'])).toThrow(CliError);
    expect(() => parseCli(['add'])).toThrow(/Usage: valyro add/);
    expect(() => parseCli(['diff', 'a', 'b'])).toThrow(/Usage: valyro diff/);
    expect(() => parseCli(['--nope'])).toThrow();
  });
});

describe('run', () => {
  it('prints the version and help with exit code 0', async () => {
    const v = fakeIo(process.cwd());
    expect(await run(['-v'], v.io)).toBe(0);
    expect(v.text()).toBe(VERSION);
    const h = fakeIo(process.cwd());
    expect(await run(['add', '--help'], h.io)).toBe(0);
    expect(h.text()).toContain('Usage: valyro add');
  });

  it('exits 1 with a message on usage errors and without a command', async () => {
    const a = fakeIo(process.cwd());
    expect(await run(['frobnicate'], a.io)).toBe(1);
    expect(a.errors()).toContain('error: Unknown command');
    const b = fakeIo(process.cwd());
    expect(await run([], b.io)).toBe(1);
    expect(b.errors()).toContain('Commands:');
  });

  it('requires valyro.json for add', async () => {
    const app = viteProject();
    const t = fakeIo(app);
    expect(await run(['add', 'button', '--registry', fixtureRegistry()], t.io)).toBe(1);
    expect(t.errors()).toMatch(/valyro\.json not found .*`npx valyro-cli init`/);
  });

  it('init detects the project, installs base items and patches the entry', async () => {
    const app = viteProject();
    const registry = fixtureRegistry();
    const t = fakeIo(app);
    expect(await run(['init', '--registry', registry, '--patch', '--theme', 'glass', '--mode', 'dark'], t.io)).toBe(0);
    const config = JSON.parse(fs.readFileSync(path.join(app, 'valyro.json'), 'utf8'));
    expect(config).toEqual({
      registry,
      framework: 'vite',
      installDir: 'src/components/valyro-ui',
      alias: '@/components/valyro-ui',
      rsc: false,
      theme: 'glass',
      mode: 'dark',
    });
    const provider = fs.readFileSync(path.join(app, 'src/components/valyro-ui/theme/ThemeProvider.tsx'), 'utf8');
    expect(provider.startsWith('export function ThemeProvider')).toBe(true); // 'use client' stripped for Vite
    expect(fs.existsSync(path.join(app, 'src/components/valyro-ui/styles/index.css'))).toBe(true);
    const main = fs.readFileSync(path.join(app, 'src/main.tsx'), 'utf8');
    expect(main).toContain("import App from './App.tsx'\nimport '@/components/valyro-ui/styles/index.css';");
    expect(main).toContain('<ThemeProvider theme="glass" mode="dark"><App /></ThemeProvider>');

    const again = fakeIo(app);
    expect(await run(['init', '--registry', registry, '--patch', '--yes'], again.io)).toBe(0);
    expect(again.errors()).toContain('already set up');
    expect(fs.readFileSync(path.join(app, 'src/main.tsx'), 'utf8')).toBe(main);
  });

  it('init prints the CSS setup for CSS-only frameworks and changes nothing', async () => {
    const app = writeTree(tempDir('valyro-app-'), {
      'package.json': { name: 'app', dependencies: { vue: '^3.5.0' }, devDependencies: { vite: '^8.0.0' } },
      'pnpm-lock.yaml': '',
      'src/main.ts': "import { createApp } from 'vue'\n",
    });
    const t = fakeIo(app);
    expect(await run(['init', '--registry', fixtureRegistry(), '--patch', '--theme', 'glass'], t.io)).toBe(0);
    expect(t.text()).toContain('Detected Vue');
    expect(t.text()).toContain('pnpm add valyro-ui');
    expect(t.text()).toMatch(/src\/main\.ts: +import 'valyro-ui\/styles\.css';/);
    expect(t.text()).toContain('<html lang="en" data-theme="glass" data-mode="light">');
    expect(t.text()).toContain('/#/getting-started/vue');
    expect(fs.readdirSync(app).sort()).toEqual(['package.json', 'pnpm-lock.yaml', 'src']);
    expect(fs.readFileSync(path.join(app, 'src/main.ts'), 'utf8')).toBe("import { createApp } from 'vue'\n");
  });

  it('init names the Angular-specific step for Angular apps', async () => {
    const app = writeTree(tempDir('valyro-app-'), { 'package.json': { name: 'app', dependencies: { '@angular/core': '^22.0.0' } } });
    const t = fakeIo(app);
    expect(await run(['init', '--registry', fixtureRegistry(), '--mode', 'dark'], t.io)).toBe(0);
    expect(t.text()).toMatch(/src\/styles\.css: +@import 'valyro-ui\/styles\.css';/);
    expect(t.text()).toContain('<html lang="en" data-theme="vercel" data-mode="dark">');
    expect(t.text()).toContain('Note: angular.json: set optimization.styles.inlineCritical to false');
    expect(fs.existsSync(path.join(app, 'valyro.json'))).toBe(false);
  });

  it('rejects invalid init options', async () => {
    const t = fakeIo(viteProject());
    expect(await run(['init', '--theme', 'neon', '--registry', fixtureRegistry()], t.io)).toBe(1);
    expect(t.errors()).toContain('--theme must be one of: vercel, glass');
    const outside = fakeIo(viteProject());
    expect(await run(['init', '--dir', '../elsewhere', '--registry', fixtureRegistry()], outside.io)).toBe(1);
  });

  it('add resolves dependencies, skips identical files, keeps modified ones and installs npm packages', async () => {
    const app = viteProject();
    const registry = fixtureRegistry();
    await run(['init', '--registry', registry, '--yes'], fakeIo(app).io);

    const first = fakeIo(app);
    expect(await run(['add', 'dialog'], first.io)).toBe(0);
    expect(first.text()).toContain('Resolved styles, button, theme, dialog');
    expect(first.text()).toContain('created src/components/valyro-ui/feedback/Dialog.tsx');
    expect(first.text()).toContain("import { Dialog } from '@/components/valyro-ui/feedback/Dialog';");
    expect(first.installs).toEqual([{ pm: 'npm', args: ['install', 'left-pad@^1.3.0'], dir: app }]);

    const buttonFile = path.join(app, 'src/components/valyro-ui/basic/Button.tsx');
    fs.writeFileSync(buttonFile, 'local change\n');
    const second = fakeIo(app);
    expect(await run(['add', 'dialog', '--skip-install'], second.io)).toBe(0);
    expect(second.errors()).toContain('Kept 1 locally modified file(s)');
    expect(second.text()).toContain('Install the required packages: npm install left-pad@^1.3.0');
    expect(second.installs).toEqual([]);
    expect(fs.readFileSync(buttonFile, 'utf8')).toBe('local change\n');

    const prompted = fakeIo(app, { answers: ['y'] });
    expect(await run(['add', 'button'], prompted.io)).toBe(0);
    expect(prompted.text()).toContain('differs from the registry. Overwrite?');
    expect(fs.readFileSync(buttonFile, 'utf8')).toContain('export function Button');

    fs.writeFileSync(buttonFile, 'local change\n');
    expect(await run(['add', 'button', '--overwrite'], fakeIo(app).io)).toBe(0);
    expect(fs.readFileSync(buttonFile, 'utf8')).toContain('export function Button');
  });

  it('reports unknown components and unsafe targets', async () => {
    const app = viteProject();
    const registry = fixtureRegistry();
    await run(['init', '--registry', registry, '--yes'], fakeIo(app).io);
    const missing = fakeIo(app);
    expect(await run(['add', 'nope'], missing.io)).toBe(1);
    expect(missing.errors()).toContain('Component "nope" not found');
    const evil = fakeIo(app);
    expect(await run(['add', 'evil'], evil.io)).toBe(1);
    expect(evil.errors()).toContain('points outside the project directory');
  });

  it('diff compares installed files with the registry', async () => {
    const app = viteProject();
    const registry = fixtureRegistry();
    await run(['init', '--registry', registry, '--yes'], fakeIo(app).io);
    const before = fakeIo(app);
    await run(['diff', 'button'], before.io);
    expect(before.text()).toContain('missing locally: src/components/valyro-ui/basic/Button.tsx');

    await run(['add', 'button'], fakeIo(app).io);
    const clean = fakeIo(app);
    await run(['diff', 'button'], clean.io);
    expect(clean.text()).toContain('button: up to date with the registry');

    fs.appendFileSync(path.join(app, 'src/components/valyro-ui/basic/Button.tsx'), 'extra\n');
    const changed = fakeIo(app);
    expect(await run(['diff', 'button'], changed.io)).toBe(0);
    expect(changed.text()).toContain('-extra');
    expect(changed.text()).toContain('button: 1 changed, 0 missing');
  });

  it('list and search read the registry index', async () => {
    const registry = fixtureRegistry();
    const l = fakeIo(process.cwd());
    expect(await run(['list', '--registry', registry, '--category', 'basic', '--json'], l.io)).toBe(0);
    expect(JSON.parse(l.text())).toEqual([{ name: 'button', title: 'Button', description: 'Buttons of all kinds', category: 'basic', pro: false }]);
    const s = fakeIo(process.cwd());
    expect(await run(['search', 'modal', '--registry', registry], s.io)).toBe(0);
    expect(s.text()).toContain('dialog');
    const none = fakeIo(process.cwd());
    expect(await run(['search', 'zzz', '--registry', registry], none.io)).toBe(0);
    expect(none.text()).toContain('No components match');
  });
});
