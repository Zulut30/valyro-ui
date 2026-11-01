'use client';

import { useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type PointerEvent, type ReactNode } from 'react';
import { createVelocityTracker, cx, getDirection, mergeRefs, useControllableState, useLatest } from '../primitives';
import { inertAttr, useId, useLayoutEffect, withRef } from '../primitives/react-compat';
import { Button } from '../basic/Button';
import { useLabels } from '../agents/labels';
import { useMotionReduced } from '../motion-kit/preference';
import { CALM_SPRING, createSpringDrive, RETURN_SPRING } from './spring-drive';
import { pullDistance, revealTransition, stubPose, stubSize, tearDistance, tearOpens, type TicketOrientation } from './ticket';
import './TearOffTicket.css';

export type { TicketOrientation } from './ticket';
export type TearOffTicketReason = 'gesture' | 'button';

export interface TearOffTicketLabels {
  /** Name of the ticket. */
  region: string;
  /** The button that tears the stub off in one press. */
  open: string;
  /** Text on the stub, unless `stub` is given. */
  stub: string;
  /** Name of the revealed part. */
  revealed: string;
}

const DEFAULT_LABELS: TearOffTicketLabels = {
  region: 'Ticket',
  open: 'Open ticket',
  stub: 'Tear here',
  revealed: 'Ticket details',
};

export interface TearOffTicketProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** The visible face of the closed ticket. */
  front: ReactNode;
  /** What tearing the stub off reveals: a code, an invitation, event details. Not a secret: it is in the page. */
  revealedContent: ReactNode;
  /** Content of the stub; default `labels.stub`. */
  stub?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  /** A request to change the state, with what caused it. Controlled tickets open once `open` turns true. */
  onOpenChange?: (open: boolean, reason: TearOffTicketReason) => void;
  /** Once per real opening (the accepted `open` going from false to true); not for a ticket that starts open. */
  onReveal?: () => void;
  /** Share of the stub's size it must be pulled before release tears it off (a quick flick needs less). Default 0.65. */
  tearThreshold?: number;
  /** Direction of the perforation: `vertical` (default, the stub at the inline end, pulled sideways) or `horizontal` (the stub at the bottom, pulled down). */
  orientation?: TicketOrientation;
  /** Look: `plain` (default) quiet surfaces and a thin dashed line, `paper` printed card with notches, `game` a pass in the theme's accent. */
  variant?: 'plain' | 'paper' | 'game';
  labels?: Partial<TearOffTicketLabels>;
}

/**
 * The torn stub drifts away, critically damped and soft: thrown, it keeps the release speed and slows down; from the
 * button it eases in. A stiff spring toward a far target would jolt at the start.
 */
const FLY_SPRING = { stiffness: 42, damping: 13 };
/** How far (in stub sizes) the stub travels as it flies off and fades. */
const FLY_DISTANCE = 1.9;

interface Pull {
  id: number;
  x: number;
  y: number;
  /** Distance the stub already had when the finger caught it (mid-spring). */
  base: number;
  size: number;
  rtl: boolean;
  distance: number;
}

/**
 * A ticket with a perforated stub: pull the stub away from the perforation and release past the threshold to tear
 * it off and reveal the rest; a regular button does the same in one press. The stub follows the finger, springs back
 * when let go too early and, once torn, flies off from where it was released while the ticket opens up. The gesture
 * starts only on the stub, so links on the ticket stay plain links. Revealing does not register, redeem or send
 * anything: the app does that.
 */
export const TearOffTicket = withRef(function TearOffTicket({
  front,
  revealedContent,
  stub,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onReveal,
  tearThreshold = 0.65,
  orientation = 'vertical',
  variant = 'plain',
  labels,
  className,
  style,
  ref,
  ...rest
}: TearOffTicketProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stubRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const revealedRef = useRef<HTMLDivElement>(null);
  const reduced = useMotionReduced(rootRef);
  const reasonRef = useRef<TearOffTicketReason>('button');
  const [open, setOpen] = useControllableState({
    value: openProp,
    defaultValue: defaultOpen,
    onChange: (next: boolean) => onOpenChange?.(next, reasonRef.current),
  });
  /** The stub is gone (torn and flown away, or the ticket started open). */
  const [torn, setTorn] = useState(open);
  /** The stub's track has collapsed and the revealed row has opened. */
  const [opened, setOpened] = useState(open);
  const [dragging, setDragging] = useState(false);
  const pull = useRef<Pull | null>(null);
  const tracker = useMemo(() => createVelocityTracker(), []);
  const releaseVelocity = useRef(0);
  const size = useRef(0);
  const wasOpen = useRef(open);
  /** After the first commit: an opening from then on is animated; a ticket that starts open is not. */
  const mounted = useRef(false);
  const focusAfter = useRef(false);
  const onRevealRef = useLatest(onReveal);
  const openRef = useLatest(open);
  const pose = useLatest({ orientation, reduced, rtl: false });

  // Every frame of the stub: written to the DOM, never through React state.
  const drive = useMemo(
    () =>
      createSpringDrive(
        [0],
        ([distance]) => {
          const el = stubRef.current;
          if (!el) return;
          const { orientation: axis, reduced: calm, rtl } = pose.current;
          const dir = rtl ? -1 : 1;
          const p = stubPose(distance, size.current, calm);
          el.style.transform =
            axis === 'vertical'
              ? `translate3d(${p.along * dir}px, ${p.across}px, 0) rotate(${p.rotate * dir}deg)`
              : `translate3d(${p.across * 0.4 * dir}px, ${p.along}px, 0) rotate(${p.rotate * 0.45 * dir}deg)`;
          el.style.opacity = String(p.opacity);
          el.style.setProperty('--_lift', String(Math.min(1, Math.max(0, size.current ? distance / size.current : 0))));
        },
        0.05,
      ),
    [pose],
  );
  useEffect(() => {
    mounted.current = true;
    return () => drive.stop();
  }, [drive]);
  useLayoutEffect(() => {
    pose.current.rtl = getDirection(rootRef.current) === 'rtl';
  });

  const measure = () => {
    const el = stubRef.current;
    if (!el) return 0;
    size.current = stubSize(orientation, { width: el.offsetWidth, height: el.offsetHeight });
    return size.current;
  };

  const springBack = (velocity = 0) => drive.to([0], { velocity: [velocity], spring: reduced ? CALM_SPRING : RETURN_SPRING });

  // Opening: the stub leaves the layout where it is and flies off; its track collapses and the revealed row opens.
  useLayoutEffect(() => {
    const step = revealTransition(wasOpen.current, open);
    wasOpen.current = step.wasOpen;
    const body = bodyRef.current;
    if (!open) {
      if (!torn) return;
      // Closed again (a demo resets the ticket): the stub slides back in.
      setTorn(false);
      setOpened(false);
      return;
    }
    if (!step.fire) return;
    onRevealRef.current?.();
    const el = stubRef.current;
    const slot = slotRef.current;
    if (!el || !body || !slot) {
      setTorn(true);
      setOpened(true);
      return;
    }
    measure();
    // The stub's slot keeps its size in px, so it can shrink to 0 with a transition once the stub has left it.
    slot.style.setProperty('--_slot', `${orientation === 'vertical' ? slot.offsetWidth : slot.offsetHeight}px`);
    // Commit that size before it collapses, or the browser sees one change and skips the transition.
    void getComputedStyle(slot).inlineSize;
    // Out of the layout exactly where it is, at its own size.
    el.style.width = `${el.offsetWidth}px`;
    el.style.height = `${el.offsetHeight}px`;
    el.style.left = `${el.offsetLeft}px`;
    el.style.top = `${el.offsetTop}px`;
    el.setAttribute('data-flying', '');
    requestAnimationFrame(() => setOpened(true));
    if (reduced) {
      // A calm fade instead of the flight.
      el.style.transition = 'opacity 160ms ease-out';
      el.style.opacity = '0';
      setTimeout(() => setTorn(true), 180);
    } else {
      drive.to([size.current * FLY_DISTANCE], {
        velocity: [releaseVelocity.current],
        spring: FLY_SPRING,
        onRest: () => setTorn(true),
      });
    }
    releaseVelocity.current = 0;
    if (focusAfter.current) requestAnimationFrame(() => revealedRef.current?.focus({ preventScroll: true }));
    focusAfter.current = false;
    // `torn` and the rest are read at the moment `open` changes on purpose.
  }, [open]);

  // The stub is back in the page (closed again): it slides in from outside and settles with a spring.
  useLayoutEffect(() => {
    if (torn || open) return;
    const slot = slotRef.current;
    if (!stubRef.current || !slot) return;
    const stubSizeNow = measure();
    if (!stubSizeNow || !mounted.current) return;
    drive.set([stubSizeNow * 0.9]);
    requestAnimationFrame(() => drive.to([0], { spring: reduced ? CALM_SPRING : RETURN_SPRING }));
    // Once the slot has grown back, it sizes to the stub again.
    const clear = (event: TransitionEvent) => {
      if (event.target !== slot) return;
      slot.style.removeProperty('--_slot');
      slot.removeEventListener('transitionend', clear);
    };
    slot.addEventListener('transitionend', clear);
  }, [torn]);

  const request = (reason: TearOffTicketReason, velocity = 0) => {
    if (open) return;
    reasonRef.current = reason;
    releaseVelocity.current = velocity;
    setOpen(true);
    // A controlled ticket the app keeps closed: the stub returns.
    requestAnimationFrame(() => {
      if (!openRef.current && !drive.animating) springBack();
    });
  };

  const end = (event: PointerEvent<HTMLElement>, commit: boolean) => {
    const current = pull.current;
    if (!current || current.id !== event.pointerId) return;
    pull.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    // px per ms, outward; to px per second for the spring.
    const velocity = tracker.velocity(event.timeStamp || undefined);
    const progress = current.size ? current.distance / current.size : 0;
    if (commit && tearOpens(progress, tearThreshold, velocity)) {
      request('gesture', Math.max(0, velocity * 1000));
      return;
    }
    // Interrupted or short of the threshold: the stub springs back, carrying the release speed.
    springBack(velocity * 1000);
  };

  const stubHandlers = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (open || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      // Caught mid-spring: the stub stays where it is and follows the finger from there.
      const base = drive.value[0];
      drive.stop();
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // A synthetic or already released pointer: the gesture still follows the moves it gets.
      }
      const rtl = getDirection(rootRef.current) === 'rtl';
      pose.current.rtl = rtl;
      const rect = event.currentTarget.getBoundingClientRect();
      size.current = stubSize(orientation, rect);
      pull.current = { id: event.pointerId, x: event.clientX, y: event.clientY, base, size: size.current, rtl, distance: base };
      tracker.reset();
      tracker.add(base, event.timeStamp || 0);
      setDragging(true);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const current = pull.current;
      if (!current || current.id !== event.pointerId) return;
      const raw = current.base + tearDistance(orientation, current.rtl, current, { x: event.clientX, y: event.clientY });
      current.distance = pullDistance(raw);
      tracker.add(raw, event.timeStamp || 0);
      drive.set([current.distance]);
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => end(event, true),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => end(event, false),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => end(event, false),
  };

  const stubText = stub ?? copy.stub;
  const state = open ? 'open' : dragging ? 'tearing' : 'closed';

  return (
    <div
      ref={mergeRefs(ref, rootRef)}
      role="group"
      aria-label={copy.region}
      className={cx('ui-ticket', className)}
      data-orientation={orientation}
      data-variant={variant}
      data-state={state}
      style={style}
      {...rest}
    >
      <div ref={bodyRef} className="ui-ticket__body" data-opened={opened || undefined}>
        <div className="ui-ticket__front">{front}</div>
        <div className="ui-ticket__perforation" aria-hidden="true" />
        <div ref={slotRef} className="ui-ticket__slot">
          {!torn && (
            <div
              ref={stubRef}
              className="ui-ticket__stub"
              data-dragging={dragging || undefined}
              aria-hidden={open || undefined}
              inert={inertAttr(open)}
              {...(open ? {} : stubHandlers)}
            >
              <span className="ui-ticket__stub-label">{stubText}</span>
            </div>
          )}
        </div>
        <div className="ui-ticket__reveal">
          {open && (
            <div
              ref={revealedRef}
              id={`${uid}-revealed`}
              className="ui-ticket__revealed"
              role="region"
              aria-label={copy.revealed}
              tabIndex={-1}
              data-animate={mounted.current || undefined}
            >
              <div className="ui-ticket__details">{revealedContent}</div>
            </div>
          )}
        </div>
      </div>
      {/* The button's row folds away as the ticket opens, so the ticket never jumps in a centred layout. */}
      <div className="ui-ticket__actions" data-folded={open || undefined} inert={inertAttr(open)} aria-hidden={open || undefined}>
        <div className="ui-ticket__actions-inner">
          {!torn && (
            <Button
              className="ui-ticket__open"
              size="sm"
              variant={variant === 'game' ? 'accent' : 'secondary'}
              onClick={() => {
                focusAfter.current = true;
                request('button');
              }}
            >
              {copy.open}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
});
