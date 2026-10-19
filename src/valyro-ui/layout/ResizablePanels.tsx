'use client';

import { createContext, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState, type ComponentPropsWithRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref, type RefObject } from 'react';
import { GripVerticalIcon } from '../icons';
import { composeHandlers, cx, getDirection, inlineArrowStep, mergeRefs, useEventCallback, useLatest } from '../primitives';
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
import './ResizablePanels.css';
import { withRef, useId, useLayoutEffect } from '../primitives/react-compat';

export type ResizableDirection = 'horizontal' | 'vertical';

/** A panel limit: percent of the group, or pixels as a `'240px'` string (re-resolved as the group resizes). */
export type ResizablePanelSize = PanelSize;

export interface ResizablePanelsProps extends ComponentPropsWithRef<'div'> {
  /** `horizontal` puts panels side by side (following the reading direction); `vertical` stacks them. */
  direction?: ResizableDirection;
  /** Panel sizes in percent, in panel order. Controlled: pair with `onLayout`. */
  layout?: number[];
  /** Called with the new sizes on every drag step, key press, collapse or expand, and when a saved layout is restored. */
  onLayout?: (layout: number[]) => void;
  /** Remembers the layout in localStorage under this id and restores it on mount (after hydration). */
  autoSaveId?: string;
  /** Percent an arrow key moves a focused handle; Shift moves five times as far. */
  keyboardStep?: number;
}

export interface ResizablePanelApi {
  collapse: () => void;
  /** Reopens a collapsed panel at the size it had before collapsing. */
  expand: () => void;
  /** Sets the size in percent, within the panel's limits. */
  resize: (size: number) => void;
  getSize: () => number | undefined;
  isCollapsed: () => boolean;
}

export interface ResizablePanelProps extends ComponentPropsWithRef<'div'> {
  /** Size in percent before any interaction. Give every panel one so the server render matches. */
  defaultSize?: number;
  /**
   * Smallest size while open: percent, or pixels as `'200px'` so the panel never gets too narrow to read,
   * however small the group.
   */
  minSize?: ResizablePanelSize;
  /** Largest size: percent, or pixels as `'480px'`. */
  maxSize?: ResizablePanelSize;
  /** Dragging below `minSize` past the halfway point snaps the panel to `collapsedSize`. */
  collapsible?: boolean;
  /** Size when collapsed, e.g. room for an icon rail: percent, or pixels as `'56px'`. */
  collapsedSize?: ResizablePanelSize;
  onCollapse?: () => void;
  onExpand?: () => void;
  /** Called with the size in percent whenever it changes. */
  onResize?: (size: number) => void;
  /** Imperative collapse / expand / resize. */
  panelRef?: Ref<ResizablePanelApi>;
}

export interface ResizableHandleProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Shows a grip in the middle of the divider. */
  withHandle?: boolean;
  disabled?: boolean;
  /** Accessible name; name what it resizes, e.g. "Resize sidebar". */
  label?: string;
}

interface PanelCallbacks {
  onCollapse?: () => void;
  onExpand?: () => void;
  onResize?: (size: number) => void;
}

/** A panel's limits as given; pixel sizes become percents once the group is measured. */
interface PanelSizes {
  defaultSize?: number;
  minSize?: PanelSize;
  maxSize?: PanelSize;
  collapsible?: boolean;
  collapsedSize?: PanelSize;
}

interface PanelEntry {
  id: string;
  /** The panel's own `id` prop, used as its key in saved layouts (else its position). */
  persistId?: string;
  sizes: PanelSizes;
  callbacks: RefObject<PanelCallbacks>;
}

interface Structure {
  panels: PanelEntry[];
  /** Handle id → index of the panel before it. */
  handles: Map<string, number>;
  signature: string;
}

interface HandleState {
  controls?: string;
  valueNow?: number;
  valueMin?: number;
  valueMax?: number;
}

interface GroupContextValue {
  direction: ResizableDirection;
  /** Panels animate size changes (not while dragging, nor before the first paint). */
  animate: boolean;
  activeHandle: string | null;
  registerPanel: (entry: PanelEntry) => () => void;
  registerHandle: (id: string) => () => void;
  sizeOf: (id: string) => number | undefined;
  collapsedOf: (id: string) => boolean;
  handleState: (id: string) => HandleState;
  api: (id: string) => ResizablePanelApi;
  onHandlePointerDown: (id: string, event: ReactPointerEvent<HTMLDivElement>) => void;
  onHandlePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onHandlePointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onHandleKeyDown: (id: string, event: KeyboardEvent<HTMLDivElement>) => void;
  onHandleDoubleClick: (id: string) => void;
}

const GroupContext = createContext<GroupContextValue | null>(null);

function useGroup(component: string) {
  const group = useContext(GroupContext);
  if (!group) throw new Error(`${component} must be rendered inside <ResizablePanels>.`);
  return group;
}

const EMPTY: Structure = { panels: [], handles: new Map(), signature: '' };
const round = (size: number) => Math.round(size * 10) / 10;

/** Panels and handles of `group` in DOM order, skipping those of nested groups. */
function ownItems(group: HTMLElement) {
  return Array.from(group.querySelectorAll<HTMLElement>('[data-resizable-item]')).filter(
    (el) => el.parentElement?.closest('[data-resizable-group]') === group,
  );
}

/** Layout pixels (untransformed) that the panels of `group` share: the group's box minus its handles. */
function freeSpace(group: HTMLElement, direction: ResizableDirection) {
  const horizontal = direction === 'horizontal';
  const handles = ownItems(group)
    .filter((el) => el.dataset.resizableItem === 'handle')
    .reduce((total, el) => total + (horizontal ? el.offsetWidth : el.offsetHeight), 0);
  return (horizontal ? group.clientWidth : group.clientHeight) - handles;
}

const hasPixelSize = ({ minSize, maxSize, collapsedSize }: PanelSizes) =>
  isPixelSize(minSize) || isPixelSize(maxSize) || isPixelSize(collapsedSize);

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

export const ResizablePanels = withRef(function ResizablePanels({
  direction = 'horizontal',
  layout: layoutProp,
  onLayout,
  autoSaveId,
  keyboardStep = 2,
  className,
  children,
  ref,
  ...rest
}: ResizablePanelsProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const registry = useRef(new Map<string, PanelEntry>());
  const handleIds = useRef(new Set<string>());
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const [structure, setStructure] = useState<Structure>(EMPTY);
  const [inner, setInner] = useState<{ key: string; sizes: number[] } | null>(null);
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [painted, setPainted] = useState(false);
  const drag = useRef<DragState | null>(null);
  /** Size each panel had before it last collapsed, for expand(). */
  const expandSizes = useRef(new Map<string, number>());
  /** Size and collapsed state each panel last reported (pixel limits move the collapsed size as the group resizes). */
  const lastSizes = useRef(new Map<string, { size: number; collapsed: boolean }>());
  const storageWarned = useRef(false);
  /** Pixels the panels share; measured only while some panel has a pixel limit (0 = not measured). */
  const [free, setFree] = useState(0);
  const pixelLimits = structure.panels.some((p) => hasPixelSize(p.sizes));

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group || !pixelLimits) return;
    const measure = () => setFree(Math.max(0, freeSpace(group, direction)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [pixelLimits, direction, structure]);

  const constraints = useMemo(
    () =>
      structure.panels.map(({ sizes }) =>
        normalizeConstraints({
          defaultSize: sizes.defaultSize,
          minSize: resolvePanelSize(sizes.minSize, free),
          maxSize: resolvePanelSize(sizes.maxSize, free),
          collapsible: sizes.collapsible,
          collapsedSize: resolvePanelSize(sizes.collapsedSize, free),
        }),
      ),
    [structure, free],
  );
  const panelKey = useMemo(() => structure.panels.map((p, i) => p.persistId ?? String(i)).join(','), [structure]);
  const fallback = useMemo(() => defaultLayout(constraints), [constraints]);
  const layout = useMemo(() => {
    const source = layoutProp ?? (inner?.key === panelKey ? inner.sizes : null);
    return source && source.length === constraints.length ? validateLayout(source, constraints) : fallback;
  }, [layoutProp, inner, panelKey, constraints, fallback]);
  const latest = useLatest({ layout, constraints, structure, fallback, panelKey, controlled: layoutProp !== undefined });

  // Panels and handles register in their own layout effects, which run before this one.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const panels: PanelEntry[] = [];
    const handles = new Map<string, number>();
    for (const el of ownItems(group)) {
      const id = el.dataset.resizableId ?? '';
      if (el.dataset.resizableItem === 'panel') {
        const entry = registry.current.get(id);
        if (entry) panels.push(entry);
      } else if (handleIds.current.has(id)) {
        handles.set(id, panels.length - 1);
      }
    }
    const signature = JSON.stringify([panels.map((p) => [p.id, p.persistId, p.sizes]), [...handles]]);
    setStructure((prev) => (prev.signature === signature ? prev : { panels, handles, signature }));
  }, [version]);

  useEffect(() => setPainted(true), []);

  const commit = useEventCallback((next: number[], base: readonly number[] = latest.current.layout) => {
    const { layout: current, structure: s, constraints: c, panelKey: key, controlled } = latest.current;
    if (layoutsEqual(current, next)) return;
    s.panels.forEach((panel, i) => {
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
    structure.panels.forEach((panel, i) => {
      const size = layout[i];
      const before = previous.get(panel.id);
      const now = isCollapsed(size, constraints[i]);
      sizes.set(panel.id, { size, collapsed: now });
      const callbacks = panel.callbacks.current;
      if (before === undefined || !fuzzyEqual(before.size, size)) callbacks.onResize?.(size);
      const was = before !== undefined && before.collapsed;
      if (now && !was) callbacks.onCollapse?.();
      else if (!now && was) callbacks.onExpand?.();
    });
    lastSizes.current = sizes;
  }, [layout, structure, constraints]);

  const collapse = useEventCallback((index: number) => {
    const { layout: current, constraints: c } = latest.current;
    if (index < 0 || !c[index].collapsible || isCollapsed(current[index], c[index])) return;
    commit(resizePanel(current, c, index, c[index].collapsedSize, { discrete: true }));
  });

  const expand = useEventCallback((index: number) => {
    const { layout: current, constraints: c, structure: s } = latest.current;
    if (index < 0 || !isCollapsed(current[index], c[index])) return;
    const remembered = expandSizes.current.get(s.panels[index].id) ?? c[index].defaultSize ?? c[index].minSize;
    commit(resizePanel(current, c, index, Math.max(remembered, c[index].minSize), { discrete: true }));
  });

  const resizeTo = useEventCallback((index: number, size: number) => {
    const { layout: current, constraints: c } = latest.current;
    if (index < 0 || !Number.isFinite(size)) return;
    commit(resizePanel(current, c, index, size, { discrete: true }));
  });

  const endDrag = useCallback(() => {
    drag.current = null;
    setActiveHandle(null);
    delete document.documentElement.dataset.uiResizing;
  }, []);

  // Escape during a drag puts the panels back.
  useEffect(() => {
    if (!activeHandle) return;
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

  const onHandlePointerDown = useEventCallback((id: string, event: ReactPointerEvent<HTMLDivElement>) => {
    const group = groupRef.current;
    const pivot = latest.current.structure.handles.get(id);
    if (!group || pivot === undefined || pivot < 0 || pivot >= latest.current.layout.length - 1) return;
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });

    const horizontal = direction === 'horizontal';
    const rect = group.getBoundingClientRect();
    const handlesSize = ownItems(group)
      .filter((el) => el.dataset.resizableItem === 'handle')
      .reduce((total, el) => total + (horizontal ? el.offsetWidth : el.offsetHeight), 0);
    drag.current = {
      pointerId: event.pointerId,
      pivot,
      start: horizontal ? event.clientX : event.clientY,
      base: latest.current.layout,
      free: Math.max(1, (horizontal ? rect.width : rect.height) - handlesSize),
      sign: horizontal && getDirection(group) === 'rtl' ? -1 : 1,
    };
    setActiveHandle(id);
    document.documentElement.dataset.uiResizing = direction;
  });

  const onHandlePointerMove = useEventCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const position = direction === 'horizontal' ? event.clientX : event.clientY;
    const delta = (((position - state.start) * state.sign) / state.free) * 100;
    commit(resizeLayout(state.base, latest.current.constraints, state.pivot, delta), state.base);
  });

  const onHandlePointerEnd = useEventCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    endDrag();
  });

  const onHandleKeyDown = useEventCallback((id: string, event: KeyboardEvent<HTMLDivElement>) => {
    const pivot = latest.current.structure.handles.get(id);
    const { layout: current, constraints: c } = latest.current;
    if (pivot === undefined || pivot < 0 || pivot >= current.length - 1 || drag.current) return;
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

  const onHandleDoubleClick = useEventCallback((id: string) => {
    const pivot = latest.current.structure.handles.get(id);
    const { layout: current, constraints: c, fallback: defaults } = latest.current;
    if (pivot === undefined || pivot < 0 || pivot >= current.length - 1) return;
    commit(resizePanel(current, c, pivot, defaults[pivot], { discrete: true }));
  });

  const registerPanel = useCallback((entry: PanelEntry) => {
    registry.current.set(entry.id, entry);
    bump();
    return () => {
      if (registry.current.get(entry.id) === entry) registry.current.delete(entry.id);
      bump();
    };
  }, []);

  const registerHandle = useCallback((id: string) => {
    handleIds.current.add(id);
    bump();
    return () => {
      handleIds.current.delete(id);
      bump();
    };
  }, []);

  const apis = useRef(new Map<string, ResizablePanelApi>());
  const api = useCallback(
    (id: string) => {
      const indexOf = (panelId: string) => latest.current.structure.panels.findIndex((p) => p.id === panelId);
      let value = apis.current.get(id);
      if (!value) {
        value = {
          collapse: () => collapse(indexOf(id)),
          expand: () => expand(indexOf(id)),
          resize: (size) => resizeTo(indexOf(id), size),
          getSize: () => latest.current.layout[indexOf(id)],
          isCollapsed: () => {
            const i = indexOf(id);
            return i !== -1 && isCollapsed(latest.current.layout[i], latest.current.constraints[i]);
          },
        };
        apis.current.set(id, value);
      }
      return value;
    },
    [collapse, expand, resizeTo, latest],
  );

  const context = useMemo<GroupContextValue>(() => {
    const indexById = new Map(structure.panels.map((p, i) => [p.id, i]));
    return {
      direction,
      animate: painted && !activeHandle,
      activeHandle,
      registerPanel,
      registerHandle,
      sizeOf: (id) => {
        const i = indexById.get(id);
        return i === undefined ? undefined : layout[i];
      },
      collapsedOf: (id) => {
        const i = indexById.get(id);
        return i !== undefined && isCollapsed(layout[i], constraints[i]);
      },
      handleState: (id) => {
        const pivot = structure.handles.get(id);
        if (pivot === undefined || pivot < 0 || pivot >= layout.length - 1) return {};
        const c = constraints[pivot];
        return {
          controls: structure.panels[pivot].id,
          valueNow: round(layout[pivot]),
          valueMin: round(lowestSize(c)),
          valueMax: round(c.maxSize),
        };
      },
      api,
      onHandlePointerDown,
      onHandlePointerMove,
      onHandlePointerEnd,
      onHandleKeyDown,
      onHandleDoubleClick,
    };
  }, [
    direction,
    painted,
    activeHandle,
    structure,
    layout,
    constraints,
    registerPanel,
    registerHandle,
    api,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerEnd,
    onHandleKeyDown,
    onHandleDoubleClick,
  ]);

  return (
    <div
      {...rest}
      ref={mergeRefs(groupRef, ref)}
      className={cx('ui-resizable-panels', className)}
      data-direction={direction}
      data-resizable-group=""
      data-resizing={activeHandle ? '' : undefined}
    >
      <GroupContext.Provider value={context}>{children}</GroupContext.Provider>
    </div>
  );
});

export const ResizablePanel = withRef(function ResizablePanel({
  id: idProp,
  defaultSize,
  minSize,
  maxSize,
  collapsible,
  collapsedSize,
  onCollapse,
  onExpand,
  onResize,
  panelRef,
  className,
  style,
  children,
  ref,
  ...rest
}: ResizablePanelProps) {
  const group = useGroup('ResizablePanel');
  const autoId = useId();
  const id = idProp ?? autoId;
  const callbacks = useLatest<PanelCallbacks>({ onCollapse, onExpand, onResize });
  const { registerPanel } = group;

  useLayoutEffect(
    () =>
      registerPanel({
        id,
        persistId: idProp,
        sizes: { defaultSize, minSize, maxSize, collapsible, collapsedSize },
        callbacks,
      }),
    [registerPanel, id, idProp, defaultSize, minSize, maxSize, collapsible, collapsedSize, callbacks],
  );

  const { api } = group;
  useImperativeHandle(panelRef, () => api(id), [api, id]);

  const size = group.sizeOf(id);
  const grow = size ?? defaultSize;
  return (
    <div
      {...rest}
      ref={ref}
      id={id}
      className={cx('ui-resizable-panel', className)}
      data-resizable-item="panel"
      data-resizable-id={id}
      data-collapsed={group.collapsedOf(id) || undefined}
      data-animate={group.animate || undefined}
      style={{
        ...style,
        flex: grow === undefined ? '1 1 0px' : `${grow} 1 0px`,
        // A panel collapsed to nothing keeps its content out of the tab order and the accessibility tree.
        visibility: size === 0 ? 'hidden' : style?.visibility,
      }}
    >
      {children}
    </div>
  );
});

export const ResizableHandle = withRef(function ResizableHandle({
  withHandle = false,
  disabled = false,
  label = 'Resize',
  className,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onKeyDown,
  onDoubleClick,
  ref,
  ...rest
}: ResizableHandleProps) {
  const group = useGroup('ResizableHandle');
  const id = useId();
  const { registerHandle } = group;
  useLayoutEffect(() => registerHandle(id), [registerHandle, id]);
  const state = group.handleState(id);
  const active = group.activeHandle === id;

  return (
    <div
      {...rest}
      ref={ref}
      role="separator"
      tabIndex={disabled ? undefined : 0}
      aria-label={label}
      // A vertical divider separates panels laid out side by side.
      aria-orientation={group.direction === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-controls={state.controls}
      aria-valuenow={state.valueNow}
      aria-valuemin={state.valueMin}
      aria-valuemax={state.valueMax}
      aria-disabled={disabled || undefined}
      className={cx('ui-resizable-handle', className)}
      data-resizable-item="handle"
      data-resizable-id={id}
      data-direction={group.direction}
      data-active={active || undefined}
      data-disabled={disabled || undefined}
      onPointerDown={composeHandlers(onPointerDown, (event) => !disabled && group.onHandlePointerDown(id, event))}
      onPointerMove={composeHandlers(onPointerMove, group.onHandlePointerMove)}
      onPointerUp={composeHandlers(onPointerUp, group.onHandlePointerEnd)}
      onPointerCancel={composeHandlers(onPointerCancel, group.onHandlePointerEnd)}
      onLostPointerCapture={composeHandlers(onLostPointerCapture, group.onHandlePointerEnd)}
      onKeyDown={composeHandlers(onKeyDown, (event) => !disabled && group.onHandleKeyDown(id, event))}
      onDoubleClick={composeHandlers(onDoubleClick, () => !disabled && group.onHandleDoubleClick(id))}
    >
      {withHandle && (
        <span className="ui-resizable-handle__grip" aria-hidden="true">
          <GripVerticalIcon size={12} />
        </span>
      )}
    </div>
  );
});
