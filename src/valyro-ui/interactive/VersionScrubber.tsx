'use client';

import { useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';
import { cx, useControllableState } from '../primitives';
import { useId, withRef } from '../primitives/react-compat';
import { AlertCircleIcon, ChevronLeftIcon, ChevronRightIcon, RefreshIcon, RotateCcwIcon } from '../icons';
import { Button } from '../basic/Button';
import { IconButton } from '../basic/IconButton';
import { Spinner } from '../basic/Spinner';
import { Slider } from '../forms/Slider';
import { useLabels } from '../agents/labels';
import { neighbourIndexes, resolveVersion, tickIndexes } from './versions';
import { useMotionReduced } from '../motion-kit/preference';
import { SoftHeight } from './soft-height';
import './VersionScrubber.css';

export interface VersionSnapshot {
  /** Stable id: the selection follows it through reorders. */
  id: string;
  title: string;
  /** What changed in this version. */
  description?: ReactNode;
  /** Shown next to the title; the order comes from the array, not from dates. */
  date?: string;
  /** Small image for the thumbnail row. */
  thumbnail?: string;
  /** The version's image; or draw it with `renderSnapshot`. */
  src?: string;
  /** Text alternative of the image. Default: the title. */
  alt?: string;
}

export interface VersionScrubberLabels {
  region: string;
  slider: string;
  /** aria-valuetext of the slider: `Version 2 of 5: Wireframe`. */
  position: (index: number, total: number, title: string) => string;
  previous: string;
  next: string;
  first: string;
  loading: string;
  error: string;
  retry: string;
  empty: string;
  invalid: string;
  versions: string;
}

const DEFAULT_LABELS: VersionScrubberLabels = {
  region: 'Versions',
  slider: 'Version',
  position: (index, total, title) => `Version ${index} of ${total}: ${title}`,
  previous: 'Previous version',
  next: 'Next version',
  first: 'Back to the start',
  loading: 'Loading this version',
  error: 'This version could not be loaded.',
  retry: 'Retry',
  empty: 'No versions yet.',
  invalid: 'The selected version is not in the list.',
  versions: 'All versions',
};

export interface VersionScrubberProps extends Omit<ComponentPropsWithRef<'section'>, 'children' | 'defaultValue'> {
  /** Prepared snapshots, in order. */
  snapshots: VersionSnapshot[];
  /** Id of the shown snapshot. A controlled id missing from `snapshots` shows an error until a valid one comes. */
  value?: string;
  /** Initial snapshot when uncontrolled. Default: the first. If it disappears, the first remaining one is shown. */
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  /** Called when a choice is settled: the slider released, a key, a button or a thumbnail. Not on every pixel. */
  onValueCommit?: (id: string) => void;
  /** Draws a snapshot instead of its image; it handles its own loading and errors. */
  renderSnapshot?: (snapshot: VersionSnapshot) => ReactNode;
  /** Width / height of the viewer, reserved before images load. Default 16 / 9. */
  aspectRatio?: number;
  /** A thumbnail row when there are at most 8 snapshots. Default true. */
  showThumbnails?: boolean;
  labels?: Partial<VersionScrubberLabels>;
}

const THUMBNAIL_LIMIT = 8;
type LoadState = 'loading' | 'loaded' | 'error';

/** How long a new version takes to fade in over the previous one, ms (VersionScrubber.css). */
const FADE_MS = 420;

/**
 * One slider through prepared versions of a design, an illustration or a product: the image of each step, its title,
 * date and what changed. Selection is by id; images fit the reserved area without jumps, only the neighbours preload,
 * and a late load of a previous image never replaces the current one.
 */
export const VersionScrubber = withRef(function VersionScrubber({
  snapshots,
  value: valueProp,
  defaultValue,
  onValueChange,
  onValueCommit,
  renderSnapshot,
  aspectRatio = 16 / 9,
  showThumbnails = true,
  labels,
  className,
  style,
  ref,
  ...rest
}: VersionScrubberProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const ids = snapshots.map((snapshot) => snapshot.id);
  const [raw, setRaw] = useControllableState<string | undefined>({ value: valueProp, defaultValue: defaultValue ?? ids[0], onChange: onValueChange as (id: string | undefined) => void });
  const { index, invalid } = resolveVersion(ids, raw, valueProp !== undefined);
  const current = index >= 0 ? snapshots[index] : undefined;
  const count = snapshots.length;
  // Load state per image URL (and retry round): an answer for another image never changes the current one.
  const [loads, setLoads] = useState<Record<string, LoadState>>({});
  const [round, setRound] = useState<Record<string, number>>({});
  const committed = useRef<string | undefined>(current?.id);
  // The last image that finished fading in: it stays under a new one until that one is fully shown, so the
  // background never flashes between versions.
  const [under, setUnder] = useState<{ key: string; src: string; alt: string } | null>(null);
  // The same for custom content (renderSnapshot): the id of the version drawn underneath.
  const [underId, setUnderId] = useState<string | undefined>(current?.id);
  const viewerRef = useRef<HTMLDivElement>(null);
  const reduced = useMotionReduced(viewerRef);
  const pendingCommit = useRef(false);

  const select = (next: number, commit: boolean) => {
    const target = snapshots[Math.max(0, Math.min(count - 1, next))];
    if (!target) return;
    setRaw(target.id);
    if (commit) doCommit(target.id);
    else pendingCommit.current = true;
  };
  const doCommit = (id: string) => {
    pendingCommit.current = false;
    if (committed.current === id) return;
    committed.current = id;
    onValueCommit?.(id);
  };
  const settle = () => {
    if (pendingCommit.current && current) doCommit(current.id);
  };

  // Preload the neighbours only: the previous and the next image.
  useEffect(() => {
    if (renderSnapshot || typeof Image === 'undefined') return;
    for (const i of neighbourIndexes(index, count)) {
      const src = snapshots[i]?.src;
      if (src && i !== index) new Image().src = src;
    }
  }, [index, count, snapshots, renderSnapshot]);

  const keyOf = (src: string) => `${src}#${round[src] ?? 0}`;
  const status: LoadState | undefined = current?.src && !renderSnapshot ? (loads[keyOf(current.src)] ?? 'loading') : undefined;
  const mark = (key: string, state: LoadState) => setLoads((prev) => (prev[key] === state ? prev : { ...prev, [key]: state }));
  const currentKey = current?.src ? keyOf(current.src) : undefined;

  useEffect(() => {
    if (!renderSnapshot || !current || underId === current.id) return;
    if (reduced) {
      setUnderId(current.id);
      return;
    }
    const timer = setTimeout(() => setUnderId(current.id), FADE_MS + 40);
    return () => clearTimeout(timer);
  }, [current?.id, reduced, !!renderSnapshot]);

  // Once the current image is loaded and has faded in, it becomes the one under the next.
  useEffect(() => {
    if (!current?.src || !currentKey || status !== 'loaded' || under?.key === currentKey) return;
    const next = { key: currentKey, src: current.src, alt: current.alt ?? current.title };
    if (reduced) {
      setUnder(next);
      return;
    }
    const timer = setTimeout(() => setUnder(next), FADE_MS + 40);
    return () => clearTimeout(timer);
  }, [currentKey, status, reduced]);

  let viewer: ReactNode;
  if (count === 0) viewer = <p className="ui-version-scrubber__state">{copy.empty}</p>;
  else if (invalid || !current) {
    viewer = (
      <p className="ui-version-scrubber__state" role="alert" data-state="invalid">
        <AlertCircleIcon aria-hidden="true" />
        {copy.invalid}
      </p>
    );
  } else if (renderSnapshot) {
    const below = underId && underId !== current.id ? snapshots.find((snapshot) => snapshot.id === underId) : undefined;
    viewer = (
      <>
        {below && (
          <div className="ui-version-scrubber__custom" key={`under-${below.id}`} data-under="" aria-hidden="true">
            {renderSnapshot(below)}
          </div>
        )}
        <div className="ui-version-scrubber__custom" key={current.id}>
          {renderSnapshot(current)}
        </div>
      </>
    );
  }
  else if (current.src) {
    const src = current.src;
    const key = keyOf(src);
    viewer = (
      <>
        {/* Not under an error: the old image must not pass for the version that failed. */}
        {under && under.key !== key && status !== 'error' && (
          <img key={`under-${under.key}`} className="ui-version-scrubber__image" data-under="" src={under.src} alt="" aria-hidden="true" />
        )}
        {status !== 'error' && (
          <img
            key={key}
            className="ui-version-scrubber__image"
            src={src}
            decoding="async"
            alt={current.alt ?? current.title}
            data-loaded={status === 'loaded' || undefined}
            onLoad={() => mark(key, 'loaded')}
            onError={() => mark(key, 'error')}
            ref={(img) => {
              // Cached images can finish before React attaches the handlers.
              if (img?.complete && img.naturalWidth && loads[key] !== 'loaded') mark(key, 'loaded');
            }}
          />
        )}
        {status === 'loading' && (
          <span className="ui-version-scrubber__loading">
            <Spinner size={16} label={null} />
            <span>{copy.loading}</span>
          </span>
        )}
        {status === 'error' && (
          <div className="ui-version-scrubber__state" role="alert" data-state="error">
            <AlertCircleIcon aria-hidden="true" />
            <span>{copy.error}</span>
            <Button size="sm" variant="secondary" leftIcon={<RefreshIcon />} onClick={() => setRound((prev) => ({ ...prev, [src]: (prev[src] ?? 0) + 1 }))}>
              {copy.retry}
            </Button>
          </div>
        )}
      </>
    );
  } else viewer = null;

  const thumbnails = showThumbnails && count > 1 && count <= THUMBNAIL_LIMIT;
  const ticks = tickIndexes(count);

  return (
    <section
      ref={ref}
      className={cx('ui-version-scrubber', className)}
      aria-label={copy.region}
      data-status={count === 0 ? 'empty' : invalid ? 'invalid' : status}
      style={{ ...style, '--_ratio': String(aspectRatio > 0 ? aspectRatio : 16 / 9) } as CSSProperties}
      {...rest}
    >
      <div ref={viewerRef} className="ui-version-scrubber__viewer">
        {viewer}
      </div>

      {current && (
        // The caption's height follows the text of each step softly; the new text fades in.
        <SoftHeight>
          <div className="ui-version-scrubber__caption" id={`${uid}-caption`}>
            <span className="ui-version-scrubber__step">
              {index + 1} / {count}
            </span>
            <span key={current.id} className="ui-version-scrubber__text">
              <span className="ui-version-scrubber__title">{current.title}</span>
              {current.date && <span className="ui-version-scrubber__date">{current.date}</span>}
              {current.description != null && <span className="ui-version-scrubber__description">{current.description}</span>}
            </span>
          </div>
        </SoftHeight>
      )}

      {count > 1 && (
        <div className="ui-version-scrubber__controls">
          <IconButton className="ui-version-scrubber__nav" variant="secondary" size="sm" icon={<ChevronLeftIcon />} label={copy.previous} disabled={index <= 0} onClick={() => select(index - 1, true)} />
          <div className="ui-version-scrubber__track" onPointerUp={settle} onPointerCancel={settle} onKeyUp={settle} onBlur={settle}>
            <Slider
              aria-label={copy.slider}
              aria-describedby={current ? `${uid}-caption` : undefined}
              min={0}
              max={count - 1}
              step={1}
              value={Math.max(0, index)}
              onValueChange={(next) => select(next, false)}
              formatValue={(i) => copy.position(i + 1, count, snapshots[i]?.title ?? '')}
              marks={ticks.map((i) => ({ value: i }))}
            />
          </div>
          <IconButton className="ui-version-scrubber__nav" variant="secondary" size="sm" icon={<ChevronRightIcon />} label={copy.next} disabled={index >= count - 1} onClick={() => select(index + 1, true)} />
          <Button variant="ghost" size="sm" leftIcon={<RotateCcwIcon />} disabled={index === 0} onClick={() => select(0, true)}>
            {copy.first}
          </Button>
        </div>
      )}

      {thumbnails && (
        <ol className="ui-version-scrubber__thumbs" aria-label={copy.versions}>
          {snapshots.map((snapshot, i) => (
            <li key={snapshot.id}>
              <button
                type="button"
                className="ui-version-scrubber__thumb"
                aria-current={i === index ? 'step' : undefined}
                aria-label={copy.position(i + 1, count, snapshot.title)}
                onClick={() => select(i, true)}
              >
                {snapshot.thumbnail ? <img src={snapshot.thumbnail} alt="" loading="lazy" /> : <span aria-hidden="true">{i + 1}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
});
