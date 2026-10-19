'use client';

import { isValidElement, useRef, type ComponentPropsWithRef, type ReactElement, type ReactNode, type Ref, type RefObject } from 'react';
import { clamp, composeHandlers, cx, Floating, mergeRefs, Slot, type FloatingProps } from '../primitives';
import { collectionPart, partsOf, propsOf } from '../primitives/compound';
import { tokenNumber, useThemeTokens } from '../theme/useThemeTokens';
import { usePopover } from './usePopover';
import './Popover.css';
import { getElementRef, withRef, useLayoutEffect } from '../primitives/react-compat';

export interface PopoverProps extends Omit<FloatingProps, 'open' | 'anchorRef' | 'onDismiss' | 'children'> {
  /** A single element (usually a button); it toggles the popover on click. Or `Popover.Trigger` in the children. */
  trigger?: ReactElement;
  /**
   * Content of the panel (a non-modal `dialog`); Tab past its end returns focus to the page after the trigger. In the
   * compound form, a `Popover.Trigger` and a `Popover.Content` instead. The trigger names the dialog unless it gets
   * an `aria-label`, or an `aria-labelledby` pointing at a heading inside.
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
  const { id: _contentId, ...contentProps } = propsOf(contentPart);
  // The open state, the ids and the name, the focus moves and Tab past the panel come from the headless hook;
  // Floating positions the panel and dismisses it.
  const triggerOwnId = isValidElement<{ id?: string }>(trigger) ? trigger.props.id : undefined;
  const popover = usePopover({ open: openProp, defaultOpen, onOpenChange, id, triggerId: triggerOwnId, floating: false });
  const { open, triggerRef, contentRef } = popover;
  // Read on the trigger, which exists before the panel opens.
  const tokens = useThemeTokens(triggerRef, { '--ui-popover-arrow': '1' });
  const arrow = arrowProp && tokenNumber(tokens['--ui-popover-arrow'], 1) > 0;
  const arrowRef = useRef<HTMLSpanElement>(null);

  useArrowPosition(open && arrow, triggerRef, contentRef, arrowRef);

  return (
    <>
      <Slot {...popover.getTriggerProps()}>{trigger}</Slot>
      <Floating
        {...popover.getContentProps({
          ...rest,
          ...contentProps,
          ref: mergeRefs(ref, contentPart && (getElementRef(contentPart) as Ref<HTMLDivElement>)),
          onKeyDown: onKeyDown ? composeHandlers(contentProps.onKeyDown, onKeyDown) : contentProps.onKeyDown,
        })}
        open={open}
        anchorRef={triggerRef}
        placement={placement}
        offset={offset ?? (arrow ? 12 : 8)}
        onDismiss={() => popover.setOpen(false)}
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
