import { srcOr } from './shared.mjs';

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'vite',
  guide: 'vite',
  kind: 'react',
  detect: (dir, deps) => (deps.vite ? { rsc: false, defaultDir: srcOr(dir, 'components/valyro-ui') } : null),
  patch: {
    entries: ['src/main.tsx', 'src/main.jsx', 'src/main.ts', 'src/main.js', 'src/index.tsx', 'src/index.jsx'],
    anchor: /<App\s*\/>/g,
    wrapped: '<App />',
    note: () =>
      "Vite: delete the template's src/index.css and src/App.css with their imports: :root there sets letter-spacing and #root centers text, and every component inherits both.",
  },
};
