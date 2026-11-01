'use client';

import { createContext, useContext, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';
import { cx, Slot } from '../primitives';
import { findPart } from '../primitives/compound';
import { ChevronDownIcon } from '../icons';
import '../primitives/motion.css';
import './Collapsible.css';
import { withRef } from '../primitives/react-compat';
import { useCollapsible, type CollapsibleHiddenMode, type CollapsibleState } from './useCollapsible';

export interface CollapsibleProps extends Omit<ComponentPropsWithRef<'div'>, 'hidden'> {
  open?: boolean;
  /** Initial state when uncontrolled. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The trigger does nothing. */
  disabled?: boolean;
  /** Height in px shown while closed, with a faded bottom edge ("show more"); 0 hides the content. */
  collapsedHeight?: number;
  /**
   * What closed content does: `until-found` stays in the DOM, hidden, and the browser's find-in-page opens it;
   * `keep` stays hidden in the DOM (form state survives); `unmount` drops it.
   */
  hidden?: CollapsibleHiddenMode;
  /** Unfold on the smooth spring instead of the theme's curve. */
  spring?: boolean;
  /** The trigger's text in the props form: a button with a chevron above the content (the children). */
  trigger?: ReactNode;
  /** The content, or the compound form: `Collapsible.Trigger` and `Collapsible.Content`. */
  children?: ReactNode;
}

export interface CollapsibleTriggerProps extends ComponentPropsWithRef<'button'> {
  /** Render the single child element (a Button, a heading's link) as the trigger instead of a <button>. */
  asChild?: boolean;
}

export type CollapsibleContentProps = ComponentPropsWithRef<'div'>;

export interface CollapsibleIndicatorProps extends ComponentPropsWithRef<'span'> {
  /** A custom icon; it turns half a circle as the content opens. Default: a chevron. */
  children?: ReactNode;
}

const CollapsibleContext = createContext<CollapsibleState | null>(null);

function useCollapsibleContext(part: string) {
  const value = useContext(CollapsibleContext);
  if (!value) throw new Error(`${part} must be inside a Collapsible`);
  return value;
}

/** The button that opens and closes the content. */
export const CollapsibleTrigger = withRef(function CollapsibleTrigger({ asChild = false, className, children, ...rest }: CollapsibleTriggerProps) {
  const collapsible = useCollapsibleContext('Collapsible.Trigger');
  const props = collapsible.getTriggerProps({ ...rest, className: cx('ui-collapsible__trigger', className) });
  return asChild ? <Slot {...(props as unknown as Record<string, unknown>)}>{children as ReactElement}</Slot> : <button {...props}>{children}</button>;
});

/** The content that unfolds; kept in the DOM while closed unless `hidden="unmount"`. */
export const CollapsibleContent = withRef(function CollapsibleContent({ className, children, ...rest }: CollapsibleContentProps) {
  const collapsible = useCollapsibleContext('Collapsible.Content');
  return (
    <div {...collapsible.getContentProps({ ...rest, className: cx('ui-collapsible__content', className) })}>
      {collapsible.isMounted && <div className="ui-collapsible__inner">{children}</div>}
    </div>
  );
});

/** A chevron that turns as the content opens; put it inside the trigger. */
export const CollapsibleIndicator = withRef(function CollapsibleIndicator({ className, children, ...rest }: CollapsibleIndicatorProps) {
  const collapsible = useCollapsibleContext('Collapsible.Indicator');
  return (
    <span aria-hidden="true" {...rest} className={cx('ui-collapsible__indicator', className)} data-state={collapsible.open ? 'open' : 'closed'}>
      {children ?? <ChevronDownIcon />}
    </span>
  );
});

export const Collapsible = withRef(function Collapsible({
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  collapsedHeight,
  hidden,
  spring,
  trigger,
  className,
  children,
  ...rest
}: CollapsibleProps) {
  // The state, ids and fold come from the headless hook, so `useCollapsible` builds the same disclosure.
  const collapsible = useCollapsible({ open, defaultOpen, onOpenChange, disabled, collapsedHeight, hidden, spring });
  const composed = !!(findPart(children, CollapsibleTrigger) || findPart(children, CollapsibleContent));

  return (
    <CollapsibleContext.Provider value={collapsible}>
      <div {...collapsible.getRootProps({ ...rest, className: cx('ui-collapsible', className) })}>
        {composed ? (
          children
        ) : (
          <>
            {trigger != null && (
              <CollapsibleTrigger>
                {trigger}
                <CollapsibleIndicator />
              </CollapsibleTrigger>
            )}
            <CollapsibleContent>{children}</CollapsibleContent>
          </>
        )}
      </div>
    </CollapsibleContext.Provider>
  );
}, { Trigger: CollapsibleTrigger, Content: CollapsibleContent, Indicator: CollapsibleIndicator });
