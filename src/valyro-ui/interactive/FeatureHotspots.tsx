'use client';

import { useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { cx, mergeRefs, useControllableState } from '../primitives';
import { inertAttr, useId, withRef } from '../primitives/react-compat';
import { useFold } from '../primitives/useFold';
import { AlertCircleIcon, XIcon } from '../icons';
import { IconButton } from '../basic/IconButton';
import { Popover } from '../feedback/Popover';
import { BottomSheet } from '../feedback/BottomSheet';
import { useLabels } from '../agents/labels';
import { duplicateIds, useElementSize, warnOnce } from './shared';
import { useHeightGlide } from './glide';
import { placeHotspot, validShare, type HotspotFit, type HotspotSize } from './hotspots';
import './FeatureHotspots.css';

export type { HotspotFit } from './hotspots';

export interface Hotspot {
  /** Unique id: the active point is tracked by it. */
  id: string;
  /** Name of the detail: the marker's accessible name, the heading of its note and its row in the list. */
  label: string;
  /** Horizontal position as a share of the source image, 0…1. */
  x: number;
  /** Vertical position as a share of the source image, 0…1. */
  y: number;
  /** The note shown when the point is open. */
  content: ReactNode;
  /** Drawn in the marker instead of its number. */
  icon?: ReactNode;
}

export interface FeatureHotspotsImage {
  src: string;
  /** Text alternative of the whole picture. */
  alt: string;
  /** Intrinsic width in px; with `height`, reserves the space before the image loads. */
  width?: number;
  height?: number;
}

export interface FeatureHotspotsLabels {
  /** Name of the whole block. */
  region: string;
  /** Heading of the text list of details. */
  list: string;
  close: string;
  loading: string;
  error: string;
  /** Shown in the list next to a point the `cover` crop hides. */
  hidden: string;
  /** Accessible name of a marker. */
  marker: (index: number, label: string) => string;
}

const DEFAULT_LABELS: FeatureHotspotsLabels = {
  region: 'Image details',
  list: 'Details',
  close: 'Close',
  loading: 'Loading image',
  error: 'The image could not be loaded. Every detail is in the list below.',
  hidden: 'outside the visible area',
  marker: (index, label) => `${index}. ${label}`,
};

export interface FeatureHotspotsProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** The picture and its text alternative. */
  image: FeatureHotspotsImage;
  /** Points with notes, in reading order (the Tab order). Ids must be unique; a repeated id is skipped. */
  hotspots?: Hotspot[];
  /** How the image fills the area: `contain` (default) shows all of it, `cover` fills it and may crop points away. */
  fit?: HotspotFit;
  /** Proportions of the image area (`16 / 9`). Default: the image's own (`width / height`), else 16 / 9. */
  aspectRatio?: number | string;
  /** Id of the open point, or null. */
  activeId?: string | null;
  defaultActiveId?: string | null;
  onActiveIdChange?: (id: string | null) => void;
  /** Where the note opens on a narrow block (under 560 px): a bottom sheet or a panel under the image. Default `below`. */
  mobilePresentation?: 'sheet' | 'below';
  /** The text list of every detail under the image. Default true; it still shows when points are cropped away or the image fails. */
  showList?: boolean;
  /** Marker look: the point's number (default) or a small dot. A point's `icon` wins over both. */
  marker?: 'number' | 'dot';
  /** A slow pulse on the markers; never under reduced motion. Default false. */
  pulse?: boolean;
  labels?: Partial<FeatureHotspotsLabels>;
}

/** Below this width of the block, notes open under the image or in a bottom sheet instead of next to the point. */
const NARROW = 560;

/**
 * Numbered points over a picture: each opens a note about one detail. Points are shares of the source image, so they
 * stay on their detail at any width, with `contain` letterboxing or `cover` cropping (cropped points stay in the
 * list). Every point is also a row of the text list under the image, and the note returns focus where it was opened.
 */
export const FeatureHotspots = withRef(function FeatureHotspots({
  image,
  hotspots = [],
  fit = 'contain',
  aspectRatio,
  activeId: activeIdProp,
  defaultActiveId = null,
  onActiveIdChange,
  mobilePresentation = 'below',
  showList = true,
  marker = 'number',
  pulse = false,
  labels,
  className,
  style,
  ref,
  ...rest
}: FeatureHotspotsProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [activeId, setActiveId] = useControllableState<string | null>({ value: activeIdProp, defaultValue: defaultActiveId, onChange: onActiveIdChange });
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [natural, setNatural] = useState<HotspotSize | null>(image.width && image.height ? { width: image.width, height: image.height } : null);
  const rootSize = useElementSize(rootRef);
  const box = useElementSize(stageRef);
  const narrow = !!rootSize && rootSize.width < NARROW;
  /** After the first commit: from then on the note unfolds and the image fades in; a server render just shows. */
  const ready = useRef(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    ready.current = true;
    setMounted(true);
  }, []);

  // Repeated ids and coordinates outside 0…1 are data errors: skipped (not clamped), reported once.
  const points = useMemo(() => {
    const seen = new Set<string>();
    return hotspots.flatMap((spot, index) => {
      if (seen.has(spot.id)) return [];
      seen.add(spot.id);
      return [{ spot, index: index + 1, valid: validShare(spot.x) && validShare(spot.y) }];
    });
  }, [hotspots]);
  useEffect(() => {
    const repeated = duplicateIds(hotspots.map((spot) => spot.id));
    if (repeated.length) warnOnce('FeatureHotspots', `repeated hotspot ids are skipped: ${repeated.join(', ')}`);
    const invalid = hotspots.filter((spot) => !(validShare(spot.x) && validShare(spot.y))).map((spot) => spot.id);
    if (invalid.length) warnOnce('FeatureHotspots', `hotspots outside 0…1 have no marker: ${invalid.join(', ')}`);
  }, [hotspots]);

  useEffect(() => {
    setNatural(image.width && image.height ? { width: image.width, height: image.height } : null);
    // A server-rendered image may finish before hydration, without a load event React sees.
    const img = imageRef.current;
    if (img?.complete) setStatus(img.naturalWidth ? 'ready' : 'error');
    else setStatus('loading');
  }, [image.src, image.width, image.height]);

  const imageSize = natural ?? { width: 16, height: 9 };
  const ratio = aspectRatio ?? `${imageSize.width} / ${imageSize.height}`;
  const placed = points.map((point) => ({
    ...point,
    place: point.valid && status !== 'error' ? placeHotspot(imageSize, box, fit, point.spot.x, point.spot.y) : null,
  }));
  const active = placed.find((point) => point.spot.id === activeId) ?? null;
  const markerShown = (point: (typeof placed)[number]) => !!point.place?.visible;
  const listForced = status === 'error' || placed.some((point) => !markerShown(point));
  const listShown = (showList || listForced) && placed.length > 0;
  // The note opens next to its marker; under the image when the block is narrow or the point has no marker.
  const inline = !!active && (!markerShown(active) || (narrow && mobilePresentation === 'below'));
  const sheet = !!active && markerShown(active) && narrow && mobilePresentation === 'sheet';
  // The note under the image folds open and closed; while it folds away it keeps showing the last point.
  // On the smooth spring: it unfolds from rest, without a hard start.
  const fold = useFold<HTMLDivElement>(inline, ready, true);
  const lastInline = useRef<typeof active>(null);
  if (inline && active) lastInline.current = active;
  const shownNote = inline && active ? active : lastInline.current;
  // Another point's note in the open panel: the panel's height glides to the new note.
  const glideRef = useHeightGlide<HTMLDivElement>(shownNote?.spot.id);

  const open = (id: string, opener?: HTMLElement) => {
    openerRef.current = opener ?? null;
    setActiveId(id);
  };
  const close = () => {
    const opener = openerRef.current;
    setActiveId(null);
    // Back to the button that opened the note (a list row, or a marker when the note was not a popover).
    if (opener) requestAnimationFrame(() => opener.isConnected && opener.focus({ preventScroll: true }));
  };
  const toggle = (id: string) => (event: MouseEvent<HTMLElement>) => (activeId === id ? close() : open(id, event.currentTarget));

  const note = (point: (typeof placed)[number], headingId: string) => (
    <>
      <div className="ui-hotspots__note-head">
        <span className="ui-hotspots__note-index" aria-hidden="true">
          {point.index}
        </span>
        <h3 className="ui-hotspots__note-title" id={headingId}>
          {point.spot.label}
        </h3>
        <IconButton className="ui-hotspots__close" variant="ghost" size="sm" icon={<XIcon />} label={copy.close} onClick={close} />
      </div>
      <div className="ui-hotspots__note-body">{point.spot.content}</div>
    </>
  );

  return (
    <div
      ref={mergeRefs(ref, rootRef)}
      role="group"
      aria-label={copy.region}
      className={cx('ui-hotspots', className)}
      data-fit={fit}
      data-narrow={narrow || undefined}
      data-pulse={pulse || undefined}
      data-mounted={mounted || undefined}
      style={style}
      {...rest}
    >
      <div ref={stageRef} className="ui-hotspots__stage" style={{ aspectRatio: ratio } as CSSProperties} data-status={status}>
        {status !== 'error' && (
          <img
            ref={imageRef}
            className="ui-hotspots__image"
            src={image.src}
            alt={image.alt}
            width={image.width}
            height={image.height}
            onLoad={(event) => {
              const img = event.currentTarget;
              if (!(image.width && image.height) && img.naturalWidth && img.naturalHeight) setNatural({ width: img.naturalWidth, height: img.naturalHeight });
              setStatus('ready');
            }}
            onError={() => setStatus('error')}
          />
        )}
        {status === 'loading' && <span className="ui-sr-only">{copy.loading}</span>}
        {status === 'error' && (
          <div className="ui-hotspots__error" role="alert">
            <AlertCircleIcon aria-hidden="true" />
            <span>{copy.error}</span>
          </div>
        )}
        {placed.map((point) => {
          if (!point.place?.visible) return null;
          const isActive = point.spot.id === activeId;
          const markerProps = {
            type: 'button' as const,
            className: 'ui-hotspots__marker',
            'aria-label': copy.marker(point.index, point.spot.label),
            'data-active': isActive || undefined,
            'data-kind': point.spot.icon ? 'icon' : marker,
            // Image coordinates are physical: a picture is not mirrored in right-to-left pages.
            style: { left: `${point.place.left}%`, top: `${point.place.top}%` },
            children: (
              <span className="ui-hotspots__marker-face" aria-hidden="true">
                {point.spot.icon ?? (marker === 'number' ? point.index : null)}
              </span>
            ),
          };
          // A popover next to the point on a wide block; elsewhere the marker toggles the note below or in a sheet.
          if (narrow) {
            return (
              <button
                key={point.spot.id}
                {...markerProps}
                aria-expanded={isActive}
                aria-controls={isActive && inline ? `${uid}-note` : undefined}
                onClick={toggle(point.spot.id)}
              />
            );
          }
          return (
            <Popover
              key={point.spot.id}
              trigger={<button {...markerProps} />}
              open={isActive && !inline}
              onOpenChange={(next) => (next ? open(point.spot.id) : activeId === point.spot.id && close())}
              placement="right"
              className="ui-hotspots__popover"
              aria-labelledby={`${uid}-pop-${point.spot.id}`}
            >
              {note(point, `${uid}-pop-${point.spot.id}`)}
            </Popover>
          );
        })}
      </div>

      {fold.isMounted && shownNote && (
        <div className="ui-hotspots__fold-slot">
          {/* A block slot: a fold that is itself a flex item does not animate its height in Chromium. */}
          <div ref={fold.ref} className="ui-hotspots__fold" data-state={fold.state} data-ui-fold={fold.cssFold} inert={inertAttr(fold.state === 'closed')}>
            <div ref={glideRef} className="ui-hotspots__note" id={`${uid}-note`} role="region" aria-labelledby={`${uid}-note-title`}>
              <div key={shownNote.spot.id} className="ui-hotspots__note-swap">
                {note(shownNote, `${uid}-note-title`)}
              </div>
            </div>
          </div>
        </div>
      )}
      {narrow && mobilePresentation === 'sheet' && (
        <BottomSheet open={sheet} onOpenChange={(next) => !next && close()} title={active?.spot.label}>
          {active && <div className="ui-hotspots__note-body">{active.spot.content}</div>}
        </BottomSheet>
      )}

      {listShown && (
        <div className="ui-hotspots__list-wrap">
          <h3 className="ui-hotspots__list-title" id={`${uid}-list`}>
            {copy.list}
          </h3>
          <ol className="ui-hotspots__list" aria-labelledby={`${uid}-list`}>
            {placed.map((point) => (
              <li key={point.spot.id} className="ui-hotspots__item">
                <button
                  type="button"
                  className="ui-hotspots__item-button"
                  aria-expanded={point.spot.id === activeId}
                  data-active={point.spot.id === activeId || undefined}
                  onClick={toggle(point.spot.id)}
                >
                  <span className="ui-hotspots__item-index" aria-hidden="true">
                    {point.index}
                  </span>
                  <span className="ui-hotspots__item-label">{point.spot.label}</span>
                  {!markerShown(point) && <span className="ui-hotspots__item-note">{copy.hidden}</span>}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
});
