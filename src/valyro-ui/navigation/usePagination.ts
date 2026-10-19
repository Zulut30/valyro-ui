'use client';

import { useRef, type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent, type MouseEvent } from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { clamp, getDirection, inlineArrowStep } from '../primitives/utils';
import { useLayoutEffect } from '../primitives/react-compat';
import { useNodeRef, withUserProps, type UserProps } from '../primitives/prop-getters';

/*
 * The behaviour of Pagination without its markup: the current page (controlled or not, kept within the page count),
 * the page numbers and ellipses to show, previous / next steps, ← / → between the buttons (mirrored under RTL),
 * and focus that stays in the control when the focused step button is disabled on the first or last page.
 * Pagination renders with it.
 */

export type PaginationRangeItem = number | 'start-ellipsis' | 'end-ellipsis';

export interface PaginationRangeOptions {
  page: number;
  pageCount: number;
  /** Pages shown on each side of the current page. */
  siblings?: number;
  /** Pages always shown at the start and at the end. */
  boundaries?: number;
}

const range = (from: number, to: number) =>
  from > to ? [] : Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * Page numbers and ellipses to render. Once collapsing starts the result has a
 * constant length (2·boundaries + 2·siblings + 3), so the control never jumps
 * in width while paging; an ellipsis that would hide a single page shows the
 * page instead.
 */
export function getPaginationRange({
  page,
  pageCount,
  siblings: siblingsOption = 1,
  boundaries: boundariesOption = 1,
}: PaginationRangeOptions): PaginationRangeItem[] {
  const siblings = Math.max(0, Math.floor(siblingsOption) || 0);
  const boundaries = Math.max(0, Math.floor(boundariesOption) || 0);
  const count = Math.max(0, Math.floor(pageCount));
  const current = clamp(Math.round(page), 1, Math.max(count, 1));

  const startPages = range(1, Math.min(boundaries, count));
  const endPages = range(Math.max(count - boundaries + 1, boundaries + 1), count);

  const siblingsStart = Math.max(
    Math.min(current - siblings, count - boundaries - siblings * 2 - 1),
    boundaries + 2,
  );
  const siblingsEnd = Math.min(
    Math.max(current + siblings, boundaries + siblings * 2 + 2),
    count - boundaries - 1,
  );

  const startGap: PaginationRangeItem[] =
    siblingsStart > boundaries + 2
      ? ['start-ellipsis']
      : boundaries + 1 < count - boundaries
        ? [boundaries + 1]
        : [];
  const endGap: PaginationRangeItem[] =
    siblingsEnd < count - boundaries - 1
      ? ['end-ellipsis']
      : count - boundaries > boundaries
        ? [count - boundaries]
        : [];

  return [...startPages, ...startGap, ...range(siblingsStart, siblingsEnd), ...endGap, ...endPages];
}

export interface PaginationOptions {
  /** Total number of pages; non-finite or lower values count as 1. */
  pageCount: number;
  /** Current page, 1-based. */
  value?: number;
  defaultValue?: number;
  onValueChange?: (page: number) => void;
  /** Pages shown on each side of the current page before an ellipsis. Default 1. */
  siblings?: number;
  /** Pages always shown at the start and at the end. Default 1. */
  boundaries?: number;
}

export interface PaginationState {
  /** Current page, within 1…pageCount. */
  page: number;
  /** The page count, at least 1. */
  pageCount: number;
  /** Goes to a page (kept within range). */
  setPage: (page: number) => void;
  /** The page numbers and ellipses to render, in order. */
  range: PaginationRangeItem[];
  /** The element around the buttons: ← and → move focus between them. */
  getListProps: (props?: UserProps) => HTMLAttributes<HTMLElement> & { ref: (node: HTMLElement | null) => void };
  /** The previous-page button: disabled on the first page. Name it with `aria-label`. */
  getPreviousProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement>;
  /** The next-page button: disabled on the last page. */
  getNextProps: (props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement>;
  /** The button of one page: `aria-current="page"` on the current one. */
  getPageProps: (page: number, props?: UserProps) => ButtonHTMLAttributes<HTMLButtonElement>;
}

export function usePagination({
  pageCount,
  value,
  defaultValue = 1,
  onValueChange,
  siblings = 1,
  boundaries = 1,
}: PaginationOptions): PaginationState {
  const [rawPage, setRawPage] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const count = Number.isFinite(pageCount) ? Math.max(1, Math.floor(pageCount)) : 1;
  const page = clamp(Math.round(rawPage) || 1, 1, count);
  const setPage = (next: number) => setRawPage(clamp(next, 1, count));
  const [listRef, setListNode] = useNodeRef();
  // Set when the focused previous/next button is about to become disabled (first or last page).
  const refocus = useRef(false);

  // A disabled button drops focus to <body>; keep it in the control on the current page (or the other arrow).
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const list = listRef.current;
    const target =
      list?.querySelector<HTMLElement>('[aria-current="page"]') ??
      list?.querySelector<HTMLElement>('[data-kind="step"]:not(:disabled)');
    target?.focus();
  });

  const step = (delta: 1 | -1) => (event: MouseEvent<HTMLElement>) => {
    const next = clamp(page + delta, 1, count);
    if ((next === 1 || next === count) && document.activeElement === event.currentTarget) refocus.current = true;
    setPage(next);
  };

  // Arrow keys move focus between the buttons (mirrored in RTL); Enter / Space activate as usual.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    const delta = inlineArrowStep(event.key, getDirection(event.currentTarget));
    if (delta === 0) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const next = buttons[buttons.indexOf(event.target as HTMLButtonElement) + delta];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return {
    page,
    pageCount: count,
    setPage,
    range: getPaginationRange({ page, pageCount: count, siblings, boundaries }),
    getListProps: (props) => withUserProps({ ref: setListNode, onKeyDown }, props) as never,
    getPreviousProps: (props) =>
      withUserProps({ type: 'button', 'data-kind': 'step', disabled: page <= 1, onClick: step(-1) }, props),
    getNextProps: (props) =>
      withUserProps({ type: 'button', 'data-kind': 'step', disabled: page >= count, onClick: step(1) }, props),
    getPageProps: (item, props) =>
      withUserProps({ type: 'button', 'aria-current': item === page ? 'page' : undefined, onClick: () => setPage(item) }, props),
  };
}
