'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from '../primitives';
import './Timeline.css';
import { withRef } from '../primitives/react-compat';

export type TimelineStatus = 'default' | 'success' | 'warning' | 'danger' | 'accent';

export type TimelineProps = ComponentPropsWithRef<'ol'>;

export interface TimelineItemProps extends Omit<ComponentPropsWithRef<'li'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  /** Time label, e.g. "2h ago" or a formatted date. */
  timestamp?: ReactNode;
  /** Replaces the dot with an icon badge. */
  icon?: ReactNode;
  status?: TimelineStatus;
  /**
   * The step in progress (order tracking, onboarding): its marker gets a ring, the path up to it is drawn
   * solid in the steps' colours and the path after it dashed. Sets `aria-current="step"`.
   */
  current?: boolean;
  /** Extra content under the description (cards, code, attachments). */
  children?: ReactNode;
}

export const TimelineItem = withRef(function TimelineItem({
  title,
  description,
  timestamp,
  icon,
  status = 'default',
  current = false,
  className,
  children,
  ...rest
}: TimelineItemProps) {
  return (
    <li
      className={cx('ui-timeline__item', className)}
      data-status={status}
      data-icon={icon ? true : undefined}
      data-current={current || undefined}
      aria-current={current ? 'step' : undefined}
      {...rest}
    >
      <span className="ui-timeline__marker" aria-hidden="true">
        <span className="ui-timeline__dot">{icon}</span>
      </span>
      <div className="ui-timeline__body">
        <div className="ui-timeline__header">
          <span className="ui-timeline__title">{title}</span>
          {timestamp && <span className="ui-timeline__timestamp">{timestamp}</span>}
        </div>
        {description && <div className="ui-timeline__description">{description}</div>}
        {children && <div className="ui-timeline__content">{children}</div>}
      </div>
    </li>
  );
});

/** Vertical list of events; children are `TimelineItem`s (`Timeline.Item`). */
export const Timeline = withRef(function Timeline({ className, ...rest }: TimelineProps) {
  return <ol className={cx('ui-timeline', className)} {...rest} />;
}, { Item: TimelineItem });
