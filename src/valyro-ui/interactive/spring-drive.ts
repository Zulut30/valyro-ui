import { stepSpring, type SpringOptions } from '../primitives/spring';

/*
 * The motion of the gesture blocks (Peel Sticker, Tear-off Ticket, Swipe Action Card): a value that follows the
 * finger 1:1 while dragged and, on release, springs to its target from where it is, carrying the release velocity.
 * Each animation frame hands the value to `onFrame`, which writes it straight to the DOM, so React does not render
 * per frame and pointer events faster than the screen are coalesced into one write per frame.
 */

/** Soft, with a small overshoot: a stub or a card springing back into place. */
export const RETURN_SPRING = { stiffness: 260, damping: 22 } satisfies SpringOptions;
/** Settling into an open position without a wobble. */
export const SETTLE_SPRING = { stiffness: 300, damping: 30 } satisfies SpringOptions;
/** Reduced motion: critically damped and quick, no overshoot. */
export const CALM_SPRING = { stiffness: 520, damping: 2 * Math.sqrt(520) } satisfies SpringOptions;

export interface SpringDrive {
  /** Current values. */
  readonly value: readonly number[];
  /** Whether a spring is running. */
  readonly animating: boolean;
  /** Puts the values there (a drag), drawn on the next frame; stops a running spring. */
  set(values: readonly number[]): void;
  /** Springs to `target` from the current values; `velocity` in units per second (a release). */
  to(target: readonly number[], options?: { velocity?: readonly number[]; spring?: SpringOptions; onRest?: () => void }): void;
  /** Stops where it is. */
  stop(): void;
}

const raf = (run: FrameRequestCallback) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : (setTimeout(() => run(Date.now()), 16) as unknown as number));
const caf = (id: number) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));

/**
 * A spring-driven value of `size` numbers, starting at `initial`. `precision` is the distance, in the values' units,
 * under which a spring counts as at rest.
 */
export function createSpringDrive(initial: readonly number[], onFrame: (values: readonly number[]) => void, precision = 0.001): SpringDrive {
  const state = initial.map((value) => ({ value, velocity: 0 }));
  let frame = 0;
  let animating = false;
  let pendingWrite = false;

  const write = () => onFrame(state.map((s) => s.value));
  const cancel = () => {
    if (frame) caf(frame);
    frame = 0;
  };

  return {
    get value() {
      return state.map((s) => s.value);
    },
    get animating() {
      return animating;
    },
    set(values) {
      animating = false;
      values.forEach((value, i) => {
        state[i].value = value;
        state[i].velocity = 0;
      });
      if (pendingWrite) return;
      pendingWrite = true;
      cancel();
      frame = raf(() => {
        frame = 0;
        pendingWrite = false;
        write();
      });
    },
    to(target, options = {}) {
      const spring = options.spring ?? RETURN_SPRING;
      cancel();
      pendingWrite = false;
      options.velocity?.forEach((v, i) => (state[i].velocity = v));
      animating = true;
      let last = 0;
      const run = (now: number) => {
        // A dropped frame advances the spring by the real time (capped), so it never stutters or jumps ahead.
        const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
        last = now;
        let rest = true;
        state.forEach((s, i) => {
          if (!stepSpring(s, target[i], dt, spring, precision)) rest = false;
        });
        write();
        if (rest) {
          frame = 0;
          animating = false;
          options.onRest?.();
          return;
        }
        frame = raf(run);
      };
      frame = raf(run);
    },
    stop() {
      cancel();
      pendingWrite = false;
      animating = false;
    },
  };
}

/**
 * The iOS-style rubber band: past `limit`, movement is damped smoothly (no kink at the limit) and never exceeds
 * `limit + range`.
 */
export function rubberBand(distance: number, limit: number, range: number): number {
  if (distance <= limit) return distance;
  const over = distance - limit;
  return limit + range * (1 - 1 / ((over * 0.55) / range + 1));
}
