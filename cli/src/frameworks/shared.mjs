// Detection helpers shared by the framework adapters.

import fs from 'node:fs';
import path from 'node:path';

export const exists = (...parts) => fs.existsSync(path.join(...parts));

/** `src/<fallback>` when the project has a src/ directory, else `<fallback>`. */
export const srcOr = (dir, fallback) => (exists(dir, 'src') ? `src/${fallback}` : fallback);

/** detect() for a CSS-only framework: one package marks it; nothing is copied, so the dir is nominal. */
export const detectDependency = (dependency) => (dir, deps) =>
  deps[dependency] ? { rsc: false, defaultDir: srcOr(dir, 'components/valyro-ui') } : null;
