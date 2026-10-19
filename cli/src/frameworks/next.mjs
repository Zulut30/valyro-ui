import { exists } from './shared.mjs';

const APP_ROUTER = {
  entries: ['src/app/layout.tsx', 'app/layout.tsx', 'src/app/layout.jsx', 'app/layout.jsx', 'src/app/layout.js', 'app/layout.js'],
  anchor: /\{children\}/g,
  wrapped: '{children}',
  ssr: true,
};

const PAGES_ROUTER = {
  entries: ['src/pages/_app.tsx', 'pages/_app.tsx', 'src/pages/_app.jsx', 'pages/_app.jsx', 'src/pages/_app.js', 'pages/_app.js'],
  anchor: /<Component\s+\{\.\.\.pageProps\}\s*\/>/g,
  wrapped: '<Component {...pageProps} />',
};

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'next',
  guide: 'next',
  kind: 'react',
  detect(dir, deps) {
    if (!deps.next) return null;
    const appRouter = exists(dir, 'app') || exists(dir, 'src', 'app');
    const srcDir = exists(dir, 'src', 'app') || exists(dir, 'src', 'pages') || (!exists(dir, 'app') && !exists(dir, 'pages') && exists(dir, 'src'));
    return { rsc: appRouter, defaultDir: srcDir ? 'src/components/valyro-ui' : 'components/valyro-ui' };
  },
  // The Pages Router _app only when the project has one and no App Router.
  patch: (config, projectDir) => (config.rsc || !PAGES_ROUTER.entries.some((f) => exists(projectDir, f)) ? APP_ROUTER : PAGES_ROUTER),
};
