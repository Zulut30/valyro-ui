'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { getDirection, inlineArrowStep, useEventCallback, useLatest } from '../primitives/utils';
import { useLayoutEffect } from '../primitives/react-compat';
import { useNodeRef, withUserProps, type UserProps } from '../primitives/prop-getters';
import {
  defaultLayout,
  fuzzyEqual,
  isCollapsed,
  isPixelSize,
  layoutsEqual,
  lowestSize,
  normalizeConstraints,
  readSavedLayout,
  resizeLayout,
  resizePanel,
  resolvePanelSize,
  validateLayout,
  writeSavedLayout,
  type PanelSize,
} from './resizable';

/*
 * The behaviour of ResizablePanels without its markup: panel sizes in percent (controlled or not, saved in
 * localStorage with `autoSaveId`), limits in percent or pixels, collapsing, and the WAI-ARIA window splitter on each
 * handle: drag it (Escape puts the panels back), arrows (Shift for bigger steps; mirrored under RTL), Home / End,
 * Enter collapses or expands, a double click restores the default size. ResizablePanels renders with it; its
 * Panel and Handle components register themselves and hand the hook the panels in DOM order.
 */

export type ResizableDirection = 'horizontal' | 'vertical';

/** A panel, as the hook sees it. */
export interface ResizablePanelDescriptor {
  /** Unique id of the panel; the handle before it points at it (`aria-controls`). */
  id: string;
  /** Key of the panel in a saved layout (default: its position). */
  persistId?: string;
  /** Size in percent before any interaction. */
  defaultSize?: number;
  /** Smallest size while open: percent, or pixels as `'200px'`. */
  minSize?: PanelSize;
  /** Largest size: percent, or pixels as `'480px'`. */
  maxSize?: PanelSize;
  /** Dragging below `minSize` past the halfway point snaps it to `collapsedSize`. */
  collapsible?: boolean;
  collapsedSize?: PanelSize;
  onCollapse?: () => void;
  onExpand?: () => void;
  onResize?: (size: number) => void;
}

export interface ResizablePanelsOptions {
  /** The panels in order. */
  panels: ResizablePanelDescriptor[];
  /** `horizontal`: side by side (following the reading direction); `vertical`: stacked. */
  direction?: ResizableDirection;
  /** Sizes in percent, in panel order. Controlled: pair with `onLayout`. */
  layout?: number[];
  onLayout?: (layout: number[]) => void;
  /** Remembers the layout in localStorage under this id and restores it (after hydration). */
  autoSaveId?: string;
  /** Percent an arrow key moves a handle; Shift moves five times as far. Default 2. */
  keyboardStep?: number;
  /** Locale of the handle's value text ("40 %" or "40%"), which screen readers read instead of the bare number. Default: the browser's. */
  locale?: string;
}

export interface ResizablePanelsState {
  /** Sizes in percent, in panel order. */
  layout: number[];
  /** Index of the panel before the handle being dragged, or null. */
  activeHandle: number | null;
  /** Panels animate size changes now (not while dragging, nor before the first paint). */
  animate: boolean;
  groupRef: RefObject<HTMLElement | null>;
  collapse: (index: number) => void;
  /** Reopens a collapsed panel at the size it had before collapsing. */
  expand: (index: number) => void;
  /** Sets a panel's size in percent, within its limits. */
  resize: (index: number, size: number) => void;
  isCollapsed: (index: number) => boolean;
  /** The element around the panels and handles. */
  getGroupProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** A panel: its flex size, collapsed state and id. */
  getPanelProps: (panel: { id: string; defaultSize?: number }, props?: UserProps) => HTMLAttributes<HTMLElement> & {
    style: CSSProperties;
  };
  /**
   * The handle after the panel at `index`: a focusable `separator` with the size of that panel as its value. Name
   * it with `aria-label`; `disabled` leaves it in place but inert.
   */
  getHandleProps: (index: number, props?: UserProps & { disabled?: boolean }) => HTMLAttributes<HTMLElement>;
}

/** Layout pixels (untransformed) that the panels of `group` share: the group's box minus its handles. */
function handlesSize(group: HTMLElement, direction: ResizableDirection) {
  const horizontal = direction === 'horizontal';
  return Array.from(group.querySelectorAll<HTMLElement>('[data-resizable-item="handle"]'))
    .filter((el) => el.parentElement?.closest('[data-resizable-group]') === group)
    .reduce((total, el) => total + (horizontal ? el.offsetWidth : el.offsetHeight), 0);
}
function freeSpace(group: HTMLElement, direction: ResizableDirection) {
  return (direction === 'horizontal' ? group.clientWidth : group.clientHeight) - handlesSize(group, direction);
}

const round = (size: number) => Math.round(size * 10) / 10;

interface DragState {
  pointerId: number;
  pivot: number;
  start: number;
  base: number[];
  /** Pixels that 100% stands for: the group minus its handles. */
  free: number;
  /** -1 when dragging right moves the handle towards the start (horizontal RTL). */
  sign: 1 | -1;
}

export function useResizablePanels({
  panels,
  direction = 'horizontal',
  layout: layoutProp,
  onLayout,
  autoSaveId,
  keyboardStep = 2,
  locale,
}: ResizablePanelsOptions): ResizablePanelsState {
  const [groupRef, setGroupNode] = useNodeRef();
  const [inner, setInner] = useState<{ key: string; sizes: number[] } | null>(null);
  const [activeHandle, setActiveHandle] = useState<number | null>(null);
  const [painted, setPainted] = useState(false);
  const drag = useRef<DragState | null>(null);
  // The size of the panel before a handle, read as a percentage ("40%") rather than a bare number.
  const percent = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }), [locale]);
  /** Size each panel had before it last collapsed, for expand(). */
  const expandSizes = useRef(new Map<string, number>());
  /** Size and collapsed state each panel last reported (pixel limits move the collapsed size as the group resizes). */
  const lastSizes = useRef(new Map<string, { size: number; collapsed: boolean }>());
  const storageWarned = useRef(false);
  /** Pixels the panels share; measured only while some panel has a pixel limit (0 = not measured). */
  const [free, setFree] = useState(0);
  const latestPanels = useLatest(panels);
  // The panels' ids and limits: what the layout depends on (callbacks are read from the latest render).
  const signature = JSON.stringify(
    panels.map(({ id, persistId, defaultSize, minSize, maxSize, collapsible, collapsedSize }) => [
      id,
      persistId,
      defaultSize,
      minSize,
      maxSize,
      collapsible,
      collapsedSize,
    ]),
  );
  const pixelLimits = panels.some(({ minSize, maxSize, collapsedSize }) => isPixelSize(minSize) || isPixelSize(maxSize) || isPixelSize(collapsedSize));

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group || !pixelLimits) return;
    const measure = () => setFree(Math.max(0, freeSpace(group, direction)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [pixelLimits, direction, signature]);

  const constraints = useMemo(
    () =>
      panels.map((sizes) =>
        normalizeConstraints({
          defaultSize: sizes.defaultSize,
          minSize: resolvePanelSize(sizes.minSize, free),
          maxSize: resolvePanelSize(sizes.maxSize, free),
          collapsible: sizes.collapsible,
          collapsedSize: resolvePanelSize(sizes.collapsedSize, free),
        }),
      ),
    [signature, free],
  );
  // Keyed by the signature: an inline `panels` array is new on every render.
  const panelKey = useMemo(() => panels.map((p, i) => p.persistId ?? String(i)).join(','), [signature]);
  const fallback = useMemo(() => defaultLayout(constraints), [constraints]);
  const layout = useMemo(() => {
    const source = layoutProp ?? (inner?.key === panelKey ? inner.sizes : null);
    return source && source.length === constraints.length ? validateLayout(source, constraints) : fallback;
  }, [layoutProp, inner, panelKey, constraints, fallback]);
  const latest = useLatest({ layout, constraints, fallback, panelKey, controlled: layoutProp !== undefined });

  useEffect(() => setPainted(true), []);

  const commit = useEventCallback((next: number[], base: readonly number[] = latest.current.layout) => {
    const { layout: current, constraints: c, panelKey: key, controlled } = latest.current;
    if (layoutsEqual(current, next)) return;
    latestPanels.current.forEach((panel, i) => {
      if (isCollapsed(next[i], c[i]) && !isCollapsed(base[i], c[i])) {
        expandSizes.current.set(panel.id, base[i]);
      }
    });
    if (!controlled) setInner({ key, sizes: next });
    onLayout?.(next);
  });

  // Restore a saved layout once the panels are known (and again if the set of panels changes).
  useLayoutEffect(() => {
    if (!autoSaveId || !panelKey) return;
    const { constraints: current } = latest.current;
    let saved: number[] | null;
    try {
      saved = readSavedLayout(window.localStorage, autoSaveId, panelKey, current.length);
    } catch (error) {
      console.warn(`ResizablePanels: could not restore the saved layout "${autoSaveId}".`, error);
      return;
    }
    if (saved) commit(validateLayout(saved, current));
  }, [autoSaveId, panelKey, latest, commit]);

  useEffect(() => {
    if (!autoSaveId || !panelKey || !painted) return;
    const timer = window.setTimeout(() => {
      try {
        writeSavedLayout(window.localStorage, autoSaveId, panelKey, layout);
      } catch (error) {
        // Once per group: a drag writes many times and storage that fails (private mode, quota) keeps failing.
        if (storageWarned.current) return;
        storageWarned.current = true;
        console.warn(`ResizablePanels: could not save the layout "${autoSaveId}".`, error);
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [autoSaveId, panelKey, layout, painted]);

  // Per-panel callbacks, fired after the layout settles.
  useEffect(() => {
    const previous = lastSizes.current;
    const sizes = new Map<string, { size: number; collapsed: boolean }>();
    latestPanels.current.forEach((panel, i) => {
      const size = layout[i];
      const before = previous.get(panel.id);
      const now = isCollapsed(size, constraints[i]);
      sizes.set(panel.id, { size, collapsed: now });
      if (before === undefined || !fuzzyEqual(before.size, size)) panel.onResize?.(size);
      const was = before !== undefined && before.collapsed;
      if (now && !was) panel.onCollapse?.();
      else if (!now && was) panel.onExpand?.();
    });
    lastSizes.current = sizes;
  }, [layout, signature, constraints]);

  const collapse = useEventCallback((index: number) => {
    const { layout: current, constraints: c } = latest.current;
    if (index < 0 || !c[index]?.collapsible || isCollapsed(current[index], c[index])) return;
    commit(resizePanel(current, c, index, c[index].collapsedSize, { discrete: true }));
  });

  const expand = useEventCallback((index: number) => {
    const { layout: current, constraints: c } = latest.current;
    if (index < 0 || !c[index] || !isCollapsed(current[index], c[index])) return;
    const remembered = expandSizes.current.get(latestPanels.current[index].id) ?? c[index].defaultSize ?? c[index].minSize;
    commit(resizePanel(current, c, index, Math.max(remembered, c[index].minSize), { discrete: true }));
  });

  const resize = useEventCallback((index: number, size: number) => {
    const { layout: current, constraints: c } = latest.current;
    if (index < 0 || !c[index] || !Number.isFinite(size)) return;
    commit(resizePanel(current, c, index, size, { discrete: true }));
  });

  const endDrag = useCallback(() => {
    drag.current = null;
    setActiveHandle(null);
    delete document.documentElement.dataset.uiResizing;
  }, []);

  // Escape during a drag puts the panels back.
  useEffect(() => {
    if (activeHandle === null) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const state = drag.current;
      if (event.key !== 'Escape' || !state) return;
      event.preventDefault();
      event.stopPropagation();
      commit(state.base);
      endDrag();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeHandle, commit, endDrag]);

  // A drag in progress must not leave the global cursor behind.
  useEffect(() => () => void delete document.documentElement.dataset.uiResizing, []);

  const validPivot = (pivot: number) => pivot >= 0 && pivot < latest.current.layout.length - 1;

  const onPointerDown = useEventCallback((pivot: number, event: ReactPointerEvent<HTMLElement>) => {
    const group = groupRef.current;
    if (!group || !validPivot(pivot)) return;
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });

    const horizontal = direction === 'horizontal';
    const rect = group.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      pivot,
      start: horizontal ? event.clientX : event.clientY,
      base: latest.current.layout,
      free: Math.max(1, (horizontal ? rect.width : rect.height) - handlesSize(group, direction)),
      sign: horizontal && getDirection(group) === 'rtl' ? -1 : 1,
    };
    setActiveHandle(pivot);
    document.documentElement.dataset.uiResizing = direction;
  });

  const onPointerMove = useEventCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const position = direction === 'horizontal' ? event.clientX : event.clientY;
    const delta = (((position - state.start) * state.sign) / state.free) * 100;
    commit(resizeLayout(state.base, latest.current.constraints, state.pivot, delta), state.base);
  });

  const onPointerEnd = useEventCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    endDrag();
  });

  const onKeyDown = useEventCallback((pivot: number, event: KeyboardEvent<HTMLElement>) => {
    const { layout: current, constraints: c } = latest.current;
    if (!validPivot(pivot) || drag.current) return;
    const horizontal = direction === 'horizontal';
    const step = event.shiftKey ? keyboardStep * 5 : keyboardStep;
    const discrete = { discrete: true };
    let next: number[];
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!horizontal) return;
        next = resizeLayout(current, c, pivot, inlineArrowStep(event.key, getDirection(event.currentTarget)) * step, discrete);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (horizontal) return;
        next = resizeLayout(current, c, pivot, event.key === 'ArrowDown' ? step : -step, discrete);
        break;
      case 'Home':
        next = resizePanel(current, c, pivot, lowestSize(c[pivot]), discrete);
        break;
      case 'End':
        next = resizePanel(current, c, pivot, c[pivot].maxSize, discrete);
        break;
      case 'Enter': {
        event.preventDefault();
        // The panel before the handle when it can collapse, else the one after (e.g. a bottom terminal).
        const target = c[pivot].collapsible ? pivot : c[pivot + 1].collapsible ? pivot + 1 : -1;
        if (target === -1) return;
        if (isCollapsed(current[target], c[target])) expand(target);
        else collapse(target);
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    commit(next);
  });

  const onDoubleClick = useEventCallback((pivot: number) => {
    const { layout: current, constraints: c, fallback: defaults } = latest.current;
    if (!validPivot(pivot)) return;
    commit(resizePanel(current, c, pivot, defaults[pivot], { discrete: true }));
  });

  const animate = painted && activeHandle === null;

  return {
    layout,
    activeHandle,
    animate,
    groupRef,
    collapse,
    expand,
    resize,
    isCollapsed: (index) => index >= 0 && index < layout.length && isCollapsed(layout[index], constraints[index]),
    getGroupProps: (props) =>
      withUserProps(
        {
          ref: setGroupNode,
          'data-direction': direction,
          'data-resizable-group': '',
          'data-resizing': activeHandle !== null ? '' : undefined,
        },
        props,
      ) as never,
    getPanelProps: (panel, props) => {
      const index = panels.findIndex((p) => p.id === panel.id);
      const size = index === -1 ? undefined : layout[index];
      const grow = size ?? panel.defaultSize;
      const style = (props?.style ?? {}) as CSSProperties;
      return withUserProps(
        {
          id: panel.id,
          'data-resizable-item': 'panel',
          'data-resizable-id': panel.id,
          'data-collapsed': (index !== -1 && isCollapsed(layout[index], constraints[index])) || undefined,
          'data-animate': animate || undefined,
        },
        {
          ...props,
          style: {
            ...style,
            flex: grow === undefined ? '1 1 0px' : `${grow} 1 0px`,
            // A panel collapsed to nothing keeps its content out of the tab order and the accessibility tree.
            visibility: size === 0 ? 'hidden' : style.visibility,
          },
        },
      ) as never;
    },
    getHandleProps: (pivot, { disabled = false, ...props } = {}) => {
      const valid = pivot >= 0 && pivot < layout.length - 1;
      const c = valid ? constraints[pivot] : undefined;
      return withUserProps(
        {
          role: 'separator',
          tabIndex: disabled ? undefined : 0,
          // Named by the caller ("Resize sidebar"); listed here so the name comes before the orientation.
          'aria-label': undefined,
          // A vertical divider separates panels laid out side by side.
          'aria-orientation': direction === 'horizontal' ? 'vertical' : 'horizontal',
          'aria-controls': valid ? panels[pivot].id : undefined,
          'aria-valuenow': valid ? round(layout[pivot]) : undefined,
          'aria-valuemin': c ? round(lowestSize(c)) : undefined,
          'aria-valuemax': c ? round(c.maxSize) : undefined,
          'aria-valuetext': valid ? percent.format(round(layout[pivot]) / 100) : undefined,
          'aria-disabled': disabled || undefined,
          'data-resizable-item': 'handle',
          'data-direction': direction,
          'data-active': (valid && activeHandle === pivot) || undefined,
          'data-disabled': disabled || undefined,
          onPointerDown: (event: ReactPointerEvent<HTMLElement>) => !disabled && onPointerDown(pivot, event),
          onPointerMove,
          onPointerUp: onPointerEnd,
          onPointerCancel: onPointerEnd,
          onLostPointerCapture: onPointerEnd,
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => !disabled && onKeyDown(pivot, event),
          onDoubleClick: () => !disabled && onDoubleClick(pivot),
        },
        props,
      );
    },
  };
}
