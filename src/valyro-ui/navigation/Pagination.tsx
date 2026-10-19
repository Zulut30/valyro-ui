'use client';

import { useMemo, useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from '../icons';
import { cx } from '../primitives';
import { useLocale } from '../theme/ThemeProvider';
import { useSlidingIndicator } from './internal';
import { usePagination } from './usePagination';
import './Pagination.css';
import { withRef } from '../primitives/react-compat';

export {
  getPaginationRange,
  type PaginationRangeItem,
  type PaginationRangeOptions,
} from './usePagination';

export interface PaginationLabels {
  previous: string;
  next: string;
  /** Accessible name of a page button; receives the formatted page number. */
  page: (page: string) => string;
  /** Compact variant status; receives the formatted page and page count. */
  status: (page: string, pageCount: string) => ReactNode;
}

export const defaultPaginationLabels: PaginationLabels = {
  previous: 'Previous page',
  next: 'Next page',
  page: (page) => `Page ${page}`,
  status: (page, pageCount) => (
    <>
      Page <strong>{page}</strong> of {pageCount}
    </>
  ),
};

export interface PaginationProps extends Omit<ComponentPropsWithRef<'nav'>, 'defaultValue' | 'onChange'> {
  /** Total number of pages; non-finite or lower values count as 1. */
  pageCount: number;
  /** Current page, 1-based. */
  value?: number;
  defaultValue?: number;
  onValueChange?: (page: number) => void;
  /** Page buttons shown on each side of the current page before an ellipsis. */
  siblings?: number;
  /** Page buttons always shown at the start and at the end. */
  boundaries?: number;
  /** `compact` shows "Page 3 of 10" between the arrows instead of page numbers. */
  variant?: 'default' | 'compact';
  /** Height of the page buttons: 32 / 40 / 48px, like the other controls' sm / md / lg. */
  size?: 'sm' | 'md' | 'lg';
  /** Overrides for the built-in English strings. */
  labels?: Partial<PaginationLabels>;
  /** Locale for page numbers (default: the ThemeProvider's, then the browser's). */
  locale?: string;
  /** `spring`: the current-page cursor springs to the chosen page with a slight overshoot. `default`: the theme's curve. */
  animation?: 'default' | 'spring';
}

export const Pagination = withRef(function Pagination({
  pageCount,
  value,
  defaultValue = 1,
  onValueChange,
  siblings = 1,
  boundaries = 1,
  variant = 'default',
  size = 'sm',
  labels: labelOverrides,
  locale,
  animation = 'default',
  className,
  'aria-label': ariaLabel,
  ...rest
}: PaginationProps) {
  // The behaviour is usePagination's (valyro-ui/headless): the range, the steps, the arrow keys, focus kept in place.
  const pagination = usePagination({ pageCount, value, defaultValue, onValueChange, siblings, boundaries });
  const { page, pageCount: count } = pagination;
  const listRef = useRef<HTMLUListElement>(null);
  const labels = { ...defaultPaginationLabels, ...labelOverrides };
  const resolvedLocale = useLocale(locale);
  const numberFormat = useMemo(() => new Intl.NumberFormat(resolvedLocale), [resolvedLocale]);
  const format = (n: number) => numberFormat.format(n);
  // The current page's fill slides between page buttons; until it is measured (SSR, first paint) the
  // current button paints its own fill.
  const cursor = useSlidingIndicator(listRef, variant === 'compact' ? null : page, ':scope > li > [aria-current="page"]');

  return (
    <nav
      {...rest}
      // Several on one page need distinct names: pass `aria-label`, or `aria-labelledby` to name it by a heading.
      aria-label={ariaLabel ?? (rest['aria-labelledby'] ? undefined : 'Pagination')}
      className={cx('ui-pagination', className)}
      data-variant={variant}
      data-size={size}
      data-motion={animation === 'spring' ? 'spring' : undefined}
    >
      <ul {...pagination.getListProps({ ref: listRef, className: 'ui-pagination__list', 'data-cursor': cursor ? '' : undefined })}>
        {cursor && (
          <li
            className="ui-pagination__cursor"
            aria-hidden="true"
            style={{
              width: cursor.width,
              height: cursor.height,
              transform: `translate(${cursor.left}px, ${cursor.top}px)`,
              transition: cursor.instant ? 'none' : undefined,
            }}
          />
        )}
        <li>
          <button {...pagination.getPreviousProps({ className: 'ui-pagination__item', 'aria-label': labels.previous })}>
            <ChevronLeftIcon />
          </button>
        </li>
        {variant === 'compact' ? (
          <li className="ui-pagination__status" aria-live="polite">
            {labels.status(format(page), format(count))}
          </li>
        ) : (
          pagination.range.map((item) =>
            typeof item === 'number' ? (
              <li key={item}>
                <button {...pagination.getPageProps(item, { className: 'ui-pagination__item', 'aria-label': labels.page(format(item)) })}>
                  {format(item)}
                </button>
              </li>
            ) : (
              <li key={item} className="ui-pagination__ellipsis" aria-hidden="true">
                <MoreHorizontalIcon />
              </li>
            ),
          )
        )}
        <li>
          <button {...pagination.getNextProps({ className: 'ui-pagination__item', 'aria-label': labels.next })}>
            <ChevronRightIcon />
          </button>
        </li>
      </ul>
    </nav>
  );
});
