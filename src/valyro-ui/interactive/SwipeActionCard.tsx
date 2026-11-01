'use client';

import { useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { composeHandlers, createVelocityTracker, cx, getDirection, mergeRefs, useLatest } from '../primitives';
import { inertAttr, useLayoutEffect, withRef } from '../primitives/react-compat';
import { MoreHorizontalIcon } from '../icons';
import { Button } from '../basic/Button';
import { IconButton } from '../basic/IconButton';
import { Spinner } from '../basic/Spinner';
import { useLabels } from '../agents/labels';
import { useMotionReduced } from '../motion-kit/preference';
import { CALM_SPRING, createSpringDrive, RETURN_SPRING, SETTLE_SPRING } from './spring-drive';
import { AXIS_SLOP, dragOffset, lockAxis, logicalOffset, releaseOf, remainingAfter, sideOf, zoneOf, type SwipeLimits, type SwipeSide } from './swipe';
import './SwipeActionCard.css';

export type { SwipeSide } from './swipe';

export interface SwipeAction {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Colour of the action under the card. Default `neutral`. */
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  disabled?: boolean;
}

/** What the app reports back. `undoable` offers Undo (only with `onUndo`); `message` replaces the default status. */
export interface SwipeActionResult {
  actionId?: string;
  undoable?: boolean;
  message?: ReactNode;
  /** Anything the app needs to undo the action. */
  data?: unknown;
}

export interface SwipeActionCardLabels {
  /** Name of the card. */
  region: string;
  /** The button and toolbar that offer every action without a swipe. */
  actions: string;
  pending: string;
  done: (action: string) => string;
  failed: (action: string) => string;
  retry: string;
  undo: string;
  undone: string;
  undoFailed: string;
}

const DEFAULT_LABELS: SwipeActionCardLabels = {
  region: 'Card',
  actions: 'Actions',
  pending: 'Working…',
  done: (action) => `${action}: done`,
  failed: (action) => `${action} failed`,
  retry: 'Try again',
  undo: 'Undo',
  undone: 'Undone',
  undoFailed: 'Could not undo',
};

export interface SwipeActionCardProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Stable identity of the card, passed back to `onAction`. */
  itemId: string;
  /** Actions uncovered by a swipe toward the inline end. */
  startActions?: SwipeAction[];
  /** Actions uncovered by a swipe toward the inline start. */
  endActions?: SwipeAction[];
  /**
   * Runs an action. While its promise is pending the card waits and takes no other action; a rejection shows the
   * error with a retry, and nothing pretends it succeeded. Whether the card then leaves the list is up to the app.
   */
  onAction: (actionId: string, itemId: string) => SwipeActionResult | void | Promise<SwipeActionResult | void>;
  /** The one action a long swipe may run on release, by side; null (default) allows none. */
  fullSwipeAction?: { side: SwipeSide; actionId: string } | null;
  /** Undoes a result the app marked `undoable`. Without it no Undo is offered. */
  onUndo?: (result: SwipeActionResult) => void | Promise<void>;
  /** How long Undo stays, ms; focus and hover pause it, 0 keeps it until used. Expiry only hides it. Default 5000. */
  undoDuration?: number;
  /** No swipe and no actions. */
  disabled?: boolean;
  /** The card content. Links, fields and text selection inside keep working. */
  children: ReactNode;
  labels?: Partial<SwipeActionCardLabels>;
}

type Phase = 'closed' | 'dragging' | 'revealed' | 'armed' | 'pending' | 'success' | 'error';

interface Drag {
  id: number;
  x: number;
  y: number;
  /** Offset the card had when the finger caught it (open, or mid-spring). */
  base: number;
  axis: 'x' | 'y' | null;
  rtl: boolean;
  limits: SwipeLimits;
  offset: number;
}

/** Width of one action in an open tray, px. */
const ACTION_WIDTH = 80;
const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .ui-swipe-action__more';

/**
 * A card that slides sideways to uncover its actions. The card follows the finger, the actions grow in from under it,
 * and on release it springs open or closed with the speed it was let go at (a flick is enough); one explicitly allowed
 * action can run on a long swipe, on release, and fills the strip as it arms. Vertical movement stays page scrolling.
 * Every action is also in the Actions toolbar, the result is shown only once the app confirms it, and Undo appears
 * only when the app can undo.
 */
export const SwipeActionCard = withRef(function SwipeActionCard({
  itemId,
  startActions = [],
  endActions = [],
  onAction,
  fullSwipeAction = null,
  onUndo,
  undoDuration = 5000,
  disabled = false,
  children,
  labels,
  className,
  style,
  ref,
  onKeyDown,
  ...rest
}: SwipeActionCardProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const startTray = useRef<HTMLDivElement>(null);
  const endTray = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const reduced = useMotionReduced(rootRef);
  const [phase, setPhase] = useState<Phase>('closed');
  /** The side whose tray is open (or opening), for which actions can be reached. */
  const [openSide, setOpenSide] = useState<SwipeSide | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState<{ action: SwipeAction; message?: ReactNode; result?: SwipeActionResult; undo: boolean } | null>(null);
  const [failed, setFailed] = useState<SwipeAction | null>(null);
  const drag = useRef<Drag | null>(null);
  const tracker = useMemo(() => createVelocityTracker(), []);
  const armed = useRef(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const suppressClick = useRef(false);
  const undoTimer = useRef<{ id?: ReturnType<typeof setTimeout>; remaining: number; startedAt: number }>({ remaining: undoDuration, startedAt: 0 });
  const geometry = useLatest({ rtl: false, start: startActions.length, end: endActions.length });

  // Every frame: the card's position and how far each tray has grown, written to the DOM.
  const offsetDrive = useMemo(
    () =>
      createSpringDrive(
        [0],
        ([offset]) => {
          const { rtl, start, end } = geometry.current;
          const card = cardRef.current;
          if (card) card.style.transform = offset ? `translate3d(${(rtl ? -offset : offset).toFixed(2)}px, 0, 0)` : '';
          const grow = (tray: HTMLDivElement | null, width: number, count: number) => {
            if (!tray) return;
            tray.style.width = `${Math.max(0, width).toFixed(2)}px`;
            tray.style.setProperty('--_reveal', String(count ? Math.min(1, Math.max(0, width / (count * ACTION_WIDTH))) : 0));
          };
          grow(startTray.current, offset > 0 ? offset : 0, start);
          grow(endTray.current, offset < 0 ? -offset : 0, end);
        },
        0.1,
      ),
    [geometry],
  );
  // The full-swipe action filling the strip as the swipe arms, 0…1.
  const armDrive = useMemo(
    () =>
      createSpringDrive(
        [0],
        ([arm]) => {
          startTray.current?.style.setProperty('--_arm', arm.toFixed(3));
          endTray.current?.style.setProperty('--_arm', arm.toFixed(3));
        },
        0.002,
      ),
    [],
  );

  useLayoutEffect(() => {
    geometry.current.rtl = getDirection(rootRef.current) === 'rtl';
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      offsetDrive.stop();
      armDrive.stop();
      clearTimeout(undoTimer.current.id);
    };
  }, [offsetDrive, armDrive]);

  const actions = [...startActions, ...endActions];
  const sideActions = (side: SwipeSide) => (side === 'start' ? startActions : endActions);
  const fullAction = (side: SwipeSide) =>
    fullSwipeAction?.side === side ? sideActions(side).find((a) => a.id === fullSwipeAction.actionId && !a.disabled) : undefined;
  const pending = phase === 'pending';
  const spring = (tuned: typeof RETURN_SPRING) => (reduced ? CALM_SPRING : tuned);

  const setArmed = (on: boolean) => {
    if (armed.current === on) return;
    armed.current = on;
    if (reduced) armDrive.set([on ? 1 : 0]);
    else armDrive.to([on ? 1 : 0], { spring: SETTLE_SPRING });
  };

  const springTo = (offset: number, velocity = 0, onRest?: () => void) =>
    offsetDrive.to([offset], { velocity: [velocity], spring: spring(offset === 0 ? RETURN_SPRING : SETTLE_SPRING), onRest });

  const close = (velocity = 0) => {
    setArmed(false);
    springTo(0, velocity, () => mounted.current && setOpenSide(null));
    setPhase((current) => (current === 'revealed' || current === 'dragging' || current === 'armed' ? 'closed' : current));
  };

  // An open tray closes when the pointer goes down anywhere else, or on Escape.
  useEffect(() => {
    if (phase !== 'revealed') return;
    const onDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [phase]);

  /* ── Undo countdown: pauses while the pointer or focus is on it ── */
  const startUndoTimer = () => {
    const timer = undoTimer.current;
    clearTimeout(timer.id);
    if (undoDuration <= 0) return;
    timer.startedAt = Date.now();
    timer.id = setTimeout(() => mounted.current && setStatus((s) => (s?.undo ? { ...s, undo: false } : s)), timer.remaining);
  };
  const pauseUndo = () => {
    const timer = undoTimer.current;
    if (timer.id === undefined) return;
    clearTimeout(timer.id);
    timer.id = undefined;
    timer.remaining = remainingAfter(timer.remaining, timer.startedAt, Date.now());
  };

  // Home again over the strip; the armed action keeps the strip until the card is back.
  const comeBack = (velocity = 0) =>
    springTo(0, velocity, () => {
      if (!mounted.current) return;
      setOpenSide(null);
      setArmed(false);
    });

  /**
   * Runs an action. A full swipe (`slideOut` = the side) carries the card on out of view while the app works, the way
   * a swiped-away row leaves: if the app then removes the card it is already gone; if it keeps it, or fails, the card
   * slides back in.
   */
  const run = async (action: SwipeAction, velocity = 0, slideOut?: SwipeSide) => {
    if (busy.current || disabled || action.disabled) return;
    busy.current = true;
    setMenuOpen(false);
    setFailed(null);
    setStatus(null);
    setPhase('pending');
    if (slideOut) {
      const width = cardRef.current?.getBoundingClientRect().width || 320;
      springTo((slideOut === 'start' ? 1 : -1) * (width + 24), velocity);
    } else comeBack(velocity);
    try {
      const result = (await onAction(action.id, itemId)) as SwipeActionResult | undefined;
      if (!mounted.current) return;
      const undo = !!(result?.undoable && onUndo);
      // The app may now remove the card (it is already out of view); if it keeps it, the card slides back in.
      if (slideOut) setTimeout(() => mounted.current && comeBack(), 500);
      setStatus({ action, message: result?.message, result: result ? { actionId: action.id, ...result } : undefined, undo });
      setPhase('success');
      if (undo) {
        undoTimer.current.remaining = undoDuration;
        startUndoTimer();
      }
    } catch {
      if (!mounted.current) return;
      if (slideOut) comeBack();
      setFailed(action);
      setPhase('error');
    } finally {
      busy.current = false;
    }
  };

  const undo = async () => {
    const result = status?.result;
    if (!result || !onUndo || busy.current) return;
    busy.current = true;
    clearTimeout(undoTimer.current.id);
    try {
      await onUndo(result);
      if (mounted.current) setStatus((s) => (s ? { ...s, undo: false, message: copy.undone } : s));
    } catch {
      if (mounted.current) setStatus((s) => (s ? { ...s, undo: false, message: copy.undoFailed } : s));
    } finally {
      busy.current = false;
    }
  };

  /* ── Gesture ── */
  const limits = (): SwipeLimits => ({
    start: startActions.length * ACTION_WIDTH,
    end: endActions.length * ACTION_WIDTH,
    card: cardRef.current?.getBoundingClientRect().width || 320,
    full: { start: !!fullAction('start'), end: !!fullAction('end') },
  });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || pending || !event.isPrimary || event.button !== 0 || !actions.length) return;
    if ((event.target as Element).closest(FIELD)) return;
    // Caught mid-spring or open: the card stays where it is and follows the finger from there.
    const base = offsetDrive.value[0];
    const rtl = getDirection(rootRef.current) === 'rtl';
    geometry.current.rtl = rtl;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, base, axis: null, rtl, limits: limits(), offset: base };
    tracker.reset();
    tracker.add(base, event.timeStamp || 0);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.axis) {
      current.axis = lockAxis(dx, dy);
      if (current.axis === 'y') {
        drag.current = null;
        return;
      }
      if (!current.axis) return;
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // A synthetic or already released pointer: the swipe still follows the moves it gets.
      }
      offsetDrive.stop();
      setPhase('dragging');
      setMenuOpen(false);
      // The slop it took to pick the axis is not movement of the card: it starts from where it is, not with a jump.
      current.x += Math.sign(dx) * AXIS_SLOP;
    }
    const moved = event.clientX - current.x;
    current.offset = dragOffset(current.base + logicalOffset(moved, current.rtl), current.limits);
    tracker.add(current.offset, event.timeStamp || 0);
    const side = sideOf(current.offset);
    if (current.offset !== 0) setOpenSide((value) => (value === side ? value : side));
    const arm = zoneOf(current.offset, current.limits) === 'armed' && !!fullAction(side);
    if (arm !== armed.current) setPhase(arm ? 'armed' : 'dragging');
    setArmed(arm);
    offsetDrive.set([current.offset]);
  };

  const finish = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!current.axis) {
      // A tap on an open card closes it rather than pressing what is under the finger.
      if (commit && current.base !== 0) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        close();
      }
      return;
    }
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    // px per ms, logical; px per second for the spring.
    const velocity = tracker.velocity(event.timeStamp || undefined);
    if (!commit) {
      // Interrupted: back to where the gesture started.
      setArmed(false);
      if (current.base) {
        springTo(current.base);
        setPhase('revealed');
      } else close();
      return;
    }
    const release = releaseOf(current.offset, velocity, current.limits);
    if (release.kind === 'full') {
      const action = fullAction(release.side);
      if (action) {
        void run(action, velocity * 1000, release.side);
        return;
      }
    }
    if (release.kind === 'open') {
      setArmed(false);
      setOpenSide(release.side);
      springTo(release.offset, velocity * 1000);
      setPhase('revealed');
      return;
    }
    close(velocity * 1000);
  };

  // A click that ends a swipe does not follow a link inside the card.
  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    if (menuOpen) {
      event.preventDefault();
      setMenuOpen(false);
      moreRef.current?.focus();
    } else if (phase === 'revealed') {
      event.preventDefault();
      close();
    }
  };

  const actionButton = (action: SwipeAction, side: SwipeSide | null) => {
    const full = side !== null && fullAction(side)?.id === action.id;
    return (
      <button
        key={action.id}
        type="button"
        className="ui-swipe-action__action"
        data-tone={action.tone ?? 'neutral'}
        data-full={full || undefined}
        disabled={disabled || pending || action.disabled}
        onClick={() => void run(action)}
      >
        {action.icon != null && (
          <span className="ui-swipe-action__action-icon" aria-hidden="true">
            {action.icon}
          </span>
        )}
        <span className="ui-swipe-action__action-label">{action.label}</span>
      </button>
    );
  };

  const tray = (side: SwipeSide) => {
    const list = sideActions(side);
    if (!list.length) return null;
    // The actions under the card can be pressed once its tray is open; while moving they are only shown.
    const reachable = openSide === side && phase === 'revealed';
    return (
      <div ref={side === 'start' ? startTray : endTray} className="ui-swipe-action__tray" data-side={side} inert={inertAttr(!reachable)} aria-hidden={!reachable || undefined}>
        {list.map((action) => actionButton(action, side))}
      </div>
    );
  };

  return (
    <div
      ref={mergeRefs(ref, rootRef)}
      role="group"
      aria-label={copy.region}
      aria-busy={pending || undefined}
      className={cx('ui-swipe-action', className)}
      data-state={phase}
      data-side={openSide ?? undefined}
      data-disabled={disabled || undefined}
      style={style}
      {...rest}
      onKeyDown={composeHandlers(onKeyDown, onRootKeyDown)}
    >
      <div className="ui-swipe-action__track">
        {tray('start')}
        {tray('end')}
        <div
          ref={cardRef}
          className="ui-swipe-action__card"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finish(event, true)}
          onPointerCancel={(event) => finish(event, false)}
          onLostPointerCapture={(event) => finish(event, false)}
          onClickCapture={onClickCapture}
          // A link or image dragged natively would cancel the swipe (pointercancel): the card is swiped, not dragged.
          onDragStart={(event) => event.preventDefault()}
        >
          <div className="ui-swipe-action__content">{children}</div>
          {actions.length > 0 && (
            <IconButton
              ref={moreRef}
              className="ui-swipe-action__more"
              variant="ghost"
              size="sm"
              icon={<MoreHorizontalIcon />}
              label={copy.actions}
              aria-expanded={menuOpen}
              disabled={disabled || pending}
              onClick={() => {
                setMenuOpen((value) => !value);
                if (phase === 'revealed') close();
              }}
            />
          )}
        </div>
      </div>
      {actions.length > 0 && (
        <div className="ui-swipe-action__menu" data-open={menuOpen || undefined} inert={inertAttr(!menuOpen)} aria-hidden={!menuOpen || undefined}>
          <div className="ui-swipe-action__menu-list" role="toolbar" aria-label={copy.actions}>
            {actions.map((action) => actionButton(action, null))}
          </div>
        </div>
      )}
      <div className="ui-swipe-action__status" role="status" onPointerEnter={pauseUndo} onPointerLeave={() => status?.undo && startUndoTimer()} onFocus={pauseUndo} onBlur={() => status?.undo && startUndoTimer()}>
        {pending && (
          <span key="pending" className="ui-swipe-action__note">
            <Spinner size={14} label={null} />
            {copy.pending}
          </span>
        )}
        {phase === 'error' && failed && (
          <span key="error" className="ui-swipe-action__note" data-tone="danger">
            {copy.failed(failed.label)}
            <Button size="sm" variant="ghost" onClick={() => void run(failed)}>
              {copy.retry}
            </Button>
          </span>
        )}
        {phase === 'success' && status && (
          <span key="success" className="ui-swipe-action__note">
            {status.message ?? copy.done(status.action.label)}
            {status.undo && (
              <Button size="sm" variant="ghost" onClick={() => void undo()}>
                {copy.undo}
              </Button>
            )}
          </span>
        )}
      </div>
    </div>
  );
});
