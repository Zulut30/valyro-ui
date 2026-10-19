import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANONICAL = 'https://valyro.xyz/r';

const created = [];

export function tempDir(prefix = 'valyro-cli-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/** Removes every directory made by tempDir(); call from afterAll. */
export function cleanup() {
  for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

export function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  return root;
}

const file = (kitPath, content) => ({
  path: `valyro-ui/${kitPath}`,
  content,
  type: 'registry:file',
  target: `components/valyro-ui/${kitPath}`,
});

export const ITEMS = {
  styles: { name: 'styles', type: 'registry:item', files: [file('styles/index.css', ':root { --ui-x: 1px; }\n')], categories: ['setup'] },
  theme: {
    name: 'theme',
    type: 'registry:item',
    registryDependencies: [`${CANONICAL}/styles.json`],
    files: [file('theme/ThemeProvider.tsx', "'use client';\n\nexport function ThemeProvider() { return null; }\n")],
    categories: ['setup'],
  },
  button: {
    name: 'button',
    type: 'registry:item',
    title: 'Button',
    description: 'Buttons of all kinds',
    registryDependencies: [`${CANONICAL}/styles.json`],
    files: [file('basic/Button.tsx', "'use client';\n\nexport function Button() { return null; }\n")],
    categories: ['basic'],
    meta: { category: 'basic', categoryTitle: 'Basic', exports: { 'basic/Button': ['Button'] } },
  },
  dialog: {
    name: 'dialog',
    type: 'registry:item',
    title: 'Dialog',
    description: 'Modal windows',
    dependencies: ['left-pad@^1.3.0', 'react'],
    registryDependencies: [`${CANONICAL}/button.json`, 'theme'],
    files: [file('feedback/Dialog.tsx', "'use client';\n\nimport { Button } from '../basic/Button';\nexport const Dialog = Button;\n")],
    categories: ['feedback'],
    meta: { category: 'feedback', categoryTitle: 'Feedback', exports: { 'feedback/Dialog': ['Dialog'] }, parts: { 'Dialog.Close': 'DialogClose' } },
  },
  'cycle-a': { name: 'cycle-a', registryDependencies: ['cycle-b'], files: [] },
  'cycle-b': { name: 'cycle-b', registryDependencies: ['cycle-a'], files: [] },
  evil: { name: 'evil', files: [{ path: 'x', content: 'x', type: 'registry:file', target: '../outside.txt' }] },
};

/** A registry directory with ITEMS and a registry.json index. */
export function fixtureRegistry() {
  const dir = tempDir('valyro-reg-');
  const files = { 'registry.json': { name: 'valyro-ui', items: Object.values(ITEMS).map(({ files: f, ...rest }) => rest) } };
  for (const [name, item] of Object.entries(ITEMS)) files[`${name}.json`] = item;
  return writeTree(dir, files);
}

/** I/O object for run(): collects output, never prompts unless `answers` given. */
export function fakeIo(cwd, { answers = [], ...overrides } = {}) {
  const out = [];
  const err = [];
  const installs = [];
  const io = {
    cwd,
    // Never the developer's own ~/.config/valyro token.
    env: { VALYRO_CONFIG_DIR: tempDir('valyro-config-') },
    isTTY: answers.length > 0,
    fetch: globalThis.fetch,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    ask: async (question) => {
      out.push(question);
      return answers.shift() ?? '';
    },
    run: (pm, args, dir) => installs.push({ pm, args, dir }),
    ...overrides,
  };
  return { io, out, err, installs, text: () => out.join('\n'), errors: () => err.join('\n') };
}
