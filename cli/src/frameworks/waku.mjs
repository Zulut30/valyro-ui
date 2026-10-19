/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'waku',
  guide: 'waku',
  kind: 'react',
  detect: (dir, deps) => (deps.waku ? { rsc: true, defaultDir: 'src/components/valyro-ui' } : null),
  patch: {
    entries: ['src/pages/_layout.tsx', 'src/pages/_layout.jsx'],
    anchor: /\{children\}/g,
    wrapped: '{children}',
    note: ({ attrs }) =>
      `Waku: render <html lang="en" ${attrs}> in src/pages/_root.tsx so the server HTML is themed before hydration, and drop the template layout's font-['Nunito'] wrapper: it overrides the theme font.`,
  },
};
