import { detectDependency } from './shared.mjs';

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'solid',
  guide: 'solid',
  kind: 'css',
  detect: detectDependency('solid-js'),
  manual: {
    label: 'Solid',
    css: ['src/index.tsx', "import 'valyro-ui/styles.css';"],
    theme: ['index.html', '<html lang="en" {attrs}>'],
    note: "Remove the template's import './index.css' (and App.css): its :root letter-spacing and #root centering are inherited by every component.",
  },
};
