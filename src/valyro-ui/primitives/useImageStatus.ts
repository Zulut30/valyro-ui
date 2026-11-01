'use client';

import { useCallback, useRef, useState, type RefCallback } from 'react';
import { useLayoutEffect } from './react-compat';

/** Where an `<img>` is: waiting for its bytes, shown, or broken. */
export type ImageStatus = 'loading' | 'loaded' | 'error';

export interface ImageStatusState {
  /**
   * The status of `src`. Null until the element has been checked after mount (on the server and in the
   * first client render), so server and client markup match.
   */
  status: ImageStatus | null;
  /** Put on the `<img>`: an image already in the cache (or loaded before hydration) is seen at once. */
  ref: RefCallback<HTMLImageElement>;
  onLoad: () => void;
  onError: () => void;
}

/** The status of a finished `<img>`: drawn when it has pixels, else broken (an SVG without a size is decoded to tell). */
function settledStatus(img: HTMLImageElement): ImageStatus | Promise<ImageStatus> {
  if (img.naturalWidth > 0) return 'loaded';
  return typeof img.decode === 'function'
    ? img.decode().then(
        () => 'loaded' as const,
        () => 'error' as const,
      )
    : 'error';
}

/**
 * The load state of one image source, for a picture that fades in from a placeholder and falls back on
 * error. Changing `src` starts over at `loading`; an image the browser already has (the cache, or loaded
 * before hydration) reports `loaded` before the first paint, so it shows without a fade.
 *
 * ```tsx
 * const { status, ref, onLoad, onError } = useImageStatus(src);
 * <img ref={ref} src={src} onLoad={onLoad} onError={onError} data-status={status ?? undefined} />
 * ```
 */
export function useImageStatus(src: string | null | undefined): ImageStatusState {
  const node = useRef<HTMLImageElement | null>(null);
  const [state, setState] = useState<{ src: typeof src; status: ImageStatus | null }>({ src, status: null });
  const latest = useRef(src);
  latest.current = src;

  const set = useCallback((for_: typeof src, status: ImageStatus) => {
    // An answer for a source that is no longer wanted is dropped.
    if (latest.current === for_) setState((prev) => (prev.src === for_ && prev.status === status ? prev : { src: for_, status }));
  }, []);

  const check = useCallback(() => {
    const img = node.current;
    if (!src) {
      set(src, 'loading');
      return;
    }
    if (!img || !img.complete) {
      set(src, 'loading');
      return;
    }
    const result = settledStatus(img);
    if (typeof result === 'string') set(src, result);
    else {
      set(src, 'loading');
      void result.then((status) => set(src, status));
    }
  }, [src, set]);

  useLayoutEffect(check, [check]);

  const ref = useCallback((img: HTMLImageElement | null) => {
    node.current = img;
  }, []);
  const onLoad = useCallback(() => set(src, 'loaded'), [src, set]);
  const onError = useCallback(() => set(src, 'error'), [src, set]);

  // A new source is loading from its first render on, until the check above says otherwise.
  const status = state.src === src ? state.status : state.status === null ? null : 'loading';
  return { status, ref, onLoad, onError };
}
