'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useLatest } from '../primitives';
import { useLayoutEffect } from '../primitives/react-compat';
import { useMotionReduced } from '../motion-kit/preference';
import { createSpringDrive, SETTLE_SPRING } from './spring-drive';

/**
 * A number that rolls softly to its new value (a spring, no overshoot past whole steps) instead of jumping: the text
 * node React renders is rewritten per frame and always ends on `format(value)`. Under reduced motion it changes at
 * once. The rendered text on the server and on the first frame is the value itself.
 */
export function RollingValue({ value, format, step = 1, className }: { value: number; format: (value: number) => string; step?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useMotionReduced(ref);
  const formatRef = useLatest(format);
  const target = useRef(value);
  const drive = useMemo(
    () =>
      createSpringDrive(
        [value],
        ([current]) => {
          const node = ref.current?.firstChild;
          // Whole steps on the way; exactly the value at rest.
          const unit = step > 0 ? step : 1;
          const shown = Math.abs(current - target.current) < unit / 2 ? target.current : Math.round(current / unit) * unit;
          if (node && node.nodeType === 3) node.nodeValue = formatRef.current(shown);
        },
        0.05,
      ),
    // One drive for the element's life; it starts from the first value.
    [],
  );
  const first = useRef(true);
  // Before paint: React has just written the new value; put back the one on the way, then roll from there.
  useLayoutEffect(() => {
    target.current = value;
    if (first.current) {
      first.current = false;
      return;
    }
    if (reduced || !Number.isFinite(value)) {
      drive.set([value]);
      return;
    }
    const node = ref.current?.firstChild;
    const unit = step > 0 ? step : 1;
    if (node && node.nodeType === 3) node.nodeValue = formatRef.current(Math.round(drive.value[0] / unit) * unit);
    drive.to([value], { spring: SETTLE_SPRING });
  }, [value]);
  useEffect(() => () => drive.stop(), [drive]);
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
