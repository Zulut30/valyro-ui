'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { ThemeName } from './themes';
import { useLayoutEffect, useSyncExternalStore } from '../primitives/react-compat';
import {
  COLOR_MODE_STORAGE_KEY,
  isColorModeChoice,
  resolveColorMode,
  storedColorModeStore,
  switchColorMode,
  systemColorModeStore,
  systemTransitionHosts,
  writeColorMode,
  type ColorMode,
  type ColorModeChoice,
  type ColorModeStorage,
  type ColorModeTransitionHost,
  type StoredColorModeStore,
} from './color-mode';

/** A registered theme (see ./themes) or the name of a theme whose CSS the app loads itself. */
export type { ThemeName };
/** The mode a page is painted in. */
export type ThemeMode = ColorMode;

interface ThemeContextValue {
  theme: ThemeName;
  /** The painted mode (`system` resolved; light while the server cannot know it). */
  mode: ThemeMode;
  /** BCP 47 locale for number/date formatting; undefined = the browser's. */
  locale?: string | undefined;
  /** IANA time zone for dates and times; undefined = the reader's. */
  timeZone?: string | undefined;
}

/** The nearest ThemeProvider / ThemeScope; read it with useTheme(). */
export const ThemeContext = createContext<ThemeContextValue>({ theme: 'vercel', mode: 'light' });

export interface ColorModeState {
  /** The reader's choice: light, dark or system. */
  mode: ColorModeChoice;
  /** The mode painted: `system` resolved. Undefined on the server and while hydrating, when it cannot be known. */
  resolvedMode: ColorMode | undefined;
  /** The OS mode; undefined on the server and while hydrating. */
  systemMode: ColorMode | undefined;
  /** Saves the choice, applies it at once (with the provider's transition) and tells the other tabs. */
  setMode: (mode: ColorModeChoice) => void;
  /** Light ↔ dark, from the painted mode. */
  toggle: () => void;
}

const ColorModeContext = createContext<ColorModeState | null>(null);

export interface ThemeProviderProps {
  theme?: ThemeName;
  /**
   * The mode (controlled): `light`, `dark`, or `system` to follow the OS live. Leave it out to let the provider keep
   * the reader's choice itself (`defaultMode`, saved under `storageKey`).
   */
  mode?: ColorModeChoice;
  /** Without `mode`: the mode until the reader picks one. Default `light`. */
  defaultMode?: ColorModeChoice;
  /** The reader picked a mode (useColorMode's `setMode`, ColorModeSwitch or another mode switch). */
  onModeChange?: (mode: ColorModeChoice) => void;
  /**
   * Where the choice is saved: a localStorage key or a cookie name; false = not saved. Default `ui-mode` without
   * `mode`, false with it (then the app owns the value). Pair it with `<ColorModeScript>` so a reload paints the saved
   * mode from the first frame.
   */
  storageKey?: string | false;
  /** `local` (default) or `cookie`, which the server can read to render `data-mode` itself. */
  storage?: ColorModeStorage;
  /**
   * How a mode change is painted: `fade` cross-fades the whole page once (View Transitions; at once under reduced
   * motion and where the API is missing); `none` switches at once. Either way component transitions are held for
   * the switch, so colours never trail behind at their own speeds. Default `fade`.
   */
  transition?: 'fade' | 'none';
  /** Default locale for every component's number/date formatting (a component's own `locale` prop wins). */
  locale?: string;
  /**
   * Default IANA time zone for every component that prints a date or a time of day, e.g. "Europe/Moscow" (a
   * component's own `timeZone` prop wins). Set it when rendering on the server, so the server and the browser print
   * the same time; undefined = the reader's.
   */
  timeZone?: string;
  children: ReactNode;
}

/**
 * The reader's latest pick, shown at once: a pick made while the page is still cross-fading to an earlier one is
 * painted after that fade, and a switch driven by arrow keys must start from what the reader chose, not from what is
 * painted yet. It gives way to the stored choice when that catches up, or after a moment if a controlled provider
 * turned the pick down.
 */
function usePick(choice: ColorModeChoice) {
  const [picked, setPicked] = useState<ColorModeChoice | null>(null);
  if (picked !== null && picked === choice) setPicked(null);
  useEffect(() => {
    if (picked === null) return;
    const timer = setTimeout(() => setPicked(null), 2000);
    return () => clearTimeout(timer);
  }, [picked]);
  return [picked ?? choice, setPicked] as const;
}

const noStore = {
  subscribe: () => () => {},
  getSnapshot: () => null,
  getServerSnapshot: () => undefined,
};

/**
 * Applies `data-theme` / `data-mode` to <html>, so portaled layers
 * (menus, dialogs, toasts) inherit the same tokens as the page.
 * To theme only part of the page, use ThemeScope.
 *
 * Light, dark or the OS mode: without `mode` it keeps the reader's choice (useColorMode, ColorModeSwitch) and saves
 * it under `storageKey`; `<ColorModeScript>` in <head> applies the saved mode before the first paint, and the
 * provider takes over without repainting. ThemeScope subtrees with their own `mode` keep it.
 */
export function ThemeProvider({
  theme = 'vercel',
  mode: modeProp,
  defaultMode = 'light',
  onModeChange,
  storageKey: storageKeyProp,
  storage = 'local',
  transition = 'fade',
  locale,
  timeZone,
  children,
}: ThemeProviderProps) {
  const controlled = modeProp !== undefined;
  const storageKey = storageKeyProp ?? (controlled ? false : COLOR_MODE_STORAGE_KEY);
  const store: StoredColorModeStore | typeof noStore = storageKey ? storedColorModeStore(storageKey, storage) : noStore;
  // `undefined` on the server and while hydrating: the saved choice is unknown there.
  const stored = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const system = useSyncExternalStore(systemColorModeStore.subscribe, systemColorModeStore.getSnapshot, systemColorModeStore.getServerSnapshot);
  const fallback = isColorModeChoice(defaultMode) ? defaultMode : 'light';
  const [local, setLocal] = useState<ColorModeChoice>(fallback);
  const choice: ColorModeChoice = controlled ? modeProp : storageKey ? (stored ?? fallback) : local;
  const known = stored !== undefined && (choice !== 'system' || system !== undefined);
  // What the server and the hydrating render paint into context: the choice when it is fixed, else light.
  const painted: ColorMode = choice === 'system' ? (system ?? 'light') : choice;

  // The mode to write, read live: during hydration the render above still sees the server snapshot, and writing
  // that would undo what ColorModeScript painted.
  const live = useRef<() => ColorMode>(() => painted);
  live.current = () => {
    const liveChoice = controlled ? modeProp : storageKey ? (store.getSnapshot() ?? fallback) : local;
    return resolveColorMode(liveChoice, systemColorModeStore.getSnapshot());
  };

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    writeColorMode(live.current(), root);
  }, [theme, painted, choice, stored, system]);

  // An OS change (in `system`) is cross-faded like a pick.
  useLayoutEffect(() => {
    const host: ColorModeTransitionHost = { transition };
    systemTransitionHosts.push(host);
    return () => {
      const index = systemTransitionHosts.indexOf(host);
      if (index >= 0) systemTransitionHosts.splice(index, 1);
    };
  }, [transition]);

  const latest = useRef({ controlled, storageKey, store, onModeChange, transition, local });
  latest.current = { controlled, storageKey, store, onModeChange, transition, local };

  const [shown, setPicked] = usePick(choice);
  const setMode = useCallback((next: ColorModeChoice) => {
    if (!isColorModeChoice(next)) return;
    setPicked(next);
    const { controlled: isControlled, storageKey: key, store: target, onModeChange: notify, transition: how } = latest.current;
    const apply = () =>
      flushSync(() => {
        if (key) (target as StoredColorModeStore).set(next);
        if (!isControlled) {
          setLocal(next);
          // Uncontrolled, the provider owns the mode: paint it now, not at the next commit.
          writeColorMode(resolveColorMode(next, systemColorModeStore.getSnapshot()));
        }
        notify?.(next);
      });
    switchColorMode(apply, how);
  }, [setPicked]);

  const resolvedMode = known || controlled ? (choice === 'system' ? system : choice) : undefined;
  const colorMode = useMemo<ColorModeState>(
    () => ({
      mode: shown,
      resolvedMode,
      systemMode: system,
      setMode,
      toggle: () => setMode((resolvedMode ?? live.current()) === 'dark' ? 'light' : 'dark'),
    }),
    [shown, resolvedMode, system, setMode],
  );

  const value = useMemo(() => ({ theme, mode: painted, locale, timeZone }), [theme, painted, locale, timeZone]);
  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    </ColorModeContext.Provider>
  );
}

export interface UseColorModeOptions {
  /** localStorage key or cookie name; false = kept in memory only. Default 'ui-mode'. */
  storageKey?: string | false;
  /** Default 'local'. */
  storage?: ColorModeStorage;
  /** The mode until one is picked. Default 'system'. */
  defaultMode?: ColorModeChoice;
  /** How a pick is painted: `fade` cross-fades the page (View Transitions; at once under reduced motion), `none` at once. Default `fade`. */
  transition?: 'fade' | 'none';
}

const memory = new Map<string, StoredColorModeStore>();
function memoryStore(id: string): StoredColorModeStore {
  let store = memory.get(id);
  if (!store) {
    const listeners = new Set<() => void>();
    let value: ColorModeChoice | null = null;
    store = {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => value,
      getServerSnapshot: () => undefined,
      set: (choice) => {
        value = choice;
        for (const listener of [...listeners]) listener();
      },
    };
    memory.set(id, store);
  }
  return store;
}

/**
 * The color mode: the reader's choice (`light | dark | system`), the painted mode and `setMode`, which saves the
 * choice, applies it and tells the other tabs. Inside a ThemeProvider it is the provider's (the provider paints
 * `data-mode`). Outside one, or with `options`, it keeps a choice of its own under `storageKey` and writes no
 * attribute: apply `resolvedMode` yourself, e.g. to a ThemeScope (a pick is still cross-faded, see `transition`).
 */
export function useColorMode(options?: UseColorModeOptions): ColorModeState {
  const provided = useContext(ColorModeContext);
  const own = !provided || options !== undefined;
  const { storageKey = COLOR_MODE_STORAGE_KEY, storage = 'local', defaultMode = 'system', transition = 'fade' } = options ?? {};
  const store = storageKey ? storedColorModeStore(storageKey, storage) : memoryStore('memory');
  const stored = useSyncExternalStore(own ? store.subscribe : noStore.subscribe, own ? store.getSnapshot : noStore.getSnapshot, store.getServerSnapshot);
  const system = useSyncExternalStore(systemColorModeStore.subscribe, systemColorModeStore.getSnapshot, systemColorModeStore.getServerSnapshot);
  const fallback = isColorModeChoice(defaultMode) ? defaultMode : 'system';
  const choice: ColorModeChoice = stored ?? fallback;
  const known = stored !== undefined && (choice !== 'system' || system !== undefined);
  const resolvedMode = known ? (choice === 'system' ? system : choice) : undefined;
  const [shown, setPicked] = usePick(choice);
  const standalone = useMemo<ColorModeState>(() => {
    const pick = (next: ColorModeChoice) => {
      setPicked(next);
      switchColorMode(() => flushSync(() => store.set(next)), transition);
    };
    return {
      mode: shown,
      resolvedMode,
      systemMode: system,
      setMode: (next) => {
        if (isColorModeChoice(next)) pick(next);
      },
      toggle: () => {
        if (resolvedMode) pick(resolvedMode === 'dark' ? 'light' : 'dark');
      },
    };
  }, [shown, resolvedMode, system, store, transition, setPicked],
  );
  return own ? standalone : provided;
}

export function useTheme() {
  return useContext(ThemeContext);
}

/** The locale a component should format with: its own prop, else the provider's, else the browser's (undefined). */
export function useLocale(override?: string) {
  const { locale } = useContext(ThemeContext);
  return override ?? locale;
}

/** The time zone a component should print dates in: its own prop, else the provider's, else the reader's (undefined). */
export function useTimeZone(override?: string) {
  const { timeZone } = useContext(ThemeContext);
  return override ?? timeZone;
}
