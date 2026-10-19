'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useControllableState } from '../primitives';
import { AlertCircleIcon } from '../icons';
import { Button } from '../basic/Button';
import { Dialog, type DialogProps } from './Dialog';
import './ConfirmDialog.css';
import { withRef, useId, useSyncExternalStore } from '../primitives/react-compat';

export interface ConfirmDialogProps extends Omit<DialogProps, 'title' | 'footer'> {
  /** The question being confirmed, e.g. "Delete project?"; becomes the dialog's accessible name. */
  title: ReactNode;
  /** Text of the confirm button; name the action, e.g. "Delete". */
  confirmLabel?: ReactNode;
  /** Text of the cancel button. */
  cancelLabel?: ReactNode;
  /** `danger` makes the confirm button red, for destructive actions. */
  variant?: 'default' | 'danger';
  /** May return a promise: the dialog shows a spinner and stays open until it settles; a rejection is shown as an error. */
  onConfirm: () => unknown;
  /** Called when the dialog closes without confirming. */
  onCancel?: () => void;
  /** The user must type this exact text (e.g. a project name) before confirming. */
  confirmText?: string;
  /** Prompt above the type-to-confirm field; defaults to "To confirm, type **{confirmText}** below". */
  confirmTextLabel?: ReactNode;
}

export const ConfirmDialog = withRef(function ConfirmDialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
  confirmText,
  confirmTextLabel,
  size = confirmText ? 'md' : 'sm',
  children,
  ...rest
}: ConfirmDialogProps) {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  const inputId = useId();

  // Each opening starts clean.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setTyped('');
    }
  }

  const canConfirm = !pending && (confirmText === undefined || typed === confirmText);

  const cancel = () => {
    if (pending) return;
    setOpen(false);
    onCancel?.();
  };

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleConfirm();
  };

  const hasBody = children != null || confirmText !== undefined || error !== null;

  return (
    <Dialog
      role="alertdialog"
      {...rest}
      size={size}
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : cancel())}
      title={title}
      description={description}
      showClose={false}
      footer={
        <>
          <Button variant="secondary" onClick={cancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'primary'}
            onClick={() => void handleConfirm()}
            disabled={!canConfirm && !pending}
            loading={pending}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {hasBody && (
        <>
          {children}
          {confirmText !== undefined && (
            <form className="ui-confirm-dialog__form" onSubmit={onSubmit}>
              <label htmlFor={inputId} className="ui-confirm-dialog__prompt">
                {confirmTextLabel ?? (
                  <>
                    To confirm, type <strong>{confirmText}</strong> below
                  </>
                )}
              </label>
              <input
                id={inputId}
                className="ui-field"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                // Read-only, not disabled, while the action runs: a disabled field drops focus to <body>.
                readOnly={pending}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </form>
          )}
          {error !== null && (
            <p role="alert" className="ui-confirm-dialog__error">
              <AlertCircleIcon />
              <span>{error}</span>
            </p>
          )}
        </>
      )}
    </Dialog>
  );
});

/* ── Imperative API: `await confirm({...})` rendered by a single <ConfirmDialogHost /> ── */

export type ConfirmOptions = Pick<
  ConfirmDialogProps,
  'title' | 'description' | 'confirmLabel' | 'cancelLabel' | 'variant' | 'confirmText' | 'confirmTextLabel' | 'children'
>;

interface ConfirmState {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
  open: boolean;
}

let confirmState: ConfirmState | null = null;
const confirmListeners = new Set<() => void>();

function setConfirmState(next: ConfirmState | null) {
  confirmState = next;
  confirmListeners.forEach((listener) => listener());
}

function settle(confirmed: boolean) {
  if (!confirmState?.open) return;
  confirmState.resolve(confirmed);
  setConfirmState({ ...confirmState, open: false });
}

/** Opens the dialog rendered by `<ConfirmDialogHost />`; resolves `true` on confirm, `false` otherwise. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // A newer request replaces an unanswered one, which counts as cancelled.
    settle(false);
    setConfirmState({ options, resolve, open: true });
  });
}

const subscribeConfirm = (listener: () => void) => {
  confirmListeners.add(listener);
  return () => {
    confirmListeners.delete(listener);
  };
};
const getConfirmState = () => confirmState;

/** Mount once (next to `<Toaster />`) to enable `confirm()`. */
export function ConfirmDialogHost() {
  const state = useSyncExternalStore(subscribeConfirm, getConfirmState, getConfirmState);
  if (!state) return null;
  return (
    <ConfirmDialog
      {...state.options}
      open={state.open}
      onConfirm={() => settle(true)}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
    />
  );
}
