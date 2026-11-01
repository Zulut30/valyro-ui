/*
 * Shared browser plumbing of the motion wrappers, so a page of a hundred reveals and tilts costs one
 * IntersectionObserver per setting, one requestAnimationFrame loop and one pointer listener. The frame
 * loop runs only while some task is moving and stops with the tab hidden (rAF does), then resumes.
 * Browser only: called from effects.
 */

type IntersectionCallback = (entry: IntersectionObserverEntry) => void;

interface Pool {
  observer: IntersectionObserver;
  callbacks: Map<Element, Set<IntersectionCallback>>;
}

const pools = new Map<string, Pool>();

export interface IntersectionOptions {
  /** Grows or shrinks the viewport, like IntersectionObserver's rootMargin. */
  rootMargin?: string;
  /** Visible share that counts as "in view", 0–1. */
  threshold?: number;
}

/**
 * Calls `callback` with every intersection change of `element`. Observers are shared per rootMargin and
 * threshold. Without IntersectionObserver the element counts as in view at once. Returns the cleanup.
 */
export function observeIntersection(element: Element, callback: IntersectionCallback, { rootMargin = '0px', threshold = 0 }: IntersectionOptions = {}): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback({ isIntersecting: true, intersectionRatio: 1, target: element } as IntersectionObserverEntry);
    return () => {};
  }
  const key = `${rootMargin}|${threshold}`;
  let pool = pools.get(key);
  if (!pool) {
    const callbacks = new Map<Element, Set<IntersectionCallback>>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) callbacks.get(entry.target)?.forEach((fn) => fn(entry));
      },
      { rootMargin, threshold },
    );
    pool = { observer, callbacks };
    pools.set(key, pool);
  }
  const { observer, callbacks } = pool;
  let set = callbacks.get(element);
  if (!set) {
    set = new Set();
    callbacks.set(element, set);
    observer.observe(element);
  }
  set.add(callback);
  return () => {
    const current = callbacks.get(element);
    if (!current) return;
    current.delete(callback);
    if (current.size) return;
    callbacks.delete(element);
    observer.unobserve(element);
  };
}

/** A frame task gets the frame time in seconds (capped at 1/20 s) and returns false when it is done. */
export type FrameTask = (dt: number) => boolean | void;

const tasks = new Set<FrameTask>();
let frame = 0;
let last = 0;

function run(now: number) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
  last = now;
  for (const task of [...tasks]) if (task(dt) === false) tasks.delete(task);
  if (tasks.size) frame = requestAnimationFrame(run);
  else {
    frame = 0;
    last = 0;
  }
}

/** Runs `task` once per frame in the shared loop until it returns false or the returned stop is called. */
export function addFrameTask(task: FrameTask): () => void {
  tasks.add(task);
  frame ||= requestAnimationFrame(run);
  return () => {
    tasks.delete(task);
    if (tasks.size || !frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  };
}

type PointerListener = (event: PointerEvent) => void;
const pointerListeners = new Set<PointerListener>();
const layoutListeners = new Set<() => void>();
const dispatchPointer = (event: PointerEvent) => pointerListeners.forEach((fn) => fn(event));
const dispatchLayout = () => layoutListeners.forEach((fn) => fn());

/** Every pointer move on the page, from one passive window listener. */
export function onPointerMove(listener: PointerListener): () => void {
  if (!pointerListeners.size) window.addEventListener('pointermove', dispatchPointer, { passive: true });
  pointerListeners.add(listener);
  return () => {
    pointerListeners.delete(listener);
    if (!pointerListeners.size) window.removeEventListener('pointermove', dispatchPointer);
  };
}

/** Any scroll (window or container) or resize: cached element boxes are stale. One listener pair for all. */
export function onLayoutShift(listener: () => void): () => void {
  if (!layoutListeners.size) {
    document.addEventListener('scroll', dispatchLayout, { capture: true, passive: true });
    window.addEventListener('resize', dispatchLayout, { passive: true });
  }
  layoutListeners.add(listener);
  return () => {
    layoutListeners.delete(listener);
    if (layoutListeners.size) return;
    document.removeEventListener('scroll', dispatchLayout, { capture: true });
    window.removeEventListener('resize', dispatchLayout);
  };
}

/** Whether a pointer event comes from a precise hovering pointer (mouse, pen) — pointer effects skip touch. */
export const isHoverPointer = (event: PointerEvent) => event.pointerType === 'mouse' || event.pointerType === 'pen';
