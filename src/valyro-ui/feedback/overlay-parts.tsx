'use client';

import { createContext, useContext, type ComponentPropsWithRef, type Context, type ReactElement, type UIEvent } from 'react';
import { composeHandlers, cx, Slot } from '../primitives';
import { withRef } from '../primitives/react-compat';

/** What the parts of a Dialog or Drawer read from it. */
export interface OverlayContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
  /** Called on body scroll (the dialog shades its header once the body scrolls). */
  onBodyScroll?: (scrolled: boolean) => void;
}

export interface OverlayTriggerProps {
  /** A single element, usually a Button; it opens the overlay on click. */
  children: ReactElement;
}

export interface OverlayCloseProps {
  /** A single element, usually a Button; it closes the overlay on click. */
  children: ReactElement;
}

export type OverlayHeaderProps = ComponentPropsWithRef<'div'>;
export type OverlayTitleProps = ComponentPropsWithRef<'h2'>;
export type OverlayDescriptionProps = ComponentPropsWithRef<'div'>;
export type OverlayBodyProps = ComponentPropsWithRef<'div'>;
export type OverlayFooterProps = ComponentPropsWithRef<'div'>;

function useOverlay(context: Context<OverlayContextValue | null>, part: string) {
  const value = useContext(context);
  if (!value) throw new Error(`${part} must be inside its ${part.split('.')[0]}`);
  return value;
}

/**
 * The parts that Dialog and Drawer share in their compound form, with the block's class names
 * (`ui-dialog__title`, `ui-drawer__title`…). Each component adds its own `Content`.
 */
export function createOverlayParts(name: 'Dialog' | 'Drawer') {
  const block = `ui-${name.toLowerCase()}`;
  const Context = createContext<OverlayContextValue | null>(null);

  /** Opens the overlay: its child gets the click handler and the dialog-button ARIA. */
  const Trigger = withRef(function Trigger({ children, ...rest }: OverlayTriggerProps) {
    const overlay = useOverlay(Context, `${name}.Trigger`);
    return (
      <Slot {...rest} aria-haspopup="dialog" aria-expanded={overlay.open} onClick={() => overlay.setOpen(true)}>
        {children}
      </Slot>
    );
  });

  /** Closes the overlay: an action button in the footer or anywhere in the content. */
  const Close = withRef(function Close({ children, ...rest }: OverlayCloseProps) {
    const overlay = useOverlay(Context, `${name}.Close`);
    return (
      <Slot {...rest} onClick={() => overlay.setOpen(false)}>
        {children}
      </Slot>
    );
  });

  const Header = withRef(function Header({ className, ...rest }: OverlayHeaderProps) {
    return <div {...rest} className={cx(`${block}__header`, className)} />;
  });

  /** The heading; it names the overlay. */
  const Title = withRef(function Title({ className, ...rest }: OverlayTitleProps) {
    const overlay = useOverlay(Context, `${name}.Title`);
    return <h2 id={overlay.titleId} {...rest} className={cx(`${block}__title`, className)} />;
  });

  /** Supporting text under the title; it describes the overlay. */
  const Description = withRef(function Description({ className, ...rest }: OverlayDescriptionProps) {
    const overlay = useOverlay(Context, `${name}.Description`);
    return <div id={overlay.descriptionId} {...rest} className={cx(`${block}__description`, className)} />;
  });

  /** The content between the header and the footer; it scrolls when it overflows. */
  const Body = withRef(function Body({ className, onScroll, ...rest }: OverlayBodyProps) {
    const overlay = useContext(Context);
    return (
      <div
        {...rest}
        className={cx(`${block}__body`, className)}
        onScroll={composeHandlers(onScroll, (event: UIEvent<HTMLDivElement>) => overlay?.onBodyScroll?.(event.currentTarget.scrollTop > 0))}
      />
    );
  });

  const Footer = withRef(function Footer({ className, ...rest }: OverlayFooterProps) {
    return <div {...rest} className={cx(`${block}__footer`, className)} />;
  });

  for (const [part, component] of Object.entries({ Trigger, Close, Header, Title, Description, Body, Footer })) {
    (component as { displayName?: string }).displayName = `${name}.${part}`;
  }
  return { Context, Trigger, Close, Header, Title, Description, Body, Footer };
}
