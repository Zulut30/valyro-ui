'use client';

import { useEffect, useRef, useState, type FocusEvent, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { useDismissableLayer } from '../primitives/useDismissableLayer';
import { useFloating, type Placement } from '../primitives/useFloating';
import { useEventCallback } from '../primitives/utils';
import { useId } from '../primitives/react-compat';
import { useNodeRef, withUserProps, type UserProps } from '../primitives/prop-getters';

/*
 * The behaviour of Tooltip without its markup: hover (not touch) opens after a delay and keyboard focus at once,
 * leaving waits a moment so the pointer can cross onto the tooltip (WCAG 1.4.13), Escape closes it first, and
 * tooltips share one clock: after one closes the next opens without delay, and only one shows at a time. The
 * trigger is described by the tooltip while it shows. With `floating` (the default) the hook positions it next to
 * the trigger; the kit's Tooltip renders it in Floating and passes `floating: false`.
 */

export interface TooltipOptions {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Delay before showing on hover, ms. Skipped while another tooltip was just visible. Default 400. */
  delay?: number;
  /** Never show it (the trigger keeps working); also while there is nothing to show. */
  disabled?: boolean;
  /** Position the tooltip next to the trigger (getTooltipProps). Default true. */
  floating?: boolean;
  /** Preferred side and alignment. Default `top`. */
  placement?: Placement;
  /** Gap to the trigger, px. Default 6. */
  offset?: number;
  /**
   * Measure where the tooltip shown last was, so an animation can glide from it (`glide`), and let it vanish at
   * once when the next one glides in (`instantExit`). Default false.
   */
  glide?: boolean;
}

export interface TooltipState {
  /** The open state as asked for (`visible` also needs it enabled). */
  open: boolean;
  /** Showing now: open and not disabled. */
  visible: boolean;
  /** Shows it, after the delay unless `immediate` (or another tooltip was just visible). */
  show: (immediate?: boolean) => void;
  hide: () => void;
  /** With `glide`: offset from the tooltip shown last, while gliding in from it. */
  glide: { x: number; y: number } | null;
  /** With `glide`: the tooltip closes because the next one glides in, so it should vanish without its exit. */
  instantExit: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  /** The element it describes: hover and focus handlers, `aria-describedby` while it shows (your ids first). */
  getTriggerProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** The tooltip: role, id, and hover that keeps it open. Positioned with `floating`. */
  getTooltipProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref?: (node: HTMLElement | null) => void };
}

// After one tooltip closes, the next opens without delay for a moment, so scanning a toolbar feels instant.
const WARM_MS = 500;
let lastClosedAt = -Infinity;
// Leaving the trigger waits this long before hiding, so the pointer can cross onto the tooltip (WCAG 1.4.13).
const HIDE_GRACE_MS = 120;
// Only one tooltip shows at a time: opening one closes another still in its grace period.
// `instant`: the next tooltip glides in from this one, so it vanishes at once instead of fading.
let closeActive: ((instant?: boolean) => void) | null = null;
// Trigger of the tooltip shown last: a gliding tooltip opening while warm glides in from there.
let lastAnchor: DOMRect | null = null;

/** Offset from the trigger shown last to `rect` (centre to centre), or null when there is nothing to glide from. */
function glideFrom(rect: DOMRect): { x: number; y: number } | null {
  if (!lastAnchor) return null;
  const x = lastAnchor.left + lastAnchor.width / 2 - (rect.left + rect.width / 2);
  const y = lastAnchor.top + lastAnchor.height / 2 - (rect.top + rect.height / 2);
  return x || y ? { x, y } : null;
}

export function useTooltip({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  delay = 400,
  disabled = false,
  floating = true,
  placement = 'top',
  offset = 6,
  glide: tracksGlide = false,
}: TooltipOptions = {}): TooltipState {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const [triggerRef, setTriggerNode] = useNodeRef();
  const [tooltipRef, setTooltipNode] = useNodeRef();
  const timer = useRef<number>(undefined);
  const id = useId();
  const [glide, setGlide] = useState<{ x: number; y: number } | null>(null);
  const [instantExit, setInstantExit] = useState(false);
  const visible = open && !disabled;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (immediate = false) => {
    if (disabled) return;
    window.clearTimeout(timer.current);
    const warm = closeActive !== null || performance.now() - lastClosedAt < WARM_MS;
    const rect = triggerRef.current?.getBoundingClientRect();
    setGlide(tracksGlide && warm && rect ? glideFrom(rect) : null);
    setInstantExit(false);
    if (immediate || delay <= 0 || warm) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = useEventCallback((instant?: boolean) => {
    window.clearTimeout(timer.current);
    if (visible) lastClosedAt = performance.now();
    setInstantExit(instant === true);
    setOpen(false);
  });
  const hideSoon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => hide(), HIDE_GRACE_MS);
  };
  const keepOpen = () => window.clearTimeout(timer.current);

  useEffect(() => {
    if (!visible) return;
    if (closeActive !== hide) closeActive?.(glide !== null);
    closeActive = hide;
    lastAnchor = triggerRef.current?.getBoundingClientRect() ?? null;
    return () => {
      if (closeActive === hide) closeActive = null;
    };
  }, [visible, hide, glide]);

  // Escape closes the tooltip first; outside presses ignore it and reach the layers below.
  useDismissableLayer({ enabled: visible, refs: [], onDismiss: () => hide(), closeOnOutside: false, passThrough: true });

  const { floatingStyles, side, align } = useFloating({
    open: floating && visible,
    anchorRef: triggerRef,
    floatingRef: tooltipRef,
    placement,
    offset,
  });

  return {
    open,
    visible,
    show,
    hide: () => hide(),
    glide,
    instantExit,
    triggerRef,
    getTriggerProps: (props) =>
      withUserProps(
        {
          ref: setTriggerNode,
          onPointerEnter: (event: PointerEvent) => {
            // Touch has no hover; a tap should just activate the control.
            if (event.pointerType !== 'touch') show();
          },
          onPointerLeave: hideSoon,
          onPointerDown: () => hide(),
          // Pressing the trigger from the keyboard is using it, like a click: the hint goes (React Aria's TooltipTrigger).
          onKeyDown: (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') hide();
          },
          onFocus: (event: FocusEvent<HTMLElement>) => {
            // Only keyboard focus shows the tooltip, and immediately.
            if (event.target.matches(':focus-visible')) show(true);
          },
          onBlur: () => hide(),
        },
        { ...props, 'aria-describedby': [props?.['aria-describedby'], visible && id].filter(Boolean).join(' ') || undefined },
      ) as never,
    getTooltipProps: (props) =>
      withUserProps(
        {
          ...(floating && { ref: setTooltipNode, style: floatingStyles, 'data-side': side, 'data-align': align }),
          id,
          role: 'tooltip',
          // The content is hoverable: the pointer may rest on it without it disappearing.
          onPointerEnter: keepOpen,
          onPointerLeave: hideSoon,
        },
        props,
      ) as never,
  };
}
