'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  createVelocityTracker,
  cx,
  mergeRefs,
  Portal,
  useControllableState,
  useDismissableLayer,
  useEventCallback,
  useAriaHideOutside,
  useFocusTrap,
  useLatest,
  usePresence,
  useScrollLock,
} from '../primitives';
import { findPart, hasPart } from '../primitives/compound';
import { backdropOpacity, releaseSnapIndex, resolveSnapPoints, rubberband, type SnapPoint } from './bottom-sheet';
import {
  createOverlayParts,
  type OverlayBodyProps,
  type OverlayCloseProps,
  type OverlayDescriptionProps,
  type OverlayHeaderProps,
  type OverlayTitleProps,
  type OverlayTriggerProps,
} from './overlay-parts';
import { useDialog } from './useDialog';
import './BottomSheet.css';
import { withRef, useLayoutEffect } from '../primitives/react-compat';

export interface BottomSheetLabels {
  /** Accessible name of the drag handle (a separator that resizes the sheet). */
  handle: string;
  /** Spoken value of the handle, e.g. "Height 2 of 3". */
  snapPosition: (index: number, count: number) => string;
}

export const defaultBottomSheetLabels: BottomSheetLabels = {
  handle: 'Resize sheet',
  snapPosition: (index, count) => `Height ${index + 1} of ${count}`,
};

export interface BottomSheetProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'children'> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Heights the sheet rests at, lowest first: px (`320` or `'320px'`) or a share of the available
   * height (`'50%'`). Default `['50%', '92%']` — iOS medium and large detents.
   */
  snapPoints?: SnapPoint[];
  /** Index of the current snap point (controlled). */
  snap?: number;
  /** Snap point the sheet opens at (default 0, the lowest). */
  defaultSnap?: number;
  onSnapChange?: (index: number) => void;
  /**
   * `true` (default): backdrop, focus trap, page scroll lock. `false`: a "peek" sheet that leaves
   * the page interactive, like the drawer of a maps app.
   */
  modal?: boolean;
  /** Can be closed by dragging below the lowest snap point, Escape or a backdrop press (default true). */
  dismissible?: boolean;
  /** Snap index at which the backdrop is fully dimmed; it fades in below that (default 0). */
  dimFrom?: number;
  /** Heading in the draggable header; also the dialog's accessible name. */
  title?: ReactNode;
  /** Text under the title; also the dialog's accessible description. */
  description?: ReactNode;
  /** Show the grab handle (default true). */
  showHandle?: boolean;
  /**
   * Render inside this element (which should be `position: relative; overflow: hidden`) instead of
   * over the viewport — for sheets inside a panel, map or device frame.
   */
  container?: HTMLElement | null;
  /** Element focused when a modal sheet opens (default: the sheet itself). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  labels?: Partial<BottomSheetLabels>;
  /**
   * Sheet body; it scrolls only at the highest snap point, otherwise dragging it moves the sheet. In the compound
   * form, a `BottomSheet.Trigger` and a `BottomSheet.Content` (with `.Header`, `.Title`, `.Description`, `.Body`, `.Close`).
   */
  children?: ReactNode;
}

const parts = createOverlayParts('BottomSheet');

export type BottomSheetTriggerProps = OverlayTriggerProps;
export type BottomSheetCloseProps = OverlayCloseProps;
export type BottomSheetHeaderProps = OverlayHeaderProps;
export type BottomSheetTitleProps = OverlayTitleProps;
export type BottomSheetDescriptionProps = OverlayDescriptionProps;
export type BottomSheetBodyProps = OverlayBodyProps;
export interface BottomSheetContentProps {
  /** The parts inside the sheet: `BottomSheet.Header` (it drags the sheet, like the handle) and `BottomSheet.Body`. */
  children?: ReactNode;
}

/** Opens the sheet (`BottomSheet.Trigger`): its single child gets the click handler. */
export const BottomSheetTrigger = parts.Trigger;
/** Closes the sheet (`BottomSheet.Close`). */
export const BottomSheetClose = parts.Close;
/** The draggable title area (`BottomSheet.Header`). */
export const BottomSheetHeader = parts.Header;
/** The heading (`BottomSheet.Title`); it names the sheet. */
export const BottomSheetTitle = parts.Title;
/** Supporting text (`BottomSheet.Description`); it describes the sheet. */
export const BottomSheetDescription = parts.Description;
/** The content (`BottomSheet.Body`); it scrolls at the highest snap point. */
export const BottomSheetBody = parts.Body;

/** Renders the sheet around the compound content; whether a title and a description are among it. */
type SheetRenderer = (content: ReactNode, named: { title: boolean; description: boolean }) => ReactNode;
const SheetContext = createContext<SheetRenderer | null>(null);

/** The sheet of the compound form (`BottomSheet.Content`): handle, layer and panel around the parts. */
export const BottomSheetContent = withRef(function BottomSheetContent({ children }: BottomSheetContentProps) {
  const render = useContext(SheetContext);
  if (!render) throw new Error('BottomSheet.Content must be inside its BottomSheet');
  return render(children, {
    title: !!findPart(children, BottomSheetTitle),
    description: !!findPart(children, BottomSheetDescription),
  });
});

// Longer than the slide-out (--ui-duration-slow ≤ 380ms), so it is never cut off.
const EXIT_MS = 420;
// How far the sheet can be pulled past its highest / lowest stop before it resists completely.
const OVERSHOOT = 64;
// Drags that start on these keep their native behaviour (text selection, sliders).
const NO_DRAG = 'input, textarea, select, [contenteditable="true"], [role="slider"], [data-ui-slider], [data-sheet-no-drag]';

type DragMode = 'pending' | 'sheet' | 'scroll';

/**
 * iOS-style sheet with snap points. Drag the handle, header or (at lower heights) the content;
 * a flick moves on to the next height or closes it. The content scrolls only at the highest snap
 * point, and pulling down from its top drags the sheet again.
 */
export const BottomSheet = withRef(function BottomSheet({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  snapPoints = ['50%', '92%'],
  snap: snapProp,
  defaultSnap = 0,
  onSnapChange,
  modal = true,
  dismissible = true,
  dimFrom = 0,
  title,
  description,
  showHandle = true,
  container,
  initialFocusRef,
  labels: labelsProp,
  className,
  style,
  ref,
  onKeyDown,
  children,
  ...rest
}: BottomSheetProps) {
  const labels = { ...defaultBottomSheetLabels, ...labelsProp };
  // Open state, ids and the trigger / close / title ARIA are useDialog's (valyro-ui/headless); the layer is the sheet's own.
  const dialog = useDialog({ open: openProp, defaultOpen, onOpenChange, modal, layer: false });
  const { open, setOpen, titleId, descriptionId } = dialog;
  const openLatest = useLatest(open);
  const [snapState, setSnap] = useControllableState({ value: snapProp, defaultValue: defaultSnap, onChange: onSnapChange });
  const { isMounted, state } = usePresence(open, EXIT_MS);
  const [available, setAvailable] = useState(0);
  const layerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const position = useRef(0);
  const drag = useRef<{ y: number; height: number; mode: DragMode; fromBody: boolean; fromHandle: boolean } | null>(null);
  const [tracker] = useState(() => createVelocityTracker());

  const heights = available > 0 ? resolveSnapPoints(snapPoints, available) : [];
  const snap = Math.min(Math.max(0, snapState), Math.max(0, snapPoints.length - 1));
  const maxHeight = heights[heights.length - 1] ?? 0;
  const atTop = snap === snapPoints.length - 1;

  // An uncontrolled sheet reopens at its default height: reset while it slides out (the height no longer shows).
  const wasOpen = useRef(open);
  useEffect(() => {
    if (!open && wasOpen.current && snapProp === undefined) setSnap(defaultSnap);
    wasOpen.current = open;
  }, [open, snapProp, defaultSnap, setSnap]);

  // Available height = the layer minus its padding (top safe area / gap, bottom inset).
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!isMounted || !layer) return;
    const measure = () => {
      const style = getComputedStyle(layer);
      setAvailable(layer.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [isMounted]);

  /** Shows `height` px of the sheet without React (every pointer move during a drag). */
  const place = useEventCallback((height: number) => {
    const panel = panelRef.current;
    const layer = layerRef.current;
    if (!panel || !layer || maxHeight === 0) return;
    position.current = height;
    const extra = Math.max(0, height - maxHeight);
    panel.style.height = `${maxHeight + extra}px`;
    // Fully closed sits below the edge, clear of the bottom inset and the shadow.
    const offset = height <= 0 ? `calc(${maxHeight}px + ${getComputedStyle(layer).paddingBottom} + 32px)` : `${maxHeight - Math.min(height, maxHeight)}px`;
    panel.style.transform = `translateY(${offset})`;
    layer.style.setProperty('--_dim', String(backdropOpacity(heights, height, dimFrom)));
  });

  // Settle on the current snap point (or below the edge when closing); CSS transitions animate it.
  const entered = useRef(false);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!isMounted || !panel || heights.length === 0 || drag.current?.mode === 'sheet') return;
    if (!entered.current) {
      // First frame below the edge, then slide in.
      panel.setAttribute('data-instant', '');
      place(0);
      panel.getBoundingClientRect();
      panel.removeAttribute('data-instant');
      entered.current = true;
    }
    place(open ? heights[snap] : 0);
  });
  useEffect(() => {
    if (!isMounted) entered.current = false;
  }, [isMounted]);

  // Initial focus for modal sheets: the requested element, else the sheet itself — at a low snap point
  // the first control of the content may sit below the screen edge.
  useLayoutEffect(() => {
    if (!open || !isMounted) return;
    focusRef.current = initialFocusRef?.current ?? panelRef.current;
  }, [open, isMounted, initialFocusRef]);

  const close = () => {
    if (dismissible) setOpen(false);
  };

  useScrollLock(open && modal && !container);
  // A page-level modal sheet hides the page behind from screen readers too (aria-modal alone is not enough).
  useAriaHideOutside([layerRef], open && modal && isMounted && !container);
  useFocusTrap(panelRef, open && modal && isMounted && heights.length > 0, { initialFocusRef: focusRef, contain: true });
  useDismissableLayer({
    enabled: open && modal,
    refs: [panelRef],
    onDismiss: close,
    closeOnEscape: dismissible,
    closeOnOutside: dismissible,
  });

  const settle = (index: number) => {
    if (index < 0) {
      setOpen(false);
      // A controlling parent may refuse to close (unsaved changes): then the sheet returns to its snap point.
      requestAnimationFrame(() => {
        if (openLatest.current) place(heights[snap]);
      });
      return;
    }
    setSnap(index);
    place(heights[index]);
  };

  /* ── Dragging: shared by touch (native listeners, so moves can be cancelled) and mouse/pen ── */

  const begin = (y: number, time: number, target: EventTarget | null) => {
    if (!open || heights.length === 0 || !(target instanceof Element) || target.closest(NO_DRAG)) return;
    const fromBody = !!bodyRef.current?.contains(target);
    drag.current = { y, height: position.current, mode: 'pending', fromBody, fromHandle: !!target.closest('.ui-bottom-sheet__handle') };
    tracker.reset();
    tracker.add(-y, time);
  };

  /** Returns true when the sheet took the move (the caller then prevents scrolling). */
  const move = (y: number, time: number) => {
    const d = drag.current;
    if (!d || d.mode === 'scroll') return false;
    const dy = d.y - y;
    if (d.mode === 'pending') {
      if (dy === 0) return false;
      // At the top height the content scrolls; pulling down from its very top drags the sheet.
      const scrollTop = bodyRef.current?.scrollTop ?? 0;
      d.mode = !d.fromBody || !atTop || (scrollTop <= 0 && dy < 0) ? 'sheet' : 'scroll';
      if (d.mode === 'scroll') return false;
      panelRef.current?.setAttribute('data-dragging', '');
      layerRef.current?.setAttribute('data-dragging', '');
    }
    let height = d.height + dy;
    if (height > maxHeight) height = maxHeight + rubberband(height - maxHeight, OVERSHOOT);
    const floor = heights[0];
    if (!dismissible && height < floor) height = floor - rubberband(floor - height, OVERSHOOT);
    place(Math.max(0, height));
    tracker.add(-y, time);
    return true;
  };

  const end = (time: number) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    panelRef.current?.removeAttribute('data-dragging');
    layerRef.current?.removeAttribute('data-dragging');
    if (d.mode === 'sheet') {
      settle(releaseSnapIndex(heights, position.current, tracker.velocity(time), { dismissible }));
    } else if (d.mode === 'pending' && d.fromHandle && heights.length > 1) {
      // Tapping the grabber cycles through the heights, as on iOS.
      settle(snap < heights.length - 1 ? snap + 1 : 0);
    }
  };

  const onTouchStart = useEventCallback((event: TouchEvent) => {
    if (event.touches.length === 1) begin(event.touches[0].clientY, event.timeStamp, event.target);
    else drag.current = null;
  });
  const onTouchMove = useEventCallback((event: TouchEvent) => {
    if (event.touches.length === 1 && move(event.touches[0].clientY, event.timeStamp) && event.cancelable) event.preventDefault();
  });
  const onTouchEnd = useEventCallback((event: TouchEvent) => end(event.timeStamp));

  useEffect(() => {
    const panel = panelRef.current;
    if (!isMounted || !panel) return;
    panel.addEventListener('touchstart', onTouchStart, { passive: true });
    // Not passive: a drag that belongs to the sheet must stop the content (and page) from scrolling.
    panel.addEventListener('touchmove', onTouchMove, { passive: false });
    panel.addEventListener('touchend', onTouchEnd);
    panel.addEventListener('touchcancel', onTouchEnd);
    return () => {
      panel.removeEventListener('touchstart', onTouchStart);
      panel.removeEventListener('touchmove', onTouchMove);
      panel.removeEventListener('touchend', onTouchEnd);
      panel.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isMounted, onTouchStart, onTouchMove, onTouchEnd]);

  // Mouse and pen drag from the handle and header only, so text in the content stays selectable.
  const pointerHandlers = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      begin(event.clientY, event.timeStamp, event.target);
      if (drag.current) event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') move(event.clientY, event.timeStamp);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') end(event.timeStamp);
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (event.pointerType !== 'touch') end(event.timeStamp);
    },
  };

  const onHandleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = heights.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowUp' || event.key === 'PageUp') next = Math.min(last, snap + 1);
    else if (event.key === 'ArrowDown' || event.key === 'PageDown') next = Math.max(0, snap - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === 'Enter' || event.key === ' ') next = snap < last ? snap + 1 : 0;
    if (next === null || last < 0) return;
    event.preventDefault();
    settle(next);
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    // Modal sheets close through the dismissable layer; a peek sheet handles Escape only while focused.
    if (event.defaultPrevented || modal || event.key !== 'Escape') return;
    event.preventDefault();
    if (dismissible) setOpen(false);
    else settle(0);
  };

  const valueNow = available > 0 ? Math.round(((heights[snap] ?? 0) / available) * 100) : 0;
  const overlay = {
    open,
    setOpen,
    titleId,
    descriptionId,
    dialog,
    headerProps: pointerHandlers,
    bodyProps: { ref: bodyRef, 'data-scrollable': atTop || undefined },
  };

  const renderSheet: SheetRenderer = (content, named) =>
    isMounted ? (
      <Portal container={container}>
        <div
          ref={layerRef}
          className="ui-bottom-sheet-layer"
          data-ui-portal=""
          data-state={state}
          data-modal={modal || undefined}
          data-contained={container ? '' : undefined}
        >
          {modal && <div className="ui-bottom-sheet__backdrop" aria-hidden="true" />}
          <div
            {...dialog.getDialogProps({
              'aria-labelledby': named.title ? titleId : undefined,
              'aria-describedby': named.description ? descriptionId : undefined,
              ...rest,
              ref: mergeRefs(panelRef, ref),
            })}
            className={cx('ui-bottom-sheet', className)}
            data-state={state}
            data-modal={modal || undefined}
            style={{ ...style, visibility: heights.length ? undefined : 'hidden' }}
            onKeyDown={onPanelKeyDown}
          >
            {showHandle && (
              <div
                className="ui-bottom-sheet__handle"
                role="separator"
                aria-orientation="horizontal"
                aria-label={labels.handle}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={valueNow}
                aria-valuetext={labels.snapPosition(snap, snapPoints.length)}
                tabIndex={0}
                onKeyDown={onHandleKeyDown}
                {...pointerHandlers}
              />
            )}
            {content}
          </div>
        </div>
      </Portal>
    ) : null;

  if (hasPart(children, [BottomSheetTrigger, BottomSheetContent])) {
    return (
      <parts.Context.Provider value={overlay}>
        <SheetContext.Provider value={renderSheet}>{children}</SheetContext.Provider>
      </parts.Context.Provider>
    );
  }

  return (
    <parts.Context.Provider value={overlay}>
      {renderSheet(
        <>
          {(title || description) && (
            <BottomSheetHeader>
              {title && <BottomSheetTitle>{title}</BottomSheetTitle>}
              {description && <BottomSheetDescription>{description}</BottomSheetDescription>}
            </BottomSheetHeader>
          )}
          <BottomSheetBody>{children}</BottomSheetBody>
        </>,
        { title: !!title, description: !!description },
      )}
    </parts.Context.Provider>
  );
}, {
  Trigger: BottomSheetTrigger,
  Content: BottomSheetContent,
  Header: BottomSheetHeader,
  Title: BottomSheetTitle,
  Description: BottomSheetDescription,
  Body: BottomSheetBody,
  Close: BottomSheetClose,
});
