'use client';

import type { ReactNode } from 'react';
import type { IconProps } from '../icons';
import { withRef } from '../primitives/react-compat';

/** Icons missing from the shared set; same geometry and stroke conventions (Lucide, ISC). */
function createIcon(name: string, body: ReactNode) {
  const Icon = withRef(function Icon({ size = 16, strokeWidth, className, ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={className ? `ui-icon ${className}` : 'ui-icon'}
        {...rest}
      >
        {body}
      </svg>
    );
  });
  return Object.assign(Icon, { displayName: `${name}Icon` });
}

export const ThumbsDownIcon = createIcon(
  'ThumbsDown',
  <>
    <path d="M17 14V2" />
    <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z" />
  </>,
);

export const WrapTextIcon = createIcon(
  'WrapText',
  <>
    <path d="M3 6h18" />
    <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
    <path d="m16 16-2 2 2 2" />
    <path d="M3 18h7" />
  </>,
);

export const LightbulbIcon = createIcon(
  'Lightbulb',
  <>
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
    <path d="M9 18h6" />
    <path d="M10 22h4" />
  </>,
);

export const WrenchIcon = createIcon(
  'Wrench',
  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
);

export const MaximizeIcon = createIcon(
  'Maximize',
  <>
    <path d="M15 3h6v6" />
    <path d="M9 21H3v-6" />
    <path d="m21 3-7 7" />
    <path d="m3 21 7-7" />
  </>,
);

export const MinimizeIcon = createIcon(
  'Minimize',
  <>
    <path d="M4 14h6v6" />
    <path d="M20 10h-6V4" />
    <path d="m14 10 7-7" />
    <path d="m3 21 7-7" />
  </>,
);
