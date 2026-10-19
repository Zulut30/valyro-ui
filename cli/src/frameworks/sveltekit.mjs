import { detectDependency } from './shared.mjs';

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'sveltekit',
  guide: 'sveltekit',
  kind: 'css',
  detect: detectDependency('@sveltejs/kit'),
  manual: {
    label: 'SvelteKit',
    css: ['src/routes/+layout.svelte', "import 'valyro-ui/styles.css';"],
    theme: ['src/app.html', '<html lang="en" {attrs}>'],
  },
};
