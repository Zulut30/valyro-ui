import { detectDependency } from './shared.mjs';

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'nuxt',
  guide: 'nuxt',
  kind: 'css',
  detect: detectDependency('nuxt'),
  manual: {
    label: 'Nuxt',
    css: ['nuxt.config.ts', "css: ['valyro-ui/styles.css'],"],
    theme: ['app/app.vue', "useHead({ htmlAttrs: { 'data-theme': '{theme}', 'data-mode': '{mode}' } });"],
  },
};
