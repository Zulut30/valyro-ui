'use client';

import type { ComponentPropsWithRef, CSSProperties, ReactNode } from 'react';
import { cx } from '../primitives';
import type { WidgetTone } from './utils';
import './DescriptionList.css';
import { withRef } from '../primitives/react-compat';

export interface DescriptionListItem {
  /** Stable key; defaults to the index. */
  id?: string;
  /** The term: "Owner", "Next billing date". */
  label: ReactNode;
  /** The value; any node (a badge, a link, a formatted number). */
  value: ReactNode;
  /** Small icon before the label. */
  icon?: ReactNode;
  /** Color of the value. Default `neutral`. */
  tone?: WidgetTone | 'muted';
  /** Extra line under the value in the muted color. */
  hint?: ReactNode;
  /** Columns the item spans in the `grid` layout (e.g. a long bio over both columns). */
  span?: number;
}

export interface DescriptionListProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** The term–value pairs, in reading order. */
  items: DescriptionListItem[];
  /** `stacked`: label above value; `inline`: label left, value right (billing rows); `grid`: stacked items in columns. */
  layout?: 'stacked' | 'inline' | 'grid';
  /** Columns of the `grid` layout; below 360px of width they collapse to one. Default 2. */
  columns?: number;
  /** Hairlines between the items. */
  dividers?: boolean;
  /** Text size of the values. Default `md`. */
  size?: 'sm' | 'md' | 'lg';
}

export const DescriptionList = withRef(function DescriptionList({ items, layout = 'stacked', columns = 2, dividers = false, size = 'md', className, style, ...rest }: DescriptionListProps) {
  return (
    <div className={cx('ui-description-list', className)} style={{ '--ui-description-list-columns': columns, ...style } as CSSProperties} {...rest}>
      <dl className="ui-description-list__list" data-layout={layout} data-size={size} data-dividers={dividers || undefined}>
        {items.map((item, index) => (
          <div
            key={item.id ?? index}
            className="ui-description-list__item"
            style={item.span ? ({ '--ui-description-list-span': Math.min(item.span, columns) } as CSSProperties) : undefined}
          >
            <dt className="ui-description-list__label">
              {item.icon != null && (
                <span className="ui-description-list__icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              {item.label}
            </dt>
            <dd className="ui-description-list__value" data-tone={item.tone ?? 'neutral'}>
              {item.value}
              {item.hint != null && <span className="ui-description-list__hint">{item.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
});
