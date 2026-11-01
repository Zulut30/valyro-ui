'use client';

import { useEffect, useRef, useState, type ComponentPropsWithRef, type CSSProperties, type PointerEvent } from 'react';
import { cx, isMotionReduced, mergeRefs } from '../primitives';
import { inertAttr, useId, withRef } from '../primitives/react-compat';
import { ChevronDownIcon } from '../icons';
import { Tooltip } from '../basic/Tooltip';
import { Slider } from '../forms/Slider';
import { useLabels } from '../agents/labels';
import {
  activeSection,
  contentFits,
  maxScroll,
  minimapLayout,
  scrollTopForFrame,
  scrollTopForSection,
  type MinimapMetrics,
  type MinimapSectionBox,
} from './minimap';
import './PageMinimap.css';

export interface MinimapSection {
  /** Stable id, reported by `onActiveChange` and `onNavigate`. */
  id: string;
  /** Name of the section: the block's accessible name and tooltip. */
  label: string;
  /** The section's element in the page (null until it mounts). Only these elements are measured. */
  element: HTMLElement | null;
  /** Marker colour of the block (any CSS colour). */
  color?: string;
}

export interface PageMinimapLabels {
  region: string;
  /** The button that opens the map on a narrow screen. */
  toggle: string;
  /** Name of the position slider. */
  position: string;
  /** aria-valuetext of the position slider: `40% down the page`. */
  positionValue: (percent: string) => string;
  /** Prefix of the current section line: `Now: Setup`. */
  current: (label: string) => string;
  empty: string;
}

const DEFAULT_LABELS: PageMinimapLabels = {
  region: 'Page map',
  toggle: 'Page map',
  position: 'Position on the page',
  positionValue: (percent) => `${percent} down the page`,
  current: (label) => `Now: ${label}`,
  empty: 'No sections to show.',
};

export interface PageMinimapProps extends Omit<ComponentPropsWithRef<'nav'>, 'children'> {
  /** The sections, in document order. */
  sections: MinimapSection[];
  /** The element that scrolls; null (default) means the page itself. */
  scrollContainer?: HTMLElement | null;
  /** Upper limit of the map's height, px. Default 320; it is also kept within the screen. */
  maxHeight?: number;
  /** Height of a fixed header over the content, px: jumps land below it. Default 0. */
  headerOffset?: number;
  /** Hide the map when everything fits without scrolling. Default true. */
  hideWhenFits?: boolean;
  /** `inline` (default) in the flow, or `fixed` to the inline end of the screen. */
  placement?: 'inline' | 'fixed';
  /** Called when the section the reader is in changes. */
  onActiveChange?: (id: string | null) => void;
  /** Called when the reader picks a section in the map. */
  onNavigate?: (id: string) => void;
  labels?: Partial<PageMinimapLabels>;
}

interface Geometry extends MinimapMetrics {
  boxes: MinimapSectionBox[];
  mapHeight: number;
}

const sameGeometry = (a: Geometry | null, b: Geometry) =>
  !!a &&
  a.scrollTop === b.scrollTop &&
  a.clientHeight === b.clientHeight &&
  a.scrollHeight === b.scrollHeight &&
  a.mapHeight === b.mapHeight &&
  a.boxes.length === b.boxes.length &&
  a.boxes.every((box, i) => box.id === b.boxes[i].id && box.top === b.boxes[i].top && box.height === b.boxes[i].height);

const NARROW_QUERY = '(max-width: 640px)';

/**
 * A schematic map of a long page: its sections as blocks to scale and the visible area as a frame. Pick a section to
 * jump to it under the fixed header, drag the frame, or use the position slider. Only the registered sections are
 * measured, once per frame; nothing of the page is cloned.
 */
export const PageMinimap = withRef(function PageMinimap({
  sections,
  scrollContainer = null,
  maxHeight = 320,
  headerOffset = 0,
  hideWhenFits = true,
  placement = 'inline',
  onActiveChange,
  onNavigate,
  labels,
  className,
  style,
  ref,
  ...rest
}: PageMinimapProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const rootRef = useRef<HTMLElement>(null);
  const [geo, setGeo] = useState<Geometry | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // The narrow block folds open and shut with a transition only once the reader toggles it, not when the page loads.
  const [toggled, setToggled] = useState(false);
  const [dragging, setDragging] = useState(false);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const drag = useRef<{ id: number; startY: number; startScroll: number } | null>(null);
  const lastActive = useRef<string | null | undefined>(undefined);
  const onActiveChangeRef = useRef(onActiveChange);
  onActiveChangeRef.current = onActiveChange;

  // Measure the registered sections and the scroller, batched to one read per frame.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isDoc = !scrollContainer;
    const el = scrollContainer ?? ((document.scrollingElement as HTMLElement | null) ?? document.documentElement);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const scrollTop = isDoc ? window.scrollY : el.scrollTop;
      const clientHeight = isDoc ? document.documentElement.clientHeight : el.clientHeight;
      const origin = isDoc ? -window.scrollY : el.getBoundingClientRect().top + el.clientTop - el.scrollTop;
      const boxes = sectionsRef.current.flatMap((section) => {
        if (!section.element?.isConnected) return [];
        const rect = section.element.getBoundingClientRect();
        return [{ id: section.id, top: rect.top - origin, height: rect.height }];
      });
      const next: Geometry = {
        scrollTop,
        clientHeight,
        scrollHeight: el.scrollHeight,
        boxes,
        mapHeight: Math.round(Math.min(maxHeight, Math.max(96, window.innerHeight - 96))),
      };
      setGeo((prev) => (sameGeometry(prev, next) ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const target: EventTarget = isDoc ? window : el;
    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // A section that grows (an image loading) or a resized scroller moves the blocks below it.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(isDoc ? document.body : el);
    for (const section of sections) if (section.element) observer?.observe(section.element);
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
    };
  }, [scrollContainer, sections, maxHeight]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  const active = geo ? activeSection(geo, geo.boxes, headerOffset) : null;
  useEffect(() => {
    if (!geo || lastActive.current === active) return;
    lastActive.current = active;
    onActiveChangeRef.current?.(active);
  }, [active, geo]);

  const scrollToTop = (top: number, smooth: boolean) => {
    const behavior: ScrollBehavior = smooth && !isMotionReduced(rootRef.current) ? 'smooth' : 'auto';
    if (scrollContainer) scrollContainer.scrollTo({ top, behavior });
    else window.scrollTo({ top, behavior });
  };

  const navigate = (id: string) => {
    if (!geo) return;
    const box = geo.boxes.find((item) => item.id === id);
    if (!box) return;
    scrollToTop(scrollTopForSection(box.top, geo, headerOffset), true);
    onNavigate?.(id);
  };

  const layout = geo ? minimapLayout(geo, geo.boxes, geo.mapHeight) : null;

  // Dragging the frame: a mouse anywhere on it, a finger only on the frame (the map itself keeps page scrolling).
  const onFramePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!geo || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { id: event.pointerId, startY: event.clientY, startScroll: geo.scrollTop };
    setDragging(true);
  };
  const onFramePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId || !geo || !layout) return;
    const frameTop = start.startScroll * layout.scale + (event.clientY - start.startY);
    scrollToTop(scrollTopForFrame(frameTop, layout.scale, geo), false);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };
  // A mouse click on an empty part of the map centres the frame there.
  const onMapPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.target !== event.currentTarget || !geo || !layout) return;
    const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
    scrollToTop(scrollTopForFrame(y - layout.frame.height / 2, layout.scale, geo), true);
  };

  const fits = !!geo && contentFits(geo);
  const hidden = hideWhenFits && fits;
  const max = geo ? maxScroll(geo) : 0;
  const percent = geo && max > 0 ? Math.round((geo.scrollTop / max) * 100) : 0;
  const activeLabel = sections.find((section) => section.id === active)?.label;
  const collapsed = narrow && !expanded;
  const state = !geo ? 'measuring' : sections.length === 0 ? 'empty' : dragging ? 'dragging' : 'ready';

  return (
    <nav
      ref={mergeRefs(ref, rootRef)}
      className={cx('ui-minimap', className)}
      aria-label={copy.region}
      data-placement={placement}
      data-state={state}
      data-narrow={narrow || undefined}
      hidden={hidden || undefined}
      style={style}
      {...rest}
    >
      {narrow && (
        <button type="button" className="ui-minimap__toggle" aria-expanded={expanded} aria-controls={`${uid}-body`} onClick={() => {
            setToggled(true);
            setExpanded((open) => !open);
          }}
        >
          <span>{copy.toggle}</span>
          <ChevronDownIcon aria-hidden="true" />
        </button>
      )}
      <div
        className="ui-minimap__body"
        id={`${uid}-body`}
        data-collapsed={collapsed || undefined}
        data-animate={toggled || undefined}
        inert={inertAttr(collapsed)}
        aria-hidden={collapsed || undefined}
      >
        <div className="ui-minimap__inner">
        {sections.length === 0 ? (
          <p className="ui-minimap__empty">{copy.empty}</p>
        ) : (
          <>
            <div
              className="ui-minimap__map"
              style={{ height: layout ? geo!.mapHeight : undefined } as CSSProperties}
              onPointerDown={onMapPointerDown}
            >
              {sections.map((section, i) => {
                const block = layout?.sections.find((item) => item.id === section.id);
                return (
                  <Tooltip key={section.id} content={section.label} placement="left">
                    <button
                      type="button"
                      className="ui-minimap__section"
                      aria-label={section.label}
                      aria-current={section.id === active ? 'location' : undefined}
                      data-measured={block ? '' : undefined}
                      style={
                        ({
                          '--_color': section.color,
                          ...(block ? { top: block.top, height: block.height } : { '--_i': i }),
                        }) as Record<string, unknown> as CSSProperties
                      }
                      onClick={() => navigate(section.id)}
                    />
                  </Tooltip>
                );
              })}
              {layout && (
                <div
                  className="ui-minimap__frame"
                  aria-hidden="true"
                  style={{ top: layout.frame.top, height: layout.frame.height }}
                  onPointerDown={onFramePointerDown}
                  onPointerMove={onFramePointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onLostPointerCapture={endDrag}
                />
              )}
            </div>
            {activeLabel && (
              // Keyed by the section: the new name fades in.
              <p key={active ?? ''} className="ui-minimap__current" aria-hidden="true">
                {copy.current(activeLabel)}
              </p>
            )}
            {geo && max > 0 && (
              <Slider
                className="ui-minimap__position"
                aria-label={copy.position}
                min={0}
                max={100}
                step={1}
                value={percent}
                onValueChange={(next) => scrollToTop((next / 100) * maxScroll(geo), false)}
                formatValue={(value) => copy.positionValue(`${value}%`)}
              />
            )}
          </>
        )}
        </div>
      </div>
    </nav>
  );
});
