import { srcOr } from './shared.mjs';

/** styles/index.css, then an opt-in theme file. */
const cssVar = (index) => (index ? 'valyroThemeCss' : 'valyroCss');

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'tanstack-start',
  guide: 'tanstack-start',
  kind: 'react',
  detect: (dir, deps) => (deps['@tanstack/react-start'] ? { rsc: false, defaultDir: srcOr(dir, 'components/valyro-ui') } : null),
  patch: {
    entries: ['src/routes/__root.tsx', 'src/routes/__root.jsx', 'app/routes/__root.tsx'],
    anchor: /\{children\}/g,
    wrapped: '{children}',
    ssr: true,
    // Stylesheets are linked from head() so SSR puts them in <head> before the app's own CSS.
    cssImport: (base, file, index) => `import ${cssVar(index)} from '${base}/${file}?url';`,
    headLink: (index) => `{ rel: 'stylesheet', href: ${cssVar(index)} }`,
    note: () =>
      "TanStack Start: in src/styles.css keep only the reset (box-sizing, body margin): the template's body font-family and main rule override the theme font and the page layout.",
  },
};
