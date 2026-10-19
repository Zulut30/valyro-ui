// Shared by the CLI and scripts/build-registry.mjs so both agree on URLs and layout.

export const SITE_URL = 'https://valyro.xyz';
export const DEFAULT_REGISTRY_URL = `${SITE_URL}/r`;
/** ValyroUI Pro: where to buy a licence. */
export const PRICING_URL = `${SITE_URL}/#/pricing`;
/** The account API (`valyro login`, `whoami`, the licensed registry, the hosted MCP server); VALYRO_API_URL overrides it. */
export const API_URL = `${SITE_URL}/api`;
export const PRO_REGISTRY_URL = `${API_URL}/registry`;
export const CLI_PACKAGE = 'valyro-cli';
/** The npm package with the components and `styles.css`: the free core. */
export const LIBRARY_PACKAGE = 'valyro-ui';
/** The licensed npm package with every component and theme. */
export const PRO_PACKAGE = 'valyro-ui-pro';
export const CONFIG_FILE = 'valyro.json';

/** Every registry file targets `components/valyro-ui/<kit path>`; the CLI swaps the prefix for the configured install dir. */
export const KIT_TARGET_PREFIX = 'components/valyro-ui/';
/** Registry `path` prefix (the path inside the registry, see shadcn's registry-item schema). */
export const KIT_PATH_PREFIX = 'valyro-ui/';

export const THEMES = ['vercel', 'glass', 'material', 'fluent', 'linear', 'stripe', 'anthropic', 'paper', 'brutalism', 'high-contrast', 'terminal', 'pixel', 'cyber', 'fantasy', 'playrix', 'manacost', 'mythic', 'frost', 'hearthstone'];
/** Free themes (src/lib/tiers.ts CORE_THEMES); every other theme is Pro: the `<name>-theme` registry item and `valyro-ui-pro`. */
export const CORE_THEMES = ['vercel', 'glass', 'high-contrast'];
/** Themes in `styles/index.css` (the package's `valyro-ui/styles.css`); every other theme is an opt-in file. */
export const BUNDLED_THEMES = ['vercel', 'glass'];
/** Self-hosted fonts each theme's font stacks use: `valyro-ui/fonts/<id>.css` in the npm package. */
export const THEME_FONTS = {
  vercel: ['geist', 'geist-mono'],
  glass: [],
  material: ['roboto-flex', 'jetbrains-mono'],
  fluent: ['selawik'],
  linear: ['inter', 'jetbrains-mono'],
  stripe: ['inter', 'jetbrains-mono'],
  anthropic: ['inter', 'source-serif-4', 'jetbrains-mono'],
  paper: ['inter', 'jetbrains-mono'],
  brutalism: ['inter', 'unbounded', 'jetbrains-mono'],
  'high-contrast': ['atkinson-hyperlegible-next', 'jetbrains-mono'],
  terminal: ['jetbrains-mono'],
  pixel: ['jetbrains-mono', 'pixelify-sans', 'press-start-2p'],
  cyber: ['geist', 'unbounded', 'jetbrains-mono'],
  fantasy: ['jetbrains-mono', 'cinzel', 'eb-garamond'],
  playrix: ['inter', 'unbounded', 'jetbrains-mono'],
  manacost: ['roboto-flex', 'jetbrains-mono'],
  mythic: ['inter', 'eb-garamond', 'jetbrains-mono'],
  frost: ['inter', 'cinzel', 'eb-garamond', 'jetbrains-mono'],
  hearthstone: ['hs-display', 'inter', 'jetbrains-mono'],
};
export const MODES = ['light', 'dark'];

/** Items `valyro init` installs. */
export const BASE_ITEMS = ['styles', 'theme'];
