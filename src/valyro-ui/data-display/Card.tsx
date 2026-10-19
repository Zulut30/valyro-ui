'use client';

import { isValidElement, type ComponentPropsWithRef } from 'react';
import { cx, Slot } from '../primitives';
import './Card.css';
import { withRef } from '../primitives/react-compat';

export type CardVariant = 'default' | 'outline' | 'interactive';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends ComponentPropsWithRef<'div'> {
  /** `interactive` adds hover lift and a focus ring — pair it with `asChild` and a link or button. */
  variant?: CardVariant;
  /** Inner padding and gap between sections; `none` also clips content to the rounded corners (e.g. edge-to-edge media). */
  padding?: CardPadding;
  /** Render the single child element (e.g. an <a>) with card styling. */
  asChild?: boolean;
}

export type CardHeaderProps = ComponentPropsWithRef<'div'>;

export const CardHeader = withRef(function CardHeader({ className, ...rest }: CardHeaderProps) {
  return <div className={cx('ui-card__header', className)} {...rest} />;
});

export type CardTitleProps = ComponentPropsWithRef<'h3'>;

export const CardTitle = withRef(function CardTitle({ className, ...rest }: CardTitleProps) {
  return <h3 className={cx('ui-card__title', className)} {...rest} />;
});

export type CardDescriptionProps = ComponentPropsWithRef<'p'>;

export const CardDescription = withRef(function CardDescription({ className, ...rest }: CardDescriptionProps) {
  return <p className={cx('ui-card__description', className)} {...rest} />;
});

export type CardContentProps = ComponentPropsWithRef<'div'>;

export const CardContent = withRef(function CardContent({ className, ...rest }: CardContentProps) {
  return <div className={cx('ui-card__content', className)} {...rest} />;
});

export type CardFooterProps = ComponentPropsWithRef<'div'>;

export const CardFooter = withRef(function CardFooter({ className, ...rest }: CardFooterProps) {
  return <div className={cx('ui-card__footer', className)} {...rest} />;
});

/**
 * A surface for related content. Compose it from parts, as named exports (`CardHeader`) or as members
 * (`Card.Header`, `Card.Title`, `Card.Description`, `Card.Body` / `Card.Content`, `Card.Footer`).
 */
export const Card = withRef(function Card({ variant = 'default', padding = 'md', asChild = false, className, children, ...rest }: CardProps) {
  const props = {
    ...rest,
    className: cx('ui-card', variant !== 'outline' && 'ui-panel', className),
    'data-variant': variant,
    'data-padding': padding,
  };
  if (asChild && isValidElement(children)) return <Slot {...props}>{children}</Slot>;
  return <div {...props}>{children}</div>;
}, {
  Header: CardHeader,
  Title: CardTitle,
  Description: CardDescription,
  /** The card body (CardContent). */
  Body: CardContent,
  Content: CardContent,
  Footer: CardFooter,
});
