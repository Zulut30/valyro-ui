/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'electron-vite',
  guide: 'electron',
  kind: 'react',
  detect: (dir, deps) => (deps['electron-vite'] ? { rsc: false, defaultDir: 'src/renderer/src/components/valyro-ui' } : null),
  patch: {
    entries: ['src/renderer/src/main.tsx', 'src/renderer/src/main.jsx'],
    anchor: /<App\s*\/>/g,
    wrapped: '<App />',
    note: ({ attrs }) =>
      `electron-vite: put ${attrs} on <html> in src/renderer/index.html, and drop the template's import './assets/main.css' from main.tsx: it paints <body> (background image, colors) over the theme.`,
  },
};
