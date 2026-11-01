'use client';

import { useRef, useState, type ReactNode } from 'react';
import { cx, usePresence } from '../primitives';
import { useLayoutEffect } from '../primitives/react-compat';
import './soft-fold.css';

/**
 * A block that unfolds when `open` turns true and folds away when it turns false (grid rows 0fr ↔ 1fr), so a message
 * or a panel never pops in or out and the layout below moves smoothly. While folding away it keeps showing what it
 * showed last. Starts unfolded on the server when open, without an animation.
 */
export function SoftFold({ open, children, className }: { open: boolean; children?: ReactNode; className?: string }) {
  const { isMounted } = usePresence(open, 420);
  const last = useRef<ReactNode>(children);
  if (open) last.current = children;
  const [unfolded, setUnfolded] = useState(open);
  useLayoutEffect(() => {
    if (!open) {
      setUnfolded(false);
      return;
    }
    if (unfolded) return;
    // Mounted folded, then unfolded on the next frame, so the transition has a start.
    const frame = requestAnimationFrame(() => setUnfolded(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);
  if (!isMounted) return null;
  return (
    <div className={cx('ui-soft-fold', className)} data-open={(open && unfolded) || undefined}>
      <div className="ui-soft-fold__inner">{open ? children : last.current}</div>
    </div>
  );
}
