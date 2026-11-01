'use client';

import { Children, cloneElement, isValidElement, type ComponentPropsWithRef, type MouseEvent, type ReactElement, type ReactNode } from 'react';
import { cx } from '../primitives';
import { useFormField } from '../forms-advanced/form-field-context';
import './InputGroup.css';
import { withRef, useId } from '../primitives/react-compat';

export interface InputGroupTextProps extends ComponentPropsWithRef<'span'> {}

/**
 * Plain text joined to the field (`https://`, `₽`, `.ru`). The field is described by it, so a screen
 * reader reads it with the field; a click on it focuses the field.
 */
export const InputGroupText = withRef(function InputGroupText({ className, ...rest }: InputGroupTextProps) {
  return <span {...rest} className={cx('ui-input-group__text', className)} />;
});

export interface InputGroupAddonProps extends ComponentPropsWithRef<'div'> {
  /**
   * Where the addon sits: beside the field (`inline-start` / `inline-end`, in source order) or as a full-width
   * row above or below it (`block-start` / `block-end`), e.g. a character counter and a send button under a Textarea.
   */
  align?: 'inline-start' | 'inline-end' | 'block-start' | 'block-end';
}

/** A segment of the group for icons, buttons, key hints or mixed content. */
export const InputGroupAddon = withRef(function InputGroupAddon({ align = 'inline-start', className, ...rest }: InputGroupAddonProps) {
  return <div {...rest} className={cx('ui-input-group__addon', className)} data-align={align} />;
});

export interface InputGroupProps extends ComponentPropsWithRef<'div'> {
  /** Height and text size of the group; passed to the kit controls inside that do not set their own. */
  size?: 'sm' | 'md' | 'lg';
  /** Segments in a row, or stacked. Block addons stack the group by themselves. */
  orientation?: 'horizontal' | 'vertical';
  /** Disables every control inside. */
  disabled?: boolean;
  /** Error look for the whole group; inside a FormField it follows the field's error. */
  invalid?: boolean;
}

type ChildProps = Record<string, unknown> & { className?: string; children?: ReactNode };

const CONTROLS = new Set(['input', 'button', 'select', 'textarea']);
const isPart = (child: ReactElement, part: unknown) => child.type === part;
const blockAlign = (child: ReactElement) => {
  if (!isPart(child, InputGroupAddon)) return null;
  const align = (child.props as InputGroupAddonProps).align;
  return align === 'block-start' || align === 'block-end' ? align : null;
};

/**
 * One frame for a field and what belongs to it: text, a button, a select, a key hint. Segments are joined
 * (one border between them, rounded only at the outer ends) and the group shows one focus ring.
 *
 * The first child that is not a `InputGroup.Text` / `InputGroup.Addon` is the field: it gets the group's
 * `id`, `aria-describedby` (plus the ids of the text parts) and `invalid`, so `<FormField>` around the group
 * labels the field. `className`, `style`, `ref` and the other props go to the group (`role="group"`).
 */
export const InputGroup = withRef(
  function InputGroup({
    size = 'md',
    orientation = 'horizontal',
    disabled = false,
    invalid: invalidProp,
    id,
    'aria-describedby': describedBy,
    'aria-invalid': ariaInvalid,
    className,
    children,
    onMouseDown,
    ...rest
  }: InputGroupProps) {
    const field = useFormField();
    const invalid = invalidProp ?? field?.invalid ?? false;
    const baseId = useId();

    const items = Children.toArray(children).filter(isValidElement) as ReactElement<ChildProps>[];
    const textIds = items.map((child, i) =>
      isPart(child, InputGroupText) ? ((child.props.id as string | undefined) ?? `${baseId}-text-${i}`) : null,
    );
    const controlAt = items.findIndex((child) => !isPart(child, InputGroupText) && !isPart(child, InputGroupAddon));
    const hasBlock = items.some((child) => blockAlign(child) !== null);
    const layout = hasBlock ? 'vertical' : orientation;

    const wired = items.map((child, i) => {
      const props = child.props;
      const isComponent = typeof child.type !== 'string';
      if (textIds[i]) return cloneElement(child, { id: textIds[i] });
      if (isPart(child, InputGroupAddon)) return child;
      const extra: ChildProps = {};
      if (isComponent && props.size === undefined) extra.size = size;
      if (disabled && props.disabled === undefined && (isComponent || CONTROLS.has(child.type as string))) extra.disabled = true;
      if (i === controlAt) {
        const ids = [describedBy, ...textIds.filter(Boolean), props['aria-describedby']].filter(Boolean).join(' ');
        if (id !== undefined && props.id === undefined) extra.id = id;
        if (ids) extra['aria-describedby'] = ids;
        if (invalid) {
          if (isComponent) extra.invalid = props.invalid ?? true;
          else extra['aria-invalid'] = props['aria-invalid'] ?? true;
        }
        if (ariaInvalid !== undefined && props['aria-invalid'] === undefined) extra['aria-invalid'] = ariaInvalid;
      }
      return cloneElement(child, extra);
    });
    // Block addons sit above and below everything else, whatever their place in the source.
    const ordered = hasBlock
      ? [
          ...wired.filter((_, i) => blockAlign(items[i]) === 'block-start'),
          ...wired.filter((_, i) => blockAlign(items[i]) === null),
          ...wired.filter((_, i) => blockAlign(items[i]) === 'block-end'),
        ]
      : wired;

    const focusField = (event: MouseEvent<HTMLDivElement>) => {
      onMouseDown?.(event);
      if (event.defaultPrevented) return;
      // A press on a text part focuses the field, as a label would.
      const target = event.target as Element;
      if (!target.closest('.ui-input-group__text')) return;
      const control = event.currentTarget.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select, [role="combobox"]');
      if (!control) return;
      event.preventDefault();
      control.focus();
    };

    return (
      <div
        role="group"
        aria-disabled={disabled || undefined}
        {...rest}
        className={cx('ui-input-group', className)}
        data-size={size}
        data-orientation={layout}
        data-disabled={disabled || undefined}
        data-invalid={invalid || undefined}
        onMouseDown={focusField}
      >
        {ordered}
      </div>
    );
  },
  { Text: InputGroupText, Addon: InputGroupAddon },
);
