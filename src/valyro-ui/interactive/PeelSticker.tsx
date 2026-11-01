'use client';

import { useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { createVelocityTracker, cx, getDirection, mergeRefs, useControllableState, useLatest } from '../primitives';
import { inertAttr, useId, useLayoutEffect, withRef } from '../primitives/react-compat';
import { Button } from '../basic/Button';
import { useLabels } from '../agents/labels';
import { useMotionReduced } from '../motion-kit/preference';
import { CALM_SPRING, createSpringDrive, RETURN_SPRING } from './spring-drive';
import { dragTip, peelAmount, peeledOffTip, peelOpens, peelShapeAt, physicalCorner as physicalCornerOf, tipAt, type PeelCorner, type Point } from './peel';
import './PeelSticker.css';

export type { PeelCorner } from './peel';
export type PeelStickerReason = 'gesture' | 'button';

export interface PeelStickerLabels {
  /** Name of the whole sticker. */
  region: string;
  open: string;
  close: string;
}

const DEFAULT_LABELS: PeelStickerLabels = {
  region: 'Sticker',
  open: 'Open',
  close: 'Close',
};

export interface PeelStickerProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** The face of the sticker: what lies on top while it is closed. */
  cover: ReactNode;
  /** What the sticker reveals. It cannot be focused while the sticker is closed. */
  children?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  /**
   * A request to open or close, once per button press or finished gesture (`reason`), when it is decided, without
   * waiting for the animation. Not a confirmation of anything on a server.
   */
  onOpenChange?: (open: boolean, reason: PeelStickerReason) => void;
  /** The lifted corner, on the logical sides (mirrored in right-to-left pages). Default `bottom-end`. */
  corner?: PeelCorner;
  /** Share of the diagonal the corner must be peeled before release opens the sticker (a quick flick needs less). Default 0.55. */
  threshold?: number;
  /** Show a Close action once open. Default true. */
  reclosable?: boolean;
  /** Material of the sticker: `paper` (default), `gloss` or `foil`. Same mechanics, different surface. */
  material?: 'paper' | 'gloss' | 'foil';
  /** Neither the gesture nor the button work. */
  disabled?: boolean;
  labels?: Partial<PeelStickerLabels>;
}

/** The corner lifted at rest, and a little more on hover or focus (shares of the diagonal). */
const REST = 0.07;
const PREVIEW = 0.15;
/** A drag shorter than this (px) is a press, not a peel. */
const SLOP = 4;
/**
 * Peeling off and laying back down: the fold crosses the whole sticker, so the spring is soft and critically damped —
 * it eases in, sweeps at a readable pace and settles without a wobble.
 */
const PEEL_SPRING = { stiffness: 36, damping: 12 };
/** The hover preview: a gentle lift. */
const PREVIEW_SPRING = { stiffness: 220, damping: 24 };
/** While dragged the tip catches up with the finger in a few frames, critically damped: no lag to speak of, no jolt. */
const FOLLOW_SPRING = { stiffness: 1600, damping: 80 };

interface Drag {
  id: number;
  start: Point;
  base: Point;
  width: number;
  height: number;
  rtl: boolean;
  tip: Point;
  moved: boolean;
}

/**
 * A sticker over a small area: drag its lifted corner to peel it back, see its reverse side, and release past the
 * threshold to uncover what is under it. The corner stays under the finger in any direction, springs back when let go
 * too early and peels off on its own once released past the threshold. A regular Open button does the same from the
 * keyboard. The fold is CSS clip-path geometry relative to the sticker's size; there is no graphics engine.
 */
export const PeelSticker = withRef(function PeelSticker({
  cover,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  corner = 'bottom-end',
  threshold = 0.55,
  reclosable = true,
  material = 'paper',
  disabled = false,
  labels,
  className,
  style,
  ref,
  onClickCapture,
  ...rest
}: PeelStickerProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const liftRef = useRef<HTMLDivElement>(null);
  const flapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const reduced = useMotionReduced(rootRef);
  const reasonRef = useRef<PeelStickerReason>('button');
  const [open, setOpen] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: (next: boolean) => onOpenChange?.(next, reasonRef.current),
  });
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(false);
  const drag = useRef<Drag | null>(null);
  const trackers = useMemo(() => ({ x: createVelocityTracker(), y: createVelocityTracker() }), []);
  const releaseVelocity = useRef<[number, number]>([0, 0]);
  const suppressClick = useRef(false);
  const focusContent = useRef(false);
  const mounted = useRef(false);
  const openRef = useLatest(open);
  const geometry = useLatest({ corner, rtl: false, aspect: 1 });

  // The first pose, rendered on the server and kept on every render, so React never fights the frames written below.
  const firstTip = useRef(open ? peeledOffTip(tipAt(0.5)) : tipAt(REST)).current;
  const firstShape = useMemo(() => peelShapeAt(firstTip, corner, false), [firstTip, corner]);

  // Each frame: the cover's flat part, the flap and the shadow, written to the DOM.
  const drive = useMemo(
    () =>
      createSpringDrive(
        [firstTip.x, firstTip.y],
        ([x, y]) => {
          const { corner: lifted, rtl, aspect } = geometry.current;
          const shape = peelShapeAt({ x, y }, lifted, rtl, aspect);
          if (coverRef.current) coverRef.current.style.clipPath = shape.cover;
          const flap = flapRef.current;
          if (flap) {
            flap.style.clipPath = shape.flap;
            flap.style.setProperty('--_angle', `${shape.angle}deg`);
          }
          // The flap and its shadow fade as the last of it slides off the sticker.
          liftRef.current?.style.setProperty('--_peel', String(Math.min(1, shape.amount)));
          liftRef.current?.style.setProperty('--_fade', String(Math.max(0, Math.min(1, (2 - shape.amount) / 0.6))));
        },
        0.0005,
      ),
    // The drive lives as long as the component; its starting pose only matters on the first render.
    [geometry],
  );

  // The fold is computed in the sticker's real proportions.
  const measure = () => {
    const surface = surfaceRef.current;
    geometry.current.rtl = getDirection(rootRef.current) === 'rtl';
    if (surface?.offsetWidth) geometry.current.aspect = surface.offsetHeight / surface.offsetWidth;
  };
  useLayoutEffect(measure);
  useEffect(() => {
    mounted.current = true;
    // The first frame in the page's real direction (the server assumed left to right).
    drive.set(drive.value);
    return () => drive.stop();
  }, [drive]);

  // Reduced motion: no peel; the cover fades out or back in where it lies.
  const fadeCover = (show: boolean) => {
    const layers = [coverRef.current, liftRef.current].filter((el): el is HTMLDivElement => !!el);
    const set = (transition: string, opacity: string) =>
      layers.forEach((el) => {
        el.style.transition = transition;
        el.style.opacity = opacity;
      });
    if (show) {
      // Back to the resting corner while invisible, then fade in.
      set('none', '0');
      const tip = tipAt(REST);
      drive.set([tip.x, tip.y]);
      requestAnimationFrame(() => requestAnimationFrame(() => set('opacity 200ms ease-out', '1')));
      setTimeout(() => set('', ''), 260);
    } else {
      // Fade out where it lies, then take the sticker away for good.
      set('opacity 200ms ease-out', '0');
      setTimeout(() => {
        const off = peeledOffTip(tipNow(), geometry.current.aspect);
        drive.set([off.x, off.y]);
        requestAnimationFrame(() => requestAnimationFrame(() => set('', '')));
      }, 220);
    }
  };

  const tipNow = (): Point => ({ x: drive.value[0], y: drive.value[1] });
  const restTip = () => tipAt(preview && !reduced ? PREVIEW : REST);

  // The accepted state animates: peeled off when it opens, laid back down when it closes.
  useLayoutEffect(() => {
    if (!mounted.current) return;
    if (reduced) {
      fadeCover(!open);
    } else if (open) {
      const target = peeledOffTip(tipNow(), geometry.current.aspect);
      drive.to([target.x, target.y], { velocity: releaseVelocity.current, spring: PEEL_SPRING });
    } else {
      // Laid back from just past the far edge, so the motion is on the sticker from the first frame.
      const from = peeledOffTip(tipAt(0.5), geometry.current.aspect, 2.05);
      drive.set([from.x, from.y]);
      const tip = tipAt(REST);
      requestAnimationFrame(() => drive.to([tip.x, tip.y], { spring: PEEL_SPRING }));
    }
    releaseVelocity.current = [0, 0];
    if (open && focusContent.current) {
      focusContent.current = false;
      if (!reclosable) contentRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // Hover or focus lifts the corner a little more.
  useEffect(() => {
    if (!mounted.current || open || dragging || drive.animating) return;
    const tip = restTip();
    drive.to([tip.x, tip.y], { spring: reduced ? CALM_SPRING : PREVIEW_SPRING });
  }, [preview]);

  const request = (next: boolean, reason: PeelStickerReason) => {
    if (disabled) return;
    reasonRef.current = reason;
    setOpen(next);
  };

  const springBack = (velocity: [number, number] = [0, 0]) => {
    const tip = restTip();
    drive.to([tip.x, tip.y], { velocity, spring: reduced ? CALM_SPRING : RETURN_SPRING });
  };

  const endDrag = (event: PointerEvent<HTMLElement>, commit: boolean) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    suppressClick.current = current.moved;
    // Only the click this release produces; if the handle is gone by then there is none, and nothing else is swallowed.
    setTimeout(() => (suppressClick.current = false), 0);
    // Tip velocity in sticker sizes per ms (frame units), to per second for the spring.
    const now = event.timeStamp || undefined;
    const velocity: [number, number] = [trackers.x.velocity(now) * 1000, trackers.y.velocity(now) * 1000];
    const amount = peelAmount(current.tip, geometry.current.aspect);
    // Speed toward the far corner: the velocity along the peel direction.
    const dx = current.tip.x - 1;
    const dy = current.tip.y - 1;
    const length = Math.hypot(dx, dy) || 1;
    const speed = (velocity[0] * dx + velocity[1] * dy) / length;
    if (commit && peelOpens(amount, threshold, speed)) {
      releaseVelocity.current = velocity;
      request(true, 'gesture');
      // A controlled sticker the app keeps closed: the corner returns.
      requestAnimationFrame(() => {
        if (!openRef.current && !drive.animating) springBack();
      });
      return;
    }
    springBack(velocity);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (disabled || open || !event.isPrimary || event.button !== 0) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic or already released pointer: the peel still follows the moves it gets.
    }
    measure();
    const rtl = geometry.current.rtl;
    // The finger, in the frame: the tip catches up with it (from wherever it is, even mid-spring) and stays under it.
    const { right, bottom } = physicalCornerOf(corner, rtl);
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = (event.clientY - rect.top) / rect.height;
    const base = { x: right ? fx : 1 - fx, y: bottom ? fy : 1 - fy };
    drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, base, width: rect.width, height: rect.height, rtl, tip: base, moved: false };
    drive.to([base.x, base.y], { spring: FOLLOW_SPRING });
    trackers.x.reset();
    trackers.y.reset();
    trackers.x.add(base.x, event.timeStamp || 0);
    trackers.y.add(base.y, event.timeStamp || 0);
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) > SLOP) current.moved = true;
    current.tip = dragTip(current.base, current.start, { x: event.clientX, y: event.clientY }, current, corner, current.rtl);
    trackers.x.add(current.tip.x, event.timeStamp || 0);
    trackers.y.add(current.tip.y, event.timeStamp || 0);
    drive.to([current.tip.x, current.tip.y], { spring: FOLLOW_SPRING });
  };

  // A click that ends a peel does not follow a link or press a button inside the sticker.
  const onRootClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    onClickCapture?.(event);
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const state = open ? 'open' : dragging ? 'dragging' : preview ? 'preview' : 'closed';
  const hover = (on: boolean) => () => {
    if (!open && !disabled) setPreview(on);
  };

  return (
    <div
      ref={mergeRefs(ref, rootRef)}
      role="group"
      aria-label={copy.region}
      className={cx('ui-peel-sticker', className)}
      data-state={state}
      data-material={material}
      data-corner={corner}
      data-disabled={disabled || undefined}
      style={style}
      onClickCapture={onRootClickCapture}
      {...rest}
    >
      <div
        ref={surfaceRef}
        className="ui-peel-sticker__surface"
        onPointerEnter={(event) => event.pointerType === 'mouse' && hover(true)()}
        onPointerLeave={(event) => event.pointerType === 'mouse' && hover(false)()}
      >
        <div ref={contentRef} id={`${uid}-content`} className="ui-peel-sticker__content" tabIndex={-1} inert={inertAttr(!open)}>
          {children}
        </div>
        <div ref={coverRef} className="ui-peel-sticker__cover" style={{ clipPath: firstShape.cover }} inert={inertAttr(open)} aria-hidden={open || undefined}>
          {cover}
        </div>
        <div ref={liftRef} className="ui-peel-sticker__lift" aria-hidden="true">
          <div ref={flapRef} className="ui-peel-sticker__flap" style={{ clipPath: firstShape.flap }} />
        </div>
        {!open && !disabled && (
          <span
            className="ui-peel-sticker__handle"
            aria-hidden="true"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => endDrag(event, true)}
            onPointerCancel={(event) => endDrag(event, false)}
            onLostPointerCapture={(event) => endDrag(event, false)}
          />
        )}
      </div>
      {(!open || reclosable) && (
        <div className="ui-peel-sticker__actions">
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            aria-expanded={open}
            aria-controls={`${uid}-content`}
            onFocus={hover(true)}
            onBlur={hover(false)}
            onClick={() => {
              if (!open) focusContent.current = true;
              request(!open, 'button');
            }}
          >
            {open ? copy.close : copy.open}
          </Button>
        </div>
      )}
    </div>
  );
});
