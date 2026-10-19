import { exists, srcOr } from './shared.mjs';

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'react-router',
  guide: 'react-router',
  kind: 'react',
  detect(dir, deps) {
    const found = deps['@react-router/dev'] || exists(dir, 'react-router.config.ts') || exists(dir, 'react-router.config.js');
    if (!found) return null;
    return { rsc: false, defaultDir: exists(dir, 'app') ? 'app/components/valyro-ui' : srcOr(dir, 'components/valyro-ui') };
  },
  patch: {
    entries: ['app/root.tsx', 'app/root.jsx', 'src/root.tsx', 'src/root.jsx'],
    anchor: /<Outlet\s*\/>/g,
    wrapped: '<Outlet />',
    ssr: true,
  },
};
