'use client';

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { announce } from '../primitives/liveAnnouncer';
import { useControllableState } from '../primitives/useControllableState';
import { getDirection, inlineArrowStep, useLatest } from '../primitives/utils';
import { withUserProps, type UserProps } from '../primitives/prop-getters';
import { inertAttr, useId, useLayoutEffect } from '../primitives/react-compat';
import { edgeScrollStep } from '../data-display/kanban';
import type { MoveAction } from './drag-moves';
import { arrayMove, closestIndex, columnCount, keyboardTarget, type Box, type SortableLayout } from './sorting';

/*
 * The behaviour of Sortable without its markup. A pointer drag (a press-and-hold on touch, so swipes still scroll)
 * leaves the item as a placeholder in its live slot while a copy follows the pointer, scrolls the list or the page
 * near its edges and glides the copy into place on release; Escape cancels. From the keyboard Space / Enter lifts
 * the item, the arrows move it (rows too in a `grid`), Space / Enter drops it and Escape puts it back. A screen
 * reader's cursor and a single pointer (WCAG 2.5.7) lift it with a start button and move it with move buttons
 * (getMoveActions). Every step is read out through the live announcer, and items that change place glide there
 * (FLIP, on the theme's --ui-duration and --ui-ease). Sortable renders with it.
 */

export type SortableKey = string | number;

export interface SortableItemState {
  index: number;
  /** The item is being moved: its placeholder during a pointer drag, or lifted with the keyboard. */
  isDragging: boolean;
  /** Rendering the copy that follows the pointer. */
  isOverlay: boolean;
  disabled: boolean;
}

export interface SortableMove<T> {
  item: T;
  from: number;
  to: number;
}

export interface SortableLabels {
  /** Keyboard instructions, linked to every draggable item or handle. */
  instructions: string;
  /**
   * Accessible name of a `SortableHandle`; also of the start button a screen reader finds in an item without a
   * handle, and of the group of move buttons on a lifted item.
   */
  handle: (item: string) => string;
  /** Move buttons on a lifted item: one step towards the start or the end of the list, drop, cancel. */
  moveEarlier?: string;
  moveLater?: string;
  drop?: string;
  cancel?: string;
  pickedUp: (item: string, position: number, total: number) => string;
  moved: (item: string, position: number, total: number) => string;
  dropped: (item: string, position: number, total: number) => string;
  cancelled: (item: string, position: number, total: number) => string;
}

export const defaultSortableLabels: Required<SortableLabels> = {
  instructions:
    'Press Space or Enter to pick up the item. While it is picked up, move it with the arrow keys or the move buttons, press Space or Enter to drop it, Escape to cancel.',
  handle: (item) => `Reorder ${item}`,
  moveEarlier: 'Move earlier',
  moveLater: 'Move later',
  drop: 'Drop here',
  cancel: 'Cancel move',
  pickedUp: (item, position, total) => `Picked up ${item}. Position ${position} of ${total}.`,
  moved: (item, position, total) => `${item}: position ${position} of ${total}.`,
  dropped: (item, position, total) => `Dropped ${item} at position ${position} of ${total}.`,
  cancelled: (item, position, total) => `Reorder cancelled. ${item} is back at position ${position} of ${total}.`,
};

export interface SortableOptions<T> {
  /** Controlled items, in order. */
  items?: readonly T[];
  defaultItems?: readonly T[];
  /** Called after a drop that changed the order (pointer or keyboard). */
  onReorder?: (items: T[], move: SortableMove<T>) => void;
  /** Stable key of an item. Defaults to `item.id`, or the item itself for strings and numbers. */
  getKey?: (item: T) => SortableKey;
  /** `grid` matches drop positions in both directions and moves rows with ArrowUp / ArrowDown. Default `vertical`. */
  layout?: SortableLayout;
  /** Only the handle (getHandleProps) starts a drag; the rest of the item stays interactive. */
  handle?: boolean;
  /** No item can be picked up by pointer or keyboard, and handles are disabled. */
  disabled?: boolean;
  /** Items that can't be picked up (others can still move past them). */
  isItemDisabled?: (item: T) => boolean;
  /** Item name for announcements and handle labels. Defaults to "item 3". */
  getItemLabel?: (item: T) => string;
  labels?: Partial<SortableLabels>;
}

export interface SortableState<T> {
  /** The items in their committed order. */
  items: readonly T[];
  /** The items in the order to render: the live order while one moves. */
  shown: readonly T[];
  /** Key of the item a pointer drags, or null. */
  dragging: SortableKey | null;
  /** Key of the item lifted with the keyboard or the start button, or null. */
  grabbed: SortableKey | null;
  /** The item the pointer drags: render it again inside getOverlayProps. */
  overlayItem: T | undefined;
  /** The labels, defaults filled in. */
  labels: Required<SortableLabels>;
  getKey: (item: T) => SortableKey;
  /** The item's name (getItemLabel, else "item 3"). */
  getItemLabel: (item: T) => string;
  /** The state a row of the list renders with (the overlay's copy is `isOverlay: true, isDragging: true`). */
  getItemState: (item: T, index: number) => SortableItemState;
  /** Lifts an item (focus moves to it, or its handle), as Space does. */
  lift: (key: SortableKey) => void;
  /** Drops the lifted item where it is now and calls onReorder. */
  drop: () => void;
  /** Puts the lifted item back. */
  cancel: () => void;
  /** Moves the lifted item to a position of the live order. */
  move: (target: number) => void;
  /** The buttons of a lifted item: a step earlier or later, drop, cancel. Render each with `data-move={action.id}`. */
  getMoveActions: (item: T) => MoveAction[];
  /** The list (`<ul>`): a lifted item is put back when focus leaves it. */
  getListProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** An item (`<li>`): its ref, and without `handle` the press, the keys and the tab stop. */
  getItemProps: (item: T, props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** The drag handle of an item, with `handle`: a button that drags, or lifts and drops when pressed. */
  getHandleProps: (item: T, props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement> & { 'data-sortable-handle': '' };
  /** A visually hidden button that lifts an item without a handle, for a screen reader's cursor (out of the Tab order). */
  getStartButtonProps: (item: T, props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement>;
  /** The copy that follows the pointer (fixed position, moved with transform). Render it in a portal while overlayItem is set. */
  getOverlayProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** The visually hidden keyboard instructions every draggable item or handle points at. */
  getInstructionsProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
}

interface PointerDrag {
  key: SortableKey;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  /** Released: the copy glides into its slot before the drag ends. */
  dropping: boolean;
}

/** Pointer travel (px) that turns a press into a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Touch on an item needs a press-and-hold, so swipes keep scrolling the page. */
const LONG_PRESS_MS = 260;
const INTERACTIVE = 'a[href], button, input, textarea, select, [contenteditable="true"], [role="button"], [role="checkbox"], [role="switch"]';
const EMPTY: readonly never[] = [];

function defaultGetKey(item: unknown): SortableKey {
  if (typeof item === 'string' || typeof item === 'number') return item;
  const id = (item as { id?: unknown } | null)?.id;
  if (typeof id === 'string' || typeof id === 'number') return id;
  throw new Error('Sortable: items need a string or number `id`, or pass `getKey`.');
}

/** "180ms" / "0.24s" → milliseconds. */
function parseDuration(value: string) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return value.trim().endsWith('ms') ? n : n * 1000;
}

function motion(element: Element) {
  const style = getComputedStyle(element);
  return {
    duration: parseDuration(style.getPropertyValue('--ui-duration')),
    easing: style.getPropertyValue('--ui-ease').trim() || 'ease',
  };
}

/** Viewport box of an item's layout position, ignoring the transforms of running animations. */
function layoutBox(item: HTMLElement, list: HTMLElement, origin: DOMRect): Box {
  return {
    left: origin.left + list.clientLeft - list.scrollLeft + item.offsetLeft,
    top: origin.top + list.clientTop - list.scrollTop + item.offsetTop,
    width: item.offsetWidth,
    height: item.offsetHeight,
  };
}

/** Nearest ancestor (or the list itself) that scrolls along the list's axis; null means the window. */
function scrollParent(node: HTMLElement, layout: SortableLayout): HTMLElement | null {
  for (let el: HTMLElement | null = node; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    const style = getComputedStyle(el);
    const y = /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight;
    const x = /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
    if ((layout !== 'horizontal' && y) || (layout !== 'vertical' && x)) return el;
  }
  return null;
}

/** Focuses the move button `id` of an item again after a move re-rendered it somewhere else. */
function focusMoveButton(item: Element | undefined, id: string) {
  const button = item?.querySelector<HTMLElement>(`[data-move="${id}"]`);
  if (button && document.activeElement !== button) button.focus({ preventScroll: true });
  return !!button;
}

/** Keeps a press on a button from starting the item's own pointer drag or click. */
const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

export function useSortable<T>({
  items: itemsProp,
  defaultItems,
  onReorder,
  getKey = defaultGetKey,
  layout = 'vertical',
  handle = false,
  disabled = false,
  isItemDisabled,
  getItemLabel,
  labels: labelsProp,
}: SortableOptions<T>): SortableState<T> {
  const labels = { ...defaultSortableLabels, ...labelsProp };
  const [items, setItems] = useControllableState<readonly T[]>({ value: itemsProp, defaultValue: defaultItems ?? EMPTY });
  /** Live order while an item is moving (pointer drag or keyboard grab). */
  const [order, setOrder] = useState<readonly T[] | null>(null);
  const [drag, setDrag] = useState<PointerDrag | null>(null);
  const [grabbed, setGrabbed] = useState<SortableKey | null>(null);

  const listRef = useRef<HTMLElement | null>(null);
  const [setList] = useState(() => (node: HTMLElement | null) => {
    listRef.current = node;
  });
  const overlayRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<PointerDrag | null>(null);
  dragRef.current = drag;
  const itemRefs = useRef(new Map<SortableKey, HTMLElement>());
  // One ref callback per item, so an item's ref does not change on every render.
  const itemRefCallbacks = useRef(new Map<SortableKey, (node: HTMLElement | null) => void>());
  const pointer = useRef({ x: 0, y: 0 });
  /** Item rects captured right before a reorder, for the FLIP animation. */
  const snapshot = useRef<Map<SortableKey, DOMRect> | null>(null);
  const flips = useRef(new WeakMap<Element, Animation>());
  /** Where focus goes after the next render: the item (or its handle), or one of its move buttons. */
  const pendingFocus = useRef<{ key: SortableKey; move?: string } | null>(null);
  const suppressClick = useRef(false);
  const pressCleanup = useRef<(() => void) | null>(null);
  const baseId = useId();
  const instructionsId = `${baseId}-instructions`;

  const shown = order ?? items;
  const keySignature = JSON.stringify(shown.map(getKey));
  const latest = useLatest({ items, shown, labels, getKey, onReorder, grabbed });

  const labelOf = (item: T, index: number) => getItemLabel?.(item) ?? `item ${index + 1}`;
  const indexOfKey = (list: readonly T[], key: SortableKey) => list.findIndex((item) => latest.current.getKey(item) === key);
  const nameOf = (item: T) => labelOf(item, indexOfKey(items, getKey(item)));

  const takeSnapshot = () => {
    const rects = new Map<SortableKey, DOMRect>();
    for (const [key, el] of itemRefs.current) rects.set(key, el.getBoundingClientRect());
    snapshot.current = rects;
  };

  // FLIP: items that changed place glide from where they were.
  useLayoutEffect(() => {
    const first = snapshot.current;
    snapshot.current = null;
    const list = listRef.current;
    if (!first || !list) return;
    const { duration, easing } = motion(list);
    // Reduced motion zeroes the duration tokens (1ms).
    if (duration <= 1) return;
    for (const [key, el] of itemRefs.current) {
      const from = first.get(key);
      if (!from) continue;
      flips.current.get(el)?.cancel();
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      flips.current.set(el, el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration, easing }));
    }
  }, [keySignature]);

  // A reorder remounts nothing, but moving the focused node in the DOM can drop focus.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (pending === null) return;
    pendingFocus.current = null;
    const item = itemRefs.current.get(pending.key);
    if (pending.move && focusMoveButton(item, pending.move)) return;
    const target = handle ? item?.querySelector<HTMLElement>('[data-sortable-handle]') : item;
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  });

  // Window listeners of an unfinished press must not outlive the list.
  useEffect(
    () => () => {
      pressCleanup.current?.();
      delete document.documentElement.dataset.uiSorting;
    },
    [],
  );

  const commit = (next: readonly T[], key: SortableKey) => {
    const { items: current } = latest.current;
    const from = indexOfKey(current, key);
    const to = indexOfKey(next, key);
    if (from === -1 || to === -1 || from === to) return;
    const result = next.slice();
    setItems(result);
    latest.current.onReorder?.(result, { item: current[from], from, to });
  };

  // Read through the page's live announcer (primitives/liveAnnouncer): a region of our own stays silent when the
  // same step is announced twice, and is hidden with the page while a modal is open.
  const say = (message: (item: string, position: number, total: number) => string, list: readonly T[], key: SortableKey) => {
    const index = indexOfKey(list, key);
    if (index === -1) return;
    announce(message(labelOf(list[index], indexOfKey(latest.current.items, key)), index + 1, list.length), 'assertive');
  };

  /* ── Pointer: the item stays as a placeholder in its live slot, a copy follows the pointer ── */

  useEffect(() => {
    const list = listRef.current;
    if (!drag || drag.dropping || !list) return;
    const scroller = scrollParent(list, layout);
    let frame = 0;
    const tick = () => {
      const { x, y } = pointer.current;
      const overlay = overlayRef.current;
      if (overlay) overlay.style.transform = `translate3d(${x - drag.offsetX}px, ${y - drag.offsetY}px, 0)`;

      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        if (layout !== 'vertical') scroller.scrollLeft += edgeScrollStep(x, rect.left, rect.right);
        if (layout !== 'horizontal') scroller.scrollTop += edgeScrollStep(y, rect.top, rect.bottom);
      } else if (layout !== 'horizontal') {
        const dy = edgeScrollStep(y, 0, window.innerHeight);
        if (dy) window.scrollBy(0, dy);
      }

      // Skip while a reorder is still rendering: the DOM and `shown` would disagree.
      if (!snapshot.current) {
        const { shown: current, getKey: keyOf } = latest.current;
        const origin = list.getBoundingClientRect();
        const boxes: Box[] = [];
        for (const item of current) {
          const el = itemRefs.current.get(keyOf(item));
          if (el) boxes.push(layoutBox(el, list, origin));
        }
        if (boxes.length === current.length) {
          const center = { x: x - drag.offsetX + drag.width / 2, y: y - drag.offsetY + drag.height / 2 };
          const target = closestIndex(boxes, center, layout);
          const from = indexOfKey(current, drag.key);
          if (target !== -1 && from !== -1 && target !== from) {
            takeSnapshot();
            setOrder(arrayMove(current, from, target));
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // indexOfKey and takeSnapshot read refs only, so they are not dependencies.
  }, [drag, layout, latest]);

  // Released: glide the copy into the item's final slot, then end the drag.
  useLayoutEffect(() => {
    if (!drag?.dropping) return;
    const overlay = overlayRef.current;
    const item = itemRefs.current.get(drag.key);
    const list = listRef.current;
    const done = () => {
      setDrag(null);
      setOrder(null);
    };
    if (!overlay || !item || !list) {
      done();
      return;
    }
    const target = layoutBox(item, list, list.getBoundingClientRect());
    const { duration, easing } = motion(list);
    const animation = overlay.animate(
      [{ transform: overlay.style.transform }, { transform: `translate3d(${target.left}px, ${target.top}px, 0)` }],
      { duration: Math.max(duration, 1), easing, fill: 'forwards' },
    );
    animation.onfinish = done;
    animation.oncancel = done;
  }, [drag]);

  const startPress = (event: ReactPointerEvent<HTMLElement>, key: SortableKey, fromHandle: boolean) => {
    suppressClick.current = false;
    if (disabled || drag || latest.current.grabbed !== null || event.button !== 0 || !event.isPrimary) return;
    // Interactive content inside an item keeps its own behaviour.
    if (!fromHandle && (event.target as HTMLElement).closest(INTERACTIVE) !== null) return;
    const node = itemRefs.current.get(key);
    if (!node) return;
    if (fromHandle) event.preventDefault();

    const start = { x: event.clientX, y: event.clientY };
    const longPress = event.pointerType === 'touch' && !fromHandle;
    let started = false;
    let pressTimer = 0;

    const begin = () => {
      started = true;
      const rect = node.getBoundingClientRect();
      const { items: current } = latest.current;
      setOrder(current);
      setDrag({
        key,
        width: rect.width,
        height: rect.height,
        offsetX: start.x - rect.left,
        offsetY: start.y - rect.top,
        dropping: false,
      });
      document.documentElement.dataset.uiSorting = '';
      say(latest.current.labels.pickedUp, current, key);
    };

    const cleanup = () => {
      window.clearTimeout(pressTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('contextmenu', onContextMenu);
      pressCleanup.current = null;
    };

    const finish = (dropIt: boolean) => {
      cleanup();
      if (!started) return;
      suppressClick.current = true;
      delete document.documentElement.dataset.uiSorting;
      const { items: current, shown: preview, labels: currentLabels } = latest.current;
      if (dropIt) {
        commit(preview, key);
        say(currentLabels.dropped, preview, key);
      } else {
        takeSnapshot();
        setOrder(current);
        say(currentLabels.cancelled, current, key);
      }
      setDrag((prev) => (prev ? { ...prev, dropping: true } : prev));
    };

    function onMove(e: PointerEvent) {
      if (e.pointerId !== event.pointerId) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      if (started) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
      if (longPress) {
        // Moving before the hold completes means the user is scrolling.
        if (moved > 8) cleanup();
      } else if (moved > DRAG_THRESHOLD) {
        begin();
      }
    }
    function onUp(e: PointerEvent) {
      if (e.pointerId === event.pointerId) finish(true);
    }
    function onCancel(e: PointerEvent) {
      if (e.pointerId === event.pointerId) finish(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Escape' || !started) return;
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
    // Once a touch drag has started, the page must not scroll under the finger.
    function onTouchMove(e: TouchEvent) {
      if (started && e.cancelable) e.preventDefault();
    }
    // A long press opens the context menu on touch devices.
    function onContextMenu(e: MouseEvent) {
      e.preventDefault();
    }

    pressCleanup.current?.();
    pressCleanup.current = cleanup;
    pointer.current = start;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    if (event.pointerType === 'touch') {
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('contextmenu', onContextMenu);
    }
    if (longPress) pressTimer = window.setTimeout(begin, LONG_PRESS_MS);
  };

  /* ── Keyboard and buttons: Space/Enter lifts, arrows move, Space/Enter drops, Escape cancels ── */

  const cancelGrab = () => {
    const key = latest.current.grabbed;
    if (key === null) return;
    takeSnapshot();
    setGrabbed(null);
    setOrder(null);
    say(labels.cancelled, latest.current.items, key);
  };

  /** Puts the lifted item back and keeps focus on it. */
  const putBack = () => {
    const key = latest.current.grabbed;
    if (key === null) return;
    pendingFocus.current = { key };
    cancelGrab();
  };

  const lift = (key: SortableKey) => {
    const { items: current } = latest.current;
    // From a start button that disappears once the item is up: focus goes to the item (or its handle).
    pendingFocus.current = { key };
    setGrabbed(key);
    setOrder(current);
    say(labels.pickedUp, current, key);
  };

  const dropGrabbed = (key: SortableKey) => {
    const { items: current, shown: preview } = latest.current;
    pendingFocus.current = { key };
    // Apply the move to the items as they are now: items that arrived while this one was held must stay.
    const from = indexOfKey(current, key);
    if (from < 0) {
      // The held item was removed meanwhile: nothing to drop.
      cancelGrab();
      return;
    }
    const dropped = arrayMove(current, from, indexOfKey(preview, key));
    commit(dropped, key);
    setGrabbed(null);
    setOrder(null);
    say(labels.dropped, dropped, key);
  };

  /** Moves the lifted item to `target` in the live order; `move` names the button that keeps the focus. */
  const moveGrabbed = (key: SortableKey, target: number, move?: string) => {
    const { shown: preview } = latest.current;
    const index = indexOfKey(preview, key);
    if (index < 0 || target < 0 || target >= preview.length || target === index) return;
    const next = arrayMove(preview, index, target);
    takeSnapshot();
    pendingFocus.current = { key, move };
    setOrder(next);
    say(labels.moved, next, key);
    // Keep the moved item in view inside scrolling lists.
    requestAnimationFrame(() => itemRefs.current.get(key)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  };

  /** A press on the handle (a click, a tap, Enter, Space, a screen reader's activation) lifts the item or drops it. */
  const toggleFromHandle = (key: SortableKey) => {
    if (drag || disabled) return;
    if (grabbed === null) {
      // A mouse press does not focus the handle (its pointerdown is prevented); the arrows and buttons need it.
      itemRefs.current.get(key)?.querySelector<HTMLElement>('[data-sortable-handle]')?.focus({ preventScroll: true });
      lift(key);
    } else if (grabbed === key) dropGrabbed(key);
  };

  const onItemKeyDown = (event: KeyboardEvent<HTMLElement>, key: SortableKey, itemDisabled: boolean, viaHandle = false) => {
    if (drag || disabled || event.defaultPrevented) return;
    const { shown: preview } = latest.current;
    // On the handle, Space and Enter arrive as its click (toggleFromHandle), like every other way of pressing it.
    const activates = (event.key === ' ' || event.key === 'Enter') && !viaHandle;

    if (grabbed === null) {
      if (activates && !itemDisabled) {
        event.preventDefault();
        lift(key);
      }
      return;
    }
    if (grabbed !== key) return;

    if (activates) {
      event.preventDefault();
      dropGrabbed(key);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      putBack();
      return;
    }

    const index = indexOfKey(preview, key);
    const list = listRef.current;
    const columns =
      layout === 'grid' && list
        ? columnCount(preview.map((item) => itemRefs.current.get(latest.current.getKey(item))?.offsetTop ?? 0))
        : 1;
    const target = keyboardTarget(
      event.key,
      index,
      preview.length,
      layout,
      inlineArrowStep(event.key, getDirection(event.currentTarget)),
      columns,
    );
    if (target === null) return;
    event.preventDefault();
    moveGrabbed(key, target);
  };

  const itemRef = (key: SortableKey) => {
    let ref = itemRefCallbacks.current.get(key);
    if (!ref) {
      ref = (node) => {
        if (node) itemRefs.current.set(key, node);
        else itemRefs.current.delete(key);
      };
      itemRefCallbacks.current.set(key, ref);
    }
    return ref;
  };
  const [overlayCallback] = useState(() => (node: HTMLElement | null) => {
    // Positioned before the first paint so the copy never flashes at the corner.
    const current = dragRef.current;
    if (node && current && !node.style.transform) {
      node.style.transform = `translate3d(${pointer.current.x - current.offsetX}px, ${pointer.current.y - current.offsetY}px, 0)`;
    }
    overlayRef.current = node;
  });

  const isDisabled = (item: T) => disabled || !!isItemDisabled?.(item);
  const overlayItem = drag ? shown.find((item) => getKey(item) === drag.key) : undefined;

  return {
    items,
    shown,
    dragging: drag?.key ?? null,
    grabbed,
    overlayItem,
    labels,
    getKey,
    getItemLabel: nameOf,
    getItemState: (item, index) => {
      const key = getKey(item);
      return { index, isDragging: drag?.key === key || grabbed === key, isOverlay: false, disabled: isDisabled(item) };
    },
    lift,
    drop: () => {
      if (grabbed !== null) dropGrabbed(grabbed);
    },
    cancel: putBack,
    move: (target) => {
      if (grabbed !== null) moveGrabbed(grabbed, target);
    },
    getMoveActions: (item) => {
      const key = getKey(item);
      const index = indexOfKey(shown, key);
      return [
        {
          id: 'earlier',
          icon: layout === 'vertical' ? 'up' : 'start',
          label: labels.moveEarlier,
          disabled: index === 0,
          onPress: () => moveGrabbed(key, index - 1, 'earlier'),
        },
        {
          id: 'later',
          icon: layout === 'vertical' ? 'down' : 'end',
          label: labels.moveLater,
          disabled: index === shown.length - 1,
          onPress: () => moveGrabbed(key, index + 1, 'later'),
        },
        { id: 'drop', icon: 'drop', label: labels.drop, onPress: () => dropGrabbed(key) },
        { id: 'cancel', icon: 'cancel', label: labels.cancel, onPress: putBack },
      ];
    },
    getListProps: (props) =>
      withUserProps(
        {
          ref: setList,
          'data-dragging': drag ? '' : undefined,
          'data-grabbing': grabbed !== null ? '' : undefined,
          onBlur: (event: FocusEvent<HTMLElement>) => {
            if (grabbed === null) return;
            const root = event.currentTarget;
            // Checked a frame later: a moved item can blur for a moment before it is refocused.
            requestAnimationFrame(() => {
              if (root.isConnected && !root.contains(document.activeElement)) cancelGrab();
            });
          },
        },
        props,
      ) as never,
    getItemProps: (item, props) => {
      const key = getKey(item);
      const itemDisabled = isDisabled(item);
      const draggable = !handle && !itemDisabled;
      return withUserProps(
        {
          ref: itemRef(key),
          'data-placeholder': drag?.key === key || undefined,
          'data-grabbed': grabbed === key || undefined,
          'data-disabled': itemDisabled || undefined,
          'data-draggable': draggable || undefined,
          tabIndex: draggable ? 0 : undefined,
          'aria-describedby': draggable ? instructionsId : undefined,
          onPointerDown: draggable ? (event: ReactPointerEvent<HTMLElement>) => startPress(event, key, false) : undefined,
          onKeyDown: draggable
            ? (event: KeyboardEvent<HTMLElement>) => {
                if (event.target === event.currentTarget) onItemKeyDown(event, key, itemDisabled);
              }
            : undefined,
          // Focus moving to another item (or its handle) puts a lifted one back.
          onFocus: () => {
            if (grabbed !== null && grabbed !== key) cancelGrab();
          },
          onClickCapture: (event: ReactMouseEvent) => {
            if (!suppressClick.current) return;
            suppressClick.current = false;
            event.preventDefault();
            event.stopPropagation();
          },
        },
        props,
      ) as never;
    },
    getHandleProps: (item, props) => {
      const key = getKey(item);
      const itemDisabled = isDisabled(item);
      const active = handle && !itemDisabled;
      return withUserProps(
        {
          type: 'button',
          'aria-label': labels.handle(nameOf(item)),
          'data-sortable-handle': '',
          'aria-describedby': instructionsId,
          'aria-pressed': grabbed === key || undefined,
          disabled: itemDisabled,
          onPointerDown: active ? (event: ReactPointerEvent<HTMLElement>) => startPress(event, key, true) : undefined,
          onKeyDown: active ? (event: KeyboardEvent<HTMLElement>) => onItemKeyDown(event, key, itemDisabled, true) : undefined,
          onClick: active ? () => toggleFromHandle(key) : undefined,
        },
        props,
      ) as never;
    },
    getStartButtonProps: (item, props) =>
      withUserProps(
        {
          type: 'button',
          tabIndex: -1,
          'aria-label': labels.handle(nameOf(item)),
          onPointerDown: stop,
          onClick: (event: ReactMouseEvent) => {
            stop(event);
            lift(getKey(item));
          },
        },
        props,
      ) as never,
    getOverlayProps: (props) =>
      withUserProps(
        {
          ref: overlayCallback,
          'data-dropping': drag?.dropping || undefined,
          style: drag ? { width: drag.width, height: drag.height } : undefined,
          'aria-hidden': true,
          inert: inertAttr(true),
        },
        props,
      ) as never,
    getInstructionsProps: (props) => withUserProps({ id: instructionsId, children: labels.instructions }, props),
  };
}
