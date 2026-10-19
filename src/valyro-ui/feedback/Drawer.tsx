'use client';

import { createContext, useContext, useMemo, useRef, type ComponentPropsWithRef, type PointerEvent, type ReactNode, type Ref } from 'react';
import { cx, mergeRefs, ModalLayer, useControllableState, useLatest, type ModalLayerProps } from '../primitives';
import { findPart, hasPart } from '../primitives/compound';
import { XIcon } from '../icons';
import { IconButton } from '../basic/IconButton';
import { isDismissGesture } from './gesture';
import {
  createOverlayParts,
  type OverlayBodyProps,
  type OverlayCloseProps,
  type OverlayDescriptionProps,
  type OverlayFooterProps,
  type OverlayHeaderProps,
  type OverlayTitleProps,
  type OverlayTriggerProps,
} from './overlay-parts';
import './Drawer.css';
import { withRef, useId } from '../primitives/react-compat';

export type DrawerPlacement = 'right' | 'left' | 'bottom';
export type DrawerSize = 'sm' | 'md' | 'lg' | 'full';

export interface DrawerProps extends Omit<ModalLayerProps, 'open' | 'onClose' | 'placement' | 'from' | 'title' | 'children'> {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** `bottom` is a sheet with a grab handle that can be dragged down to dismiss. */
  placement?: DrawerPlacement;
  /** Width for side drawers, maximum height for bottom sheets. */
  size?: DrawerSize;
  /** Heading; becomes the drawer's accessible name. */
  title?: ReactNode;
  /** Supporting text under the title; becomes the drawer's accessible description. */
  description?: ReactNode;
  /** Sticky action bar under the scrollable body. */
  footer?: ReactNode;
  /** Show the × button (default true). */
  showClose?: boolean;
  /** Accessible name of the × button. */
  closeLabel?: string;
  /**
   * Body content; it scrolls between the header and the footer when it overflows. In the compound form, a
   * `Drawer.Trigger` and a `Drawer.Content` (with `Drawer.Header`, `.Title`, `.Description`, `.Body`, `.Footer`, `.Close`).
   */
  children?: ReactNode;
}

const parts = createOverlayParts('Drawer');

export type DrawerTriggerProps = OverlayTriggerProps;
export type DrawerCloseProps = OverlayCloseProps;
export type DrawerHeaderProps = OverlayHeaderProps;
export type DrawerTitleProps = OverlayTitleProps;
export type DrawerDescriptionProps = OverlayDescriptionProps;
export type DrawerBodyProps = OverlayBodyProps;
export type DrawerFooterProps = OverlayFooterProps;
/** Props of the drawer panel; the Drawer's own native props, `className` and `ref` are merged in. */
export type DrawerContentProps = ComponentPropsWithRef<'div'>;

/** Opens the drawer (`Drawer.Trigger`): its single child gets the click handler. */
export const DrawerTrigger = parts.Trigger;
/** Closes the drawer (`Drawer.Close`), e.g. the Cancel button. */
export const DrawerClose = parts.Close;
/** Title and description area (`Drawer.Header`). */
export const DrawerHeader = parts.Header;
/** The heading (`Drawer.Title`); it names the drawer. */
export const DrawerTitle = parts.Title;
/** Supporting text (`Drawer.Description`); it describes the drawer. */
export const DrawerDescription = parts.Description;
/** The scrolling content (`Drawer.Body`). */
export const DrawerBody = parts.Body;
/** The sticky action bar (`Drawer.Footer`). */
export const DrawerFooter = parts.Footer;

/** What the compound `Drawer.Content` renders the panel with: the Drawer's props and its drag handle. */
interface DrawerSurface extends Pick<DrawerProps, 'placement' | 'size' | 'showClose' | 'closeLabel' | 'className'> {
  /** The Drawer's other native and layer props (`ref` included): they go to the panel, as without parts. */
  rest: Partial<Omit<ModalLayerProps, 'open' | 'onClose' | 'placement' | 'from' | 'children' | 'className'>>;
  panelRef: Ref<HTMLDivElement>;
  handle: ReactNode;
}
const DrawerSurfaceContext = createContext<DrawerSurface | null>(null);

/** The drawer panel of the compound form (`Drawer.Content`), with the parts inside. */
export const DrawerContent = withRef(function DrawerContent({ className, children, ref, ...props }: DrawerContentProps) {
  const overlay = useContext(parts.Context);
  const surface = useContext(DrawerSurfaceContext);
  if (!overlay || !surface) throw new Error('Drawer.Content must be inside its Drawer');
  const { placement = 'right', size = 'md', showClose = true, closeLabel = 'Close', rest } = surface;
  const title = findPart<DrawerTitleProps>(children, DrawerTitle);
  const description = findPart<DrawerDescriptionProps>(children, DrawerDescription);
  return (
    <ModalLayer
      aria-labelledby={title ? (title.props.id ?? overlay.titleId) : undefined}
      aria-describedby={description ? (description.props.id ?? overlay.descriptionId) : undefined}
      {...rest}
      {...props}
      ref={mergeRefs(surface.panelRef, rest.ref, ref)}
      open={overlay.open}
      onClose={() => overlay.setOpen(false)}
      placement={placement}
      className={cx('ui-floating ui-drawer', surface.className, className)}
      data-size={size}
      data-closable={showClose || undefined}
    >
      {surface.handle}
      {children}
      {showClose && <IconButton className="ui-drawer__close" size="sm" icon={<XIcon />} label={closeLabel} onClick={() => overlay.setOpen(false)} />}
    </ModalLayer>
  );
});

// Pull distance (px) that dismisses the sheet; a quick flick needs less.
const DRAG_DISMISS = 96;
const FLICK_VELOCITY = 0.6;

export const Drawer = withRef(function Drawer({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  placement = 'right',
  size = 'md',
  title,
  description,
  footer,
  showClose = true,
  closeLabel = 'Close',
  className,
  ref,
  children,
  ...rest
}: DrawerProps) {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const openLatest = useLatest(open);
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; time: number; dy: number } | null>(null);

  // The sheet follows the finger directly (no React state per frame); releasing past the
  // threshold closes it and the exit animation continues from where it was dropped.
  const onHandleDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { y: event.clientY, time: event.timeStamp, dy: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    panelRef.current?.setAttribute('data-dragging', '');
  };
  const onHandleMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const panel = panelRef.current;
    if (!d || !panel) return;
    const dy = event.clientY - d.y;
    // Pulling up only stretches a little.
    d.dy = dy > 0 ? dy : dy * 0.1;
    panel.style.transform = `translateY(${d.dy}px)`;
  };
  const onHandleUp = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const panel = panelRef.current;
    drag.current = null;
    if (!d || !panel) return;
    panel.removeAttribute('data-dragging');
    if (isDismissGesture(d.dy, event.timeStamp - d.time, Math.min(DRAG_DISMISS, panel.offsetHeight / 3), FLICK_VELOCITY)) {
      setOpen(false);
      // A controlling parent may refuse to close (unsaved changes): then the panel slides back instead of sticking.
      requestAnimationFrame(() => {
        if (openLatest.current) panel.style.transform = '';
      });
    } else {
      panel.style.transform = '';
    }
  };

  const overlay = useMemo(() => ({ open, setOpen, titleId, descriptionId }), [open, setOpen, titleId, descriptionId]);
  const handle = placement === 'bottom' && (
    <div
      className="ui-drawer__handle"
      aria-hidden="true"
      onPointerDown={onHandleDown}
      onPointerMove={onHandleMove}
      onPointerUp={onHandleUp}
      onPointerCancel={onHandleUp}
    />
  );
  if (hasPart(children, [DrawerTrigger, DrawerContent])) {
    const surface: DrawerSurface = { placement, size, showClose, closeLabel, className, rest: { ...rest, ref }, panelRef, handle };
    return (
      <parts.Context.Provider value={overlay}>
        <DrawerSurfaceContext.Provider value={surface}>{children}</DrawerSurfaceContext.Provider>
      </parts.Context.Provider>
    );
  }

  return (
    <parts.Context.Provider value={overlay}>
      <ModalLayer
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        {...rest}
        ref={mergeRefs(panelRef, ref)}
        open={open}
        onClose={() => setOpen(false)}
        placement={placement}
        className={cx('ui-floating ui-drawer', className)}
        data-size={size}
        data-closable={showClose || undefined}
      >
        {handle}
        {(title || description) && (
          <div className="ui-drawer__header">
            {title && (
              <h2 id={titleId} className="ui-drawer__title">
                {title}
              </h2>
            )}
            {description && (
              <div id={descriptionId} className="ui-drawer__description">
                {description}
              </div>
            )}
          </div>
        )}
        <div className="ui-drawer__body">{children}</div>
        {footer && <div className="ui-drawer__footer">{footer}</div>}
        {/* Last in DOM so initial focus lands on the content, not on the close button. */}
        {showClose && (
          <IconButton
            className="ui-drawer__close"
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
  Trigger: DrawerTrigger,
  Content: DrawerContent,
  Header: DrawerHeader,
  Title: DrawerTitle,
  Description: DrawerDescription,
  Body: DrawerBody,
  Footer: DrawerFooter,
  Close: DrawerClose,
});
