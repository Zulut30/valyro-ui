'use client';

import { type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx } from '../primitives';
import { collectionPart, partsOf } from '../primitives/compound';
import { ChevronDownIcon } from '../icons';
import '../primitives/motion.css';
import './Accordion.css';
import { withRef } from '../primitives/react-compat';
import { useAccordion } from './useAccordion';

export interface AccordionItem {
  value: string;
  title: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

export interface AccordionProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'children'> {
  /**
   * Sections in order: `title` is the trigger, `content` the panel, `value` the id used by `value`. Or compose
   * them as children: `Accordion.Item` with an `Accordion.Trigger` and an `Accordion.Content`.
   */
  items?: readonly AccordionItem[];
  /** The compound form instead of `items`: `Accordion.Item` elements. */
  children?: ReactNode;
  /** `single` keeps at most one section open. */
  type?: 'single' | 'multiple';
  /** In `single` mode, whether the open section can be closed again. */
  collapsible?: boolean;
  /** Values of the open sections. */
  value?: string[];
  defaultValue?: string[];
  /** Level of the heading around each trigger, to fit the page's heading outline. Default 3. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  onValueChange?: (value: string[]) => void;
  /**
   * `spring`: sections open on a critically damped spring, the content drops in as it is revealed and
   * the chevron turns with a bounce. `default`: the theme's curve.
   */
  animation?: 'default' | 'spring';
}

export interface AccordionItemPartProps {
  /** Id of the section, used by `value`. */
  value: string;
  disabled?: boolean;
  /** An `Accordion.Trigger` and an `Accordion.Content`. */
  children?: ReactNode;
}

export interface AccordionTriggerProps {
  /** The section's title. */
  children?: ReactNode;
}

export interface AccordionContentProps {
  /** The section's panel content. */
  children?: ReactNode;
}

/** A section of the compound form (`Accordion.Item`; AccordionItem is the type of an `items` entry). */
export const AccordionItemPart = collectionPart<AccordionItemPartProps>('Accordion.Item');
/** The title of an `Accordion.Item`. */
export const AccordionTrigger = collectionPart<AccordionTriggerProps>('Accordion.Trigger');
/** The panel of an `Accordion.Item`. */
export const AccordionContent = collectionPart<AccordionContentProps>('Accordion.Content');

function accordionItemsFromParts(children: ReactNode): AccordionItem[] {
  return partsOf<AccordionItemPartProps>(children, AccordionItemPart).map(({ props }) => ({
    value: props.value,
    disabled: props.disabled,
    title: partsOf<AccordionTriggerProps>(props.children, AccordionTrigger)[0]?.props.children,
    content: partsOf<AccordionContentProps>(props.children, AccordionContent)[0]?.props.children,
  }));
}

export const Accordion = withRef(function Accordion({
  items: itemsProp,
  children,
  type = 'single',
  collapsible = true,
  value: valueProp,
  defaultValue = [],
  onValueChange,
  className,
  onKeyDown,
  headingLevel = 3,
  animation = 'default',
  ...rest
}: AccordionProps) {
  const items = itemsProp ?? accordionItemsFromParts(children);
  const Heading = `h${headingLevel}` as 'h3';
  // The state, ids and keys come from the headless hook, so `useAccordion` builds the same accordion.
  const accordion = useAccordion({ type, collapsible, value: valueProp, defaultValue, onValueChange });

  return (
    <div
      className={cx('ui-accordion', className)}
      data-motion={animation === 'spring' ? 'spring' : undefined}
      {...accordion.getRootProps({ onKeyDown, ...rest })}
    >
      {items.map((item) => (
        <div key={item.value} className="ui-accordion__item" {...accordion.getItemProps(item)}>
          <Heading className="ui-accordion__heading">
            <button className="ui-accordion__trigger" {...accordion.getTriggerProps(item)}>
              <span className="ui-accordion__title">{item.title}</span>
              {/* Glass turns it sideways (pointing at the content edge), so it mirrors under dir="rtl". */}
              <ChevronDownIcon className="ui-accordion__chevron" data-dir-flip="" />
            </button>
          </Heading>
          <div className="ui-accordion__panel" {...accordion.getPanelProps(item)}>
            <div className="ui-accordion__panel-inner">
              <div className="ui-accordion__content">{item.content}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}, { Item: AccordionItemPart, Trigger: AccordionTrigger, Content: AccordionContent });
