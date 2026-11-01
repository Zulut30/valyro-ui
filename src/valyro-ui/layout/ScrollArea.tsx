'use client';

import { createContext, useContext, type ComponentPropsWithRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import { ArrowDownIcon, ArrowRightIcon } from '../icons';
import { cx, mergeRefs, usePresence } from '../primitives';
import { findPart } from '../primitives/compound';
import { inertAttr, useLayoutEffect, withRef } from '../primitives/react-compat';
import { IconButton } from '../basic/IconButton';
import {
  useScrollArea,
  type ScrollAreaAxis,
  type ScrollAreaEdge,
  type ScrollAreaOrientation,
  type ScrollAreaState,
  type ScrollAreaVisibility,
} from './useScrollArea';
import './ScrollArea.css';

export type { ScrollAreaOrientation, ScrollAreaVisibility, ScrollAreaEdge };
export type ScrollAreaScrollbars = 'overlay' | 'native' | 'hidden';
export type ScrollAreaEdges = 'fade' | 'shadow' | 'none';

export interface ScrollAreaLabels {
  /** Name of the floating button that scrolls to the end (vertical areas). */
  scrollToEnd: string;
  /** The same for a horizontal area. */
  scrollToEndInline: string;
}

export const defaultScrollAreaLabels: ScrollAreaLabels = {
  scrollToEnd: 'Scroll to bottom',
  scrollToEndInline: 'Scroll to end',
};

export interface ScrollAreaProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Content, or the compound parts `ScrollArea.Viewport` (with `ScrollArea.Content`), `.Scrollbar`, `.Corner` and `.ScrollButton`. */
  children?: ReactNode;
  /** Axes that scroll. Default `vertical`. */
  orientation?: ScrollAreaOrientation;
  /** `overlay`: the kit's thin bars over the content; `native`: the browser's bars in theme colours; `hidden`: none (wheel, touch and keys still scroll). Default `overlay`. */
  scrollbars?: ScrollAreaScrollbars;
  /** When overlay bars show: while the pointer is over the area, while scrolling, whenever it overflows, or always. Default `hover`. */
  visibility?: ScrollAreaVisibility;
  /** Ms before overlay bars hide after the pointer leaves or scrolling stops. Default 600. */
  hideDelay?: number;
  /** Hint at content hidden past an edge: a soft mask, an inset shadow, or nothing. Default `fade`. */
  edges?: ScrollAreaEdges;
  /** Depth of the fade or shadow, px. Default `--ui-scroll-area-edge-size` (24px). */
  edgeSize?: number;
  /**
   * Keep the end in view while content grows (chats, logs): any scroll back releases it, reaching the end picks it
   * up again. Controlled: pair with `onFollowChange`. Passing this or `defaultFollow` turns follow mode on.
   */
  follow?: boolean;
  defaultFollow?: boolean;
  onFollowChange?: (follow: boolean) => void;
  /** Distance from the end, px, that counts as being at it. Default 32. */
  threshold?: number;
  /** Where it opens; `end` is applied before the first paint (no flash of the top). Default `start`, or `end` while following. */
  initialScroll?: 'start' | 'end';
  /** Called once each time an edge is reached (load more, older messages). `start` / `end` are the inline sides and mirror in RTL. */
  onEdgeReached?: (edge: ScrollAreaEdge) => void;
  /** Floating "scroll to end" button while the end is out of view. Default: on in follow mode. */
  scrollButton?: boolean;
  /** Accessible name of the scroll region, applied (with `role="region"`) only while it overflows. */
  label?: string;
  /** Ref of the scrolling element (the root gets `ref`, `className`, `style`, `data-*` and `aria-*`). */
  viewportRef?: Ref<HTMLDivElement>;
  /** Props of the scrolling element. */
  viewportProps?: ComponentPropsWithRef<'div'>;
  labels?: Partial<ScrollAreaLabels>;
}

interface AreaContextValue {
  area: ScrollAreaState;
  orientation: ScrollAreaOrientation;
  labels: ScrollAreaLabels;
  viewportRef?: Ref<HTMLDivElement>;
  viewportProps?: ComponentPropsWithRef<'div'>;
}

const AreaContext = createContext<AreaContextValue | null>(null);
const AxisContext = createContext<ScrollAreaAxis>('y');

function useArea(part: string): AreaContextValue {
  const context = useContext(AreaContext);
  if (!context) throw new Error(`ScrollArea.${part} must be inside its ScrollArea`);
  return context;
}

export type ScrollAreaViewportProps = ComponentPropsWithRef<'div'>;
export type ScrollAreaContentProps = ComponentPropsWithRef<'div'>;
export type ScrollAreaThumbProps = ComponentPropsWithRef<'div'>;
export type ScrollAreaCornerProps = ComponentPropsWithRef<'div'>;

export interface ScrollAreaScrollbarProps extends ComponentPropsWithRef<'div'> {
  /** The axis the bar scrolls. Default `vertical`. */
  orientation?: 'vertical' | 'horizontal';
}

export interface ScrollAreaScrollButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** Icon of the button (default an arrow towards the end). */
  icon?: ReactNode;
  /** Accessible name (default from the area's `labels`). */
  label?: string;
}

/** The scrolling element (`ScrollArea.Viewport`). Put `ScrollArea.Content` inside it. */
export const ScrollAreaViewport = withRef(function ScrollAreaViewport({ className, ref, ...props }: ScrollAreaViewportProps) {
  const { area, viewportRef, viewportProps } = useArea('Viewport');
  return (
    <div
      {...area.getViewportProps({
        ...viewportProps,
        ...props,
        ref: mergeRefs(viewportProps?.ref, viewportRef, ref),
        className: cx('ui-scroll-area__viewport', viewportProps?.className, className),
      })}
    />
  );
});

/** The content box inside the viewport (`ScrollArea.Content`); its size changes drive follow mode. */
export const ScrollAreaContent = withRef(function ScrollAreaContent({ className, ...props }: ScrollAreaContentProps) {
  const { area } = useArea('Content');
  return <div {...area.getContentProps({ ...props, className: cx('ui-scroll-area__content', className) })} />;
});

/** An overlay scrollbar (`ScrollArea.Scrollbar`); renders its thumb unless given one. Hidden from assistive technology: the keys already scroll. */
export const ScrollAreaScrollbar = withRef(function ScrollAreaScrollbar({ orientation = 'vertical', className, children, ...props }: ScrollAreaScrollbarProps) {
  const { area } = useArea('Scrollbar');
  const axis: ScrollAreaAxis = orientation === 'horizontal' ? 'x' : 'y';
  return (
    <AxisContext.Provider value={axis}>
      <div {...area.getScrollbarProps(axis, { ...props, className: cx('ui-scroll-area__scrollbar', className) })}>{children ?? <ScrollAreaThumb />}</div>
    </AxisContext.Provider>
  );
});

/** The draggable thumb of a scrollbar (`ScrollArea.Thumb`). */
export const ScrollAreaThumb = withRef(function ScrollAreaThumb({ className, ...props }: ScrollAreaThumbProps) {
  const { area } = useArea('Thumb');
  const axis = useContext(AxisContext);
  return <div {...area.getThumbProps(axis, { ...props, className: cx('ui-scroll-area__thumb', className) })} />;
});

/** The square where two scrollbars meet (`ScrollArea.Corner`); shown only while both axes overflow. */
export const ScrollAreaCorner = withRef(function ScrollAreaCorner({ className, ...props }: ScrollAreaCornerProps) {
  const { area } = useArea('Corner');
  return <div {...area.getCornerProps({ ...props, className: cx('ui-scroll-area__corner', className) })} />;
});

/** The floating "scroll to end" button (`ScrollArea.ScrollButton`): fades in while the end is out of view, glides there on press. */
export const ScrollAreaScrollButton = withRef(function ScrollAreaScrollButton({ className, icon, label, ...props }: ScrollAreaScrollButtonProps) {
  const { area, orientation, labels } = useArea('ScrollButton');
  // While following, the glide trails a growing end for a moment: that is not "out of view".
  const open = area.awayFromEnd && !area.following;
  const { isMounted, state } = usePresence(open, 320);
  const inline = orientation === 'horizontal';
  // Leaving the button under the keyboard: hand focus back to the viewport instead of dropping it on the page.
  useLayoutEffect(() => {
    if (open) return;
    const viewport = area.viewportRef.current;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (viewport && active instanceof HTMLElement && active.closest('.ui-scroll-area__scroll-button') && viewport.parentElement?.contains(active)) {
      viewport.focus({ preventScroll: true });
    }
  }, [open, area.viewportRef]);
  if (!isMounted) return null;
  const { onClick, ...rest } = props;
  return (
    <IconButton
      {...area.getScrollButtonProps({ ...rest, onClick, className: cx('ui-scroll-area__scroll-button', className) })}
      data-state={state}
      inert={inertAttr(!open)}
      variant="secondary"
      size="sm"
      round
      icon={icon ?? (inline ? <ArrowRightIcon /> : <ArrowDownIcon />)}
      label={label ?? (inline ? labels.scrollToEndInline : labels.scrollToEnd)}
    />
  );
});

/**
 * A scroll container with the kit's thin overlay scrollbars, soft fades (or shadows) at the edges that grow with the
 * hidden distance, and a follow mode for chats and logs that keeps the end in view while content streams in.
 */
export const ScrollArea = withRef(
  function ScrollArea({
    children,
    orientation = 'vertical',
    scrollbars = 'overlay',
    visibility = 'hover',
    hideDelay = 600,
    edges = 'fade',
    edgeSize,
    follow,
    defaultFollow,
    onFollowChange,
    threshold = 32,
    initialScroll,
    onEdgeReached,
    scrollButton,
    label,
    viewportRef,
    viewportProps,
    labels,
    className,
    style,
    ...rest
  }: ScrollAreaProps) {
    const area = useScrollArea({ orientation, follow, defaultFollow, onFollowChange, threshold, initialScroll, onEdgeReached, hideDelay, visibility, label });
    const t = { ...defaultScrollAreaLabels, ...labels };
    const custom = findPart(children, ScrollAreaViewport);
    const overlay = scrollbars === 'overlay';
    const withButton = scrollButton ?? area.followMode;
    const rootStyle = edgeSize === undefined ? style : ({ ...style, '--_edge-size': `${edgeSize}px` } as CSSProperties);
    return (
      <AreaContext.Provider value={{ area, orientation, labels: t, viewportRef, viewportProps }}>
        <div
          {...area.getRootProps({
            ...rest,
            className: cx('ui-scroll-area', className),
            style: rootStyle,
            'data-scrollbars': scrollbars,
            'data-edges': edges,
            'data-visibility': visibility,
          })}
        >
          {custom ? (
            children
          ) : (
            <>
              <ScrollAreaViewport>
                <ScrollAreaContent>{children}</ScrollAreaContent>
              </ScrollAreaViewport>
              {overlay && orientation !== 'horizontal' && <ScrollAreaScrollbar orientation="vertical" />}
              {overlay && orientation !== 'vertical' && <ScrollAreaScrollbar orientation="horizontal" />}
              {overlay && orientation === 'both' && <ScrollAreaCorner />}
              {withButton && <ScrollAreaScrollButton />}
            </>
          )}
        </div>
      </AreaContext.Provider>
    );
  },
  {
    Viewport: ScrollAreaViewport,
    Content: ScrollAreaContent,
    Scrollbar: ScrollAreaScrollbar,
    Thumb: ScrollAreaThumb,
    Corner: ScrollAreaCorner,
    ScrollButton: ScrollAreaScrollButton,
  },
);
