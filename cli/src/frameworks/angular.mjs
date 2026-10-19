import { detectDependency } from './shared.mjs';

/** @type {import('./index.mjs').Adapter} */
export default {
  name: 'angular',
  guide: 'angular',
  kind: 'css',
  detect: detectDependency('@angular/core'),
  manual: {
    label: 'Angular',
    css: ['src/styles.css', "@import 'valyro-ui/styles.css';"],
    theme: ['src/index.html', '<html lang="en" {attrs}>'],
    note: 'angular.json: set optimization.styles.inlineCritical to false in the production configuration, or pages paint unstyled until the CSS loads.',
  },
};
