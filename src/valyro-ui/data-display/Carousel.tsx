'use client';

import { Children, isValidElement, type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon } from '../icons';
import { cx } from '../primitives';
import { collectionPart } from '../primitives/compound';
import { IconButton } from '../basic/IconButton';
import { type SlidesPerView } from './carousel-math';
import { useCarousel, type CarouselLabels } from './useCarousel';
import '../primitives/motion.css';
import './Carousel.css';
import { withRef, inertAttr } from '../primitives/react-compat';

export { defaultCarouselLabels, type CarouselLabels } from './useCarousel';

export interface CarouselProps extends Omit<ComponentPropsWithRef<'section'>, 'children' | 'onChange'> {
  /** One child per slide: any element, or `Carousel.Slide` for a slide with its own thumbnail or name. */
  children: ReactNode;
  /** Slides visible at once: a number (fractions peek at the next slide) or `{ minWidth: count }` by carousel width. */
  slidesPerView?: SlidesPerView;
  /** Space between slides in px (default 16). */
  gap?: number;
  /** Index of the first visible slide (controlled). */
  index?: number;
  defaultIndex?: number;
  onIndexChange?: (index: number) => void;
  /** Previous/next wrap around at the ends. */
  loop?: boolean;
  /**
   * Advance automatically: `true` (every 5 s) or an interval in ms. Pauses on hover and focus, and
   * stays off when the user prefers reduced motion until they press play.
   */
  autoplay?: boolean | number;
  /**
   * Previous / next buttons over the slides (default true). With a mouse they appear on hover or
   * keyboard focus (touch screens always show them); `'always'` keeps them visible at rest too.
   */
  showArrows?: boolean | 'always';
  /**
   * Where the current slide rests: `start` (default) or `center`, with the neighbours peeking on both
   * sides and fading out at the edges. With `center` every slide is a snap position.
   */
  align?: 'start' | 'center';
  /** Dots, a thumbnail strip (with `renderThumbnail` or each `Carousel.Slide`'s `thumbnail`), or nothing (default dots). */
  indicators?: 'dots' | 'thumbnails' | 'none';
  /** Content of the thumbnail button for the slide at `index`; required for `indicators="thumbnails"` without `Carousel.Slide` thumbnails. */
  renderThumbnail?: (index: number) => ReactNode;
  /**
   * `spring`: the current slide stands out — the others shrink, dim and stay inert on a spring — and the active dot
   * stretches into a pill with a bounce. Pairs well with a fractional `slidesPerView` (1.3) that shows the
   * neighbours. `default`: plain slides.
   */
  animation?: 'default' | 'spring';
  labels?: Partial<CarouselLabels>;
}

export interface CarouselSlideProps {
  /** The slide's content. */
  children?: ReactNode;
  /** Content of its thumbnail button, for `indicators="thumbnails"`. */
  thumbnail?: ReactNode;
  /** Its accessible name. Default: "2 of 6" (`labels.slide`). */
  label?: string;
  className?: string;
}

/** A slide of the compound form (`Carousel.Slide`), with its own thumbnail and name. */
export const CarouselSlide = collectionPart<CarouselSlideProps>('Carousel.Slide');

/**
 * Scroll-snap carousel: swipe or drag, arrows, dots or thumbnails, several slides per view and
 * optional autoplay with a rotation control (WAI-ARIA APG carousel pattern).
 */
export const Carousel = withRef(function Carousel({
  children,
  slidesPerView = 1,
  gap = 16,
  index,
  defaultIndex = 0,
  onIndexChange,
  loop = false,
  autoplay = false,
  showArrows = true,
  align = 'start',
  indicators = 'dots',
  animation = 'default',
  renderThumbnail,
  labels,
  className,
  style,
  ref,
  ...rest
}: CarouselProps) {
  const slides = Children.toArray(children).map((child) =>
    isValidElement<CarouselSlideProps>(child) && child.type === CarouselSlide ? child.props : { children: child },
  );
  const count = slides.length;
  // The page, the scroll and drag, the keys and autoplay come from the headless hook.
  const carousel = useCarousel({ count, slidesPerView, gap, index, defaultIndex, onIndexChange, loop, autoplay, align, labels });
  const { pages, stopped } = carousel;
  const current = carousel.index;
  const thumbnail = (i: number) => renderThumbnail?.(i) ?? slides[i].thumbnail;
  const thumbnails = indicators === 'thumbnails' && (!!renderThumbnail || slides.some((slide) => slide.thumbnail != null));
  // The control shows the user's choice; hover and focus only pause the rotation for a moment.
  const RotationIcon = stopped ? PlayIcon : PauseIcon;
  const iconButton = ({ 'aria-label': label = '', type: _type, ...props }: { 'aria-label'?: string; type?: string }) => ({ label, ...props });

  return (
    <section
      {...carousel.getRootProps({ ...rest, ref })}
      className={cx('ui-carousel', className)}
      style={{ ...style, '--_per-view': carousel.perView, '--_gap': `${gap}px` } as CSSProperties}
      data-indicators={indicators}
      data-align={align === 'center' ? 'center' : undefined}
      data-arrows={showArrows === 'always' ? 'always' : undefined}
      data-motion={animation === 'spring' ? 'spring' : undefined}
    >
      <div className="ui-carousel__stage">
        {/* Controls come first in the tab order, as the APG pattern asks. */}
        {carousel.autoplay && (
          <IconButton
            className="ui-carousel__rotation"
            size="sm"
            round
            variant="secondary"
            icon={<RotationIcon />}
            {...iconButton(carousel.getRotationProps())}
          />
        )}
        {showArrows && pages > 1 && (
          <>
            <IconButton
              className="ui-carousel__arrow"
              data-side="start"
              round
              variant="secondary"
              icon={<ChevronLeftIcon />}
              {...iconButton(carousel.getPreviousProps())}
            />
            <IconButton
              className="ui-carousel__arrow"
              data-side="end"
              round
              variant="secondary"
              icon={<ChevronRightIcon />}
              {...iconButton(carousel.getNextProps())}
            />
          </>
        )}
        <div className="ui-carousel__track" {...carousel.getTrackProps()}>
          {slides.map((slide, i) => (
            <div
              key={i}
              {...carousel.getSlideProps(i, { 'aria-label': slide.label })}
              className={cx('ui-carousel__slide', slide.className)}
              // Spring dims every slide but the current one; a dimmed slide is inactive until it becomes current.
              inert={inertAttr((animation === 'spring' && i !== current) || undefined)}
            >
              {slide.children}
            </div>
          ))}
        </div>
      </div>

      {indicators === 'dots' && pages > 1 && (
        <div className="ui-carousel__dots" {...carousel.getIndicatorsProps()}>
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} className="ui-carousel__dot" {...carousel.getIndicatorProps(i)} />
          ))}
        </div>
      )}

      {thumbnails && (
        <div className="ui-carousel__thumbs" {...carousel.getIndicatorsProps()}>
          {slides.map((_, i) => (
            <button key={i} className="ui-carousel__thumb" {...carousel.getIndicatorProps(i)}>
              {thumbnail(i)}
            </button>
          ))}
        </div>
      )}

      <div className="ui-sr-only" {...carousel.getLiveRegionProps()} />
    </section>
  );
}, { Slide: CarouselSlide });
