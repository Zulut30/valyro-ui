'use client';

import { createContext, useCallback, useContext, useImperativeHandle, useMemo, useReducer, useRef, useState, type ComponentPropsWithRef, type Ref, type RefObject } from 'react';
import { GripVerticalIcon } from '../icons';
import { cx, useLatest } from '../primitives';
import type { PanelSize } from './resizable';
import {
  useResizablePanels,
  type ResizableDirection,
  type ResizablePanelDescriptor,
  type ResizablePanelsState,
} from './useResizablePanels';
import { useLocale } from '../theme/ThemeProvider';
import './ResizablePanels.css';
import { withRef, useId, useLayoutEffect } from '../primitives/react-compat';

export type { ResizableDirection } from './useResizablePanels';

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

interface GroupContextValue {
  /** The group's useResizablePanels: panels and handles render with its getters. */
  state: ResizablePanelsState;
  registerPanel: (entry: PanelEntry) => () => void;
  registerHandle: (id: string) => () => void;
  /** Index of the panel before the handle with `id` (-1 until the group has measured its children). */
  pivotOf: (id: string) => number;
  api: (id: string) => ResizablePanelApi;
}

const GroupContext = createContext<GroupContextValue | null>(null);

function useGroup(component: string) {
  const group = useContext(GroupContext);
  if (!group) throw new Error(`${component} must be rendered inside <ResizablePanels>.`);
  return group;
}

const EMPTY: Structure = { panels: [], handles: new Map(), signature: '' };

/** Panels and handles of `group` in DOM order, skipping those of nested groups. */
function ownItems(group: HTMLElement) {
  return Array.from(group.querySelectorAll<HTMLElement>('[data-resizable-item]')).filter(
    (el) => el.parentElement?.closest('[data-resizable-group]') === group,
  );
}

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

  return (
    <div {...group.state.getPanelProps({ id, defaultSize }, { ...rest, ref, className: cx('ui-resizable-panel', className) })}>
      {children}
    </div>
  );
});

export const ResizableHandle = withRef(function ResizableHandle({
  withHandle = false,
  disabled = false,
  label = 'Resize',
  className,
  ref,
  ...rest
}: ResizableHandleProps) {
  const group = useGroup('ResizableHandle');
  const id = useId();
  const { registerHandle } = group;
  useLayoutEffect(() => registerHandle(id), [registerHandle, id]);

  return (
    <div
      {...group.state.getHandleProps(group.pivotOf(id), {
        ...rest,
        ref,
        disabled,
        'aria-label': label,
        className: cx('ui-resizable-handle', className),
        'data-resizable-id': id,
      })}
    >
      {withHandle && (
        <span className="ui-resizable-handle__grip" aria-hidden="true">
          <GripVerticalIcon size={12} />
        </span>
      )}
    </div>
  );
});

/** Panels side by side or stacked, with handles between them; `ResizablePanels.Panel` and `.Handle` are the parts. */
export const ResizablePanels = withRef(function ResizablePanels({
  direction = 'horizontal',
  layout,
  onLayout,
  autoSaveId,
  keyboardStep = 2,
  className,
  children,
  ref,
  ...rest
}: ResizablePanelsProps) {
  const registry = useRef(new Map<string, PanelEntry>());
  const handleIds = useRef(new Set<string>());
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const [structure, setStructure] = useState<Structure>(EMPTY);
  const latestStructure = useLatest(structure);
  // The registered panels, in DOM order, as the hook's descriptors.
  const panels = useMemo<ResizablePanelDescriptor[]>(
    () =>
      structure.panels.map((entry) => ({
        id: entry.id,
        persistId: entry.persistId,
        ...entry.sizes,
        onCollapse: () => entry.callbacks.current.onCollapse?.(),
        onExpand: () => entry.callbacks.current.onExpand?.(),
        onResize: (size: number) => entry.callbacks.current.onResize?.(size),
      })),
    [structure],
  );
  // The behaviour is useResizablePanels's (valyro-ui/headless); the panels and handles here only register.
  const state = useResizablePanels({ panels, direction, layout, onLayout, autoSaveId, keyboardStep, locale: useLocale() });
  const { groupRef } = state;

  // Panels and handles register in their own layout effects, which run before this one.
  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const found: PanelEntry[] = [];
    const handles = new Map<string, number>();
    for (const el of ownItems(group)) {
      const id = el.dataset.resizableId ?? '';
      if (el.dataset.resizableItem === 'panel') {
        const entry = registry.current.get(id);
        if (entry) found.push(entry);
      } else if (handleIds.current.has(id)) {
        handles.set(id, found.length - 1);
      }
    }
    const signature = JSON.stringify([found.map((p) => [p.id, p.persistId, p.sizes]), [...handles]]);
    setStructure((prev) => (prev.signature === signature ? prev : { panels: found, handles, signature }));
  }, [version]);

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

  const { collapse, expand, resize } = state;
  const latestState = useLatest(state);
  const apis = useRef(new Map<string, ResizablePanelApi>());
  const api = useCallback(
    (id: string) => {
      const indexOf = (panelId: string) => latestStructure.current.panels.findIndex((p) => p.id === panelId);
      let value = apis.current.get(id);
      if (!value) {
        value = {
          collapse: () => collapse(indexOf(id)),
          expand: () => expand(indexOf(id)),
          resize: (size) => resize(indexOf(id), size),
          getSize: () => latestState.current.layout[indexOf(id)],
          isCollapsed: () => latestState.current.isCollapsed(indexOf(id)),
        };
        apis.current.set(id, value);
      }
      return value;
    },
    [collapse, expand, resize, latestState, latestStructure],
  );

  const context: GroupContextValue = {
    state,
    registerPanel,
    registerHandle,
    pivotOf: (id) => structure.handles.get(id) ?? -1,
    api,
  };

  return (
    <div {...state.getGroupProps({ ...rest, ref, className: cx('ui-resizable-panels', className) })}>
      <GroupContext.Provider value={context}>{children}</GroupContext.Provider>
    </div>
  );
}, { Panel: ResizablePanel, Handle: ResizableHandle });
