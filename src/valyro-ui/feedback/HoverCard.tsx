'use client';

import { useEffect, useRef, type FocusEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { composeHandlers, cx, Floating, Slot, useControllableState, type FloatingProps } from '../primitives';
import './HoverCard.css';
import { withRef } from '../primitives/react-compat';

export interface HoverCardProps extends Omit<FloatingProps, 'open' | 'anchorRef' | 'onDismiss' | 'children'> {
  /** A single focusable element, typically a link. */
  trigger: ReactElement;
  /** Card content, e.g. a profile preview; stays open while the pointer is over it. */
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Delay before opening on hover/focus, ms. */
  openDelay?: number;
  /** Delay before closing once the pointer leaves the trigger and the card, ms. */
  closeDelay?: number;
}

/** Rich preview for sighted pointer users; the trigger must remain useful on its own. */
export const HoverCard = withRef(function HoverCard({
  trigger,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  openDelay = 500,
  closeDelay = 200,
  placement = 'bottom',
  className,
  onPointerEnter,
  onPointerLeave,
  ...rest
}: HoverCardProps) {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const triggerRef = useRef<HTMLElement>(null);
  const timer = useRef<number>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const schedule = (next: boolean, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), delay);
  };
  const cancel = () => window.clearTimeout(timer.current);

  // Touch has no hover; a tap should just follow the link.
  const isMouse = (event: PointerEvent) => event.pointerType !== 'touch';

  return (
    <>
      <Slot
        ref={triggerRef}
        onPointerEnter={(event: PointerEvent) => isMouse(event) && schedule(true, openDelay)}
        onPointerLeave={(event: PointerEvent) => isMouse(event) && schedule(false, closeDelay)}
        onFocus={(event: FocusEvent<HTMLElement>) => {
          if (event.target.matches(':focus-visible')) schedule(true, openDelay);
        }}
        onBlur={() => schedule(false, closeDelay)}
      >
        {trigger}
      </Slot>
      <Floating
        {...rest}
        open={open}
        anchorRef={triggerRef}
        placement={placement}
        onDismiss={() => {
          cancel();
          setOpen(false);
        }}
        className={cx('ui-hover-card', className)}
        onPointerEnter={composeHandlers(onPointerEnter, cancel)}
        onPointerLeave={composeHandlers(onPointerLeave, (event: PointerEvent<HTMLDivElement>) => {
          if (isMouse(event)) schedule(false, closeDelay);
        })}
      >
        {children}
      </Floating>
    </>
  );
});
