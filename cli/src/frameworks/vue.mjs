import { detectDependency } from './shared.mjs';

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'vue',
  guide: 'vue',
  kind: 'css',
  detect: detectDependency('vue'),
  manual: {
    label: 'Vue',
    css: ['src/main.ts', "import 'valyro-ui/styles.css';"],
    theme: ['index.html', '<html lang="en" {attrs}>'],
    note: "Remove the template's import './assets/main.css': it paints <body> over the theme background.",
  },
};
