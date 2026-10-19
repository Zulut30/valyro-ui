/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'astro',
  guide: 'astro',
  kind: 'react',
  detect: (dir, deps) => (deps.astro ? { rsc: false, defaultDir: 'src/components/valyro-ui' } : null),
  patch: {
    // The minimal template (`--template minimal`) has no layout, only this page.
    entries: ['src/layouts/Layout.astro', 'src/layouts/BaseLayout.astro', 'src/layouts/Base.astro', 'src/pages/index.astro'],
    anchor: null,
    islands: true,
    note: ({ attrs, provider }) =>
      `Astro: set ${attrs} on <html>; wrap React islands that read theme or locale in ${provider}. Requires @astrojs/react.`,
  },
};
