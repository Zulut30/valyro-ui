'use client';

import { useEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type RefObject } from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { useDismissableLayer } from '../primitives/useDismissableLayer';
import { getTabbables } from '../primitives/useFocusTrap';
import { useFloating, type Placement } from '../primitives/useFloating';
import { withUserProps, type UserProps } from '../primitives/prop-getters';
import { useId } from '../primitives/react-compat';

/*
 * The behaviour of Popover without its markup: a trigger that toggles a non-modal dialog (open controlled or not),
 * the dialog-button ARIA, a name taken from the trigger unless the panel has its own (as React Aria does), focus
 * moved into the panel when it opens (not when it is open from the start) and back to the trigger when it closes
 * with focus inside, and Tab past either end of the panel continuing from the trigger's place in the page, as if
 * the panel came right after it. With `floating` (the default) the hook positions the panel next to the trigger
 * and closes it on an outside press or Escape; the kit's Popover renders in Floating, which does both, so it
 * passes `floating: false`.
 */

export interface PopoverOptions {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Id of the panel. Default: generated. */
  id?: string;
  /** Id of the trigger, which names the panel unless the panel gets `aria-label` or `aria-labelledby`. Default: generated. */
  triggerId?: string;
  /** Position the panel next to the trigger and close it on an outside press or Escape. Default true. */
  floating?: boolean;
  placement?: Placement;
  /** Gap between the trigger and the panel in px. Default 8. */
  offset?: number;
}

export interface PopoverState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The trigger element, for an anchor (positioning, an arrow). */
  triggerRef: RefObject<HTMLElement | null>;
  /** The panel element. */
  contentRef: RefObject<HTMLElement | null>;
  /** The button that toggles the panel. */
  getTriggerProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** The panel: a named, focusable `role="dialog"`; positioned with `floating`. Render it only while `open`. */
  getContentProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
}

export function usePopover({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  id,
  triggerId: triggerIdProp,
  floating = true,
  placement = 'bottom',
  offset = 8,
}: PopoverOptions = {}): PopoverState {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const [setTrigger] = useState(() => (node: HTMLElement | null) => {
    triggerRef.current = node;
  });
  const [setContent] = useState(() => (node: HTMLElement | null) => {
    contentRef.current = node;
  });
  const autoId = useId();
  const contentId = id ?? autoId;
  const triggerId = triggerIdProp ?? `${autoId}-trigger`;

  // A popover rendered already open (`defaultOpen`, or `open` from the start) does not pull focus from the page on
  // load; focus moves into it once it is opened afterwards.
  const openOnMount = useRef(open);
  useEffect(() => {
    if (!open) openOnMount.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || openOnMount.current) return;
    // Wait a frame: the panel stays hidden until it has been positioned.
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

  const positioned = floating && open;
  const { floatingStyles, side, align } = useFloating({ open: positioned, anchorRef: triggerRef, floatingRef: contentRef, placement, offset });
  useDismissableLayer({ enabled: positioned, refs: [contentRef, triggerRef], onDismiss: () => setOpen(false) });

  // The panel is usually portaled to the end of <body>; Tab past either end continues from the trigger's place in
  // the page, as if the panel were inserted right after it.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const content = contentRef.current;
    const anchor = triggerRef.current;
    if (event.defaultPrevented || event.key !== 'Tab' || !content || !anchor) return;
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

  return {
    open,
    setOpen,
    triggerRef,
    contentRef,
    getTriggerProps: (props) =>
      withUserProps(
        {
          ref: setTrigger,
          id: triggerId,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-controls': open ? contentId : undefined,
          onClick: () => setOpen(!open),
        },
        props,
      ) as never,
    getContentProps: (props) => {
      // A dialog needs a name; without one of its own it takes the trigger's text.
      const named = !!(props?.['aria-label'] || props?.['aria-labelledby']);
      return withUserProps(
        {
          ref: setContent,
          role: 'dialog',
          tabIndex: -1,
          'aria-labelledby': named ? undefined : triggerId,
          id: contentId,
          onKeyDown,
          ...(floating && { style: floatingStyles, 'data-side': side, 'data-align': align }),
        },
        props,
      ) as never;
    },
  };
}
