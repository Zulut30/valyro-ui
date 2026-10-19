'use client';

import { useEffect, useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx, DISMISS_IGNORE_ATTRIBUTE, mergeRefs, Portal, usePresence, useScrollLock } from '../primitives';
import { ProgressBar } from '../basic/ProgressBar';
import { Spinner } from '../basic/Spinner';
import './LoadingOverlay.css';
import { withRef, useId } from '../primitives/react-compat';

export interface LoadingOverlayProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Shows the overlay with a fade. Unless `fullscreen`, the covered parent gets `aria-busy` meanwhile. */
  visible: boolean;
  /** Cover the whole viewport instead of the nearest positioned parent. */
  fullscreen?: boolean;
  /** Text under the spinner, announced politely to screen readers. */
  message?: ReactNode;
  /** 0–100; shows a determinate progress bar. */
  progress?: number;
  /** Announced to screen readers when there is no `message`. */
  label?: string;
}

/**
 * Blocks a region while it loads. Without `fullscreen` it fills its parent, which
 * must be positioned (e.g. `position: relative`), and marks that parent `aria-busy`.
 */
export const LoadingOverlay = withRef(function LoadingOverlay({
  visible,
  fullscreen = false,
  message,
  progress,
  label = 'Loading',
  className,
  ref,
  ...rest
}: LoadingOverlayProps) {
  const { isMounted, state } = usePresence(visible, 200);
  const overlayRef = useRef<HTMLDivElement>(null);
  const statusId = useId();

  // A fullscreen overlay blocks the page, so the page should not scroll underneath it either.
  useScrollLock(visible && fullscreen);

  useEffect(() => {
    const container = overlayRef.current?.parentElement;
    if (!visible || fullscreen || !container) return;
    const previous = container.getAttribute('aria-busy');
    container.setAttribute('aria-busy', 'true');
    return () => {
      if (previous === null) container.removeAttribute('aria-busy');
      else container.setAttribute('aria-busy', previous);
    };
  }, [visible, fullscreen]);

  // The overlay covers the content, but the keyboard does not see covers: everything it hides goes inert while it is
  // shown (the container's other children; with `fullscreen`, the rest of the page except toasts), and focus left on a
  // covered control (a Pay button) moves onto the overlay so Enter cannot act twice. Focus returns when it hides.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!visible || !overlay) return;
    const blocked: HTMLElement[] = [];
    for (let node: HTMLElement = overlay; node.parentElement && node !== document.body; node = node.parentElement) {
      if (!fullscreen && node !== overlay) break;
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert || sibling.hasAttribute(DISMISS_IGNORE_ATTRIBUTE)) continue;
        sibling.inert = true;
        blocked.push(sibling);
      }
    }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const covered = !!previous && blocked.some((element) => element.contains(previous));
    if (covered) overlay.focus({ preventScroll: true });
    return () => {
      for (const element of blocked) element.inert = false;
      if (covered && previous?.isConnected && (document.activeElement === overlay || document.activeElement === document.body)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [visible, fullscreen, isMounted]);

  if (!isMounted) return null;

  const overlay = (
    <div
      {...rest}
      ref={mergeRefs(overlayRef, ref)}
      tabIndex={-1}
      className={cx('ui-loading-overlay ui-animate-fade', className)}
      data-state={state}
      data-fullscreen={fullscreen || undefined}
    >
      <div className="ui-loading-overlay__panel">
        <Spinner size={fullscreen ? 28 : 22} label={null} />
        {/* Only the message is live; progress ticks would be re-announced on every update. */}
        <div id={statusId} role="status" className={message ? 'ui-loading-overlay__message' : 'ui-sr-only'}>
          {message || label}
        </div>
        {progress !== undefined && (
          <ProgressBar
            className="ui-loading-overlay__progress"
            value={progress}
            size="sm"
            showValue
            // Named by the message (or label) above it.
            aria-labelledby={statusId}
          />
        )}
      </div>
    </div>
  );

  return fullscreen ? <Portal>{overlay}</Portal> : overlay;
});
