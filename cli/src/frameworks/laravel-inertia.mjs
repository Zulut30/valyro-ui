/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'laravel-inertia',
  guide: 'laravel',
  kind: 'react',
  detect: (dir, deps) =>
    deps['laravel-vite-plugin'] && deps['@inertiajs/react'] ? { rsc: false, defaultDir: 'resources/js/components/valyro-ui' } : null,
  patch: {
    entries: ['resources/js/app.tsx', 'resources/js/app.jsx'],
    // Inertia 3 wraps the app in withApp(app); Inertia 2 renders <App {...props} /> in setup().
    anchor: /\{app\}|<App\s+\{\.\.\.props\}\s*\/>/g,
    wrapped: '{app}',
    note: ({ attrs }) =>
      `Laravel: put ${attrs} on <html> in resources/views/app.blade.php, and drop the starter's body background (resources/css/app.css), font-sans on <body> and @fonts in <head> (it preloads the starter font, now unused) so the theme shows.`,
  },
};
