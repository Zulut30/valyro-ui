/*
 * How far a scroll container is from each of its edges, and a watcher that reports it once per frame on scroll and
 * on resize (of the container and of its children). Edge hints (fades, shadows), "scroll to end" buttons and
 * "load more at the edge" all start from these four numbers. `scrollLeft` runs negative in RTL (and from 0 to the
 * left), so the inline distances compare magnitudes: `start` is always the reading-start side. Internal; shared by
 * ScrollArea, and the place the copies in navigation/internal.tsx, in a devtools pane and in an insights pane move to.
 */

export interface ScrollEdgeDistances {
  /** Pixels of content hidden past each edge (0 at that edge). Logical inline sides: `start` mirrors in RTL. */
  top: number;
  bottom: number;
  start: number;
  end: number;
  /** The content is larger than the container on that axis (by more than a pixel of rounding). */
  overflowX: boolean;
  overflowY: boolean;
}

/** Reads the distances of `el` to its four edges (one layout read). */
export function scrollEdgeDistances(el: HTMLElement): ScrollEdgeDistances {
  const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
  const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
  return edgeDistances(el.scrollTop, Math.abs(el.scrollLeft), maxX, maxY);
}

/** The same from raw numbers: scroll offsets (inline offset as a magnitude) and the scroll ranges. */
export function edgeDistances(top: number, inline: number, maxX: number, maxY: number): ScrollEdgeDistances {
  const clampTo = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const y = clampTo(top, maxY);
  const x = clampTo(inline, maxX);
  return { top: y, bottom: maxY - y, start: x, end: maxX - x, overflowX: maxX > 1, overflowY: maxY > 1 };
}

export interface ScrollEdgeChange {
  /** A scroll event arrived since the last report. */
  scrolled: boolean;
  /** The container or one of its observed children changed size since the last report. */
  resized: boolean;
}

export interface ObserveScrollEdgesOptions {
  /** Elements whose size changes also count (default: the container's children at the time of the call). */
  observe?: Iterable<Element>;
  /** Report synchronously once at the start (default true). */
  initial?: boolean;
}

/**
 * Calls `onChange` with the distances of `el` after scrolling or a resize, at most once per animation frame (the
 * reads batch into the frame, the callback writes). Returns the cleanup. Browser only: call it from an effect.
 */
export function observeScrollEdges(
  el: HTMLElement,
  onChange: (distances: ScrollEdgeDistances, change: ScrollEdgeChange) => void,
  options: ObserveScrollEdgesOptions = {},
): () => void {
  let frame = 0;
  const pending: ScrollEdgeChange = { scrolled: false, resized: false };
  const flush = () => {
    frame = 0;
    const change = { ...pending };
    pending.scrolled = false;
    pending.resized = false;
    onChange(scrollEdgeDistances(el), change);
  };
  const schedule = (kind: keyof ScrollEdgeChange) => {
    pending[kind] = true;
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const onScroll = () => schedule('scrolled');
  el.addEventListener('scroll', onScroll, { passive: true });
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => schedule('resized'));
  if (resize) {
    resize.observe(el);
    for (const child of options.observe ?? el.children) resize.observe(child);
  }
  if (options.initial !== false) onChange(scrollEdgeDistances(el), { scrolled: false, resized: true });
  return () => {
    el.removeEventListener('scroll', onScroll);
    resize?.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
