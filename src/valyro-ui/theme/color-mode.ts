/*
 * Light, dark or the system's mode: the stored choice, the OS preference, the pre-hydration script that applies
 * them before the first paint, and the switch between modes without a "staircase" of component transitions.
 * ThemeProvider writes `data-mode` on <html> from these; useColorMode reads and sets the choice. No React here.
 */

export type ColorMode = 'light' | 'dark';
export type ColorModeChoice = ColorMode | 'system';
export type ColorModeStorage = 'local' | 'cookie';

/** The key the guides' hand-written scripts used, kept so their saved choices carry over. */
export const COLOR_MODE_STORAGE_KEY = 'ui-mode';

export const isColorModeChoice = (value: unknown): value is ColorModeChoice => value === 'light' || value === 'dark' || value === 'system';

/** `system` → the OS mode (light when unknown). */
export const resolveColorMode = (choice: ColorModeChoice, system: ColorMode | undefined): ColorMode =>
  choice === 'system' ? (system ?? 'light') : choice;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A cookie's value from a `document.cookie` string, or undefined. */
export function readCookie(cookies: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|;\\s*)${escapeRegExp(name)}=([^;]*)`).exec(cookies);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** The saved choice, or undefined when nothing valid is saved (or storage is blocked, or on the server). */
export function readStoredColorMode(storageKey: string, storage: ColorModeStorage = 'local'): ColorModeChoice | undefined {
  if (typeof document === 'undefined') return undefined;
  try {
    const value = storage === 'cookie' ? readCookie(document.cookie, storageKey) : localStorage.getItem(storageKey);
    return isColorModeChoice(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredColorMode(storageKey: string, storage: ColorModeStorage, choice: ColorModeChoice) {
  try {
    if (storage === 'cookie') document.cookie = `${storageKey}=${choice}; path=/; max-age=31536000; samesite=lax`;
    else localStorage.setItem(storageKey, choice);
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

/* ── Stores for useSyncExternalStore: the OS mode, and the saved choice per storage key ── */

type Listener = () => void;

export interface ColorModeTransitionHost {
  /** How a change from outside (the OS, another tab) is painted: cross-fade or at once. */
  transition: 'fade' | 'none';
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

const systemListeners = new Set<Listener>();
let systemMode: ColorMode | undefined;
let systemQuery: MediaQueryList | undefined;
/** Providers that want an OS change cross-faded; the last mounted one decides. */
export const systemTransitionHosts: ColorModeTransitionHost[] = [];

const readSystem = (): ColorMode | undefined => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
};

const onSystemChange = () => {
  const next = readSystem();
  if (next === systemMode) return;
  const host = systemTransitionHosts[systemTransitionHosts.length - 1];
  switchColorMode(() => {
    systemMode = next;
    for (const listener of [...systemListeners]) listener();
  }, host?.transition ?? 'none');
};

export const systemColorModeStore = {
  subscribe(listener: Listener) {
    if (systemListeners.size === 0 && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      systemQuery = window.matchMedia(DARK_QUERY);
      systemMode = systemQuery.matches ? 'dark' : 'light';
      // Safari < 14 has only addListener.
      if (systemQuery.addEventListener) systemQuery.addEventListener('change', onSystemChange);
      else systemQuery.addListener?.(onSystemChange);
    }
    systemListeners.add(listener);
    return () => {
      systemListeners.delete(listener);
      if (systemListeners.size === 0 && systemQuery) {
        if (systemQuery.removeEventListener) systemQuery.removeEventListener('change', onSystemChange);
        else systemQuery.removeListener?.(onSystemChange);
        systemQuery = undefined;
      }
    };
  },
  /** The OS mode; read live while nothing listens. */
  getSnapshot: (): ColorMode | undefined => (systemListeners.size > 0 && systemMode ? systemMode : readSystem()),
  getServerSnapshot: (): ColorMode | undefined => undefined,
};

export interface StoredColorModeStore {
  subscribe: (listener: Listener) => () => void;
  /** The saved choice; `null` when nothing valid is saved. */
  getSnapshot: () => ColorModeChoice | null;
  /** Unknown on the server and while hydrating. */
  getServerSnapshot: () => ColorModeChoice | null | undefined;
  /** Saves the choice, updates every subscriber in this tab and tells the other tabs. */
  set: (choice: ColorModeChoice) => void;
}

const stores = new Map<string, StoredColorModeStore>();
const CHANNEL = 'valyro-ui-color-mode';

/** One store per storage and key, shared by every provider and hook that uses them. */
export function storedColorModeStore(storageKey: string, storage: ColorModeStorage = 'local'): StoredColorModeStore {
  const id = `${storage}:${storageKey}`;
  const existing = stores.get(id);
  if (existing) return existing;

  const listeners = new Set<Listener>();
  let current: ColorModeChoice | null | undefined;
  let channel: BroadcastChannel | undefined;
  const read = () => readStoredColorMode(storageKey, storage) ?? null;
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const refresh = () => {
    const next = read();
    if (next === current) return;
    current = next;
    emit();
  };
  // localStorage tells other tabs by itself; a cookie needs a channel.
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey || event.key === null) refresh();
  };
  const onMessage = (event: MessageEvent) => {
    if (event.data?.id === id) refresh();
  };

  const store: StoredColorModeStore = {
    subscribe(listener) {
      if (listeners.size === 0 && typeof window !== 'undefined') {
        current = read();
        window.addEventListener('storage', onStorage);
        if (storage === 'cookie' && typeof BroadcastChannel !== 'undefined') {
          channel = new BroadcastChannel(CHANNEL);
          channel.addEventListener('message', onMessage);
        }
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== 'undefined') {
          window.removeEventListener('storage', onStorage);
          channel?.close();
          channel = undefined;
        }
      };
    },
    getSnapshot: () => (listeners.size > 0 && current !== undefined ? current : read()),
    getServerSnapshot: () => undefined,
    set(choice) {
      if (!isColorModeChoice(choice)) return;
      writeStoredColorMode(storageKey, storage, choice);
      if (storage === 'cookie' && typeof BroadcastChannel !== 'undefined') {
        const post = new BroadcastChannel(CHANNEL);
        post.postMessage({ id });
        post.close();
      }
      current = choice;
      emit();
    },
  };
  stores.set(id, store);
  return store;
}

/* ── Applying a mode to <html> ── */

/** Sets `data-mode` (and the `color-scheme` the pre-hydration script put inline) on <html>. */
export function writeColorMode(mode: ColorMode, root: HTMLElement = document.documentElement) {
  if (root.dataset.mode !== mode) root.dataset.mode = mode;
  // The script sets color-scheme inline so the canvas is dark before the CSS loads; keep it in step afterwards.
  if (root.style.colorScheme && root.style.colorScheme !== mode) root.style.colorScheme = mode;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
  activeViewTransition?: unknown;
};

const reducedMotion = (root: HTMLElement) =>
  root.closest('[data-ui-motion="reduce"]') !== null ||
  (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

let latestSwitch = 0;

/** The cross-fade in flight: picks made during it join it instead of starting another one. */
interface Fade {
  apply: () => void;
  ran: boolean;
  next?: () => void;
}
let fade: Fade | null = null;

/**
 * Runs `apply` (which changes the mode) so the page changes as one: a cross-fade of the whole page through a View
 * Transition (`fade`), or at once with every component transition held for two frames, so colours do not trail
 * behind at their own speeds. Picks never cut a running cross-fade: one made before it has captured the page
 * replaces its target, a later one (arrow keys through Light, Dark, System) waits and fades in after it. Inside another view transition (a theme switch's own sweep) it applies at once and
 * lets that transition paint it. `apply` must update the DOM synchronously (write it, or render through
 * flushSync): the transition captures the new page right after it.
 */
export function switchColorMode(apply: () => void, transition: 'fade' | 'none') {
  if (typeof document === 'undefined') {
    apply();
    return;
  }
  const doc = document as ViewTransitionDocument;
  const root = doc.documentElement;
  if (fade) {
    // Before the transition has captured the old page only the latest pick runs in it; after, the latest pick
    // waits for it to end and fades in on its own, so the page never snaps between modes half way.
    if (fade.ran) fade.next = apply;
    else fade.apply = apply;
    return;
  }
  const inTransition = root.hasAttribute('data-ui-theme-sweep') || !!doc.activeViewTransition;
  if (inTransition) {
    apply();
    return;
  }
  const id = ++latestSwitch;
  if (transition === 'fade' && typeof doc.startViewTransition === 'function' && !reducedMotion(root)) {
    const current: Fade = { apply, ran: false };
    try {
      root.setAttribute('data-ui-mode-switching', 'fade');
      fade = current;
      doc
        .startViewTransition(() => {
          current.ran = true;
          current.apply();
        })
        .finished.finally(() => {
          if (fade === current) fade = null;
          if (id === latestSwitch) root.removeAttribute('data-ui-mode-switching');
          if (current.next) switchColorMode(current.next, transition);
        })
        .catch(() => {});
      return;
    } catch {
      // A browser that refuses the transition still switches.
      fade = null;
    }
  }
  root.setAttribute('data-ui-mode-switching', '');
  apply();
  // Styles must resolve with transitions off before they come back on.
  void getComputedStyle(root).color;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (id === latestSwitch) root.removeAttribute('data-ui-mode-switching');
    }),
  );
}

/* ── The pre-hydration script ── */

export interface ColorModeScriptOptions {
  /** localStorage key or cookie name of the choice; false: nothing is saved, `defaultMode` applies. Default 'ui-mode'. */
  storageKey?: string | false;
  /** Default 'local'. A cookie also lets the server render `data-mode` itself. */
  storage?: ColorModeStorage;
  /** Applied when nothing is saved: pass ThemeProvider's `defaultMode`. Default 'light', as ThemeProvider's. */
  defaultMode?: ColorModeChoice;
  /** Also restore a theme name saved under this key (same storage), e.g. 'ui-theme'. Only names in `themes` apply. */
  themeStorageKey?: string;
  /** Theme names `themeStorageKey` may restore. */
  themes?: readonly string[];
}

/**
 * The pre-hydration script as a string, for a `<script>` in <head> before the stylesheets (Vite's index.html,
 * Astro, Remix): it reads the saved choice (or the OS mode for `system`) and sets `data-mode` and `color-scheme` on
 * <html> before the first paint. About 500 bytes, no dependencies; values are validated, nothing else is written.
 */
export function colorModeScript({
  storageKey = COLOR_MODE_STORAGE_KEY,
  storage = 'local',
  defaultMode = 'light',
  themeStorageKey,
  themes = [],
}: ColorModeScriptOptions = {}): string {
  const args = JSON.stringify([storageKey || '', storage, isColorModeChoice(defaultMode) ? defaultMode : 'light', themeStorageKey || '', themes])
    // Never let a value close the script element.
    .replace(/</g, '\\u003c');
  return (
    '(function(a){try{var k=a[0],s=a[1],d=a[2],tk=a[3],ts=a[4],r=document.documentElement;' +
    'function g(n){if(!n)return null;if(s==="cookie"){var p=document.cookie.split(";");' +
    'for(var i=0;i<p.length;i++){var q=p[i].trim(),e=q.indexOf("=");if(e>0&&q.slice(0,e)===n)return decodeURIComponent(q.slice(e+1))}return null}' +
    'return localStorage.getItem(n)}' +
    'var m=g(k);if(m!=="light"&&m!=="dark"&&m!=="system")m=d;' +
    'if(m==="system")m=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";' +
    'r.setAttribute("data-mode",m);r.style.colorScheme=m;' +
    'var t=g(tk);if(t&&ts.indexOf(t)>-1)r.setAttribute("data-theme",t)}catch(e){}})(' +
    args +
    ');'
  );
}
