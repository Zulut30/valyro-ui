'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { useDismissableLayer, type DismissReason } from '../primitives/useDismissableLayer';
import { useFloating, type Placement, type VirtualElement } from '../primitives/useFloating';
import { useListNavigation } from '../primitives/useListNavigation';
import { inlineArrowStep, useDirection, useLatest } from '../primitives/utils';
import { useId } from '../primitives/react-compat';
import { useNodeRef, withUserProps, type UserProps } from '../primitives/prop-getters';
import type { MenuActionItem, MenuCheckboxItem, MenuItem, MenuRadioGroup, MenuRadioOption } from './menu-items';

/*
 * The behaviour of a menu without its markup, shared by DropdownMenu, ContextMenu and the kit's menu surface
 * (Menu.tsx): one level of a WAI-ARIA menu. Rows are actions (with optional submenus), checkboxes and radio groups;
 * focus stays on the menu, which points at the highlighted row. Arrows, Home / End and type-ahead move the
 * highlight, Enter / Space pick, → (← under RTL) opens a submenu and ← goes back, Tab and Escape close, and focus
 * returns to the trigger. The opener is either a menu button (getTriggerProps: click, Enter / Space / ↓ open on the
 * first row, ↑ on the last) or a context target (getTargetProps: right-click, long-press, Shift+F10, the
 * ContextMenu key). A submenu is another useMenu level with the options getSubmenuOptions(index) returns.
 */

/** A row the keys reach, in render order. */
export type MenuEntry =
  | { kind: 'action'; item: MenuActionItem }
  | { kind: 'checkbox'; item: MenuCheckboxItem }
  | { kind: 'radio'; group: MenuRadioGroup; option: MenuRadioOption };

export type MenuHighlight = 'first' | 'last' | 'none';

export function collectEntries(items: MenuItem[]): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (const item of items) {
    if (item.type === 'radio') item.options.forEach((option) => entries.push({ kind: 'radio', group: item, option }));
    else if (item.type === 'checkbox') entries.push({ kind: 'checkbox', item });
    else if (item.type === undefined || item.type === 'item') entries.push({ kind: 'action', item });
  }
  return entries;
}

export const entryLabel = (entry: MenuEntry) => (entry.kind === 'radio' ? entry.option.label : entry.item.label);
const entryDisabled = (entry: MenuEntry | undefined) =>
  !entry || !!(entry.kind === 'radio' ? entry.option.disabled : entry.item.disabled);

export interface MenuOptions {
  /** Rows: actions (with optional submenus), checkboxes, radio groups, separators and labels. */
  items: MenuItem[];
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * The menu asks to close: a pick, Tab, Escape (`returnFocus` true) or an outside press. Default: it closes and
   * focus goes back to the trigger or to what had it before the menu opened.
   */
  onClose?: (returnFocus: boolean) => void;
  /** Makes this level a submenu: ← (→ under RTL) and Escape call it to hand focus back to the parent menu. */
  onBack?: () => void;
  /** Row highlighted when the menu mounts open. Keyboard openers start on the first or last row. */
  defaultHighlight?: MenuHighlight;
  /** Move focus into the menu when it opens (off for submenus opened by hover). Default true. */
  focusOnOpen?: boolean;
  /** getTargetProps opens nothing: the browser's own context menu appears. */
  targetDisabled?: boolean;
  /**
   * Where a context menu opened through `open` (not by a gesture) appears, as fractions of the target's box.
   * Default the centre; gestures open at the pointer.
   */
  anchorPoint?: { x: number; y: number };
  /** Position the menu (getMenuProps) and close it on an outside press or Escape. Default true. */
  floating?: boolean;
  /** What the menu positions next to: by default the trigger, the context point, or the parent row of a submenu. */
  anchorRef?: RefObject<Element | VirtualElement | null>;
  /** Default `bottom-start` (`right-start` for a submenu, mirrored under RTL). */
  placement?: Placement;
  /** Gap to the anchor, px. Default 6 (2 at a context point). */
  offset?: number;
  /** Locale of the type-ahead comparison (case and accents ignored as this locale does). Default: the browser's. */
  locale?: string;
}

export interface MenuState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Opens the menu with the first or last row (or none) highlighted. */
  show: (highlight?: MenuHighlight) => void;
  /** Closes it; `returnFocus` sends focus back to the trigger (or to what had it before). */
  close: (returnFocus?: boolean) => void;
  /** The rows the keys reach, in order: the index the item getters take is an index into this. */
  entries: MenuEntry[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** The row whose submenu is open, and whether the keyboard opened it. */
  submenu: { index: number; keyboard: boolean } | null;
  /** The row `show` highlighted: a menu that mounts per open starts there (its `defaultHighlight`). */
  highlight: MenuHighlight;
  /** What an outside press or Escape does: closes (Escape returns focus), or goes back from a submenu. */
  dismiss: (reason: DismissReason) => void;
  /** Id of the menu element (the trigger's `aria-controls`). */
  menuId: string;
  /** Picks the row at `index` as a click (or, `viaKeyboard`, Enter) does. */
  activate: (index: number, viaKeyboard?: boolean) => void;
  /** The opener: the trigger, or the point a context menu opened at. */
  anchorRef: RefObject<Element | VirtualElement | null>;
  /** Direction of the menu's text: submenus open towards the inline end. */
  direction: 'ltr' | 'rtl';
  /** A menu button (any focusable element). */
  getTriggerProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** The area a context menu belongs to. */
  getTargetProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** The `role="menu"` element: focus, the keys and the highlighted row. */
  getMenuProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** A row. Render an action with `href` as an `<a href>`. */
  getItemProps: (index: number, props?: UserProps) => HTMLAttributes<HTMLElement> & {
    ref?: (node: HTMLElement | null) => void;
    'data-highlighted'?: true;
  };
  /**
   * A radio group, or the section a `label` item opens (its rows up to the next separator or label): `itemIndex`
   * is the index of the group or the label in `items`.
   */
  getGroupProps: (itemIndex: number, props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** The heading of a radio group or a section, which names it. */
  getGroupLabelProps: (itemIndex: number, props?: UserProps) => HTMLAttributes<HTMLElement>;
  getSeparatorProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** Id of the row at `index`. */
  getItemId: (index: number) => string;
  /** Options for the useMenu of the submenu of the row at `index` (anchored to that row). */
  getSubmenuOptions: (index: number) => MenuOptions & { anchorRef: RefObject<HTMLElement | null>; onPointerEnter: () => void };
}

const LONG_PRESS_MS = 600;
/** Finger travel that turns a long-press into a scroll. */
const LONG_PRESS_SLOP = 10;
const LONG_PRESS_STYLE: CSSProperties = { WebkitTouchCallout: 'none' };
const point = (x: number, y: number) => new DOMRect(x, y, 0, 0);
const CENTRE = { x: 0.5, y: 0.5 };

export function useMenu({
  items,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onClose,
  onBack,
  defaultHighlight = 'none',
  focusOnOpen = true,
  targetDisabled = false,
  anchorPoint = CENTRE,
  floating = true,
  anchorRef: anchorRefProp,
  placement,
  offset,
  locale,
}: MenuOptions): MenuState {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const [menuRef, setMenuNode] = useNodeRef();
  const [triggerRef, setTriggerNode] = useNodeRef();
  const [targetRef, setTargetNode] = useNodeRef();
  // Submenus open towards the inline end and the arrows follow: right in LTR, left in RTL.
  const direction = useDirection(menuRef);
  const baseId = useId();
  const entries = useMemo(() => collectEntries(items), [items]);
  const isDisabled = (index: number) => entryDisabled(entries[index]);
  const getItemId = (index: number) => `${baseId}-item-${index}`;
  const firstEnabled = entries.findIndex((entry) => !entryDisabled(entry));
  const lastEnabled = entries.findLastIndex((entry) => !entryDisabled(entry));
  const highlightIndex = (highlight: MenuHighlight) => (highlight === 'first' ? firstEnabled : highlight === 'last' ? lastEnabled : -1);

  const [sub, setSub] = useState<{ index: number; keyboard: boolean } | null>(null);
  const hoverTimer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  // Rows with a submenu anchor it; one stable ref callback per row.
  const rowRefs = useRef<Record<number, { current: HTMLElement | null; set: (node: HTMLElement | null) => void }>>({});
  const rowRef = (index: number) => {
    let ref = rowRefs.current[index];
    if (!ref) {
      const created = { current: null as HTMLElement | null, set: (node: HTMLElement | null) => void (created.current = node) };
      ref = rowRefs.current[index] = created;
    }
    return ref;
  };
  // The id the trigger got this render: the menu is named by it unless its props name it.
  const triggerId = useRef<string | null>(null);
  triggerId.current = null;
  const [highlight, setHighlight] = useState<MenuHighlight>(defaultHighlight);

  // Where focus goes back on close: the trigger, or what had focus when the menu opened.
  const restoreRef = useRef<HTMLElement | null>(null);
  // The point a context menu opened at, measured on every reposition.
  const originRef = useRef<(() => DOMRect) | null>(null);
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const anchorPointRef = useLatest(anchorPoint);
  const pointAnchor = useRef<VirtualElement>({
    getBoundingClientRect: () => {
      if (originRef.current) return originRef.current();
      const rect = targetRef.current?.getBoundingClientRect();
      const at = anchorPointRef.current;
      return rect ? point(rect.left + rect.width * at.x, rect.top + rect.height * at.y) : point(0, 0);
    },
  });
  const anchorRef = useMemo<RefObject<Element | VirtualElement | null>>(
    () =>
      anchorRefProp ?? {
        get current() {
          return triggerRef.current ?? (targetRef.current ? pointAnchor.current : null);
        },
      },
    [anchorRefProp, triggerRef, targetRef],
  );

  const close = (returnFocus = false) => {
    if (onClose) {
      onClose(returnFocus);
      return;
    }
    setOpen(false);
    const target = triggerRef.current ?? restoreRef.current;
    if (returnFocus && target?.isConnected) target.focus();
  };

  useEffect(() => {
    // With `onClose`, focus is the caller's to return.
    if (onClose) return;
    if (open) {
      // Opened through `open` rather than by the user: still hand focus back on close.
      restoreRef.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    // Forget the opening point so a later programmatic open falls back to `anchorPoint` of the target.
    originRef.current = null;
    restoreRef.current = null;
  }, [open]);

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);

  const activate = (index: number, viaKeyboard = false) => {
    const entry = entries[index];
    if (!entry || isDisabled(index)) return;
    if (entry.kind === 'action' && entry.item.items) {
      // The submenu belongs to the highlighted row: a tap (no pointermove before it) or a screen reader's
      // double-tap highlights the row first, or the submenu would close in the same render.
      setActiveIndex(index);
      setSub({ index, keyboard: viaKeyboard });
      return;
    }
    if (entry.kind === 'action' && entry.item.href && viaKeyboard) {
      // A real click keeps native link behaviour; the row's onClick then closes the menu.
      (rowRef(index).current ?? document.getElementById(getItemId(index)))?.click();
      return;
    }
    close(true);
    if (entry.kind === 'action') entry.item.onSelect?.();
    else if (entry.kind === 'checkbox') entry.item.onCheckedChange(!entry.item.checked);
    else entry.group.onValueChange(entry.option.value);
  };

  const { activeIndex, setActiveIndex, onKeyDown } = useListNavigation({
    count: entries.length,
    isDisabled,
    getLabel: (index) => entryLabel(entries[index]),
    locale,
    onSelect: (index) => activate(index, true),
    initialIndex: highlightIndex(open ? defaultHighlight : 'none'),
  });

  // A submenu belongs to the highlighted row; moving the highlight away closes it.
  if (sub && sub.index !== activeIndex) setSub(null);

  const show = (next: MenuHighlight = 'none') => {
    setHighlight(next);
    setActiveIndex(highlightIndex(next));
    setSub(null);
    setOpen(true);
  };

  useEffect(() => {
    if (!open || !focusOnOpen) return;
    // A floating menu stays invisible until its first measurement, and hidden elements can't take focus.
    const frame = requestAnimationFrame(() => menuRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, focusOnOpen]);

  useEffect(() => {
    if (activeIndex >= 0) (rowRefs.current[activeIndex]?.current ?? document.getElementById(getItemId(activeIndex)))?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, baseId]);

  const dismiss = (reason: DismissReason) => (onBack ? onBack() : close(reason === 'escape'));
  const positioned = floating && open;
  const { floatingStyles, side, align } = useFloating({
    open: positioned,
    anchorRef,
    floatingRef: menuRef,
    placement: placement ?? (onBack ? (direction === 'rtl' ? 'left-start' : 'right-start') : 'bottom-start'),
    offset: offset ?? (targetRef.current && !triggerRef.current ? 2 : 6),
  });
  const anchorElementRef = useMemo(
    () => ({
      get current() {
        const anchor = anchorRef.current;
        return anchor instanceof Element ? anchor : null;
      },
    }),
    [anchorRef],
  );
  useDismissableLayer({ enabled: positioned, refs: [menuRef, anchorElementRef], onDismiss: dismiss });

  const handleKeyDown = (event: KeyboardEvent) => {
    // Keys pressed in a (portaled) submenu bubble here through the React tree; that level handles them.
    if (!(event.currentTarget as Element).contains(event.target as Node)) return;
    const entry = entries[activeIndex];
    const inline = inlineArrowStep(event.key, direction);
    if (event.key === 'Tab') {
      // Tab leaves the menu for the next stop after its trigger (WAI-ARIA APG): focus is back on the trigger now,
      // and the browser's own Tab moves on from there (Shift+Tab to the stop before it).
      close(true);
    } else if (inline === 1 && entry?.kind === 'action' && entry.item.items && !isDisabled(activeIndex)) {
      event.preventDefault();
      setSub({ index: activeIndex, keyboard: true });
    } else if (inline === -1 && onBack) {
      event.preventDefault();
      onBack();
    } else {
      onKeyDown(event);
    }
  };

  const showAt = (origin: () => DOMRect, next: MenuHighlight) => {
    cancelPress();
    originRef.current = origin;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    show(next);
  };

  // Moving the pointer onto a row: a real move, not the row sliding under a still pointer (scroll, a new row).
  const lastPointer = useRef({ x: NaN, y: NaN });
  const pointerMoved = (event: PointerEvent) => {
    const { x, y } = lastPointer.current;
    lastPointer.current = { x: event.clientX, y: event.clientY };
    return event.clientX !== x || event.clientY !== y;
  };

  return {
    open,
    setOpen,
    show,
    close,
    entries,
    activeIndex,
    setActiveIndex,
    submenu: sub,
    highlight,
    activate,
    dismiss,
    anchorRef,
    direction,
    menuId: `${baseId}-menu`,
    getTriggerProps: (props) => {
      const id = (props?.id as string | undefined) ?? `${baseId}-trigger`;
      triggerId.current = id;
      return withUserProps(
        {
          ref: setTriggerNode,
          id,
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-controls': open ? `${baseId}-menu` : undefined,
          'data-state': open ? 'open' : 'closed',
          // detail === 0 means Enter/Space activated the button, so start on the first row.
          onClick: (event: MouseEvent) => (open ? close(false) : show(event.detail === 0 ? 'first' : 'none')),
          onKeyDown: (event: KeyboardEvent) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            show(event.key === 'ArrowDown' ? 'first' : 'last');
          },
        },
        props,
      ) as never;
    },
    getTargetProps: (props) =>
      withUserProps(
        {
          ref: setTargetNode,
          'data-state': open ? 'open' : 'closed',
          // A long-press would otherwise also open the iOS link/image callout.
          style: targetDisabled ? undefined : LONG_PRESS_STYLE,
          onContextMenu: (event: MouseEvent) => {
            if (targetDisabled) return;
            event.preventDefault();
            const { clientX: x, clientY: y } = event;
            showAt(() => point(x, y), 'none');
          },
          onKeyDown: (event: KeyboardEvent) => {
            if (targetDisabled || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
            // Prevents the browser from also firing its own contextmenu event for the key.
            event.preventDefault();
            const target = event.target as Element;
            showAt(() => {
              const rect = target.getBoundingClientRect();
              return point(rect.left, rect.bottom);
            }, 'first');
          },
          // iOS Safari never fires contextmenu for touch, so long-press is detected by hand.
          onPointerDown: (event: PointerEvent) => {
            if (targetDisabled || event.pointerType === 'mouse') return;
            cancelPress();
            const { clientX: x, clientY: y } = event;
            press.current = { x, y, timer: window.setTimeout(() => showAt(() => point(x, y), 'none'), LONG_PRESS_MS) };
          },
          onPointerMove: (event: PointerEvent) => {
            const start = press.current;
            if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP) cancelPress();
          },
          onPointerUp: cancelPress,
          onPointerCancel: cancelPress,
        },
        props,
      ) as never,
    getMenuProps: (props) =>
      withUserProps(
        {
          ref: setMenuNode,
          id: `${baseId}-menu`,
          role: 'menu',
          tabIndex: -1,
          'aria-labelledby':
            props?.['aria-label'] === undefined && props?.['aria-labelledby'] === undefined ? (triggerId.current ?? undefined) : undefined,
          'aria-activedescendant': activeIndex >= 0 ? getItemId(activeIndex) : undefined,
          ...(positioned && { style: floatingStyles, 'data-side': side, 'data-align': align }),
          onKeyDown: handleKeyDown,
          onPointerLeave: () => {
            window.clearTimeout(hoverTimer.current);
            if (!sub) setActiveIndex(-1);
          },
          onContextMenu: (event: MouseEvent) => event.preventDefault(),
        },
        props,
      ) as never,
    getItemProps: (index, props) => {
      const entry = entries[index];
      const disabled = isDisabled(index);
      const submenu = entry?.kind === 'action' ? entry.item.items : undefined;
      const checked =
        entry?.kind === 'checkbox' ? entry.item.checked : entry?.kind === 'radio' ? entry.group.value === entry.option.value : undefined;
      return withUserProps(
        {
          id: getItemId(index),
          ref: submenu ? rowRef(index).set : undefined,
          role: entry?.kind === 'checkbox' ? 'menuitemcheckbox' : entry?.kind === 'radio' ? 'menuitemradio' : 'menuitem',
          'aria-checked': checked,
          'aria-disabled': disabled || undefined,
          'aria-haspopup': submenu ? 'menu' : undefined,
          'aria-expanded': submenu ? sub?.index === index : undefined,
          'data-highlighted': activeIndex === index || undefined,
          onPointerMove: (event: PointerEvent) => {
            if (!pointerMoved(event)) return;
            window.clearTimeout(hoverTimer.current);
            if (disabled) {
              if (!sub && activeIndex !== -1) setActiveIndex(-1);
              return;
            }
            const hover = () => {
              setActiveIndex(index);
              if (submenu) setSub({ index, keyboard: false });
            };
            if (sub && sub.index !== index) {
              // Grace period: a diagonal move toward the open submenu crosses other rows without closing it.
              hoverTimer.current = window.setTimeout(hover, 150);
            } else if (activeIndex !== index || (submenu && !sub)) {
              hover();
            }
          },
          onClick: (event: MouseEvent) => {
            if (disabled) event.preventDefault();
            else activate(index, false);
          },
        },
        props,
      ) as never;
    },
    getGroupProps: (itemIndex, props) => {
      const item = items[itemIndex];
      const labelled = (item?.type === 'radio' && !!item.label) || item?.type === 'label';
      return withUserProps({ role: 'group', 'aria-labelledby': labelled ? `${baseId}-group-${itemIndex}` : undefined }, props);
    },
    getGroupLabelProps: (itemIndex, props) => withUserProps({ id: `${baseId}-group-${itemIndex}` }, props),
    getSeparatorProps: (props) => withUserProps({ role: 'separator' }, props),
    getItemId,
    getSubmenuOptions: (index) => {
      const entry = entries[index];
      const row = rowRef(index);
      return {
        items: (entry?.kind === 'action' && entry.item.items) || [],
        open: open && sub?.index === index,
        anchorRef: row,
        defaultHighlight: sub?.keyboard ? 'first' : 'none',
        focusOnOpen: !!sub?.keyboard,
        onClose: close,
        onPointerEnter: () => window.clearTimeout(hoverTimer.current),
        onBack: () => {
          setSub(null);
          menuRef.current?.focus({ preventScroll: true });
        },
      };
    },
  };
}
