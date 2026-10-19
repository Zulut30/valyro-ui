import type { ReactNode } from 'react';

export type ToastType = 'default' | 'success' | 'error' | 'warning' | 'info' | 'loading';
export type ToastId = string | number;

export interface ToastAction {
  label: ReactNode;
  onClick: () => void;
}

export interface ToastOptions {
  /** Pass an existing id to update that toast in place. */
  id?: ToastId;
  description?: ReactNode;
  action?: ToastAction;
  /** Milliseconds before auto-dismiss; `Infinity` keeps the toast until dismissed. Default 4000. */
  duration?: number;
}

export interface ToastPromiseOptions<T> extends ToastOptions {
  loading: ReactNode;
  success: ReactNode | ((data: T) => ReactNode);
  error: ReactNode | ((error: unknown) => ReactNode);
}

export interface ToastData {
  id: ToastId;
  type: ToastType;
  title: ReactNode;
  description?: ReactNode;
  action?: ToastAction;
  duration: number;
  /** Set when dismissal starts; the toast is removed once its exit animation is over. */
  dismissed: boolean;
  /** Bumped on every update so the auto-dismiss timer restarts. */
  version: number;
}

export const DEFAULT_TOAST_DURATION = 4000;
/** Time a dismissed toast stays mounted for its exit animation. */
export const TOAST_EXIT_DURATION = 300;

const defaultDuration = (type: ToastType) => (type === 'loading' ? Infinity : DEFAULT_TOAST_DURATION);

/*
 * Page visibility for the auto-dismiss timers: while the page is hidden (another tab, a minimized
 * window) nobody can read a toast, so its time does not run out unseen.
 */
export function subscribePageVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

export function isPageHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

export function createToastStore() {
  let toasts: ToastData[] = [];
  let lastId = 0;
  const listeners = new Set<() => void>();
  const removals = new Map<ToastId, ReturnType<typeof setTimeout>>();

  const set = (next: ToastData[]) => {
    toasts = next;
    listeners.forEach((listener) => listener());
  };

  const cancelRemoval = (id: ToastId) => {
    clearTimeout(removals.get(id));
    removals.delete(id);
  };

  const remove = (id: ToastId) => {
    cancelRemoval(id);
    set(toasts.filter((t) => t.id !== id));
  };

  function show(type: ToastType, title: ReactNode, { id, duration, ...options }: ToastOptions = {}): ToastId {
    const existing = id === undefined ? undefined : toasts.find((t) => t.id === id);
    if (existing) {
      cancelRemoval(existing.id);
      const updated: ToastData = {
        ...existing,
        ...options,
        type,
        title,
        duration: duration ?? defaultDuration(type),
        dismissed: false,
        version: existing.version + 1,
      };
      set(toasts.map((t) => (t === existing ? updated : t)));
      return existing.id;
    }
    const toastId = id ?? ++lastId;
    const created: ToastData = {
      ...options,
      id: toastId,
      type,
      title,
      duration: duration ?? defaultDuration(type),
      dismissed: false,
      version: 0,
    };
    set([created, ...toasts]);
    return toastId;
  }

  /** Starts the exit of one toast, or of all toasts when `id` is omitted. */
  function dismiss(id?: ToastId) {
    const targets = toasts.filter((t) => !t.dismissed && (id === undefined || t.id === id));
    if (targets.length === 0) return;
    set(toasts.map((t) => (targets.includes(t) ? { ...t, dismissed: true } : t)));
    for (const t of targets) removals.set(t.id, setTimeout(() => remove(t.id), TOAST_EXIT_DURATION));
  }

  function promise<T>(
    pending: Promise<T>,
    { loading, success, error, duration, ...options }: ToastPromiseOptions<T>,
  ): ToastId {
    const id = show('loading', loading, options);
    pending.then(
      (data) => show('success', typeof success === 'function' ? success(data) : success, { ...options, id, duration }),
      (reason: unknown) => show('error', typeof error === 'function' ? error(reason) : error, { ...options, id, duration }),
    );
    return id;
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => toasts,
    show,
    dismiss,
    promise,
  };
}

export type ToastStore = ReturnType<typeof createToastStore>;

/** The store every `<Toaster />` renders. */
export const toastStore = createToastStore();

type ToastShortcut = (title: ReactNode, options?: ToastOptions) => ToastId;
const shortcut =
  (type: ToastType): ToastShortcut =>
  (title, options) =>
    toastStore.show(type, title, options);

/**
 * Imperative toast API — callable from anywhere, rendered by `<Toaster />`.
 * `toast('Saved')`, `toast.success(…)`, `toast.promise(p, {loading, success, error})`, `toast.dismiss(id)`.
 */
export const toast = Object.assign(shortcut('default'), {
  success: shortcut('success'),
  error: shortcut('error'),
  warning: shortcut('warning'),
  info: shortcut('info'),
  loading: shortcut('loading'),
  promise: toastStore.promise,
  dismiss: toastStore.dismiss,
});
