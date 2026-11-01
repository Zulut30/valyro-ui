'use client';

import type { ComponentPropsWithRef, ComponentType, CSSProperties, ReactNode } from 'react';
import { cx } from '../primitives';
import { withRef } from '../primitives/react-compat';
import './Icon.css';

/** Props an icon component from any set receives from Icon (the kit's, Lucide, Heroicons, your own). */
export interface IconSourceProps {
  className?: string;
  strokeWidth?: number | string;
  'aria-hidden'?: boolean | 'true' | 'false';
  focusable?: boolean | 'true' | 'false';
}

export interface IconWrapperProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** An icon component to render: one of the kit's (`SearchIcon`), Lucide's, Heroicons'… Or pass an `<svg>` as children. */
  as?: ComponentType<IconSourceProps>;
  /** A raw `<svg>` (or any icon element) to size and label. */
  children?: ReactNode;
  /** Width and height: a number of pixels or any CSS length. Default `1em`, the size of the surrounding text. */
  size?: number | string;
  /** Stroke width for stroke icons; default the theme's `--ui-icon-stroke`, so foreign icons match the kit's. */
  strokeWidth?: number | string;
  /** Accessible name: the icon becomes an image (`role="img"`). Without it the icon is decorative and hidden from screen readers. */
  label?: string;
  /** Mirror the icon in right-to-left layouts (arrows, chevrons, "send"). */
  directional?: boolean;
}

/**
 * Puts any icon on the kit's rules: a size from the text around it (or pixels), the theme's stroke width (pixel,
 * brutalism and terminal draw heavier lines), `currentColor`, mirroring in right-to-left layouts, and an honest
 * accessible name — `label` makes it an image, without one it is hidden from screen readers.
 */
export const Icon = withRef(function Icon({ as: Source, children, size = '1em', strokeWidth, label, directional = false, className, style, ...rest }: IconWrapperProps) {
  const vars = {
    '--_size': typeof size === 'number' ? `${size}px` : size,
    ...(strokeWidth !== undefined ? { strokeWidth } : null),
    ...style,
  } as CSSProperties;
  return (
    <span
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      {...rest}
      className={cx('ui-icon', className)}
      style={vars}
      data-dir-flip={directional ? '' : undefined}
    >
      {Source ? <Source aria-hidden="true" focusable="false" strokeWidth={strokeWidth} /> : children}
    </span>
  );
});
