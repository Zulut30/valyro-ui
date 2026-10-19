import { detectDependency } from './shared.mjs';

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'svelte',
  // The SvelteKit guide also covers a plain Svelte + Vite app.
  guide: 'sveltekit',
  kind: 'css',
  detect: detectDependency('svelte'),
  manual: {
    label: 'Svelte',
    css: ['src/main.ts', "import 'valyro-ui/styles.css';"],
    theme: ['index.html', '<html lang="en" {attrs}>'],
    note: "Remove the template's import './app.css': its :root letter-spacing and #app centering are inherited by every component.",
  },
};
