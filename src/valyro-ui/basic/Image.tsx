'use client';

import { useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import { ImageIcon } from '../icons';
import { cx, mergeRefs } from '../primitives';
import { themeSlowMs } from '../primitives/spring';
import { useImageStatus, type ImageStatus } from '../primitives/useImageStatus';
import './Image.css';
import { fetchPriorityAttr, useLayoutEffect, withRef } from '../primitives/react-compat';

export interface ImageLabels {
  /** Accessible name of the fallback when the picture fails and `alt` is empty. */
  error: string;
}

export const defaultImageLabels: ImageLabels = {
  error: 'Image failed to load',
};

export interface ImageProps extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'placeholder' | 'onLoad' | 'onError'> {
  /** The picture. An empty string keeps the placeholder up (the address is still on its way). */
  src: string;
  /** Text alternative; `""` marks a decorative picture. */
  alt: string;
  /** Source for dark mode: follows the colour scheme of the nearest ThemeProvider / ThemeScope, cross-fading on a switch. */
  srcDark?: string;
  /** Responsive candidates for `src` (not for `srcDark`). */
  srcSet?: string;
  /** Layout widths for `srcSet`. */
  sizes?: string;
  /** Intrinsic width in px: with `height`, reserves the box before the picture arrives. */
  width?: number;
  /** Intrinsic height in px. */
  height?: number;
  /** Reserves the box before load so nothing below moves, e.g. `"16/9"` or `1.5`. */
  aspectRatio?: number | string;
  /** How the picture fills the reserved box (`object-fit`). */
  fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  /** What shows while loading: a moving sheen, a plain fill, a blurred preview (`blurDataURL`), nothing, or your node. */
  placeholder?: 'shimmer' | 'color' | 'blur' | 'none' | ReactNode;
  /** A tiny data URL shown blurred while the picture loads (`placeholder="blur"`). */
  blurDataURL?: string;
  /** Shown when the picture fails: a string is tried once as another source; a node is shown as is. Default: an image icon. */
  fallback?: ReactNode | string;
  /** Above the fold: loads eagerly at high priority and appears without a fade. */
  priority?: boolean;
  /** Native lazy loading (default `lazy`, `eager` with `priority`). */
  loading?: 'lazy' | 'eager';
  /** CORS mode of the request. */
  crossOrigin?: 'anonymous' | 'use-credentials' | '';
  /** Referrer sent with the request. */
  referrerPolicy?: ComponentPropsWithRef<'img'>['referrerPolicy'];
  /** Ref to the `<img>` element on screen (`ref` is the wrapper's). */
  imgRef?: Ref<HTMLImageElement>;
  /** Called when the picture starts loading, appears or fails. */
  onStatusChange?: (status: ImageStatus) => void;
  labels?: Partial<ImageLabels>;
}

/** Whether the element's computed colour scheme is dark (the theme files set `color-scheme` per mode). */
const isDarkScheme = (element: Element) => /dark/.test(getComputedStyle(element).colorScheme);

/**
 * A picture that reserves its box, shows a placeholder, fades in when it arrives (at once when cached) and
 * falls back on error. A new `src` (or a mode switch with `srcDark`) keeps the old picture until the new one
 * is ready and cross-fades. Rest props, `className`, `style` and `ref` go to the wrapper `ui-image`.
 */
export const Image = withRef(function Image({
  src,
  alt,
  srcDark,
  srcSet,
  sizes,
  width,
  height,
  aspectRatio,
  fit = 'cover',
  placeholder = 'shimmer',
  blurDataURL,
  fallback,
  priority = false,
  loading,
  crossOrigin,
  referrerPolicy,
  imgRef,
  onStatusChange,
  labels: labelsProp,
  className,
  style,
  ref,
  ...rest
}: ImageProps) {
  const labels = { ...defaultImageLabels, ...labelsProp };
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The colour scheme, read from the computed style (no mode names); unknown until mounted.
  const [dark, setDark] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!srcDark || !element) return;
    const read = () => setDark(isDarkScheme(element));
    read();
    // ThemeProvider writes the <html> attributes in its own layout effect, after this one on first mount.
    const frame = requestAnimationFrame(read);
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(read);
    for (let node: Element | null = element; node; node = node.parentElement) {
      observer?.observe(node, { attributes: true, attributeFilter: ['data-mode', 'data-theme', 'class'] });
    }
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', read);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      media?.removeEventListener?.('change', read);
    };
  }, [srcDark]);

  const wanted = srcDark && dark ? srcDark : src;
  // With srcDark the scheme decides the source, so nothing loads before it is known: no light picture
  // flashes in a dark page.
  const pending = !!srcDark && dark === null;
  const fallbackSrc = typeof fallback === 'string' && fallback ? fallback : undefined;
  const [failed, setFailed] = useState<readonly string[]>([]);
  const current: string | null = pending || !wanted
    ? ''
    : !failed.includes(wanted)
      ? wanted
      : fallbackSrc && !failed.includes(fallbackSrc)
        ? fallbackSrc
        : null;

  const image = useImageStatus(current || undefined);
  useEffect(() => {
    if (image.status === 'error' && current) setFailed((list) => (list.includes(current) ? list : [...list, current]));
  }, [image.status, current]);
  const retrying = image.status === 'error' && !!current && !!fallbackSrc && current !== fallbackSrc && !failed.includes(fallbackSrc);
  const status: ImageStatus | null =
    current === null ? 'error' : current === '' ? 'loading' : retrying ? 'loading' : image.status;

  const reported = useRef<ImageStatus | null>(null);
  useEffect(() => {
    if (status === null || status === reported.current) return;
    reported.current = status;
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  // The picture that was on screen stays under a new one until that has faded in, then goes; when the new
  // source is empty or fails, it fades out over the placeholder or the fallback instead of vanishing.
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    let next: string | null | undefined;
    if (status === 'loaded' && current && settled !== current) next = current;
    else if (settled !== null && settled !== current && (current === '' || status === 'error')) next = null;
    if (next === undefined) return;
    if (settled === null) {
      setSettled(next);
      return;
    }
    const element = rootRef.current;
    const wait = element ? Math.max(themeSlowMs(element), 160) + 60 : 0;
    const timer = setTimeout(() => setSettled(next), wait);
    return () => clearTimeout(timer);
  }, [status, current, settled]);

  // A source first shown after the first paint fades in even when the browser has it already (a swap, a
  // mode switch); the pictures of the first paint (the cache, server markup) appear at once.
  const painted = useRef(false);
  useEffect(() => {
    painted.current = true;
  }, []);
  const shown = useRef<{ src: string; enter: boolean } | null>(null);
  if (!current) shown.current = null;
  else if (shown.current?.src !== current) shown.current = { src: current, enter: painted.current };
  const enter = !!current && shown.current?.src === current && shown.current.enter;

  // Once the picture is in, fetch the other mode's source while idle, so a switch cross-fades straight away.
  const other = srcDark ? (current === srcDark ? src : current === src ? srcDark : null) : null;
  useEffect(() => {
    if (status !== 'loaded' || !other || typeof window === 'undefined') return;
    const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 400));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => {
      const probe = new window.Image();
      probe.decoding = 'async';
      probe.src = other;
    });
    return () => cancel(handle as number);
  }, [status, other]);

  const ratio = aspectRatio ?? (width && height ? `${width} / ${height}` : undefined);
  const sized = ratio !== undefined;
  const rootStyle: CSSProperties = {
    ...(ratio !== undefined ? { aspectRatio: typeof ratio === 'number' ? String(ratio) : ratio.replace(/\s*\/\s*/, ' / ') } : null),
    ...(width ? { width } : null),
    ...style,
  };

  const kind =
    placeholder === 'shimmer' || placeholder === 'color' || placeholder === 'none'
      ? placeholder
      : placeholder === 'blur'
        ? blurDataURL
          ? 'blur'
          : 'shimmer'
        : 'custom';
  const previous = settled && settled !== current ? settled : null;
  const leaving = previous !== null && (current === '' || status === 'error');
  const lazy = loading ?? (priority ? 'eager' : 'lazy');

  return (
    <div
      {...rest}
      ref={mergeRefs(rootRef, ref)}
      className={cx('ui-image', className)}
      style={rootStyle}
      data-status={status ?? undefined}
      data-fit={fit}
      data-sized={sized || undefined}
      data-placeholder={kind}
      data-priority={priority || undefined}
    >
      {kind !== 'none' && (
        <span
          className="ui-image__placeholder"
          aria-hidden="true"
          style={kind === 'blur' ? ({ '--_blur-src': `url("${blurDataURL}")` } as CSSProperties) : undefined}
        >
          {kind === 'custom' ? placeholder : null}
        </span>
      )}
      {/* One keyed list, so the picture on screen keeps its element when it becomes the one underneath. */}
      {[
        previous && (
          <img
            key={previous}
            className="ui-image__img"
            data-layer="previous"
            data-leaving={leaving || undefined}
            src={previous}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        ),
        current && status !== 'error' && (
          <img
            key={current}
            ref={mergeRefs(image.ref, imgRef)}
            className="ui-image__img"
            data-status={image.status ?? undefined}
            data-enter={enter || undefined}
            src={current}
            srcSet={current === src ? srcSet : undefined}
            sizes={current === src ? sizes : undefined}
            alt={alt}
            width={width}
            height={height}
            loading={lazy}
            decoding="async"
            crossOrigin={crossOrigin}
            referrerPolicy={referrerPolicy}
            {...fetchPriorityAttr(priority ? 'high' : undefined)}
            onLoad={image.onLoad}
            onError={image.onError}
          />
        ),
      ]}
      {status === 'error' && (
        <span className="ui-image__fallback" role="img" aria-label={alt || labels.error}>
          {fallback !== undefined && typeof fallback !== 'string' ? fallback : <ImageIcon aria-hidden="true" />}
        </span>
      )}
    </div>
  );
});
