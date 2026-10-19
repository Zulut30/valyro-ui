'use client';

import { createContext, useContext, useMemo, useState, type ComponentPropsWithRef, type ReactNode, type UIEvent } from 'react';
import { cx, mergeRefs, ModalLayer, useControllableState, type ModalLayerProps } from '../primitives';
import { findPart, hasPart } from '../primitives/compound';
import { XIcon } from '../icons';
import { IconButton } from '../basic/IconButton';
import {
  createOverlayParts,
  type OverlayBodyProps,
  type OverlayCloseProps,
  type OverlayDescriptionProps,
  type OverlayHeaderProps,
  type OverlayTitleProps,
  type OverlayTriggerProps,
} from './overlay-parts';
import './Dialog.css';
import { withRef, useId } from '../primitives/react-compat';

export type DialogSize = 'sm' | 'md' | 'lg' | 'full';

export interface DialogProps extends Omit<ModalLayerProps, 'open' | 'onClose' | 'placement' | 'title' | 'children'> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Heading; becomes the dialog's accessible name. */
  title?: ReactNode;
  /** Supporting text; becomes the dialog's accessible description. */
  description?: ReactNode;
  /** Action bar under the body, usually buttons. */
  footer?: ReactNode;
  /** On phones (≤ 480px) every size becomes a bottom sheet, except small Glass dialogs, which stay iOS alerts. */
  size?: DialogSize;
  /** Show the × button (default true). */
  showClose?: boolean;
  /** Accessible name of the × button. */
  closeLabel?: string;
  /**
   * Body content; it scrolls between the header and the footer when it overflows. In the compound form, a
   * `Dialog.Trigger` and a `Dialog.Content` (with `Dialog.Header`, `.Title`, `.Description`, `.Body`, `.Footer`, `.Close`).
   */
  children?: ReactNode;
}

export type DialogFooterProps = ComponentPropsWithRef<'div'>;

/**
 * The dialog action bar. `footer` renders it for you; place it yourself at the end of
 * the body when the actions must live inside it (e.g. the submit button of a `<form>`).
 */
export const DialogFooter = withRef(function DialogFooter({ className, ...rest }: DialogFooterProps) {
  return <div {...rest} className={cx('ui-dialog__footer', className)} />;
});

const parts = createOverlayParts('Dialog');

export type DialogTriggerProps = OverlayTriggerProps;
export type DialogCloseProps = OverlayCloseProps;
export type DialogHeaderProps = OverlayHeaderProps;
export type DialogTitleProps = OverlayTitleProps;
export type DialogDescriptionProps = OverlayDescriptionProps;
export type DialogBodyProps = OverlayBodyProps;
/** Props of the dialog panel; the Dialog's own native props, `className` and `ref` are merged in. */
export type DialogContentProps = ComponentPropsWithRef<'div'>;

/** Opens the dialog (`Dialog.Trigger`): its single child gets the click handler. */
export const DialogTrigger = parts.Trigger;
/** Closes the dialog (`Dialog.Close`), e.g. the Cancel button. */
export const DialogClose = parts.Close;
/** Title and description area (`Dialog.Header`). */
export const DialogHeader = parts.Header;
/** The heading (`Dialog.Title`); it names the dialog. */
export const DialogTitle = parts.Title;
/** Supporting text (`Dialog.Description`); it describes the dialog. */
export const DialogDescription = parts.Description;
/** The scrolling content (`Dialog.Body`). */
export const DialogBody = parts.Body;

/** The Dialog props the compound `Dialog.Content` renders the panel with. */
interface DialogSurface extends Pick<DialogProps, 'size' | 'showClose' | 'closeLabel' | 'className' | 'layerClassName'> {
  /** The Dialog's other native and layer props (`ref` included): they go to the panel, as without parts. */
  rest: Partial<Omit<ModalLayerProps, 'open' | 'onClose' | 'placement' | 'children' | 'className' | 'layerClassName'>>;
  scrolled: boolean;
}
const DialogSurfaceContext = createContext<DialogSurface | null>(null);

/** The dialog panel of the compound form (`Dialog.Content`), with the parts inside. */
export const DialogContent = withRef(function DialogContent({ className, children, ref, ...props }: DialogContentProps) {
  const overlay = useContext(parts.Context);
  const surface = useContext(DialogSurfaceContext);
  if (!overlay || !surface) throw new Error('Dialog.Content must be inside its Dialog');
  const { size = 'md', showClose = true, closeLabel = 'Close', rest } = surface;
  const title = findPart<DialogTitleProps>(children, DialogTitle);
  const description = findPart<DialogDescriptionProps>(children, DialogDescription);
  return (
    <ModalLayer
      aria-labelledby={title ? (title.props.id ?? overlay.titleId) : undefined}
      aria-describedby={description ? (description.props.id ?? overlay.descriptionId) : undefined}
      {...rest}
      {...props}
      ref={mergeRefs(rest.ref, ref)}
      open={overlay.open}
      onClose={() => overlay.setOpen(false)}
      placement="center"
      layerClassName={cx('ui-dialog-layer', `ui-dialog-layer--${size}`, surface.layerClassName)}
      className={cx('ui-floating ui-dialog', surface.className, className)}
      data-size={size}
      data-closable={showClose || undefined}
      data-scrolled={surface.scrolled || undefined}
    >
      {children}
      {showClose && <IconButton className="ui-dialog__close" size="sm" icon={<XIcon />} label={closeLabel} onClick={() => overlay.setOpen(false)} />}
    </ModalLayer>
  );
});

export const Dialog = withRef(function Dialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  title,
  description,
  footer,
  size = 'md',
  showClose = true,
  closeLabel = 'Close',
  className,
  layerClassName,
  children,
  ...rest
}: DialogProps) {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const [scrolled, setScrolled] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  // The body remounts on every opening, so its scroll state must start over too.
  if (!open && scrolled) setScrolled(false);

  const overlay = useMemo(() => ({ open, setOpen, titleId, descriptionId, onBodyScroll: setScrolled }), [open, setOpen, titleId, descriptionId]);
  if (hasPart(children, [DialogTrigger, DialogContent])) {
    const surface: DialogSurface = { size, showClose, closeLabel, className, layerClassName, rest, scrolled };
    return (
      <parts.Context.Provider value={overlay}>
        <DialogSurfaceContext.Provider value={surface}>{children}</DialogSurfaceContext.Provider>
      </parts.Context.Provider>
    );
  }

  return (
    <parts.Context.Provider value={overlay}>
      <ModalLayer
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        {...rest}
        open={open}
        onClose={() => setOpen(false)}
        placement="center"
        layerClassName={cx('ui-dialog-layer', `ui-dialog-layer--${size}`, layerClassName)}
        className={cx('ui-floating ui-dialog', className)}
        data-size={size}
        data-closable={showClose || undefined}
        data-scrolled={scrolled || undefined}
      >
        {(title || description) && (
          <div className="ui-dialog__header">
            {title && (
              <h2 id={titleId} className="ui-dialog__title">
                {title}
              </h2>
            )}
            {description && (
              <div id={descriptionId} className="ui-dialog__description">
                {description}
              </div>
            )}
          </div>
        )}
        {children != null && children !== false && (
          <div
            className="ui-dialog__body"
            onScroll={(event: UIEvent<HTMLDivElement>) => setScrolled(event.currentTarget.scrollTop > 0)}
          >
            {children}
          </div>
        )}
        {footer && <DialogFooter>{footer}</DialogFooter>}
        {/* Last in DOM so initial focus lands on the content, not on the close button. */}
        {showClose && (
          <IconButton
            className="ui-dialog__close"
            size="sm"
            icon={<XIcon />}
            label={closeLabel}
            onClick={() => setOpen(false)}
          />
        )}
      </ModalLayer>
    </parts.Context.Provider>
  );
}, {
  Trigger: DialogTrigger,
  Content: DialogContent,
  Header: DialogHeader,
  Title: DialogTitle,
  Description: DialogDescription,
  Body: DialogBody,
  Footer: DialogFooter,
  Close: DialogClose,
});
