/*
 * Tear-off Ticket gesture: the stub is pulled away from the perforation, perpendicular to it, and the progress is
 * the distance over the stub's own size along that axis. A narrow and a wide ticket tear at the same share.
 */

export type TicketOrientation = 'horizontal' | 'vertical';

/**
 * Distance (px) of a pull from `start` to `point` (client px), outward from the perforation: a vertical perforation
 * has its stub at the inline end and tears sideways (outward is right, or left in right-to-left pages); a horizontal
 * one has its stub at the bottom and tears downward. Negative when pushed toward the ticket.
 */
export function tearDistance(orientation: TicketOrientation, rtl: boolean, start: { x: number; y: number }, point: { x: number; y: number }): number {
  return orientation === 'vertical' ? (point.x - start.x) * (rtl ? -1 : 1) : point.y - start.y;
}

/** Size of the stub along the tearing axis, px. */
export const stubSize = (orientation: TicketOrientation, stub: { width: number; height: number }) => (orientation === 'vertical' ? stub.width : stub.height);

/** Progress 0…1 of a pull from `start` to `point` over the stub's size along the axis. */
export function tearProgress(
  orientation: TicketOrientation,
  rtl: boolean,
  start: { x: number; y: number },
  point: { x: number; y: number },
  stub: { width: number; height: number },
): number {
  const size = stubSize(orientation, stub);
  if (size <= 0) return 0;
  return Math.min(1, Math.max(0, tearDistance(orientation, rtl, start, point) / size));
}

/** Released at or past the threshold, or flicked outward fast enough from a quarter of the way: torn off. */
export function tearOpens(progress: number, threshold: number, velocity = 0): boolean {
  return progress >= threshold || (progress >= 0.25 && velocity >= 0.6);
}

/** Pushed toward the ticket, the stub gives way only a few px, with growing resistance. */
export function pullDistance(raw: number): number {
  return raw >= 0 ? raw : -6 * (1 - 1 / (-raw / 24 + 1));
}

export interface StubPose {
  /** Along the tearing axis, px, outward. */
  along: number;
  /** Across it, px: the stub sags as it comes away. */
  across: number;
  /** Degrees, turning away from the ticket around the corner at the perforation. */
  rotate: number;
  opacity: number;
}

/**
 * Where the stub is drawn `distance` px from its place: it slides out, turns around its corner at the perforation and
 * sags a little, like paper; past its own size (flying off after the tear) it fades out.
 */
export function stubPose(distance: number, size: number, calm = false): StubPose {
  const share = size > 0 ? distance / size : 0;
  const out = Math.max(0, share);
  return {
    along: distance,
    across: calm ? 0 : out * out * size * 0.18,
    rotate: calm ? 0 : Math.min(out, 2) * 9,
    opacity: Math.max(0, Math.min(1, 1 - (out - 1) / 0.8)),
  };
}

/**
 * `onReveal` fires on a real false → true change of the accepted `open`, never for a ticket that starts open and
 * never twice in one cycle. Returns the new "was open" memory and whether to fire.
 */
export function revealTransition(wasOpen: boolean, open: boolean): { fire: boolean; wasOpen: boolean } {
  return { fire: open && !wasOpen, wasOpen: open };
}
