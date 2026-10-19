'use client';

import { useCallback, useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx, DISMISS_IGNORE_ATTRIBUTE, Portal } from '../primitives';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, XCircleIcon, XIcon } from '../icons';
import { Button } from '../basic/Button';
import { Spinner } from '../basic/Spinner';
import {
  isPageHidden,
  subscribePageVisibility,
  toastStore,
  type ToastData,
  type ToastId,
  type ToastType,
} from './toast-store';
import { isDismissGesture } from './gesture';
import './Toast.css';
import { withRef, inertAttr, useLayoutEffect, useSyncExternalStore } from '../primitives/react-compat';

export type ToastPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface ToasterProps extends Omit<ComponentPropsWithRef<'section'>, 'children'> {
  /** Viewport corner or edge the stack sits at; new toasts enter from that edge. On phones (≤ 600px) it spans the width. */
  position?: ToastPosition;
  /** Toasts beyond this count wait (hidden, timers paused) behind the stack. */
  visibleToasts?: number;
  /** Tint success / error / warning / info toasts with their status color. */
  richColors?: boolean;
  /** Accessible name of each toast's close button. */
  closeLabel?: string;
}

// Must match --_gap in Toast.css: vertical space between expanded toasts.
const GAP = 12;
// Must match --_peek in Toast.css: how far collapsed toasts peek out behind the front one.
const PEEK = 14;
// Distance (px) that dismisses a swiped toast; a quick flick needs less.
const SWIPE_THRESHOLD = 60;
const FLICK_VELOCITY = 0.5;
const pageShownOnServer = () => false;

const ICONS: Record<ToastType, ReactNode> = {
  default: null,
  success: <CheckCircleIcon />,
  error: <XCircleIcon />,
  warning: <AlertTriangleIcon />,
  info: <InfoIcon />,
  loading: <Spinner size={16} label={null} />,
};

/**
 * Renders toasts created with `toast()`. Mount exactly one per app.
 * Sonner-style stack: collapsed by default, expands on hover/focus, which also pauses timers.
 * Toasts sit above modals, and pressing one does not dismiss the modal under it.
 */
export const Toaster = withRef(function Toaster({
  position = 'bottom-right',
  visibleToasts = 3,
  richColors = false,
  closeLabel = 'Close notification',
  className,
  ref,
  ...rest
}: ToasterProps) {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot);
  // Timers stop while the page is hidden, so a toast never runs out in a background tab.
  const pageHidden = useSyncExternalStore(subscribePageVisibility, isPageHidden, pageShownOnServer);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  // The pointer may never "leave" a list that shrank to nothing under it.
  if (hovered && toasts.length === 0) setHovered(false);
  const expanded = hovered || focused;

  const setHeight = useCallback((id: ToastId, height: number | null) => {
    setHeights((prev) => {
      const key = String(id);
      if (height === null) {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return prev[key] === height ? prev : { ...prev, [key]: height };
    });
  }, []);

  // A focused toast that gets removed takes focus with it without a reliable blur event.
  // Where focus was before F8, to return to once the last focused toast is gone.
  const returnTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!focused || listRef.current?.contains(document.activeElement)) return;
    setFocused(false);
    // Focus fell to <body> with the removed toast: on to the next toast, else back where F8 came from.
    if (document.activeElement && document.activeElement !== document.body) return;
    const next = listRef.current?.querySelector<HTMLElement>('.ui-toast:not([data-removed])');
    (next ?? (returnTo.current?.isConnected ? returnTo.current : null))?.focus({ preventScroll: true });
  }, [focused, toasts]);

  useEffect(() => {
    // F8 jumps to the newest toast so keyboard users can reach actions.
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'F8') return;
      const first = listRef.current?.querySelector<HTMLElement>('.ui-toast:not([data-removed])');
      if (!first) return;
      event.preventDefault();
      if (!listRef.current?.contains(document.activeElement)) returnTo.current = document.activeElement as HTMLElement | null;
      first.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Dismissed toasts keep the slot they had; the rest close the gap.
  let offset = 0;
  let activeIndex = 0;
  const layout = toasts.map((t) => {
    const slot = { index: activeIndex, offset };
    if (!t.dismissed) {
      offset += (heights[String(t.id)] ?? 0) + GAP;
      activeIndex++;
    }
    return slot;
  });
  const front = toasts.find((t) => !t.dismissed) ?? toasts[0];
  const frontHeight = front ? (heights[String(front.id)] ?? 0) : 0;
  const shown = Math.min(activeIndex, visibleToasts);
  const listHeight = expanded
    ? Math.max(0, offset - GAP)
    : shown > 0
      ? frontHeight + (shown - 1) * PEEK
      : 0;

  const [y, x] = position.split('-') as ['top' | 'bottom', 'left' | 'center' | 'right'];

  return (
    <Portal>
      <section
        aria-label="Notifications (F8)"
        {...rest}
        // Toasts sit above modals: pressing one (e.g. Undo) must not dismiss menus or dialogs below.
        {...{ [DISMISS_IGNORE_ATTRIBUTE]: '' }}
        ref={ref}
        className={cx('ui-toaster-region', className)}
      >
        {/* The list is the live region: it exists before toasts arrive, so additions are announced. */}
        <ol
          ref={listRef}
          className="ui-toaster"
          data-x={x}
          data-y={y}
          data-expanded={expanded || undefined}
          data-rich-colors={richColors || undefined}
          aria-live="polite"
          aria-relevant="additions text"
          style={{ height: listHeight, ['--_front-h' as string]: `${frontHeight}px` }}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)}
          onBlur={(event: FocusEvent<HTMLOListElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
          }}
        >
          {toasts.map((t, i) => {
            const { index, offset: toastOffset } = layout[i];
            const hidden = index >= visibleToasts;
            return (
              <ToastItem
                key={t.id}
                toast={t}
                index={index}
                offset={toastOffset}
                zIndex={toasts.length - i}
                hidden={hidden}
                paused={expanded || hidden || pageHidden}
                height={heights[String(t.id)]}
                edge={y === 'bottom' ? 1 : -1}
                closeLabel={closeLabel}
                onHeight={setHeight}
              />
            );
          })}
        </ol>
      </section>
    </Portal>
  );
});

interface ToastItemProps {
  toast: ToastData;
  index: number;
  offset: number;
  zIndex: number;
  hidden: boolean;
  paused: boolean;
  height: number | undefined;
  /** +1 when the screen edge is below the stack, -1 when above. */
  edge: 1 | -1;
  closeLabel: string;
  onHeight: (id: ToastId, height: number | null) => void;
}

interface Drag {
  x: number;
  y: number;
  time: number;
  axis: 'x' | 'y' | null;
}

/** The browser starts transitions from @starting-style, so a toast enters from its first style. */
const startingStyle = typeof window !== 'undefined' && 'CSSStartingStyleRule' in window;

function ToastItem({ toast, index, offset, zIndex, hidden, paused, height, edge, closeLabel, onHeight }: ToastItemProps) {
  const itemRef = useRef<HTMLLIElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(startingStyle);
  const [swipe, setSwipe] = useState({ x: 0, y: 0 });
  const [swipedOut, setSwipedOut] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<Drag | null>(null);
  const remaining = useRef(toast.duration);
  const version = useRef(toast.version);
  const { id, dismissed, duration } = toast;

  // Enter transition: @starting-style plays it from the first style (Toast.css). Without it, render once at
  // the start position, then move into the stack.
  useEffect(() => {
    if (startingStyle) return;
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Collapsed toasts are clipped to the front toast's height, so measure the content.
  useLayoutEffect(() => {
    const item = itemRef.current;
    const inner = innerRef.current;
    if (!item || !inner) return;
    const measure = () => onHeight(id, inner.offsetHeight + item.offsetHeight - item.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => {
      observer.disconnect();
      onHeight(id, null);
    };
  }, [id, onHeight]);

  useEffect(() => {
    if (version.current !== toast.version) {
      version.current = toast.version;
      remaining.current = duration;
    }
    if (paused || dismissed || !Number.isFinite(duration)) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => toastStore.dismiss(id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [id, paused, dismissed, duration, toast.version]);

  const dismiss = () => toastStore.dismiss(id);

  // Swipe sideways in any position, or towards the nearest screen edge.
  const onPointerDown = (event: PointerEvent<HTMLLIElement>) => {
    if (event.button !== 0 || dismissed || (event.target as Element).closest('button, a, input, textarea, select')) return;
    drag.current = { x: event.clientX, y: event.clientY, time: event.timeStamp, axis: null };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLLIElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.axis) {
      if (Math.hypot(dx, dy) < 4) return;
      d.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
      setDragging(true);
    }
    // Away from the edge only stretches a little, like a rubber band.
    setSwipe(d.axis === 'x' ? { x: dx, y: 0 } : { x: 0, y: dy * edge > 0 ? dy : dy * 0.15 });
  };
  const onPointerUp = (event: PointerEvent<HTMLLIElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.axis) return;
    setDragging(false);
    const distance = d.axis === 'x' ? Math.abs(swipe.x) : swipe.y * edge;
    if (isDismissGesture(distance, event.timeStamp - d.time, SWIPE_THRESHOLD, FLICK_VELOCITY)) {
      // Sideways swipes fly off; edge swipes continue into the regular exit towards the edge.
      if (d.axis === 'x') setSwipedOut(true);
      dismiss();
    } else {
      setSwipe({ x: 0, y: 0 });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key !== 'Escape') return;
    // Keeps the global dismissable-layer handler from also closing an open dialog.
    event.preventDefault();
    dismiss();
  };

  const icon = ICONS[toast.type];
  const style = {
    zIndex,
    '--_index': index,
    '--_offset': `${offset}px`,
    '--_h': height === undefined ? undefined : `${height}px`,
    '--_sx': swipedOut ? `${Math.sign(swipe.x) * 110}%` : `${swipe.x}px`,
    '--_sy': `${swipe.y}px`,
  } as CSSProperties;

  return (
    <li
      ref={itemRef}
      className="ui-floating ui-toast"
      data-type={toast.type}
      data-front={index === 0 || undefined}
      data-mounted={mounted || undefined}
      data-removed={dismissed || undefined}
      data-hidden={hidden || undefined}
      data-swiping={dragging || undefined}
      tabIndex={hidden ? -1 : 0}
      inert={inertAttr(hidden || undefined)}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {/* Clips content while the toast's height animates; the close badge may overhang the corner. */}
      <div className="ui-toast__clip">
        <div ref={innerRef} className="ui-toast__inner">
          {icon && (
            <span className="ui-toast__icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="ui-toast__content">
            <div className="ui-toast__title">{toast.title}</div>
            {toast.description && <div className="ui-toast__description">{toast.description}</div>}
          </div>
          {toast.action && (
            <Button
              size="sm"
              variant="primary"
              className="ui-toast__action"
              onClick={() => {
                toast.action?.onClick();
                dismiss();
              }}
            >
              {toast.action.label}
            </Button>
          )}
        </div>
      </div>
      <button type="button" className="ui-toast__close" aria-label={closeLabel} onClick={dismiss}>
        <XIcon size={10} strokeWidth={2.5} />
      </button>
    </li>
  );
}
