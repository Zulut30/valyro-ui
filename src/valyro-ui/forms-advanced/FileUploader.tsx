'use client';

import { useEffect, useRef, useState, type ComponentPropsWithRef, type DragEvent, type ReactNode } from 'react';
import {
  AlertCircleIcon,
  CheckCircleIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  UploadIcon,
  XIcon,
} from '../icons';
import { announce, cx, mergeRefs, useControllableState } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { IconButton } from '../basic/IconButton';
import { ProgressBar } from '../basic/ProgressBar';
import { acceptTokens, describeAcceptToken, formatBytes, matchesAccept } from './files';
import './FileUploader.css';
import { withRef } from '../primitives/react-compat';

export type FileStatus = 'idle' | 'uploading' | 'done' | 'error';

export interface FileItem {
  id: string;
  file: File;
  status: FileStatus;
  /** Upload progress, 0–100. */
  progress?: number;
  /** Shown when `status` is `error`. */
  error?: string;
}

export interface FileUploaderHintInfo {
  /** Raw `accept` tokens, e.g. `["image/*", ".pdf"]`. */
  accept: string[];
  /** Formatted `maxSize`, e.g. "5 MB". */
  maxSize?: string;
  /** `maxFiles` when several files are allowed. */
  maxFiles?: number;
}

export interface FileUploaderLabels {
  /** Emphasised part of the default title. */
  browse: string;
  /** Rest of the default title, after `browse`. */
  dragAndDrop: string;
  /** Title while files are dragged over the drop zone. */
  drop: string;
  /** Default hint under the title. */
  hint: (info: FileUploaderHintInfo) => string;
  typeError: string;
  sizeError: (maxSize: string) => string;
  countError: (maxFiles: number) => string;
  /** Shown for `status: 'error'` items without an `error` message. */
  uploadFailed: string;
  uploaded: string;
  /** Accessible name of a file's progress bar. */
  progress: (fileName: string) => string;
  remove: (fileName: string) => string;
  /** Read to screen readers after a pick or a drop: the files that were accepted (rejected ones are alerts). */
  added?: (fileNames: string[]) => string;
  /** Read to screen readers after a file's Remove button. */
  removed?: (fileName: string) => string;
}

export const DEFAULT_FILE_UPLOADER_LABELS: FileUploaderLabels = {
  browse: 'Click to upload',
  dragAndDrop: 'or drag and drop',
  drop: 'Drop to upload',
  hint: ({ accept, maxSize, maxFiles }) =>
    [
      accept.map(describeAcceptToken).join(', '),
      maxSize && `up to ${maxSize}`,
      maxFiles !== undefined && `max ${maxFiles} ${maxFiles === 1 ? 'file' : 'files'}`,
    ]
      .filter(Boolean)
      .join(' · '),
  typeError: 'File type is not supported',
  sizeError: (maxSize) => `File is larger than ${maxSize}`,
  countError: (maxFiles) => `Only ${maxFiles} ${maxFiles === 1 ? 'file' : 'files'} allowed`,
  uploadFailed: 'Upload failed',
  uploaded: 'Uploaded',
  added: (fileNames) =>
    fileNames.length === 1 ? `Added ${fileNames[0]}` : `Added ${fileNames.length} files: ${fileNames.join(', ')}`,
  removed: (fileName) => `Removed ${fileName}`,
  progress: (fileName) => `Uploading ${fileName}`,
  remove: (fileName) => `Remove ${fileName}`,
};

export interface FileUploaderProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange' | 'title'> {
  /** File list, including rejected files (status `error`). Apps drive `status`/`progress` while uploading. */
  value?: FileItem[];
  defaultValue?: FileItem[];
  onValueChange?: (items: FileItem[]) => void;
  /** Called with the newly accepted files — the place to start uploads. */
  onFilesAdded?: (items: FileItem[]) => void;
  /** Same syntax as `<input accept>`: `image/*,.pdf`. */
  accept?: string;
  /** Maximum size per file, in bytes. */
  maxSize?: number;
  /** Maximum number of accepted files; extra files are listed as rejected. Applies only with `multiple`. */
  maxFiles?: number;
  /** Allow several files; when false, a new pick replaces the current file. */
  multiple?: boolean;
  /** Disables the drop zone, the file picker and the remove buttons. */
  disabled?: boolean;
  /** Danger border on the drop zone (`aria-invalid`). */
  invalid?: boolean;
  /** Drop zone heading. Defaults to "Click to upload or drag and drop"; `labels.drop` replaces it while dragging. */
  title?: ReactNode;
  /** Text under the title. Defaults to a summary of `accept`, `maxSize` and `maxFiles`. */
  hint?: ReactNode;
  /** Locale for file sizes and progress. Defaults to the `ThemeProvider` locale, then the browser's. */
  locale?: string;
  labels?: Partial<FileUploaderLabels>;
}

let nextId = 0;
const createId = () => `file-${Date.now().toString(36)}-${++nextId}`;

function fileIcon(type: string) {
  if (type.startsWith('image/')) return <ImageIcon />;
  if (type.startsWith('text/') || type === 'application/pdf') return <FileTextIcon />;
  return <FileIcon />;
}

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

/** `id`, `aria-describedby` and `aria-invalid` (e.g. from FormField) go to the dropzone button. */
export const FileUploader = withRef(function FileUploader({
  value,
  defaultValue = [],
  onValueChange,
  onFilesAdded,
  accept,
  maxSize,
  maxFiles,
  multiple = true,
  disabled = false,
  invalid = false,
  title,
  hint,
  locale: localeProp,
  labels: labelsProp,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  className,
  ref,
  ...rest
}: FileUploaderProps) {
  const [items, setItems] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const remove = (index: number, itemId: string) => {
    const removed = items.find((i) => i.id === itemId);
    setItems(items.filter((i) => i.id !== itemId));
    const text = removed && labels.removed?.(removed.file.name);
    if (text) announce(text, 'polite');
    // The focused Remove button goes with its row: continue on the next row's button, or on the drop zone.
    requestAnimationFrame(() => {
      const root = rootRef.current;
      const active = document.activeElement;
      if (!root || (active && active !== document.body)) return;
      const buttons = root.querySelectorAll<HTMLElement>('.ui-file-uploader__remove');
      const next = buttons.length
        ? buttons[Math.min(index, buttons.length - 1)]
        : root.querySelector<HTMLElement>('.ui-file-uploader__dropzone');
      next?.focus();
    });
  };
  const labels = { ...DEFAULT_FILE_UPLOADER_LABELS, ...labelsProp };
  const locale = useLocale(localeProp);
  const maxSizeText = maxSize === undefined ? undefined : formatBytes(maxSize, locale);

  const addFiles = (files: File[]) => {
    if (disabled || files.length === 0) return;
    const kept = multiple ? items : [];
    let slots = maxFiles === undefined ? Infinity : maxFiles - kept.filter((i) => i.status !== 'error').length;
    const incoming = (multiple ? files : files.slice(0, 1)).map((file): FileItem => {
      const error = !matchesAccept(file, accept)
        ? labels.typeError
        : maxSize !== undefined && file.size > maxSize
          ? labels.sizeError(formatBytes(maxSize, locale))
          : maxFiles !== undefined && slots <= 0
            ? labels.countError(maxFiles)
            : undefined;
      if (!error) slots--;
      return error ? { id: createId(), file, status: 'error', error } : { id: createId(), file, status: 'idle' };
    });
    setItems([...kept, ...incoming]);
    const accepted = incoming.filter((i) => i.status !== 'error');
    if (accepted.length > 0) {
      onFilesAdded?.(accepted);
      // The new rows appear silently below the drop zone; say what arrived.
      const text = labels.added?.(accepted.map((i) => i.file.name));
      if (text) announce(text, 'polite');
    }
  };

  const hintText =
    hint ??
    labels.hint({ accept: acceptTokens(accept), maxSize: maxSizeText, maxFiles: multiple ? maxFiles : undefined });

  return (
    <div {...rest} ref={mergeRefs(rootRef, ref)} className={cx('ui-file-uploader', className)} data-disabled={disabled || undefined}>
      <button
        type="button"
        id={id}
        aria-describedby={describedBy}
        aria-invalid={ariaInvalid ?? (invalid || undefined)}
        className="ui-file-uploader__dropzone"
        data-dragging={dragging || undefined}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
        }}
        // Children ignore pointer events (see CSS), so leave fires only when the zone itself is left.
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setDragging(false);
          addFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <span className="ui-file-uploader__icon" aria-hidden="true">
          <UploadIcon size={20} />
        </span>
        <span className="ui-file-uploader__title">
          {dragging ? (
            labels.drop
          ) : (
            title ?? (
              <>
                <span className="ui-file-uploader__browse">{labels.browse}</span> {labels.dragAndDrop}
              </>
            )
          )}
        </span>
        {hintText && <span className="ui-file-uploader__hint">{hintText}</span>}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="ui-sr-only"
        tabIndex={-1}
        aria-hidden="true"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          // Allow picking the same file again after removing it.
          event.target.value = '';
        }}
      />
      {items.length > 0 && (
        <ul className="ui-file-uploader__list">
          {items.map((item, index) => (
            <FileRow
              key={item.id}
              item={item}
              labels={labels}
              locale={locale}
              disabled={disabled}
              onRemove={() => remove(index, item.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
});

interface FileRowProps {
  item: FileItem;
  labels: FileUploaderLabels;
  locale?: string;
  disabled: boolean;
  onRemove: () => void;
}

function FileRow({ item, labels, locale, disabled, onRemove }: FileRowProps) {
  const { file, status, progress = 0, error } = item;
  return (
    <li className="ui-file-uploader__item" data-status={status}>
      <FilePreview file={file} />
      <div className="ui-file-uploader__body">
        <div className="ui-file-uploader__row">
          <span className="ui-file-uploader__name" title={file.name}>
            {file.name}
          </span>
          {status === 'done' && <CheckCircleIcon className="ui-file-uploader__status-icon" />}
          {status === 'error' && <AlertCircleIcon className="ui-file-uploader__status-icon" />}
        </div>
        <div className="ui-file-uploader__meta">
          {status === 'error' ? (
            <span className="ui-file-uploader__error" role="alert">
              {error ?? labels.uploadFailed}
            </span>
          ) : (
            <>
              <span>{formatBytes(file.size, locale)}</span>
              {status === 'uploading' && (
                <span>{new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(progress / 100)}</span>
              )}
              {status === 'done' && <span>{labels.uploaded}</span>}
            </>
          )}
        </div>
        {status === 'uploading' && (
          <ProgressBar
            value={progress}
            size="sm"
            aria-label={labels.progress(file.name)}
            className="ui-file-uploader__progress"
          />
        )}
      </div>
      <IconButton
        size="sm"
        label={labels.remove(file.name)}
        icon={<XIcon />}
        className="ui-file-uploader__remove"
        disabled={disabled}
        onClick={onRemove}
      />
    </li>
  );
}

/** Image thumbnail from an object URL (revoked when the row goes away), or a type icon. */
function FilePreview({ file }: { file: File }) {
  const isImage = file.type.startsWith('image/');
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [failed, setFailed] = useState<File | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  // Only show a URL made for this file; undecodable images (e.g. HEIC in Chrome) fall back to the icon.
  const url = preview?.file === file && failed !== file ? preview.url : null;
  return (
    <span className="ui-file-uploader__file-icon" data-preview={url ? '' : undefined} aria-hidden="true">
      {url ? (
        <img src={url} alt="" decoding="async" draggable={false} onError={() => setFailed(file)} />
      ) : (
        fileIcon(file.type)
      )}
    </span>
  );
}
