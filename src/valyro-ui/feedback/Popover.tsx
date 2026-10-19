'use client';

import { useEffect, useRef, type ComponentPropsWithRef, type KeyboardEvent, type ReactElement, type ReactNode, type Ref, type RefObject } from 'react';
import {
  clamp,
  composeHandlers,
  cx,
  Floating,
  getTabbables,
  mergeRefs,
  Slot,
  useControllableState,
  type FloatingProps,
} from '../primitives';
import { collectionPart, partsOf, propsOf } from '../primitives/compound';
import { tokenNumber, useThemeTokens } from '../theme/useThemeTokens';
import './Popover.css';
import { getElementRef, withRef, useId, useLayoutEffect } from '../primitives/react-compat';

export interface PopoverProps extends Omit<FloatingProps, 'open' | 'anchorRef' | 'onDismiss' | 'children'> {
  /** A single element (usually a button); it toggles the popover on click. Or `Popover.Trigger` in the children. */
  trigger?: ReactElement;
  /**
   * Content of the panel (a non-modal `dialog`); Tab past its end returns focus to the page after the trigger. In the
   * compound form, a `Popover.Trigger` and a `Popover.Content` instead.
   */
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Small pointer towards the trigger, where the theme draws one (`--ui-popover-arrow`). Glass popovers grow out of their
   * trigger without one, like iOS 26: the panel's backdrop-filter makes it a backdrop root,
   * so an arrow inside it can only blur the panel's own pixels and reads as a clear sliver.
   */
  arrow?: boolean;
}

// Keeps the arrow's base (half the rotated 12px square, ~8.5px) off the rounded corners.
const ARROW_CLEARANCE = 8;

/** Arrow position along the panel edge: under the anchor's center, kept `inset` px from either end. */
export function arrowOffset(anchorCenter: number, panelStart: number, panelLength: number, inset: number) {
  return clamp(anchorCenter - panelStart, inset, Math.max(inset, panelLength - inset));
}

/**
 * Points the arrow at the anchor's center even when the panel was shifted to stay in the
 * viewport. Floating writes its position to inline `top`/`left`, so watching that attribute
 * catches every reposition without re-rendering.
 */
function useArrowPosition(
  enabled: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  arrowRef: RefObject<HTMLElement | null>,
) {
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!enabled || !content) return;

    const update = () => {
      const anchor = anchorRef.current;
      const arrow = arrowRef.current;
      if (!anchor || !arrow) return;
      const side = content.dataset.side;
      const vertical = side === 'top' || side === 'bottom';
      const a = anchor.getBoundingClientRect();
      // Inline left/top ignore the scale of the enter animation, unlike getBoundingClientRect;
      // the arrow is positioned inside the border, hence clientLeft/clientTop.
      const start =
        (parseFloat(vertical ? content.style.left : content.style.top) || 0) +
        (vertical ? content.clientLeft : content.clientTop);
      const length = vertical ? content.clientWidth : content.clientHeight;
      const center = vertical ? a.left + a.width / 2 : a.top + a.height / 2;
      const inset = (parseFloat(getComputedStyle(content).borderTopLeftRadius) || 0) + ARROW_CLEARANCE;
      arrow.style.setProperty('--_arrow-at', `${Math.round(arrowOffset(center, start, length, inset))}px`);
    };

    update();
    const observer = new MutationObserver(update);
    observer.observe(content, { attributes: true, attributeFilter: ['style', 'data-side'] });
    const resize = new ResizeObserver(update);
    resize.observe(content);
    // A clamped panel stays put while its anchor keeps scrolling.
    window.addEventListener('scroll', update, { capture: true, passive: true });
    return () => {
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener('scroll', update, { capture: true });
    };
  }, [enabled, anchorRef, contentRef, arrowRef]);
}

export interface PopoverTriggerProps {
  /** A single element, usually a Button. */
  children: ReactElement;
}

/** Props of the panel (merged with the Popover's own) and its content. */
export interface PopoverContentProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  children?: ReactNode;
}

/** The element that toggles the popover (`Popover.Trigger`). */
export const PopoverTrigger = collectionPart<PopoverTriggerProps>('Popover.Trigger');
/** The panel content (`Popover.Content`); its props go to the panel. */
export const PopoverContent = collectionPart<PopoverContentProps>('Popover.Content');

export const Popover = withRef(function Popover({
  trigger: triggerProp,
  children: childrenProp,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  placement = 'bottom',
  offset,
  arrow: arrowProp = false,
  id,
  className,
  onKeyDown,
  ref,
  ...rest
}: PopoverProps) {
  const triggerPart = triggerProp ? undefined : partsOf<PopoverTriggerProps>(childrenProp, PopoverTrigger)[0];
  const contentPart = triggerPart ? partsOf<PopoverContentProps>(childrenProp, PopoverContent)[0] : undefined;
  const trigger = triggerProp ?? triggerPart?.props.children;
  const children = triggerPart ? contentPart?.props.children : childrenProp;
  const contentProps = propsOf(contentPart);
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const triggerRef = useRef<HTMLElement>(null);
  // Read on the trigger, which exists before the panel opens.
  const tokens = useThemeTokens(triggerRef, { '--ui-popover-arrow': '1' });
  const arrow = arrowProp && tokenNumber(tokens['--ui-popover-arrow'], 1) > 0;
  const contentRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLSpanElement>(null);
  const autoId = useId();
  const contentId = id ?? autoId;

  useArrowPosition(open && arrow, triggerRef, contentRef, arrowRef);

  // A popover rendered already open (`defaultOpen`, or `open` from the start) does not pull focus from the page on
  // load; focus moves into it once it is opened afterwards.
  const openOnMount = useRef(open);
  useEffect(() => {
    if (!open) openOnMount.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || openOnMount.current) return;
    // Wait a frame: Floating keeps the content hidden until it has been positioned.
    const frame = requestAnimationFrame(() => {
      const content = contentRef.current;
      if (content) (getTabbables(content)[0] ?? content).focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      // Only pull focus back when it was inside, so an outside click keeps its own target focused.
      const content = contentRef.current;
      if (content?.contains(document.activeElement)) triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open]);

  // The panel is portaled to the end of <body>; Tab past either end continues from the
  // trigger's place in the page, as if the panel were inserted right after it.
  const handleTabOut = (event: KeyboardEvent<HTMLDivElement>) => {
    const content = contentRef.current;
    const anchor = triggerRef.current;
    if (event.key !== 'Tab' || !content || !anchor) return;
    const items = getTabbables(content);
    const current = document.activeElement;
    const atStart = current === content || current === items[0];
    const atEnd = current === content || current === items[items.length - 1] || items.length === 0;
    if (event.shiftKey ? !atStart : !atEnd) return;
    event.preventDefault();
    if (event.shiftKey) {
      anchor.focus();
    } else {
      const page = getTabbables(document.body).filter((el) => !content.contains(el));
      (page[page.indexOf(anchor) + 1] ?? anchor).focus();
    }
    setOpen(false);
  };

  return (
    <>
      <Slot
        ref={triggerRef}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </Slot>
      <Floating
        role="dialog"
        tabIndex={-1}
        {...rest}
        {...contentProps}
        ref={mergeRefs(contentRef, ref, contentPart && (getElementRef(contentPart) as Ref<HTMLDivElement>))}
        id={contentId}
        open={open}
        anchorRef={triggerRef}
        placement={placement}
        offset={offset ?? (arrow ? 12 : 8)}
        onDismiss={() => setOpen(false)}
        onKeyDown={composeHandlers(contentProps.onKeyDown, composeHandlers(onKeyDown, handleTabOut))}
        className={cx('ui-popover', className, contentProps.className)}
        style={contentProps.style || rest.style ? { ...rest.style, ...contentProps.style } : undefined}
        data-arrow={arrow || undefined}
      >
        {arrow && <span ref={arrowRef} className="ui-popover__arrow" aria-hidden="true" />}
        {children}
      </Floating>
    </>
  );
}, { Trigger: PopoverTrigger, Content: PopoverContent });
