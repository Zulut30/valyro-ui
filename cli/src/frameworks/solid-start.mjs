import { detectDependency } from './shared.mjs';

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'solid-start',
  guide: 'solid',
  kind: 'css',
  detect: detectDependency('@solidjs/start'),
  manual: {
    label: 'SolidStart',
    css: ['src/app.tsx', "import 'valyro-ui/styles.css';"],
    theme: ['src/entry-server.tsx', '<html lang="en" {attrs}>'],
    note: "Use it instead of the template's import \"./app.css\": that file styles main, h1, p and a globally.",
  },
};
