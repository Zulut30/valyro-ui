'use client';

import { useEffect, useRef, useState, type ComponentPropsWithRef, type PointerEvent, type ReactNode } from 'react';
import { cx, useControllableState, useLatest } from '../primitives';
import { inertAttr, useLayoutEffect, withRef } from '../primitives/react-compat';
import { Button } from '../basic/Button';
import { useLabels } from '../agents/labels';
import { createGrid, gridProgress, maskResolution, seeded, stamp, stampSegment, throttle, type ScratchGrid, type ScratchPoint } from './scratch';
import { useElementSize } from './shared';
import './ScratchReveal.css';

export type ScratchRevealReason = 'scratch' | 'button' | 'reset';

export interface ScratchCover {
  /** `paper` (default) matte with speckles, `paint` a flat coat, `foil` a metallic film. */
  material?: 'paper' | 'paint' | 'foil';
  /** Text printed on the cover; it is scratched away with it. Decorative: the instruction is in `labels`. */
  label?: string;
  /** Colour of the coat (any CSS colour); default from the material and the theme. */
  color?: string;
}

export interface ScratchRevealLabels {
  /** Name of the card. */
  region: string;
  /** Short hint next to the button. */
  instruction: string;
  /** The button that reveals everything at once. */
  reveal: string;
  /** The button that covers the card again (with `resettable`). */
  reset: string;
  /** Announced once the content is revealed. */
  revealed: string;
}

const DEFAULT_LABELS: ScratchRevealLabels = {
  region: 'Scratch card',
  instruction: 'Scratch the cover to reveal it',
  reveal: 'Show',
  reset: 'Cover again',
  revealed: 'Revealed',
};

export interface ScratchRevealProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** What the cover hides: text, a picture or a card. It cannot be focused until revealed. */
  children: ReactNode;
  /** Look of the coat. */
  cover?: ScratchCover;
  /** Brush diameter in CSS px. Default 36. */
  brushSize?: number;
  /** Share of the card that must be cleared to reveal it all. Default 0.6. */
  threshold?: number;
  revealed?: boolean;
  defaultRevealed?: boolean;
  /** A request to reveal (`scratch`, `button`) or cover again (`reset`). Controlled cards follow `revealed`. */
  onRevealedChange?: (revealed: boolean, reason: ScratchRevealReason) => void;
  /** Once per cycle, when the threshold is reached or the button is pressed; not when `revealed` is set from outside. */
  onReveal?: (reason: 'scratch' | 'button') => void;
  /** Cleared share 0…1 while scratching, at most about ten times a second. */
  onProgressChange?: (progress: number) => void;
  /** A new key clears the scratches of a covered card. It does not cover a revealed one (`revealed={false}` does). */
  resetKey?: string | number;
  /** Offer a button that covers the card again once revealed. Default false. */
  resettable?: boolean;
  /** No scratching and no button. */
  disabled?: boolean;
  labels?: Partial<ScratchRevealLabels>;
}

interface Stroke {
  points: ScratchPoint[];
  radius: number;
}

const FALLBACK: Record<NonNullable<ScratchCover['material']>, [string, string, string]> = {
  paper: ['#cfc8b8', '#b9b19f', '#6e6656'],
  paint: ['#8e96a3', '#8e96a3', '#f4f5f7'],
  foil: ['#b7bcc6', '#eef0f3', '#3f4552'],
};

/**
 * A card under a coat that the reader scratches off with a finger or the mouse; past the threshold the rest
 * disappears. The Show button reveals it at once. The coat is a visual effect, not protection: the content is in the
 * page, and whether a prize is due is the app's decision.
 */
export const ScratchReveal = withRef(function ScratchReveal({
  children,
  cover,
  brushSize = 36,
  threshold = 0.6,
  revealed: revealedProp,
  defaultRevealed = false,
  onRevealedChange,
  onReveal,
  onProgressChange,
  resetKey = 0,
  resettable = false,
  disabled = false,
  labels,
  className,
  style,
  ref,
  ...rest
}: ScratchRevealProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const material = cover?.material ?? 'paper';
  const reasonRef = useRef<ScratchRevealReason>('button');
  const [revealed, setRevealed] = useControllableState({
    value: revealedProp,
    defaultValue: defaultRevealed,
    onChange: (next: boolean) => onRevealedChange?.(next, reasonRef.current),
  });
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(cardRef);
  const [painted, setPainted] = useState(false);
  const [scratching, setScratching] = useState(false);
  const [started, setStarted] = useState(false);
  const strokes = useRef<Stroke[]>([]);
  const grid = useRef<ScratchGrid | null>(null);
  const active = useRef<{ id: number; last: ScratchPoint } | null>(null);
  // One reveal request per cycle, whether the gesture and the button finish together or not.
  const cycleDone = useRef(defaultRevealed || !!revealedProp);
  const focusAfter = useRef(false);
  const onRevealRef = useLatest(onReveal);
  const progressRef = useLatest(onProgressChange);
  const reporter = useRef<ReturnType<typeof throttle<number>> | null>(null);
  if (!reporter.current) reporter.current = throttle<number>((value) => progressRef.current?.(value), 100);

  /* ── Drawing ── */
  const colors = (): [string, string, string] => {
    const canvas = canvasRef.current;
    const fallback = FALLBACK[material];
    if (!canvas) return fallback;
    const computed = getComputedStyle(canvas);
    const read = (name: string, i: number) => computed.getPropertyValue(name).trim() || fallback[i];
    return [cover?.color ?? read('--_cover-a', 0), read('--_cover-b', 1), read('--_cover-ink', 2)];
  };

  const paint = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !size || size.width <= 0 || size.height <= 0) return;
    const res = maskResolution(size.width, size.height, window.devicePixelRatio);
    canvas.width = res.width;
    canvas.height = res.height;
    const w = res.width;
    const h = res.height;
    const [a, b, ink] = colors();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    if (material === 'foil') {
      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, a);
      gradient.addColorStop(0.45, b);
      gradient.addColorStop(1, a);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = res.scale;
      for (let x = -h; x < w; x += 6 * res.scale) {
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x + h, 0);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, w, h);
      if (material === 'paper') {
        const random = seeded(7);
        ctx.fillStyle = b;
        const dots = Math.round((w * h) / (90 * res.scale * res.scale));
        for (let i = 0; i < dots; i++) ctx.fillRect(random() * w, random() * h, res.scale * (1 + random()), res.scale * (1 + random()));
      }
    }
    if (cover?.label) {
      const font = getComputedStyle(canvas).fontFamily || 'sans-serif';
      ctx.fillStyle = ink;
      ctx.font = `600 ${Math.round(Math.min(26, size.height / 5) * res.scale)}px ${font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cover.label, w / 2, h / 2, w * 0.9);
    }
    // The scratches so far, from the strokes in normalised coordinates: a resized card keeps its cleared areas.
    for (const stroke of strokes.current) erase(ctx, stroke.points, stroke.radius, w);
    setPainted(true);
  };

  const erase = (ctx: CanvasRenderingContext2D, points: ScratchPoint[], radius: number, width: number) => {
    if (!points.length) return;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = radius * 2 * width;
    ctx.beginPath();
    ctx.moveTo(points[0].x * width, points[0].y * width);
    for (const point of points.slice(1)) ctx.lineTo(point.x * width, point.y * width);
    if (points.length === 1) ctx.lineTo(points[0].x * width + 0.01, points[0].y * width);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  };

  const clear = () => {
    strokes.current = [];
    grid.current = null;
    active.current = null;
    cycleDone.current = false;
    reporter.current?.cancel();
    setStarted(false);
    setScratching(false);
  };

  // Covered again from outside (or by the reset button): a fresh card and a fresh cycle.
  const wasRevealed = useRef(revealed);
  useLayoutEffect(() => {
    if (wasRevealed.current && !revealed) clear();
    if (revealed) cycleDone.current = true;
    if (revealed && focusAfter.current) contentRef.current?.focus({ preventScroll: true });
    focusAfter.current = false;
    wasRevealed.current = revealed;
  }, [revealed]);

  // After the reset above, so a card covered again is painted without its old scratches — before the browser paints,
  // so the coat fades back in already fresh, without a flash of the old one.
  useLayoutEffect(() => {
    if (!revealed) paint();
  }, [size?.width, size?.height, material, cover?.color, cover?.label, revealed]);

  const firstKey = useRef(true);
  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    if (revealed) return;
    clear();
    paint();
  }, [resetKey]);

  useEffect(() => () => reporter.current?.cancel(), []);

  const requestReveal = (reason: 'scratch' | 'button') => {
    if (cycleDone.current || disabled) return;
    cycleDone.current = true;
    reporter.current?.flush();
    onRevealRef.current?.(reason);
    reasonRef.current = reason;
    setRevealed(true);
  };

  /* ── Gesture ── */
  const pointOf = (event: PointerEvent<HTMLCanvasElement>): ScratchPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = rect.width || 1;
    return { x: (event.clientX - rect.left) / width, y: (event.clientY - rect.top) / width };
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (revealed || disabled || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (!grid.current) grid.current = createGrid(rect.height / rect.width);
    const point = pointOf(event);
    const radius = brushSize / 2 / rect.width;
    strokes.current.push({ points: [point], radius });
    active.current = { id: event.pointerId, last: point };
    stamp(grid.current, point, radius);
    const ctx = event.currentTarget.getContext('2d');
    if (ctx) erase(ctx, [point], radius, event.currentTarget.width);
    setScratching(true);
    setStarted(true);
    report();
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const current = active.current;
    const stroke = strokes.current[strokes.current.length - 1];
    if (!current || current.id !== event.pointerId || !grid.current || !stroke) return;
    const point = pointOf(event);
    stampSegment(grid.current, current.last, point, stroke.radius);
    const ctx = event.currentTarget.getContext('2d');
    if (ctx) erase(ctx, [current.last, point], stroke.radius, event.currentTarget.width);
    stroke.points.push(point);
    current.last = point;
    report();
  };

  const report = () => {
    if (!grid.current) return;
    const progress = gridProgress(grid.current);
    reporter.current?.call(progress);
    if (progress >= threshold) requestReveal('scratch');
  };

  // Lifting, cancelling or losing the pointer ends the stroke; it never reveals by itself.
  const endStroke = (event: PointerEvent<HTMLCanvasElement>) => {
    if (active.current?.id !== event.pointerId) return;
    active.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    reporter.current?.flush();
    setScratching(false);
  };

  const state = disabled ? 'disabled' : revealed ? 'revealed' : scratching ? 'scratching' : started ? 'partial' : 'closed';

  /** Revealed for good (no Cover again): the footer folds away. */
  const folding = revealed && !resettable;

  return (
    <div ref={ref} role="group" aria-label={copy.region} className={cx('ui-scratch', className)} data-state={state} data-material={material} style={style} {...rest}>
      <div ref={cardRef} className="ui-scratch__card">
        <div ref={contentRef} className="ui-scratch__content" tabIndex={-1} inert={inertAttr(!revealed)}>
          {children}
        </div>
        <canvas
          ref={canvasRef}
          className="ui-scratch__cover"
          aria-hidden="true"
          data-ready={painted || undefined}
          style={cover?.color ? { backgroundColor: painted ? undefined : cover.color } : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onLostPointerCapture={endStroke}
        />
      </div>
      {/*
        The footer folds away (height and fade) when nothing is left in it, so the card below does not jump. While it
        folds it keeps showing what it showed (hint and Show), out of reach, so there is something to fold.
      */}
      <div className="ui-scratch__foot" data-folded={folding || undefined} inert={inertAttr(folding)} aria-hidden={folding || undefined}>
        <div className="ui-scratch__foot-clip">
      <div className="ui-scratch__footer" key={revealed && !folding ? 'revealed' : 'covered'}>
        {(!revealed || folding) && <span className="ui-scratch__hint">{copy.instruction}</span>}
        {(!revealed || folding) && (
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              focusAfter.current = true;
              requestReveal('button');
            }}
          >
            {copy.reveal}
          </Button>
        )}
        {revealed && resettable && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              reasonRef.current = 'reset';
              setRevealed(false);
            }}
          >
            {copy.reset}
          </Button>
        )}
      </div>
        </div>
      </div>
      <span className="ui-sr-only" role="status">
        {revealed ? copy.revealed : ''}
      </span>
    </div>
  );
});

