'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx, mergeRefs, useControllableState } from '../primitives';
import { BellIcon, InboxIcon } from '../icons';
import { useLocale } from '../theme/ThemeProvider';
import { Button } from '../basic/Button';
import { IconButton } from '../basic/IconButton';
import { Popover, type PopoverProps } from './Popover';
import './NotificationCenter.css';
import { withRef, useId } from '../primitives/react-compat';

export interface NotificationItem {
  id: string;
  title: ReactNode;
  body?: ReactNode;
  time: Date | number;
  read?: boolean;
  /** Leading avatar element, e.g. `<Avatar name="…" />`. */
  avatar?: ReactNode;
  /** Leading icon, used when there is no avatar. */
  icon?: ReactNode;
}

export interface NotificationCenterLabels {
  /** Accessible name of the bell button. */
  trigger: string;
  /** Appended to the bell's name while there are unread items, e.g. "3 unread". */
  unreadCount: (count: number) => string;
  markAllRead: string;
  /** Accessible name of the All / Unread filter. */
  filter: string;
  all: string;
  unread: string;
  /** Screen-reader text for an item's unread dot. */
  unreadItem: string;
}

export interface NotificationCenterProps extends Omit<PopoverProps, 'trigger' | 'children' | 'title' | 'arrow'> {
  /** Items in display order; unread ones (`read` not set) drive the bell badge and the Unread filter. */
  notifications: NotificationItem[];
  /** Panel heading; also its accessible name. */
  title?: ReactNode;
  /** Turns items into buttons; mark the item read yourself (e.g. set `read` and pass the list back). */
  onItemClick?: (item: NotificationItem) => void;
  /** Shows the "Mark all read" button. */
  onMarkAllRead?: () => void;
  /** Content under the list, e.g. a "View all" link. */
  footer?: ReactNode;
  /** Shown instead of the list when the current filter has no items. */
  emptyMessage?: ReactNode;
  /** Overrides for the built-in strings. */
  labels?: Partial<NotificationCenterLabels>;
  /**
   * BCP 47 locale for the relative times ("5 minutes ago") and counts. Defaults to the `ThemeProvider`
   * locale, then English — the times are words, so they follow the (English) default labels.
   */
  locale?: string;
}

const DEFAULT_LABELS: NotificationCenterLabels = {
  trigger: 'Notifications',
  unreadCount: (count) => `${count} unread`,
  markAllRead: 'Mark all read',
  filter: 'Filter notifications',
  all: 'All',
  unread: 'Unread',
  unreadItem: 'Unread',
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

/** One formatter per locale: a list of a hundred notifications must not build a hundred on every tick. */
function relativeFormat(locale?: string) {
  const key = locale ?? '';
  let format = relativeFormats.get(key);
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    relativeFormats.set(key, format);
  }
  return format;
}

/** "5 minutes ago", "yesterday", "in 2 hours" — truncated to the largest whole unit. */
export function formatRelativeTime(time: Date | number, now: Date | number = Date.now(), locale?: string) {
  const seconds = (Number(time) - Number(now)) / 1000;
  const format = relativeFormat(locale);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  }
  return format.format(0, 'second');
}

/** Current time that refreshes every minute while `active`, so "2 minutes ago" keeps counting. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export const NotificationCenter = withRef(function NotificationCenter({
  notifications,
  title = 'Notifications',
  onItemClick,
  onMarkAllRead,
  footer,
  emptyMessage = 'You’re all caught up',
  labels: labelOverrides,
  locale: localeProp,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  placement = 'bottom-end',
  className,
  ref,
  ...rest
}: NotificationCenterProps) {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const now = useNow(open);
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const locale = useLocale(localeProp) ?? 'en';
  const count = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const unread = notifications.filter((n) => !n.read).length;
  const items = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications;
  // A clicked row can leave the list (read, in the Unread filter): focus then moves to the row now in its place.
  const refocusIndex = useRef<number | null>(null);
  useEffect(() => {
    const index = refocusIndex.current;
    if (index === null) return;
    refocusIndex.current = null;
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    const rows = panel.querySelectorAll<HTMLElement>('.ui-notification-center__item');
    (rows[Math.min(index, rows.length - 1)] ?? panel).focus({ preventScroll: true });
  }, [items]);

  return (
    <Popover
      aria-labelledby={titleId}
      {...rest}
      ref={mergeRefs(panelRef, ref)}
      open={open}
      onOpenChange={setOpen}
      placement={placement}
      className={cx('ui-notification-center', className)}
      trigger={
        <IconButton
          className="ui-notification-center__trigger"
          label={unread ? `${labels.trigger}, ${labels.unreadCount(unread)}` : labels.trigger}
          icon={
            <>
              <BellIcon />
              {unread > 0 && (
                <span className="ui-notification-center__badge" aria-hidden="true">
                  {unread > 99 ? `${count.format(99)}+` : count.format(unread)}
                </span>
              )}
            </>
          }
        />
      }
    >
      <div className="ui-notification-center__header">
        <h2 id={titleId} className="ui-notification-center__title">
          {title}
        </h2>
        {onMarkAllRead && (
          <Button
            variant="ghost"
            size="sm"
            disabled={unread === 0}
            onClick={() => {
              onMarkAllRead();
              // The button disables itself; keep focus in the panel instead of dropping it to <body>.
              panelRef.current?.focus({ preventScroll: true });
            }}
          >
            {labels.markAllRead}
          </Button>
        )}
      </div>

      <div className="ui-notification-center__tabs" role="group" aria-label={labels.filter}>
        {(['all', 'unread'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="ui-notification-center__tab"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === 'all' ? labels.all : labels.unread}
            {value === 'unread' && unread > 0 && <span className="ui-notification-center__count">{count.format(unread)}</span>}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="ui-notification-center__empty" role="status">
          <span className="ui-notification-center__empty-icon" aria-hidden="true">
            <InboxIcon size={18} />
          </span>
          {emptyMessage}
        </div>
      ) : (
        <ul className="ui-notification-center__list">
          {items.map((item, index) => {
            const Row = onItemClick ? 'button' : 'div';
            return (
              <li key={item.id}>
                <Row
                  {...(onItemClick && {
                    type: 'button' as const,
                    onClick: () => {
                      refocusIndex.current = index;
                      onItemClick(item);
                    },
                  })}
                  className="ui-notification-center__item"
                  data-unread={!item.read || undefined}
                >
                  {item.avatar ?? (
                    <span className="ui-notification-center__icon" aria-hidden="true">
                      {item.icon ?? <BellIcon />}
                    </span>
                  )}
                  <span className="ui-notification-center__text">
                    <span className="ui-notification-center__item-title">{item.title}</span>
                    {item.body && <span className="ui-notification-center__item-body">{item.body}</span>}
                    <time className="ui-notification-center__time" dateTime={new Date(item.time).toISOString()}>
                      {formatRelativeTime(item.time, now, locale)}
                    </time>
                  </span>
                  {!item.read && (
                    <span className="ui-notification-center__dot">
                      <span className="ui-sr-only">{labels.unreadItem}</span>
                    </span>
                  )}
                </Row>
              </li>
            );
          })}
        </ul>
      )}

      {footer && <div className="ui-notification-center__footer">{footer}</div>}
    </Popover>
  );
});
