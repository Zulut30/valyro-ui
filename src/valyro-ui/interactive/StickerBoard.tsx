'use client';

import { useEffect, useRef, type ComponentPropsWithRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx, mergeRefs, useControllableState, useLatest } from '../primitives';
import { useId, useLayoutEffect, withRef } from '../primitives/react-compat';
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, ChevronDownIcon, ChevronUpIcon, CornerDownLeftIcon, GripVerticalIcon, LockIcon, RefreshIcon, RotateCcwIcon } from '../icons';
import { IconButton } from '../basic/IconButton';
import { useLabels } from '../agents/labels';
import { useMotionReduced } from '../motion-kit/preference';
import { CALM_SPRING, createSpringDrive, RETURN_SPRING, type SpringDrive } from './spring-drive';
import { useEditorHistory } from './editor-history';
import { angleFrom, placeItem, replaceItem, restack, rotateItem, type BoardBounds, type BoardItemGeometry, type BoardSize } from './board';
import './StickerBoard.css';

export type { BoardBounds, BoardSize } from './board';

export interface StickerItem extends BoardItemGeometry {
  /** Short name: the item's accessible name and its title in the toolbar. */
  label: string;
  /** What the item shows: a photo, a note, a sticker. */
  content: ReactNode;
  /** Pinned: cannot be moved, turned or restacked; still readable. */
  locked?: boolean;
  /** Look of the item's card. Default `paper`. */
  surface?: 'paper' | 'photo' | 'flat';
}

/** What produced a new layout. */
export type StickerChangeReason = 'move' | 'rotate' | 'restack' | 'undo';

export interface StickerBoardLabels {
  /** Name of the board. */
  board: string;
  /** What an item is, read before its name. */
  item: string;
  /** Keyboard instructions of an item. */
  hint: string;
  toolbar: string;
  nothingSelected: string;
  selected: (label: string) => string;
  locked: string;
  rotateLeft: string;
  rotateRight: string;
  forward: string;
  backward: string;
  undo: string;
  moveUp: string;
  moveDown: string;
  moveLeft: string;
  moveRight: string;
  /** The handle that moves an item on touch screens. */
  grip: string;
  /** The handle that turns an item. */
  rotateHandle: string;
}

const DEFAULT_LABELS: StickerBoardLabels = {
  board: 'Board',
  item: 'board item',
  hint: 'Arrow keys move the item, with Shift in larger steps.',
  toolbar: 'Item actions',
  nothingSelected: 'Select an item to move, turn or restack it.',
  selected: (label) => `Selected: ${label}`,
  locked: 'Pinned',
  rotateLeft: 'Turn left',
  rotateRight: 'Turn right',
  forward: 'Bring forward',
  backward: 'Send backward',
  undo: 'Undo',
  moveUp: 'Move up',
  moveDown: 'Move down',
  moveLeft: 'Move left',
  moveRight: 'Move right',
  grip: 'Drag to move',
  rotateHandle: 'Drag to turn',
};

export interface StickerBoardProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** The layout: items with centre, size, angle and stacking order in canvas units. Never changed in place. */
  items?: StickerItem[];
  /** Initial layout when uncontrolled. */
  defaultItems?: StickerItem[];
  /** Called with the proposed layout after a finished move, turn, restack or undo. */
  onItemsChange?: (items: StickerItem[], reason: StickerChangeReason) => void;
  /** The board's coordinate system. Items keep their place relative to it at any width. */
  canvasSize: BoardSize;
  /** Id of the selected item, or null. */
  selectedId?: string | null;
  defaultSelectedId?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  /** `contain` (default) keeps whole turned items on the board; `partial` lets edges hang over, the centre stays on. */
  bounds?: BoardBounds;
  /** Grid step in canvas units for moves; 0 (default) turns snapping off. */
  snap?: number;
  /** Degrees per turn of the toolbar buttons; Shift snaps the turn handle to it. Default 15. */
  rotationStep?: number;
  /** Shows the layout without editing. */
  readOnly?: boolean;
  labels?: Partial<StickerBoardLabels>;
}

type Pose = [x: number, y: number, rotation: number];

type Gesture = {
  kind: 'move' | 'rotate';
  pointerId: number;
  element: HTMLElement;
  startX: number;
  startY: number;
  /** Turning: the item's centre on screen and the pointer's angle at the start. */
  centerX: number;
  centerY: number;
  startAngle: number;
  /** The item as committed, and as drawn when the pointer caught it (maybe mid-spring). */
  item: StickerItem;
  origin: StickerItem;
  next: StickerItem;
  moved: boolean;
};

/** Settling on a new place or angle (undo, a step, the grid): unhurried, no wobble. */
const PLACE_SPRING = { stiffness: 210, damping: 27 };

/** The same angle as `target`, the nearest one to `from`: a turn from 170° to −175° goes 15°, not 345°. */
const nearestAngle = (from: number, target: number) => target + Math.round((from - target) / 360) * 360;

const ARROWS: Record<string, [number, number] | undefined> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

const INTERACTIVE = 'a, button, input, textarea, select, label, [contenteditable="true"], [data-sticker-board-ignore]';

/**
 * A free board of photos, stickers and notes. Select an item to drag it, turn it by its handle or by steps, and bring
 * it forward or back; arrow keys and toolbar buttons do the same without a pointer. Coordinates live in the board's
 * own system, so the composition scales with the width. A drag moves only the dragged item in the DOM and reports the
 * new layout once, on release; Escape cancels a gesture, Undo steps back through the confirmed layouts.
 */
export const StickerBoard = withRef(function StickerBoard({
  items: itemsProp,
  defaultItems = [],
  onItemsChange,
  canvasSize,
  selectedId: selectedProp,
  defaultSelectedId = null,
  onSelectedIdChange,
  bounds = 'contain',
  snap = 0,
  rotationStep = 15,
  readOnly = false,
  labels,
  className,
  style,
  ref,
  ...rest
}: StickerBoardProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const [items, setItemsState] = useControllableState({ value: itemsProp, defaultValue: defaultItems });
  const [selectedRaw, setSelected] = useControllableState<string | null>({ value: selectedProp, defaultValue: defaultSelectedId, onChange: onSelectedIdChange });
  const reason = useRef<StickerChangeReason>('move');
  const history = useEditorHistory<StickerItem[]>({
    value: items,
    setValue: (next) => {
      setItemsState(next);
      onItemsChange?.(next, reason.current);
    },
    limit: 50,
    same: Object.is,
  });
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const reduced = useMotionReduced(rootRef);
  const gesture = useRef<Gesture | null>(null);
  /** The items' elements and the spring that draws each one (centre and angle, in canvas units). */
  const elements = useRef(new Map<string, HTMLElement>());
  const drives = useRef(new Map<string, SpringDrive>());
  /** The pose each item had at the last render, to spring from when it changes. */
  const drawn = useRef(new Map<string, Pose>());
  const itemsRef = useLatest(items);
  const canvas = { width: Math.max(1, canvasSize.width), height: Math.max(1, canvasSize.height) };
  const selected = items.find((item) => item.id === selectedRaw) ?? null;
  const editable = !!selected && !readOnly && !selected.locked;

  const propose = (next: StickerItem[], why: StickerChangeReason, key?: string) => {
    if (next === items) return;
    reason.current = why;
    history.commit(next, key);
  };
  const undo = () => {
    reason.current = 'undo';
    history.undo();
  };

  const left = (x: number) => `${(x / canvas.width) * 100}%`;
  const top = (y: number) => `${(y / canvas.height) * 100}%`;
  const canvasRef = useLatest(canvas);

  /** The spring of one item: each frame it writes the item's place and angle to its element. */
  const driveOf = (item: StickerItem): SpringDrive => {
    let drive = drives.current.get(item.id);
    if (!drive) {
      const id = item.id;
      drive = createSpringDrive(
        [item.x, item.y, item.rotation],
        ([x, y, rotation]) => {
          const el = elements.current.get(id);
          if (!el) return;
          const { width, height } = canvasRef.current;
          el.style.left = `${(x / width) * 100}%`;
          el.style.top = `${(y / height) * 100}%`;
          el.style.setProperty('--_rotate', `${rotation}deg`);
        },
        0.05,
      );
      drives.current.set(id, drive);
    }
    return drive;
  };
  const shownPose = (item: StickerItem): Pose => {
    const drive = drives.current.get(item.id);
    return drive ? (drive.value as Pose) : [item.x, item.y, item.rotation];
  };
  /** Springs an item to `pose` from wherever it is drawn now; calm under reduced motion. */
  const settle = (item: StickerItem, pose: Pose, spring = PLACE_SPRING) => {
    const drive = driveOf(item);
    const from = drive.value[2];
    drive.to([pose[0], pose[1], nearestAngle(from, pose[2])], { spring: reduced ? CALM_SPRING : spring });
  };

  /** Ends a gesture: the drop is proposed (and settles onto the grid), a cancel springs the item back. */
  const finish = (commit: boolean) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    g.element.removeAttribute('data-dragging');
    const before = itemsRef.current;
    if (commit && g.moved) {
      propose(replaceItem(items, g.next), g.kind === 'move' ? 'move' : 'rotate');
      // A controlled board that keeps the old layout: the item goes back where it was.
      requestAnimationFrame(() => {
        if (itemsRef.current === before) settle(g.item, [g.item.x, g.item.y, g.item.rotation], RETURN_SPRING);
      });
    } else {
      settle(g.item, [g.item.x, g.item.y, g.item.rotation], RETURN_SPRING);
    }
  };

  // A layout that arrives from outside cancels a gesture in progress (the board never proposes mid-gesture).
  useEffect(() => {
    finish(false);
  }, [items]);
  // A new place or angle (a drop onto the grid, a step, a turn, undo) springs in from where the item is drawn: React
  // has just written the target, so the drawn pose goes back on before the frame is painted.
  useLayoutEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    for (const [id, drive] of drives.current) {
      if (ids.has(id)) continue;
      drive.stop();
      drives.current.delete(id);
    }
    for (const item of items) {
      const drive = drives.current.get(item.id);
      const before = drive ? (drive.value as Pose) : drawn.current.get(item.id);
      drawn.current.set(item.id, [item.x, item.y, item.rotation]);
      // A new item appears where it is; an unchanged one stays.
      if (!before) continue;
      const [x, y, rotation] = before;
      const same = Math.abs(x - item.x) < 0.05 && Math.abs(y - item.y) < 0.05 && Math.abs(nearestAngle(rotation, item.rotation) - rotation) < 0.05;
      if (same) continue;
      const el = elements.current.get(item.id);
      if (!el) continue;
      el.style.left = left(x);
      el.style.top = top(y);
      el.style.setProperty('--_rotate', `${rotation}deg`);
      if (!drive) driveOf({ ...item, x, y, rotation });
      settle(item, [item.x, item.y, item.rotation]);
    }
    for (const id of drawn.current.keys()) if (!ids.has(id)) drawn.current.delete(id);
  }, [items]);
  useEffect(
    () => () => {
      for (const drive of drives.current.values()) drive.stop();
    },
    [],
  );

  const start = (kind: Gesture['kind'], item: StickerItem, element: HTMLElement, event: PointerEvent<HTMLElement>) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A synthetic or already released pointer: the gesture still follows the moves it gets.
    }
    // Caught mid-spring: the item stays where it is drawn and follows the pointer from there.
    const [x, y, rotation] = shownPose(item);
    driveOf(item).stop();
    const origin = { ...item, x, y, rotation };
    gesture.current = {
      kind,
      pointerId: event.pointerId,
      element,
      startX: event.clientX,
      startY: event.clientY,
      centerX,
      centerY,
      startAngle: angleFrom(centerX, centerY, event.clientX, event.clientY),
      item,
      origin,
      next: origin,
      moved: false,
    };
    element.setAttribute('data-dragging', kind);
  };

  const onItemPointerDown = (item: StickerItem) => (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (selectedRaw !== item.id) setSelected(item.id);
    const target = event.target as HTMLElement;
    if (readOnly || item.locked || gesture.current) return;
    const onGrip = !!target.closest('.ui-sticker-board__grip');
    if (!onGrip && target.closest(INTERACTIVE)) return;
    // On touch screens a drag starts only from the grip, so a swipe over the board still scrolls the page.
    if (event.pointerType === 'touch' && !onGrip) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    start('move', item, event.currentTarget, event);
  };
  const onRotatePointerDown = (item: StickerItem) => (event: PointerEvent<HTMLSpanElement>) => {
    if (!event.isPrimary || event.button !== 0 || readOnly || item.locked) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget.closest<HTMLElement>('.ui-sticker-board__item');
    if (element) start('rotate', item, element, event);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) return;
    const stage = stageRef.current!.getBoundingClientRect();
    // What is drawn follows the pointer freely; the grid applies to the drop and settles in with a spring.
    let shown: Pose;
    if (g.kind === 'move') {
      const factor = canvas.width / Math.max(1, stage.width);
      const dx = (event.clientX - g.startX) * factor;
      const dy = (event.clientY - g.startY) * factor;
      g.next = placeItem(g.origin, g.origin.x + dx, g.origin.y + dy, canvas, bounds, snap);
      const free = placeItem(g.origin, g.origin.x + dx, g.origin.y + dy, canvas, bounds, 0);
      shown = [free.x, free.y, free.rotation];
    } else {
      let delta = angleFrom(g.centerX, g.centerY, event.clientX, event.clientY) - g.startAngle;
      const target = g.origin.rotation + delta;
      if (event.shiftKey && rotationStep > 0) delta = Math.round(target / rotationStep) * rotationStep - g.origin.rotation;
      g.next = rotateItem(g.origin, Math.round(delta), canvas, bounds);
      shown = [g.next.x, g.next.y, nearestAngle(g.origin.rotation, g.next.rotation)];
    }
    g.moved = g.next.x !== g.item.x || g.next.y !== g.item.y || g.next.rotation !== g.item.rotation;
    // Only the dragged item's style changes, at most once a frame; the board does not re-render.
    driveOf(g.item).set(shown);
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (gesture.current?.pointerId === event.pointerId) finish(true);
  };

  const nudge = (item: StickerItem, dx: number, dy: number) => {
    const step = snap > 0 ? snap : 8;
    propose(replaceItem(items, placeItem(item, item.x + dx * step, item.y + dy * step, canvas, bounds, snap)), 'move', `move:${item.id}`);
  };
  const turn = (item: StickerItem, direction: 1 | -1) => propose(replaceItem(items, rotateItem(item, direction * rotationStep, canvas, bounds)), 'rotate');
  const onItemKeyDown = (item: StickerItem) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Escape' && gesture.current) {
      event.preventDefault();
      finish(false);
      return;
    }
    if (readOnly || item.locked) return;
    const move = ARROWS[event.key];
    if (!move) return;
    event.preventDefault();
    const times = event.shiftKey ? 10 : 1;
    nudge(item, move[0] * times, move[1] * times);
  };

  return (
    <div ref={mergeRefs(ref, rootRef)} className={cx('ui-sticker-board', className)} data-readonly={readOnly || undefined} style={style} {...rest}>
      {!readOnly && (
        <div className="ui-sticker-board__toolbar" role="toolbar" aria-label={copy.toolbar}>
          <span className="ui-sticker-board__status">{selected ? copy.selected(selected.label) : copy.nothingSelected}</span>
          <div className="ui-sticker-board__actions">
            <IconButton size="sm" variant="ghost" icon={<ArrowLeftIcon />} label={copy.moveLeft} disabled={!editable} onClick={() => selected && nudge(selected, -1, 0)} />
            <IconButton size="sm" variant="ghost" icon={<ArrowUpIcon />} label={copy.moveUp} disabled={!editable} onClick={() => selected && nudge(selected, 0, -1)} />
            <IconButton size="sm" variant="ghost" icon={<ArrowDownIcon />} label={copy.moveDown} disabled={!editable} onClick={() => selected && nudge(selected, 0, 1)} />
            <IconButton size="sm" variant="ghost" icon={<ArrowRightIcon />} label={copy.moveRight} disabled={!editable} onClick={() => selected && nudge(selected, 1, 0)} />
            <span className="ui-sticker-board__divider" aria-hidden="true" />
            <IconButton size="sm" variant="ghost" icon={<RotateCcwIcon />} label={copy.rotateLeft} disabled={!editable} onClick={() => selected && turn(selected, -1)} />
            <IconButton size="sm" variant="ghost" icon={<RefreshIcon />} label={copy.rotateRight} disabled={!editable} onClick={() => selected && turn(selected, 1)} />
            <IconButton size="sm" variant="ghost" icon={<ChevronUpIcon />} label={copy.forward} disabled={!editable} onClick={() => selected && propose(restack(items, selected.id, 1), 'restack')} />
            <IconButton size="sm" variant="ghost" icon={<ChevronDownIcon />} label={copy.backward} disabled={!editable} onClick={() => selected && propose(restack(items, selected.id, -1), 'restack')} />
            <span className="ui-sticker-board__divider" aria-hidden="true" />
            <IconButton size="sm" variant="ghost" icon={<CornerDownLeftIcon />} label={copy.undo} disabled={!history.canUndo} onClick={undo} />
          </div>
        </div>
      )}
      <div
        ref={stageRef}
        className="ui-sticker-board__stage"
        role="group"
        aria-label={copy.board}
        style={{ aspectRatio: `${canvas.width} / ${canvas.height}`, '--_cw': canvas.width } as CSSProperties}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}
      >
        {items.map((item) => {
          const isSelected = item.id === selectedRaw;
          return (
            <div
              key={item.id}
              ref={(node) => {
                if (node) elements.current.set(item.id, node);
                else elements.current.delete(item.id);
              }}
              className="ui-sticker-board__item"
              role="group"
              aria-roledescription={copy.item}
              aria-label={item.locked ? `${item.label} (${copy.locked})` : item.label}
              aria-describedby={readOnly ? undefined : `${uid}-hint`}
              tabIndex={readOnly ? undefined : 0}
              data-selected={isSelected || undefined}
              data-locked={item.locked || undefined}
              data-surface={item.surface ?? 'paper'}
              style={
                {
                  left: left(item.x),
                  top: top(item.y),
                  width: `${(item.width / canvas.width) * 100}%`,
                  height: `${(item.height / canvas.height) * 100}%`,
                  zIndex: item.z,
                  '--_rotate': `${item.rotation}deg`,
                } as CSSProperties
              }
              onFocus={() => !readOnly && selectedRaw !== item.id && setSelected(item.id)}
              onPointerDown={onItemPointerDown(item)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => finish(false)}
              onKeyDown={onItemKeyDown(item)}
            >
              <div className="ui-sticker-board__content">{item.content}</div>
              {item.locked && (
                <span className="ui-sticker-board__pin" aria-hidden="true">
                  <LockIcon />
                </span>
              )}
              {isSelected && !readOnly && !item.locked && (
                <>
                  <span className="ui-sticker-board__grip" title={copy.grip} aria-hidden="true">
                    <GripVerticalIcon />
                  </span>
                  <span
                    className="ui-sticker-board__rotate"
                    title={copy.rotateHandle}
                    aria-hidden="true"
                    onPointerDown={onRotatePointerDown(item)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => finish(false)}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <p className="ui-sr-only" id={`${uid}-hint`}>
          {copy.hint}
        </p>
      )}
    </div>
  );
});
