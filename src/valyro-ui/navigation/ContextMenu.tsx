'use client';

import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
} from 'react';
import { Slot, useControllableState, useLatest, type VirtualElement } from '../primitives';
import { MenuPopup, type MenuHighlight, type MenuItem } from './Menu';
import { withRef } from '../primitives/react-compat';

/** Native attributes, `style` and `ref` go to the menu surface. */
export interface ContextMenuProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** The target area. Right-click, long-press, Shift+F10 or the ContextMenu key inside it opens the menu. */
  children: ReactElement;
  /** Menu rows: actions (with optional submenus), checkboxes, radio groups, separators and labels. */
  items: MenuItem[];
  /**
   * Controlled open state. A menu opened through this prop (not by the user)
   * appears at `anchorPoint` of the target (its centre by default).
   */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Ignore the opening gestures and keys, so the browser's native context menu appears instead. */
  disabled?: boolean;
  /** `pop` (default): the theme's enter. `spring`: the menu and its submenus spring open and one highlight glides between rows. */
  animation?: 'pop' | 'spring';
  /** Class for the menu surface. */
  className?: string;
  /**
   * Where a menu opened through `open` / `defaultOpen` appears, as fractions of the target's box:
   * `{ x: 0, y: 1 }` is its bottom-left corner. Default: the centre. User gestures open at the pointer.
   */
  anchorPoint?: { x: number; y: number };
}

const LONG_PRESS_MS = 600;
/** Finger travel that turns a long-press into a scroll. */
const LONG_PRESS_SLOP = 10;
const LONG_PRESS_STYLE: CSSProperties = { WebkitTouchCallout: 'none' };
const point = (x: number, y: number) => new DOMRect(x, y, 0, 0);
const CENTRE = { x: 0.5, y: 0.5 };

export const ContextMenu = withRef(function ContextMenu({
  children,
  items,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  className,
  anchorPoint = CENTRE,
  ...rest
}: ContextMenuProps) {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const [highlight, setHighlight] = useState<MenuHighlight>('none');
  const targetRef = useRef<HTMLElement>(null);
  const originRef = useRef<(() => DOMRect) | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const press = useRef<{ x: number; y: number; timer: number } | null>(null);
  const anchorPointRef = useLatest(anchorPoint);

  // Measured on every reposition: the opening point, or `anchorPoint` of the target when opened through `open`.
  const anchorRef = useRef<VirtualElement>({
    getBoundingClientRect: () => {
      if (originRef.current) return originRef.current();
      const rect = targetRef.current?.getBoundingClientRect();
      const at = anchorPointRef.current;
      return rect ? point(rect.left + rect.width * at.x, rect.top + rect.height * at.y) : point(0, 0);
    },
  });

  useEffect(() => {
    if (open) {
      // Opened through `open` rather than by the user: still hand focus back on close.
      restoreRef.current ??= document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    // Forget the opening point so a later programmatic open falls back to the target's centre.
    originRef.current = null;
    restoreRef.current = null;
  }, [open]);

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);

  const show = (origin: () => DOMRect, initial: MenuHighlight) => {
    cancelPress();
    originRef.current = origin;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setHighlight(initial);
    setOpen(true);
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus && restoreRef.current?.isConnected) restoreRef.current.focus();
  };

  return (
    <>
      <Slot
        ref={targetRef}
        data-state={open ? 'open' : 'closed'}
        // A long-press would otherwise also open the iOS link/image callout.
        style={disabled ? undefined : LONG_PRESS_STYLE}
        onContextMenu={(event: MouseEvent) => {
          if (disabled) return;
          event.preventDefault();
          const { clientX: x, clientY: y } = event;
          show(() => point(x, y), 'none');
        }}
        onKeyDown={(event: KeyboardEvent) => {
          if (disabled || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
          // Prevents the browser from also firing its own contextmenu event for the key.
          event.preventDefault();
          const target = event.target as Element;
          show(() => {
            const rect = target.getBoundingClientRect();
            return point(rect.left, rect.bottom);
          }, 'first');
        }}
        // iOS Safari never fires contextmenu for touch, so long-press is detected by hand.
        onPointerDown={(event: PointerEvent) => {
          if (disabled || event.pointerType === 'mouse') return;
          cancelPress();
          const { clientX: x, clientY: y } = event;
          press.current = { x, y, timer: window.setTimeout(() => show(() => point(x, y), 'none'), LONG_PRESS_MS) };
        }}
        onPointerMove={(event: PointerEvent) => {
          const start = press.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP) cancelPress();
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
      >
        {children}
      </Slot>
      <MenuPopup
        {...rest}
        open={open}
        anchorRef={anchorRef}
        placement="bottom-start"
        offset={2}
        items={items}
        initialHighlight={highlight}
        onClose={close}
        className={className}
      />
    </>
  );
});
