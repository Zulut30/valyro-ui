'use client';

import { useRef, type ButtonHTMLAttributes, type HTMLAttributes, type KeyboardEvent, type RefCallback } from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { inertAttr, useId } from '../primitives/react-compat';
import { inDocumentOrder, partId, withUserProps, type UserProps } from '../primitives/prop-getters';

/*
 * The behaviour of Accordion without its markup: which sections are open (single or multiple, controlled or
 * not), the ids that tie a trigger to its panel, and the WAI-ARIA keys (arrows, Home and End move between the
 * triggers of this accordion, not of a nested one). Accordion renders with it.
 */

export interface AccordionOptions {
  /** `single` keeps at most one section open. Default `single`. */
  type?: 'single' | 'multiple';
  /** In `single` mode, whether the open section can be closed again. Default true. */
  collapsible?: boolean;
  /** Values of the open sections. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
}

/** A section, as the getters see it. */
export interface AccordionSection {
  value: string;
  disabled?: boolean;
}

type SectionState = { 'data-state': 'open' | 'closed' };

export interface AccordionState {
  /** Values of the open sections. */
  value: string[];
  setValue: (value: string[]) => void;
  isOpen: (value: string) => boolean;
  /** Opens or closes a section the way a press on its trigger does. */
  toggle: (value: string) => void;
  /** The element around the sections: arrow keys, Home and End. */
  getRootProps: (props?: UserProps) => HTMLAttributes<HTMLElement>;
  /** A section's wrapper: `data-state` and `data-disabled`, for styling. */
  getItemProps: (section: AccordionSection, props?: UserProps) => HTMLAttributes<HTMLElement> & SectionState & { 'data-disabled'?: true };
  /** The section's `<button>`: toggles it and points at its panel. Put it in a heading of your outline's level. */
  getTriggerProps: (
    section: AccordionSection,
    props?: UserProps,
  ) => ButtonHTMLAttributes<HTMLButtonElement> & { ref: RefCallback<HTMLButtonElement> };
  /** The section's panel: a region named by its trigger, `inert` while closed (keep it mounted to animate). */
  getPanelProps: (section: AccordionSection, props?: UserProps) => HTMLAttributes<HTMLElement> & SectionState;
}

const NAVIGATION_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

export function useAccordion({
  type = 'single',
  collapsible = true,
  value: valueProp,
  defaultValue = [],
  onValueChange,
}: AccordionOptions = {}): AccordionState {
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const baseId = useId();
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  // One ref callback per section, so a trigger's ref does not change on every render.
  const triggerRefs = useRef(new Map<string, (node: HTMLButtonElement | null) => void>());

  const triggerRef = (sectionValue: string) => {
    let ref = triggerRefs.current.get(sectionValue);
    if (!ref) {
      ref = (node) => {
        if (node) triggers.current.set(sectionValue, node);
        else triggers.current.delete(sectionValue);
      };
      triggerRefs.current.set(sectionValue, ref);
    }
    return ref;
  };

  const toggle = (sectionValue: string) => {
    setValue((prev) => {
      const open = prev.includes(sectionValue);
      if (type === 'multiple') return open ? prev.filter((v) => v !== sectionValue) : [...prev, sectionValue];
      if (open) return collapsible ? [] : prev;
      return [sectionValue];
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || !NAVIGATION_KEYS.includes(event.key)) return;
    const enabled = inDocumentOrder(triggers.current.values()).filter((trigger) => !trigger.disabled);
    const index = enabled.indexOf(event.target as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const last = enabled.length - 1;
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? last : event.key === 'ArrowDown' ? (index === last ? 0 : index + 1) : index === 0 ? last : index - 1;
    enabled[next].focus();
  };

  const isOpen = (sectionValue: string) => value.includes(sectionValue);

  return {
    value,
    setValue,
    isOpen,
    toggle,
    getRootProps: (props) => withUserProps({ onKeyDown }, props) as never,
    getItemProps: (section, props) =>
      withUserProps(
        { 'data-state': isOpen(section.value) ? 'open' : 'closed', 'data-disabled': section.disabled || undefined },
        props,
      ) as never,
    getTriggerProps: (section, props) => {
      const open = isOpen(section.value);
      // A required open section in single mode cannot be closed, so it reports as disabled.
      const locked = open && type === 'single' && !collapsible;
      return withUserProps(
        {
          ref: triggerRef(section.value),
          type: 'button',
          id: partId(baseId, 'trigger', section.value),
          'aria-expanded': open,
          'aria-controls': partId(baseId, 'panel', section.value),
          'aria-disabled': locked || undefined,
          disabled: section.disabled,
          onClick: () => toggle(section.value),
        },
        props,
      ) as never;
    },
    getPanelProps: (section, props) => {
      const open = isOpen(section.value);
      return withUserProps(
        {
          id: partId(baseId, 'panel', section.value),
          role: 'region',
          'aria-labelledby': partId(baseId, 'trigger', section.value),
          'data-state': open ? 'open' : 'closed',
          inert: inertAttr(!open),
        },
        props,
      ) as never;
    },
  };
}
