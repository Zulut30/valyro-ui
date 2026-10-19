'use client';

import { useCallback, useEffect, useState, type ComponentPropsWithRef } from 'react';
import { composeHandlers, cx, useLatest } from '../primitives';
import { AlertCircleIcon, CheckIcon, CopyIcon } from '../icons';
import { Button, type ButtonProps } from '../basic/Button';
import { IconButton } from '../basic/IconButton';
import '../primitives/motion.css';
import './CopyToClipboard.css';
import { withRef } from '../primitives/react-compat';

export type CopyStatus = 'idle' | 'copied' | 'error';

export interface UseCopyToClipboardOptions {
  /** How long the copied/error state lasts, ms. */
  timeout?: number;
  onCopy?: (text: string) => void;
  onError?: (error: Error) => void;
}

/** `copy(text)` resolves `true` on success; failures are reported via `status`, `error` and `onError`. */
export function useCopyToClipboard({ timeout = 2000, onCopy, onError }: UseCopyToClipboardOptions = {}) {
  const [state, setState] = useState<{ status: CopyStatus; error: Error | null; attempt: number }>({
    status: 'idle',
    error: null,
    attempt: 0,
  });
  const onCopyRef = useLatest(onCopy);
  const onErrorRef = useLatest(onError);

  // `attempt` restarts the timer when the user copies again while feedback is showing.
  useEffect(() => {
    if (state.status === 'idle') return;
    const timer = setTimeout(() => setState((s) => ({ ...s, status: 'idle', error: null })), timeout);
    return () => clearTimeout(timer);
  }, [state.status, state.attempt, timeout]);

  const copy = useCallback(
    async (text: string) => {
      let error: Error | null = null;
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error('Clipboard API is unavailable (it requires a secure context).');
        }
        await navigator.clipboard.writeText(text);
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err));
      }
      setState((s) => ({ status: error ? 'error' : 'copied', error, attempt: s.attempt + 1 }));
      // Callbacks run outside the try so their own exceptions are not reported as copy failures.
      if (error) {
        onErrorRef.current?.(error);
        return false;
      }
      onCopyRef.current?.(text);
      return true;
    },
    [onCopyRef, onErrorRef],
  );

  return { copy, status: state.status, copied: state.status === 'copied', error: state.error };
}

export interface CopyToClipboardProps
  extends Omit<ButtonProps, 'value' | 'children' | 'onCopy' | 'onError' | 'leftIcon' | 'rightIcon' | 'asChild'>,
    UseCopyToClipboardOptions {
  /** Text written to the clipboard. */
  value: string;
  /** Square icon button; the label becomes its accessible name. */
  iconOnly?: boolean;
  /** Button text before copying; the accessible name when `iconOnly`. */
  label?: string;
  /** Replaces the label after a successful copy and is announced, until `timeout` resets it. */
  copiedLabel?: string;
  /** Replaces the label after a failed copy; announced together with the error message. */
  errorLabel?: string;
  /**
   * `spring`: the icons swap with a spin and a bounce, and the label slides between states. Combine with
   * `hoverScale` / `tapScale` for the full micro-interaction. `default`: the theme's pop.
   */
  animation?: 'default' | 'spring';
}

export const CopyToClipboard = withRef(function CopyToClipboard({
  value,
  iconOnly = false,
  label = 'Copy',
  copiedLabel = 'Copied!',
  errorLabel = 'Copy failed',
  timeout,
  onCopy,
  onError,
  variant,
  animation = 'default',
  onClick,
  className,
  ...rest
}: CopyToClipboardProps) {
  const { copy, status, error } = useCopyToClipboard({ timeout, onCopy, onError });
  const labels: Record<CopyStatus, string> = { idle: label, copied: copiedLabel, error: errorLabel };
  const text = labels[status];
  // Spring swaps animate from the first copy on, not when the button first appears.
  const [swapped, setSwapped] = useState(false);
  if (status !== 'idle' && !swapped) setSwapped(true);
  const icon = status === 'copied' ? <CheckIcon /> : status === 'error' ? <AlertCircleIcon /> : <CopyIcon />;
  const common = {
    ...rest,
    className: cx('ui-copy-button', className),
    'data-status': status,
    'data-motion': animation === 'spring' ? 'spring' : undefined,
    'data-swapped': (animation === 'spring' && swapped) || undefined,
    title: status === 'error' ? error?.message : rest.title,
    onClick: composeHandlers(onClick, () => void copy(value)),
  };

  return (
    <>
      {iconOnly ? (
        <IconButton {...common} variant={variant ?? 'ghost'} icon={icon} label={text} />
      ) : (
        <Button {...common} variant={variant ?? 'secondary'} leftIcon={icon}>
          {/* The labels share one grid cell, so the button keeps one width instead of jumping on copy. */}
          <span className="ui-copy-button__labels">
            {(Object.keys(labels) as CopyStatus[]).map((key) => (
              <span key={key} data-label={key} data-active={key === status || undefined}>
                {labels[key]}
              </span>
            ))}
          </span>
        </Button>
      )}
      <span className="ui-sr-only" role="status">
        {status === 'idle' ? '' : status === 'copied' ? copiedLabel : `${errorLabel}: ${error?.message ?? ''}`}
      </span>
    </>
  );
});

export interface CopySnippetProps
  extends Omit<ComponentPropsWithRef<'div'>, 'children' | 'onCopy' | 'onError'>,
    UseCopyToClipboardOptions,
    Pick<CopyToClipboardProps, 'label' | 'copiedLabel' | 'errorLabel'> {
  /** The command or code shown and copied. */
  value: string;
  /** Decorative prefix such as `$`; not copied. */
  prompt?: string;
}

/** One-line code snippet with a copy button, e.g. an install command. */
export const CopySnippet = withRef(function CopySnippet({
  value,
  prompt,
  label = 'Copy to clipboard',
  copiedLabel,
  errorLabel,
  timeout,
  onCopy,
  onError,
  className,
  ...rest
}: CopySnippetProps) {
  return (
    <div {...rest} className={cx('ui-copy-snippet', className)}>
      {prompt && (
        <span className="ui-copy-snippet__prompt" aria-hidden="true">
          {prompt}
        </span>
      )}
      <code className="ui-copy-snippet__code">{value}</code>
      <CopyToClipboard
        className="ui-copy-snippet__button"
        value={value}
        iconOnly
        size="sm"
        label={label}
        copiedLabel={copiedLabel}
        errorLabel={errorLabel}
        timeout={timeout}
        onCopy={onCopy}
        onError={onError}
      />
    </div>
  );
});
