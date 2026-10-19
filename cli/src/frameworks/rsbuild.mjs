import { srcOr } from './shared.mjs';

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'rsbuild',
  guide: 'rsbuild',
  kind: 'react',
  detect: (dir, deps) => (deps['@rsbuild/core'] ? { rsc: false, defaultDir: srcOr(dir, 'components/valyro-ui') } : null),
  patch: {
    entries: ['src/index.tsx', 'src/index.jsx'],
    anchor: /<App\s*\/>/g,
    wrapped: '<App />',
    note: ({ attrs }) =>
      `Rsbuild: put ${attrs} on <html> in your own index.html (html.template in rsbuild.config.ts) so the first paint is themed.`,
  },
};
