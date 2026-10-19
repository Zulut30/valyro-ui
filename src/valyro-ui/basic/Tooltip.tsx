'use client';

import { cloneElement, createContext, type ComponentPropsWithRef, type ReactElement, type ReactNode, type Ref } from 'react';
import { composeHandlers, cx, Floating, mergeRefs, Slot, type Placement } from '../primitives';
import { useTooltip } from './useTooltip';
import './Tooltip.css';
import { collectionPart, partsOf, propsOf } from '../primitives/compound';
import { getElementRef, withRef } from '../primitives/react-compat';

/** Native attributes, `style` and `ref` go to the tooltip surface. */
export interface TooltipProps extends Omit<ComponentPropsWithRef<'div'>, 'content' | 'children'> {
  /** Tooltip text or content; nothing shows while it is empty. Or `Tooltip.Content` in the children. */
  content?: ReactNode;
  /**
   * A single focusable element. It receives the hover/focus handlers and aria-describedby. In the compound form,
   * a `Tooltip.Trigger` and a `Tooltip.Content` instead.
   */
  children: ReactElement | ReactElement[];
  /** Preferred side and alignment relative to the trigger; flips when there is no room. */
  placement?: Placement;
  /** Delay before showing, ms. Skipped while another tooltip was just visible. */
  delay?: number;
  /** Never show the tooltip; the trigger keeps working. */
  disabled?: boolean;
  /** Small pointer towards the trigger. */
  arrow?: boolean;
  /**
   * `fade` (default) or `spring`: springs out of the trigger's side, and moving straight on to the next
   * spring tooltip glides the tooltip across instead of fading one out and another in.
   */
  animation?: 'fade' | 'spring';
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Class for the tooltip surface. */
  className?: string;
}

export interface TooltipTriggerProps {
  /** A single focusable element. */
  children: ReactElement;
}

/** Props of the tooltip surface (merged with the Tooltip's own) and its content. */
export interface TooltipContentProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  children?: ReactNode;
}

/** The element the tooltip describes (`Tooltip.Trigger`). */
export const TooltipTrigger = collectionPart<TooltipTriggerProps>('Tooltip.Trigger');
/** The tooltip text or content (`Tooltip.Content`); its props go to the surface. */
export const TooltipContent = collectionPart<TooltipContentProps>('Tooltip.Content');

/** True inside a Tooltip trigger, so IconButton can drop its native title (it would show twice). */
export const TooltipTriggerContext = createContext(false);

export const Tooltip = withRef(function Tooltip({
  content: contentProp,
  children: childrenProp,
  placement = 'top',
  delay = 400,
  disabled = false,
  arrow = false,
  animation = 'fade',
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  className,
  style,
  onPointerEnter,
  onPointerLeave,
  ref,
  ...rest
}: TooltipProps) {
  const triggerPart = partsOf<TooltipTriggerProps>(childrenProp, TooltipTrigger)[0];
  const contentPart = triggerPart && partsOf<TooltipContentProps>(childrenProp, TooltipContent)[0];
  const children = (triggerPart ? triggerPart.props.children : childrenProp) as ReactElement;
  const content = contentProp ?? contentPart?.props.children;
  const surfaceProps = propsOf(contentPart);
  const hasContent = content != null && content !== false && content !== '';
  const offset = arrow ? 10 : 6;
  // The behaviour is useTooltip's (valyro-ui/headless): delays, the shared warm-up, grace, Escape, aria-describedby.
  const tooltip = useTooltip({
    open: openProp,
    defaultOpen,
    onOpenChange,
    delay,
    disabled: disabled || !hasContent,
    floating: false,
    glide: animation === 'spring',
  });
  const { visible, glide, instantExit } = tooltip;

  // The child keeps its own aria-describedby: the tooltip's id joins it (Slot would let the child's win).
  const childDescribedBy = (children.props as { 'aria-describedby'?: string })['aria-describedby'];
  const { 'aria-describedby': describedBy, ...triggerProps } = tooltip.getTriggerProps({ 'aria-describedby': childDescribedBy });
  const trigger = cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': describedBy });

  return (
    <TooltipTriggerContext.Provider value={true}>
      <Slot {...triggerProps}>{trigger}</Slot>
      <TooltipTriggerContext.Provider value={false}>
        <Floating
          {...rest}
          {...surfaceProps}
          ref={contentPart ? mergeRefs(ref, getElementRef(contentPart) as Ref<HTMLDivElement>) : ref}
          open={visible}
          anchorRef={tooltip.triggerRef}
          placement={placement}
          offset={offset}
          surface={false}
          animation={animation}
          {...tooltip.getTooltipProps({
            onPointerEnter: onPointerEnter ? composeHandlers(surfaceProps.onPointerEnter, onPointerEnter) : surfaceProps.onPointerEnter,
            onPointerLeave: onPointerLeave ? composeHandlers(surfaceProps.onPointerLeave, onPointerLeave) : surfaceProps.onPointerLeave,
          })}
          className={cx('ui-tooltip', className, surfaceProps.className)}
          data-arrow={arrow || undefined}
          data-glide={glide ? '' : undefined}
          data-instant={instantExit || undefined}
          style={{
            zIndex: 'var(--ui-z-tooltip)',
            ['--_gap' as string]: `${offset}px`,
            ...(glide && { ['--_glide-x' as string]: `${glide.x}px`, ['--_glide-y' as string]: `${glide.y}px` }),
            ...style,
            ...surfaceProps.style,
          }}
        >
          {content}
          {arrow && <span className="ui-tooltip__arrow" aria-hidden="true" />}
        </Floating>
      </TooltipTriggerContext.Provider>
    </TooltipTriggerContext.Provider>
  );
}, { Trigger: TooltipTrigger, Content: TooltipContent });
