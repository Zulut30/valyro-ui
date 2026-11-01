'use client';

import { useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { composeHandlers, cx, mergeRefs, useControllableState, useLatest } from '../primitives';
import { useId, useLayoutEffect, withRef } from '../primitives/react-compat';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, RefreshIcon, RotateCcwIcon, TrashIcon } from '../icons';
import { Button } from '../basic/Button';
import { IconButton } from '../basic/IconButton';
import { Slider } from '../forms/Slider';
import { NumberInput } from '../forms-advanced/NumberInput';
import { ColorPickerPopover, type ColorPickerPopoverLabels } from '../forms-advanced/ColorPicker';
import { CopyToClipboard } from '../feedback/CopyToClipboard';
import { useLabels } from '../agents/labels';
import { useMotionReduced } from '../motion-kit/preference';
import { clamp01 } from './shared';
import { CALM_SPRING, createSpringDrive, RETURN_SPRING, type SpringDrive } from './spring-drive';
import { useEditorHistory } from './editor-history';
import {
  DEFAULT_GRADIENT,
  gradientLayer,
  gradientStyle,
  gradientToCss,
  movePoint,
  newPoint,
  removePoint,
  sameGradient,
  toHex6,
  toHex8,
  type GradientPoint,
  type GradientValue,
} from './gradient';
import './GradientMixer.css';

export type { GradientPoint, GradientValue } from './gradient';

export interface GradientMixerLabels {
  /** Name of the canvas with the points. */
  canvas: string;
  /** Accessible name of a point on the canvas. */
  point: (index: number, x: number, y: number) => string;
  layers: string;
  layer: (index: number) => string;
  add: string;
  remove: string;
  raise: string;
  lower: string;
  undo: string;
  redo: string;
  x: string;
  y: string;
  radiusX: string;
  radiusY: string;
  color: string;
  opacity: string;
  background: string;
  empty: string;
  limit: (max: number) => string;
  count: (count: number, max: number) => string;
  exportTitle: string;
  copy: string;
  copied: string;
  copyError: string;
  /** How to edit with the keyboard; read with the points. */
  keyboardHint: string;
  added: string;
  removed: string;
}

const DEFAULT_LABELS: GradientMixerLabels = {
  canvas: 'Gradient canvas',
  point: (index, x, y) => `Layer ${index}: ${x}% across, ${y}% down`,
  layers: 'Layers',
  layer: (index) => `Layer ${index}`,
  add: 'Add layer',
  remove: 'Remove layer',
  raise: 'Move layer up',
  lower: 'Move layer down',
  undo: 'Undo',
  redo: 'Redo',
  x: 'Across, %',
  y: 'Down, %',
  radiusX: 'Width, %',
  radiusY: 'Height, %',
  color: 'Layer colour',
  opacity: 'Opacity',
  background: 'Base colour',
  empty: 'No layers yet: add one to start.',
  limit: (max) => `The limit is ${max} layers.`,
  count: (count, max) => `${count} of ${max}`,
  exportTitle: 'CSS',
  copy: 'Copy CSS',
  copied: 'Copied',
  copyError: 'Copy failed',
  keyboardHint: 'Arrow keys move the point, with Shift in larger steps; Delete removes the layer.',
  added: 'Layer added',
  removed: 'Layer removed',
};

export interface GradientMixerProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'children'> {
  /** The composition: a base colour and radial layers, the first one on top. */
  value?: GradientValue;
  /** Initial composition when uncontrolled. Default: three colour points on a dark base. */
  defaultValue?: GradientValue;
  /** Called with the whole new composition after each change (a drag reports once, when it ends). */
  onValueChange?: (value: GradientValue) => void;
  /** Most layers. Default 8. */
  maxPoints?: number;
  /** Most undoable actions. Default 50. */
  historyLimit?: number;
  /** Panel with the layer list and exact fields. Default true. */
  showControls?: boolean;
  /** The CSS code and its copy button. Default true. */
  showExport?: boolean;
  /** Called with the CSS when it is copied. */
  onExport?: (css: string) => void;
  /** Proportions of the canvas. Default `16 / 9`. */
  aspectRatio?: number | string;
  /** Texts of the colour pickers inside the editor. */
  colorPickerLabels?: Partial<ColorPickerPopoverLabels>;
  labels?: Partial<GradientMixerLabels>;
}

const pct = (share: number) => Math.round(share * 100);

/** A point as drawn: x, y, radiusX, radiusY, opacity and how far it has appeared (0…1). */
type Drawn = [x: number, y: number, radiusX: number, radiusY: number, opacity: number, appear: number];
/** A new place, size or opacity (a step, a field, undo): settles without a wobble. */
const PLACE_SPRING = { stiffness: 260, damping: 32 };
/** Appearing and leaving layers: a soft fade and grow. */
const APPEAR_SPRING = { stiffness: 170, damping: 26 };
const drawnOf = (p: GradientPoint, appear = 1): Drawn => [p.x, p.y, p.radiusX, p.radiusY, p.opacity, appear];
const differs = (a: readonly number[], b: readonly number[]) => a.some((v, i) => Math.abs(v - b[i]) > 1e-4);

/**
 * Editor of a layered background: colour points on a canvas, each a radial CSS layer with its own colour, opacity and
 * two radii. Drag the points or move them with the arrow keys, set exact values in the panel, undo and redo whole
 * actions, and copy CSS built by the same serializer as the preview.
 */
export const GradientMixer = withRef(function GradientMixer({
  value: valueProp,
  defaultValue = DEFAULT_GRADIENT,
  onValueChange,
  maxPoints = 8,
  historyLimit = 50,
  showControls = true,
  showExport = true,
  onExport,
  aspectRatio = '16 / 9',
  colorPickerLabels,
  labels,
  className,
  style,
  ref,
  onKeyDown: onKeyDownProp,
  ...rest
}: GradientMixerProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const history = useEditorHistory({ value, setValue, limit: historyLimit, same: sameGradient });
  const [selectedRaw, setSelected] = useState<string | null>(value.points[0]?.id ?? null);
  const [announcement, setAnnouncement] = useState('');
  /** Removed layers, kept on the canvas while they fade out. */
  const [ghosts, setGhosts] = useState<{ point: GradientPoint; index: number }[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = useMotionReduced(rootRef);
  const canvasRef = useRef<HTMLDivElement>(null);
  const pointRefs = useRef(new Map<string, HTMLButtonElement>());
  const ghostRefs = useRef(new Map<string, HTMLElement>());
  const drag = useRef<{ id: string; pointerId: number; offset: { x: number; y: number }; to: { x: number; y: number } | null } | null>(null);
  /** The spring of each point (and of each fading ghost), and the pose each point had at the last render. */
  const drives = useRef(new Map<string, SpringDrive>());
  const last = useRef(new Map<string, Drawn>());
  const max = Math.max(1, Math.floor(maxPoints));
  const valueRef = useLatest(value);
  const ghostsRef = useRef(ghosts);
  const prevPoints = useRef(value.points);
  const mounted = useRef(false);

  const shown = value;
  const selected = shown.points.some((p) => p.id === selectedRaw) ? selectedRaw : (shown.points[0]?.id ?? null);
  const selectedIndex = shown.points.findIndex((p) => p.id === selected);
  const point = selectedIndex >= 0 ? shown.points[selectedIndex] : null;
  const css = gradientToCss(value);
  const full = value.points.length >= max;

  /** The canvas background from the points as drawn: the same serializer as the export, fed the animated values. */
  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const list = [...valueRef.current.points];
    for (const ghost of ghostsRef.current) list.splice(Math.min(ghost.index, list.length), 0, ghost.point);
    const layers = list.map((p) => {
      const d = drives.current.get(p.id)?.value;
      return gradientLayer(d ? { ...p, x: d[0], y: d[1], radiusX: d[2], radiusY: d[3], opacity: clamp01(d[4] * d[5]) } : p);
    });
    canvas.style.backgroundImage = layers.length ? layers.join(', ') : 'none';
  };
  const paintMarker = (id: string, d: readonly number[]) => {
    const el = pointRefs.current.get(id) ?? ghostRefs.current.get(id);
    if (!el) return;
    el.style.left = `${d[0] * 100}%`;
    el.style.top = `${d[1] * 100}%`;
    el.style.setProperty('--_appear', d[5].toFixed(3));
  };
  /** The spring of one point: each frame it moves the marker and redraws the canvas. */
  const driveOf = (id: string, from: Drawn): SpringDrive => {
    let drive = drives.current.get(id);
    if (!drive) {
      drive = createSpringDrive(
        from,
        (d) => {
          paintMarker(id, d);
          redraw();
        },
        0.0005,
      );
      drives.current.set(id, drive);
    }
    return drive;
  };
  const springTo = (id: string, target: Drawn, spring = PLACE_SPRING, onRest?: () => void) =>
    driveOf(id, target).to(target, { spring: reduced ? CALM_SPRING : spring, onRest });

  // A changed composition springs in from what is drawn: React has just written the new values, so the drawn ones go
  // back on before the frame is painted. New layers grow in; removed ones stay as ghosts while they fade out.
  useLayoutEffect(() => {
    const ids = new Set(value.points.map((p) => p.id));
    let changed = false;
    // A layer back before its ghost faded (undo of a removal): the ghost goes, the layer springs back from it.
    if (ghostsRef.current.some((g) => ids.has(g.point.id))) {
      ghostsRef.current = ghostsRef.current.filter((g) => !ids.has(g.point.id));
      setGhosts(ghostsRef.current);
    }
    value.points.forEach((p) => {
      const drive = drives.current.get(p.id);
      const before = drive ? (drive.value as Drawn) : last.current.get(p.id);
      const target = drawnOf(p);
      last.current.set(p.id, target);
      if (drag.current?.id === p.id) return;
      if (!before) {
        if (!mounted.current) return;
        // A new layer: from nothing to its place.
        changed = true;
        const from: Drawn = [p.x, p.y, p.radiusX, p.radiusY, p.opacity, 0];
        driveOf(p.id, from).set(from);
        paintMarker(p.id, from);
        springTo(p.id, target, APPEAR_SPRING);
        return;
      }
      if (!differs(before, target)) return;
      changed = true;
      const drive2 = driveOf(p.id, before);
      paintMarker(p.id, before);
      if (!drive) drive2.set(before);
      springTo(p.id, target);
    });
    const leaving: { point: GradientPoint; index: number }[] = [];
    for (const [id, pose] of last.current) {
      if (ids.has(id)) continue;
      last.current.delete(id);
      if (!mounted.current) continue;
      const previous = prevPoints.current.find((p) => p.id === id);
      if (!previous) continue;
      const index = prevPoints.current.indexOf(previous);
      const drive = drives.current.get(id);
      const from = drive ? (drive.value as Drawn) : pose;
      leaving.push({ point: { ...previous, x: from[0], y: from[1] }, index });
      driveOf(id, from).to([from[0], from[1], from[2], from[3], from[4], 0], {
        spring: reduced ? CALM_SPRING : APPEAR_SPRING,
        onRest: () => {
          drives.current.delete(id);
          ghostsRef.current = ghostsRef.current.filter((g) => g.point.id !== id);
          setGhosts(ghostsRef.current);
          redraw();
        },
      });
    }
    if (leaving.length) {
      ghostsRef.current = [...ghostsRef.current.filter((g) => !leaving.some((l) => l.point.id === g.point.id)), ...leaving];
      setGhosts(ghostsRef.current);
      changed = true;
    }
    prevPoints.current = value.points;
    // React wrote the target background: draw what is shown (a no-op when nothing moves).
    if (changed || ghostsRef.current.length || [...drives.current.values()].some((d) => d.animating)) redraw();
  }, [value]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      for (const drive of drives.current.values()) drive.stop();
    };
  }, []);
  // Ghost markers mount after the effect above: put them where they are drawn.
  useLayoutEffect(() => {
    for (const ghost of ghosts) {
      const d = drives.current.get(ghost.point.id)?.value;
      if (d) paintMarker(ghost.point.id, d);
    }
  }, [ghosts]);

  const withPoint = (base: GradientValue, id: string, patch: Partial<GradientPoint>): GradientValue => ({
    ...base,
    points: base.points.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  });
  const update = (id: string, patch: Partial<GradientPoint>, key: string) => history.commit(withPoint(value, id, patch), `${key}:${id}`);

  const add = () => {
    if (full) return;
    const created = newPoint(value.points, point?.color ?? '#6366f1');
    history.commit({ ...value, points: [created, ...value.points] });
    setSelected(created.id);
    setAnnouncement(copy.added);
  };
  const remove = (id: string) => {
    const result = removePoint(value.points, id);
    history.commit({ ...value, points: result.points });
    setSelected(result.selected);
    setAnnouncement(copy.removed);
    // Focus stays in the editor: on the next point, or the add button.
    requestAnimationFrame(() => (result.selected ? pointRefs.current.get(result.selected) : canvasRef.current)?.focus({ preventScroll: true }));
  };

  // Dragging: the point follows the pointer, drawn once a frame without a render; the change is committed on release.
  const shareAt = (event: PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };
  const endDrag = (commit: boolean) => {
    const gesture = drag.current;
    drag.current = null;
    if (!gesture) return;
    pointRefs.current.get(gesture.id)?.removeAttribute('data-dragging');
    const original = valueRef.current.points.find((p) => p.id === gesture.id);
    if (commit && gesture.to) {
      const before = valueRef.current;
      history.commit(withPoint(value, gesture.id, gesture.to));
      // A controlled editor that keeps the old value: the point springs back.
      requestAnimationFrame(() => {
        if (valueRef.current === before && original) springTo(original.id, drawnOf(original), RETURN_SPRING);
      });
    } else if (original) {
      springTo(original.id, drawnOf(original), RETURN_SPRING);
    }
  };
  const onPointerDown = (id: string) => (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic or already released pointer: the drag still follows the moves it gets.
    }
    setSelected(id);
    const p = value.points.find((q) => q.id === id);
    if (!p) return;
    // Held where it was grabbed (and caught mid-spring where it is drawn): the point does not jump under the pointer.
    const drive = driveOf(id, drawnOf(p));
    const [x, y] = drive.value;
    drive.stop();
    const at = shareAt(event);
    drag.current = { id, pointerId: event.pointerId, offset: { x: x - at.x, y: y - at.y }, to: null };
    event.currentTarget.setAttribute('data-dragging', '');
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const at = shareAt(event);
    gesture.to = { x: clamp01(at.x + gesture.offset.x), y: clamp01(at.y + gesture.offset.y) };
    const drive = drives.current.get(gesture.id);
    if (!drive) return;
    const d = drive.value;
    drive.set([gesture.to.x, gesture.to.y, d[2], d[3], d[4], 1]);
  };
  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId === event.pointerId) endDrag(true);
  };

  const onPointKeyDown = (p: GradientPoint) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Escape' && drag.current) {
      event.preventDefault();
      endDrag(false);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove(p.id);
      return;
    }
    const step = event.shiftKey ? 0.05 : 0.01;
    const deltas: Record<string, [number, number] | undefined> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    update(p.id, { x: clamp01(Math.round((p.x + delta[0]) * 1000) / 1000), y: clamp01(Math.round((p.y + delta[1]) * 1000) / 1000) }, 'move');
  };

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
    const target = event.target as HTMLElement;
    // Text fields keep their own undo.
    if (target.closest('input, textarea')) return;
    event.preventDefault();
    if (event.shiftKey) history.redo();
    else history.undo();
  };

  return (
    <div
      ref={mergeRefs(ref, rootRef)}
      className={cx('ui-gradient-mixer', className)}
      style={{ ...style, '--_ratio': String(aspectRatio) } as CSSProperties}
      data-controls={showControls || undefined}
      {...rest}
      onKeyDown={composeHandlers(onKeyDownProp, onRootKeyDown)}
    >
      <div className="ui-gradient-mixer__toolbar">
        <IconButton variant="ghost" size="sm" icon={<RotateCcwIcon />} label={copy.undo} disabled={!history.canUndo} onClick={history.undo} />
        <IconButton variant="ghost" size="sm" icon={<RefreshIcon />} label={copy.redo} disabled={!history.canRedo} onClick={history.redo} />
        <span className="ui-gradient-mixer__count">{copy.count(value.points.length, max)}</span>
        {full && <span className="ui-gradient-mixer__limit">{copy.limit(max)}</span>}
        <Button className="ui-gradient-mixer__add" variant="secondary" size="sm" leftIcon={<PlusIcon />} disabled={full} onClick={add}>
          {copy.add}
        </Button>
      </div>

      <div className="ui-gradient-mixer__body">
        <div className="ui-gradient-mixer__stage">
          <div
            ref={canvasRef}
            className="ui-gradient-mixer__canvas"
            role="group"
            aria-label={copy.canvas}
            aria-describedby={`${uid}-hint`}
            tabIndex={-1}
            style={gradientStyle(shown)}
          >
            {shown.points.length === 0 && <p className="ui-gradient-mixer__empty">{copy.empty}</p>}
            {shown.points.map((p, i) => (
              <button
                key={p.id}
                ref={(node) => {
                  if (node) pointRefs.current.set(p.id, node);
                  else pointRefs.current.delete(p.id);
                }}
                type="button"
                className="ui-gradient-mixer__point"
                aria-label={copy.point(i + 1, pct(p.x), pct(p.y))}
                aria-pressed={p.id === selected}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, zIndex: shown.points.length - i, '--_swatch': p.color } as CSSProperties}
                onClick={() => setSelected(p.id)}
                onPointerDown={onPointerDown(p.id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => endDrag(false)}
                onLostPointerCapture={() => drag.current && endDrag(true)}
                onKeyDown={onPointKeyDown(p)}
              />
            ))}
            {ghosts.map(({ point: p }) => (
              <span
                key={`ghost-${p.id}`}
                ref={(node) => {
                  if (node) ghostRefs.current.set(p.id, node);
                  else ghostRefs.current.delete(p.id);
                }}
                className="ui-gradient-mixer__ghost"
                aria-hidden="true"
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, '--_swatch': p.color } as CSSProperties}
              />
            ))}
          </div>
          <p className="ui-sr-only" id={`${uid}-hint`}>
            {copy.keyboardHint}
          </p>
        </div>

        {showControls && (
          <div className="ui-gradient-mixer__panel">
            <div className="ui-gradient-mixer__section">
              <h3 className="ui-gradient-mixer__heading" id={`${uid}-layers`}>
                {copy.layers}
              </h3>
              <ul className="ui-gradient-mixer__layers" aria-labelledby={`${uid}-layers`}>
                {shown.points.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="ui-gradient-mixer__layer"
                      aria-pressed={p.id === selected}
                      onClick={() => setSelected(p.id)}
                    >
                      <span className="ui-gradient-mixer__swatch" style={{ '--_swatch': p.color, opacity: Math.max(0.25, p.opacity) } as CSSProperties} aria-hidden="true" />
                      {copy.layer(i + 1)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {point && (
              <div className="ui-gradient-mixer__section" role="group" aria-label={copy.layer(selectedIndex + 1)}>
                <div className="ui-gradient-mixer__row">
                  <ColorPickerPopover
                    aria-label={copy.color}
                    size="sm"
                    value={point.color}
                    onValueChange={(next) => {
                      const hex = toHex6(next);
                      if (hex) update(point.id, { color: hex }, 'color');
                    }}
                    labels={colorPickerLabels}
                  />
                  <IconButton variant="ghost" size="sm" icon={<ArrowUpIcon />} label={copy.raise} disabled={selectedIndex === 0} onClick={() => history.commit({ ...value, points: movePoint(value.points, point.id, -1) })} />
                  <IconButton
                    variant="ghost"
                    size="sm"
                    icon={<ArrowDownIcon />}
                    label={copy.lower}
                    disabled={selectedIndex === shown.points.length - 1}
                    onClick={() => history.commit({ ...value, points: movePoint(value.points, point.id, 1) })}
                  />
                  <IconButton variant="ghost" size="sm" icon={<TrashIcon />} label={copy.remove} onClick={() => remove(point.id)} />
                </div>
                <div className="ui-gradient-mixer__fields">
                  <label className="ui-gradient-mixer__field">
                    <span>{copy.x}</span>
                    <NumberInput size="sm" min={0} max={100} step={1} value={pct(point.x)} onValueChange={(v) => v != null && update(point.id, { x: clamp01(v / 100) }, 'x')} />
                  </label>
                  <label className="ui-gradient-mixer__field">
                    <span>{copy.y}</span>
                    <NumberInput size="sm" min={0} max={100} step={1} value={pct(point.y)} onValueChange={(v) => v != null && update(point.id, { y: clamp01(v / 100) }, 'y')} />
                  </label>
                  <label className="ui-gradient-mixer__field">
                    <span>{copy.radiusX}</span>
                    <NumberInput size="sm" min={1} max={200} step={1} value={point.radiusX} onValueChange={(v) => v != null && update(point.id, { radiusX: Math.min(200, Math.max(1, v)) }, 'rx')} />
                  </label>
                  <label className="ui-gradient-mixer__field">
                    <span>{copy.radiusY}</span>
                    <NumberInput size="sm" min={1} max={200} step={1} value={point.radiusY} onValueChange={(v) => v != null && update(point.id, { radiusY: Math.min(200, Math.max(1, v)) }, 'ry')} />
                  </label>
                </div>
                <div className="ui-gradient-mixer__field">
                  <span id={`${uid}-opacity`}>{copy.opacity}</span>
                  <Slider
                    aria-labelledby={`${uid}-opacity`}
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(point.opacity * 100)}
                    formatValue={(v) => `${v}%`}
                    onValueChange={(v) => update(point.id, { opacity: v / 100 }, 'opacity')}
                  />
                </div>
              </div>
            )}

            <div className="ui-gradient-mixer__section ui-gradient-mixer__row">
              <span className="ui-gradient-mixer__label">{copy.background}</span>
              <ColorPickerPopover
                aria-label={copy.background}
                size="sm"
                alpha
                value={value.background}
                onValueChange={(next) => {
                  const hex = toHex8(next);
                  if (hex) history.commit({ ...value, background: hex }, 'background');
                }}
                labels={colorPickerLabels}
              />
            </div>
          </div>
        )}
      </div>

      {showExport && (
        <div className="ui-gradient-mixer__export">
          <div className="ui-gradient-mixer__export-head">
            <span className="ui-gradient-mixer__label">{copy.exportTitle}</span>
            <CopyToClipboard size="sm" variant="secondary" value={css} label={copy.copy} copiedLabel={copy.copied} errorLabel={copy.copyError} onCopy={() => onExport?.(css)} />
          </div>
          <pre className="ui-gradient-mixer__code">
            <code>{css}</code>
          </pre>
        </div>
      )}
      <div className="ui-sr-only" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
});
