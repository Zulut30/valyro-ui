'use client';

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { cx } from '../primitives';
import { useLayoutEffect } from '../primitives/react-compat';
import { useMotionReduced } from '../motion-kit/preference';
import { createSpringDrive } from './spring-drive';

/** Settling to a new height without a wobble. */
const HEIGHT_SPRING = { stiffness: 260, damping: 2 * Math.sqrt(260) };

/**
 * A box whose height follows its content softly: when the content grows or shrinks (another caption, a longer text),
 * the box springs to the new height instead of jumping, and what is below moves with it. Auto height on the server
 * and until the first measure; under reduced motion it follows at once.
 */
export function SoftHeight({ children, className }: { children?: ReactNode; className?: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const reduced = useMotionReduced(outerRef);
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const drive = useMemo(
    () =>
      createSpringDrive(
        [0],
        ([height]) => {
          if (outerRef.current) outerRef.current.style.height = `${Math.max(0, height).toFixed(2)}px`;
        },
        0.2,
      ),
    [],
  );
  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner || typeof ResizeObserver === 'undefined') return;
    let measured = false;
    const follow = () => {
      const height = inner.offsetHeight;
      if (!measured || reducedRef.current) {
        measured = true;
        drive.set([height]);
        return;
      }
      if (Math.abs(height - drive.value[0]) < 0.5 && !drive.animating) return;
      drive.to([height], { spring: HEIGHT_SPRING });
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [drive]);
  useEffect(() => () => drive.stop(), [drive]);
  return (
    <div ref={outerRef} className={cx('ui-soft-height', className)} style={{ overflow: 'hidden' }}>
      <div ref={innerRef}>{children}</div>
    </div>
  );
}
