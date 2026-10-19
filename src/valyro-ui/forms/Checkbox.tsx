'use client';

import { useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import { animateSpring, cx, mergeRefs, useControllableState } from '../primitives';
import '../primitives/motion.css';
import './Checkbox.css';
import { withRef, useId, useLayoutEffect } from '../primitives/react-compat';

export interface CheckboxProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'size' | 'checked' | 'defaultChecked'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Mixed state, e.g. a "select all" box with some children checked. */
  indeterminate?: boolean;
  /** Text next to the box; clicking it toggles the checkbox, and it names the input. */
  label?: ReactNode;
  /** Secondary text under the label, linked to the input with aria-describedby. */
  description?: ReactNode;
  /** Box and text size. */
  size?: 'sm' | 'md' | 'lg';
  /** Red box border (red fill when checked) and aria-invalid on the input (an explicit `aria-invalid` wins). */
  invalid?: boolean;
  /**
   * `spring`: the box bounces when the user toggles it, the check draws in and the mixed dash grows from
   * the centre. `default`: the theme's transitions.
   */
  animation?: 'default' | 'spring';
}

/** Native checkbox with a custom box. `className`/`style` go to the <label> wrapper, other props to the <input>. */
export const Checkbox = withRef(function Checkbox({
  checked: checkedProp,
  defaultChecked = false,
  onCheckedChange,
  indeterminate = false,
  label,
  description,
  size = 'md',
  invalid = false,
  animation = 'default',
  disabled,
  onChange,
  className,
  style,
  ref,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...rest
}: CheckboxProps) {
  const [checked, setChecked] = useControllableState({ value: checkedProp, defaultValue: defaultChecked, onChange: onCheckedChange });
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const descriptionId = useId();

  // `indeterminate` is a DOM property only; a click clears it in the DOM, so it is re-applied on every render.
  useLayoutEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate;
  });

  return (
    <label
      className={cx('ui-checkbox', className)}
      style={style}
      data-size={size}
      data-state={indeterminate ? 'indeterminate' : checked ? 'checked' : 'unchecked'}
      data-disabled={disabled || undefined}
      data-invalid={invalid || undefined}
      data-motion={animation === 'spring' ? 'spring' : undefined}
    >
      <span className="ui-checkbox__control">
        <input
          aria-invalid={ariaInvalid ?? (invalid || undefined)}
          aria-describedby={cx(describedBy, description != null && descriptionId) || undefined}
          {...rest}
          ref={mergeRefs(inputRef, ref)}
          type="checkbox"
          className="ui-checkbox__input"
          checked={checked}
          disabled={disabled}
          onChange={(event) => {
            onChange?.(event);
            setChecked(event.target.checked);
            // Only a toggle by the user bounces, not a value set from outside or the first render.
            if (animation === 'spring' && boxRef.current) {
              animateSpring(boxRef.current, { transform: [event.target.checked ? 'scale(0.78)' : 'scale(0.9)', 'none'] }, 'bouncy');
            }
          }}
        />
        <span ref={boxRef} className="ui-checkbox__box" aria-hidden="true">
          <svg className="ui-checkbox__icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            {indeterminate ? (
              <path d="M4 8h8" />
            ) : (
              <path className="ui-checkbox__check" d="M3.5 8.5 6.5 11.5 12.5 4.5" pathLength={1} />
            )}
          </svg>
        </span>
      </span>
      {(label != null || description != null) && (
        <span className="ui-checkbox__text">
          {label != null && <span className="ui-checkbox__label">{label}</span>}
          {description != null && (
            <span id={descriptionId} className="ui-checkbox__description">
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
});
