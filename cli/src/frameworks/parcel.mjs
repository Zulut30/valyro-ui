import { srcOr } from './shared.mjs';

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'parcel',
  guide: 'parcel',
  kind: 'react',
  detect: (dir, deps) => (deps.parcel ? { rsc: false, defaultDir: srcOr(dir, 'components/valyro-ui') } : null),
  patch: {
    entries: ['src/index.tsx', 'src/index.jsx'],
    anchor: /<App\s*\/>/g,
    wrapped: '<App />',
    note: ({ attrs }) => `Parcel: put ${attrs} on <html> in src/index.html.`,
  },
};
