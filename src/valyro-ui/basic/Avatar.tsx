'use client';

import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { cx, mergeRefs, useDismissableLayer } from '../primitives';
import '../primitives/motion.css';
import './Avatar.css';
import { withRef, useId } from '../primitives/react-compat';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type AvatarStatus = 'online' | 'offline' | 'busy' | 'away';

export interface AvatarProps extends Omit<ComponentPropsWithRef<'span'>, 'children'> {
  /** Image URL. When omitted or failing to load, initials (or `fallback`) are shown instead. */
  src?: string;
  /** Used for alt text, initials and the fallback color. */
  name?: string;
  /** Avatar dimensions, from 20px (`xs`) to 64px (`xl`). Inside an AvatarGroup, defaults to the group's size. */
  size?: AvatarSize;
  /** Circle, or a square with corners rounded to a quarter of the size. */
  shape?: 'circle' | 'square';
  /** Presence dot in the corner; also appended to the accessible name. */
  status?: AvatarStatus;
  /** Spoken status text appended to the name, e.g. "en ligne". Defaults to the `status` value. */
  statusLabel?: string;
  /** Custom fallback (e.g. an icon) instead of initials. */
  fallback?: ReactNode;
}

const HUES = ['blue', 'green', 'amber', 'red', 'purple', 'pink', 'teal'] as const;

// AvatarGroup's size applies to avatars that do not set their own.
const GroupSizeContext = createContext<AvatarSize | undefined>(undefined);

/** First letters of the first and last words. Works on code points, so non-BMP letters stay whole. */
export function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const initial = (word: string) => Array.from(word)[0] ?? '';
  const first = initial(parts[0]);
  const last = parts.length > 1 ? initial(parts[parts.length - 1]) : '';
  return (first + last).toUpperCase();
}

// A photo still loading after mount fades in when it arrives instead of popping in. Set from the DOM,
// so server markup (and an image already in the cache) shows at once without JavaScript.
const fadeInWhenLoaded = (img: HTMLImageElement | null) => {
  if (img && !img.complete) img.dataset.loading = '';
};

function hueFor(name: string) {
  if (!name.trim()) return undefined;
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return HUES[Math.abs(hash) % HUES.length];
}

export const Avatar = withRef(function Avatar({
  src,
  name = '',
  size: sizeProp,
  shape = 'circle',
  status,
  statusLabel,
  fallback,
  className,
  ...rest
}: AvatarProps) {
  const groupSize = useContext(GroupSizeContext);
  const size = sizeProp ?? groupSize ?? 'md';
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;
  const label = name ? (status ? `${name} (${statusLabel ?? status})` : name) : undefined;
  // Without a name (and no aria-label from the caller) the avatar is decorative.
  const named = !!label || !!rest['aria-label'] || !!rest['aria-labelledby'];

  return (
    <span
      role={named ? 'img' : undefined}
      aria-label={label}
      aria-hidden={named ? undefined : true}
      className={cx('ui-avatar', className)}
      data-size={size}
      data-shape={shape}
      data-hue={showImage ? undefined : hueFor(name)}
      {...rest}
    >
      {showImage ? (
        <img
          key={src}
          ref={fadeInWhenLoaded}
          className="ui-avatar__image"
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={(event) => delete event.currentTarget.dataset.loading}
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <span className="ui-avatar__fallback" aria-hidden="true">
          {fallback ?? getInitials(name)}
        </span>
      )}
      {status && <span className="ui-avatar__status" data-status={status} />}
    </span>
  );
});

export interface AvatarGroupProps extends ComponentPropsWithRef<'div'> {
  /** Show at most this many avatars, then a "+N" counter. */
  max?: number;
  size?: AvatarSize;
  /** Accessible name of the "+N" counter. Default: "N more". */
  moreLabel?: (count: number) => string;
  /**
   * `spring`: the avatar under the pointer or keyboard focus lifts with a bounce and its neighbours make
   * room. `default`: a static stack.
   */
  animation?: 'default' | 'spring';
  /** Shows each avatar's `name` in one tooltip that glides between them; the avatars become focusable. */
  tooltips?: boolean;
  /** Earlier avatars overlap later ones (the first is on top) instead of the other way round. */
  invertOverlap?: boolean;
}

const defaultMoreLabel = (count: number) => `${count} more`;

const HIDE_GRACE_MS = 120;

type AvatarElement = ReactElement<AvatarProps>;

export const AvatarGroup = withRef(function AvatarGroup({
  max,
  size = 'md',
  moreLabel = defaultMoreLabel,
  animation = 'default',
  tooltips = false,
  invertOverlap = false,
  className,
  children,
  ref,
  ...rest
}: AvatarGroupProps) {
  const items = Children.toArray(children);
  const visible = max && max > 0 ? items.slice(0, max) : items;
  const extra = items.length - visible.length;
  const groupRef = useRef<HTMLDivElement>(null);
  const tipId = useId();
  // The avatar the tooltip points at: its name and centre, measured once per hover or focus change.
  const [tip, setTip] = useState<{ index: number; name: string; x: number } | null>(null);

  // Leaving an avatar waits a moment, so the pointer can cross onto the tooltip (WCAG 1.4.13, as in Tooltip).
  const hideTimer = useRef<number | undefined>(undefined);
  const cancelHide = () => window.clearTimeout(hideTimer.current);
  useEffect(() => cancelHide, []);

  const show = (index: number, name: string, target: HTMLElement) => {
    const group = groupRef.current;
    if (!group || !name) return;
    cancelHide();
    const box = target.getBoundingClientRect();
    setTip({ index, name, x: box.left + box.width / 2 - group.getBoundingClientRect().left });
  };
  const hide = (index: number) => setTip((current) => (current?.index === index ? null : current));
  const hideSoon = (index: number) => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => hide(index), HIDE_GRACE_MS);
  };
  // Escape closes the tooltip; outside presses ignore it and reach the page.
  useDismissableLayer({ enabled: !!tip, refs: [], onDismiss: () => setTip(null), closeOnOutside: false, passThrough: true });

  const avatars =
    tooltips || invertOverlap
      ? visible.map((item, index) => {
          if (!isValidElement(item)) return item;
          const avatar = item as AvatarElement;
          const { name = '', style, tabIndex, onPointerEnter, onPointerLeave, onFocus, onBlur } = avatar.props;
          // The order goes through a variable, so a focused or hovered avatar can still rise above it (Avatar.css).
          const cloneProps: Partial<AvatarProps> = {
            style: invertOverlap ? ({ '--_z': visible.length - index, ...style } as CSSProperties) : style,
          };
          if (tooltips) {
            Object.assign(cloneProps, {
              // An avatar without a name is hidden from assistive tech and has no tooltip, so it takes no focus.
              tabIndex: tabIndex ?? (name ? 0 : undefined),
              'aria-describedby': tip?.index === index ? tipId : avatar.props['aria-describedby'],
              onPointerEnter: (event) => {
                onPointerEnter?.(event);
                if (event.pointerType !== 'touch') show(index, name, event.currentTarget);
              },
              onPointerLeave: (event) => {
                onPointerLeave?.(event);
                hideSoon(index);
              },
              onFocus: (event) => {
                onFocus?.(event);
                show(index, name, event.currentTarget);
              },
              onBlur: (event) => {
                onBlur?.(event);
                hide(index);
              },
            } satisfies Partial<AvatarProps>);
          }
          return cloneElement(avatar, cloneProps);
        })
      : visible;

  return (
    <div
      role="group"
      className={cx('ui-avatar-group', className)}
      data-size={size}
      data-motion={animation === 'spring' ? 'spring' : undefined}
      {...rest}
      ref={mergeRefs(groupRef, ref)}
    >
      <GroupSizeContext.Provider value={size}>{avatars}</GroupSizeContext.Provider>
      {extra > 0 && (
        <span
          role="img"
          aria-label={moreLabel(extra)}
          className="ui-avatar ui-avatar-group__more"
          data-size={size}
          data-shape="circle"
        >
          <span className="ui-avatar__fallback" aria-hidden="true">
            +{extra}
          </span>
        </span>
      )}
      {tooltips && (
        <span
          id={tipId}
          // Stays mounted so it can glide between avatars; it is only a tooltip while it has a name to show.
          role={tip ? 'tooltip' : undefined}
          className="ui-avatar-group__tip"
          data-visible={tip ? '' : undefined}
          style={{ '--_x': `${tip?.x ?? 0}px` } as CSSProperties}
          onPointerEnter={cancelHide}
          onPointerLeave={() => setTip(null)}
        >
          {tip?.name}
        </span>
      )}
    </div>
  );
});
