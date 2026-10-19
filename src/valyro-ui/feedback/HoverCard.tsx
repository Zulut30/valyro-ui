'use client';

import { useEffect, useRef, type ComponentPropsWithRef, type FocusEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import { composeHandlers, cx, Floating, mergeRefs, Slot, useControllableState, type FloatingProps } from '../primitives';
import { collectionPart, partsOf, propsOf } from '../primitives/compound';
import './HoverCard.css';
import { getElementRef, withRef } from '../primitives/react-compat';

export interface HoverCardProps extends Omit<FloatingProps, 'open' | 'anchorRef' | 'onDismiss' | 'children'> {
  /** A single focusable element, typically a link. Or `HoverCard.Trigger`. */
  trigger?: ReactElement;
  /**
   * Card content, e.g. a profile preview; stays open while the pointer is over it. In the compound form, a
   * `HoverCard.Trigger` and a `HoverCard.Content` instead of `trigger` and the content.
   */
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Delay before opening on hover/focus, ms. */
  openDelay?: number;
  /** Delay before closing once the pointer leaves the trigger and the card, ms. */
  closeDelay?: number;
}

export interface HoverCardTriggerProps {
  /** A single focusable element, typically a link. */
  children: ReactElement;
}

/** Props of the card (merged with the HoverCard's own) and its content. */
export interface HoverCardContentProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  children?: ReactNode;
}

/** The element whose hover or keyboard focus opens the card (`HoverCard.Trigger`). */
export const HoverCardTrigger = collectionPart<HoverCardTriggerProps>('HoverCard.Trigger');
/** The card content (`HoverCard.Content`); its props go to the card. */
export const HoverCardContent = collectionPart<HoverCardContentProps>('HoverCard.Content');

/** Rich preview for sighted pointer users; the trigger must remain useful on its own. */
export const HoverCard = withRef(function HoverCard({
  trigger: triggerProp,
  children: childrenProp,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  openDelay = 500,
  closeDelay = 200,
  placement = 'bottom',
  className,
  onPointerEnter,
  onPointerLeave,
  ref,
  ...rest
}: HoverCardProps) {
  const triggerPart = triggerProp ? undefined : partsOf<HoverCardTriggerProps>(childrenProp, HoverCardTrigger)[0];
  const contentPart = triggerPart ? partsOf<HoverCardContentProps>(childrenProp, HoverCardContent)[0] : undefined;
  const trigger = triggerProp ?? triggerPart?.props.children;
  const children = triggerPart ? contentPart?.props.children : childrenProp;
  const {
    className: contentClassName,
    style: contentStyle,
    onPointerEnter: contentPointerEnter,
    onPointerLeave: contentPointerLeave,
    ...contentProps
  } = propsOf(contentPart);
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
        {...contentProps}
        ref={contentPart ? mergeRefs(ref, getElementRef(contentPart)) : ref}
        style={contentStyle || rest.style ? { ...rest.style, ...contentStyle } : undefined}
        open={open}
        anchorRef={triggerRef}
        placement={placement}
        onDismiss={() => {
          cancel();
          setOpen(false);
        }}
        className={cx('ui-hover-card', className, contentClassName)}
        onPointerEnter={composeHandlers(contentPointerEnter, composeHandlers(onPointerEnter, cancel))}
        onPointerLeave={composeHandlers(
          contentPointerLeave,
          composeHandlers(onPointerLeave, (event: PointerEvent<HTMLDivElement>) => {
            if (isMouse(event)) schedule(false, closeDelay);
          }),
        )}
      >
        {children}
      </Floating>
    </>
  );
}, { Trigger: HoverCardTrigger, Content: HoverCardContent });
