'use client';

import { AlertCircleIcon, CheckIcon, CopyIcon } from '../icons';
import { cx } from '../primitives';
import { IconButton, type IconButtonProps } from '../basic/IconButton';
import { useCopyToClipboard } from './useCopyToClipboard';
import './CopyButton.css';
import { withRef } from '../primitives/react-compat';

interface CopyButtonProps extends Omit<IconButtonProps, 'icon' | 'label' | 'onClick'> {
  text: string;
  label?: string;
  /** Announced and shown as the tooltip after a successful copy. */
  copiedLabel?: string;
  /** Shown when the clipboard refuses; the browser's reason is appended to the tooltip. */
  failedLabel?: string;
}

/** Icon button that copies `text` and announces success or failure. */
export const CopyButton = withRef(function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  failedLabel = 'Copy failed',
  size = 'sm',
  className,
  ...rest
}: CopyButtonProps) {
  const { state, error, copy } = useCopyToClipboard();
  const status = state === 'copied' ? copiedLabel : state === 'error' ? failedLabel : '';

  return (
    <>
      <IconButton
        {...rest}
        size={size}
        label={status || label}
        title={state === 'error' && error ? `${failedLabel}: ${error.message}` : status || label}
        icon={state === 'copied' ? <CheckIcon /> : state === 'error' ? <AlertCircleIcon /> : <CopyIcon />}
        className={cx('ui-ai-copy-button', className)}
        data-state={state}
        onClick={() => void copy(text)}
      />
      <span className="ui-sr-only" role="status">
        {status}
      </span>
    </>
  );
});
