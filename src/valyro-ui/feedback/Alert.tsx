'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../primitives';
import { childElements, collectionPart } from '../primitives/compound';
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon, XIcon } from '../icons';
import { IconButton } from '../basic/IconButton';
import './Alert.css';
import { withRef } from '../primitives/react-compat';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export interface AlertProps extends Omit<ComponentPropsWithRef<'div'>, 'title'> {
  /** Status color and default icon; `warning` and `danger` are announced immediately (`role="alert"`). */
  variant?: AlertVariant;
  /** Bold first line of the message. */
  title?: ReactNode;
  /** Body text under the title, or the whole message when there is no title. */
  description?: ReactNode;
  /** Replaces the variant's default icon; `null` hides it. */
  icon?: ReactNode;
  /** Buttons or links shown at the end of the alert. */
  action?: ReactNode;
  /** Shows a close button that calls this. */
  onDismiss?: () => void;
  /** Accessible name of the close button. */
  dismissLabel?: string;
}

const ICONS: Record<AlertVariant, ReactNode> = {
  info: <InfoIcon />,
  success: <CheckCircleIcon />,
  warning: <AlertTriangleIcon />,
  danger: <AlertCircleIcon />,
  neutral: <InfoIcon />,
};

export interface AlertPartProps {
  children?: ReactNode;
}

/** The bold first line (`Alert.Title`, the `title` prop). */
export const AlertTitle = collectionPart<AlertPartProps>('Alert.Title');
/** The body text (`Alert.Description`, the `description` prop). */
export const AlertDescription = collectionPart<AlertPartProps>('Alert.Description');
/** Buttons or links at the end (`Alert.Action`, the `action` prop). */
export const AlertAction = collectionPart<AlertPartProps>('Alert.Action');

const PARTS: unknown[] = [AlertTitle, AlertDescription, AlertAction];

/** Inline message. Warning and danger are announced immediately (`role="alert"`), others politely. */
export const Alert = withRef(function Alert({
  variant = 'info',
  title: titleProp,
  description: descriptionProp,
  icon,
  action: actionProp,
  onDismiss,
  dismissLabel = 'Dismiss',
  className,
  children: childrenProp,
  ...rest
}: AlertProps) {
  // The compound form: Title, Description and Action parts among the children stand for the props.
  const elements = childElements(childrenProp);
  const compound = elements.some((child) => PARTS.includes(child.type));
  const part = (type: unknown) => (compound ? (elements.find((child) => child.type === type)?.props as AlertPartProps | undefined)?.children : undefined);
  const title = titleProp ?? part(AlertTitle);
  const description = descriptionProp ?? part(AlertDescription);
  const action = actionProp ?? part(AlertAction);
  // The parts themselves render nothing, so the children stay as they are.
  const children = childrenProp;
  const urgent = variant === 'warning' || variant === 'danger';
  const glyph = icon === undefined ? ICONS[variant] : icon;

  return (
    <div role={urgent ? 'alert' : 'status'} {...rest} className={cx('ui-alert', className)} data-variant={variant}>
      {glyph && (
        <span className="ui-alert__icon" aria-hidden="true">
          {glyph}
        </span>
      )}
      <div className="ui-alert__content">
        {title && <div className="ui-alert__title">{title}</div>}
        {description && <div className="ui-alert__description">{description}</div>}
        {children}
      </div>
      {action && <div className="ui-alert__action">{action}</div>}
      {onDismiss && (
        <IconButton className="ui-alert__close" size="sm" icon={<XIcon />} label={dismissLabel} onClick={onDismiss} />
      )}
    </div>
  );
}, { Title: AlertTitle, Description: AlertDescription, Action: AlertAction });
