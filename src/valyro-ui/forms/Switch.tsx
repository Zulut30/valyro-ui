'use client';

import { type ComponentPropsWithRef, type CSSProperties, type ReactNode } from 'react';
import { cx, useControllableState } from '../primitives';
import '../primitives/motion.css';
import './Switch.css';
import { withRef, useId } from '../primitives/react-compat';

export interface SwitchProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'size' | 'checked' | 'defaultChecked' | 'role'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Track, knob and text size. */
  size?: 'sm' | 'md' | 'lg';
  /** Text next to the switch; clicking it toggles the switch, and it names the input. */
  label?: ReactNode;
  /** Secondary text under the label, linked to the input with aria-describedby. */
  description?: ReactNode;
  /** Error state, e.g. from a FormField: aria-invalid on the input (an explicit `aria-invalid` wins). */
  invalid?: boolean;
  /**
   * `spring`: the knob travels with a spring (a transform, not a layout change) and the track icons swap
   * with a pop. `default`: the theme's transition.
   */
  animation?: 'default' | 'spring';
  /** Icon on the track's start side, uncovered while the switch is on (e.g. a sun). */
  startIcon?: ReactNode;
  /** Icon on the track's end side, uncovered while the switch is off (e.g. a moon). */
  endIcon?: ReactNode;
  /** Icon inside the knob. */
  thumbIcon?: ReactNode;
  /** Knob width while pressed, px: it stretches into a capsule (default: the theme's stretch). */
  pressedWidth?: number;
}

/**
 * On/off toggle: a native checkbox with `role="switch"`, so it submits with forms
 * and toggles with Space. `className`/`style` go to the <label> wrapper, other props to the <input>.
 */
export const Switch = withRef(function Switch({
  checked: checkedProp,
  defaultChecked = false,
  onCheckedChange,
  size = 'md',
  label,
  description,
  disabled,
  invalid = false,
  animation = 'default',
  startIcon,
  endIcon,
  thumbIcon,
  pressedWidth,
  onChange,
  className,
  style,
  'aria-describedby': describedBy,
  ...rest
}: SwitchProps) {
  const [checked, setChecked] = useControllableState({ value: checkedProp, defaultValue: defaultChecked, onChange: onCheckedChange });
  const descriptionId = useId();

  return (
    <label
      className={cx('ui-switch', className)}
      style={pressedWidth != null ? ({ '--_pressed-w': `${pressedWidth}px`, ...style } as CSSProperties) : style}
      data-size={size}
      data-checked={checked || undefined}
      data-disabled={disabled || undefined}
      data-motion={animation === 'spring' ? 'spring' : undefined}
      data-pressed-width={pressedWidth != null || undefined}
    >
      <span className="ui-switch__control">
        <input
          aria-describedby={cx(describedBy, description != null && descriptionId) || undefined}
          aria-invalid={invalid || undefined}
          {...rest}
          type="checkbox"
          role="switch"
          className="ui-switch__input"
          checked={checked}
          disabled={disabled}
          onChange={(event) => {
            onChange?.(event);
            setChecked(event.target.checked);
          }}
        />
        <span className="ui-switch__track" aria-hidden="true">
          {startIcon != null && (
            <span className="ui-switch__icon" data-side="start">
              {startIcon}
            </span>
          )}
          {endIcon != null && (
            <span className="ui-switch__icon" data-side="end">
              {endIcon}
            </span>
          )}
        </span>
        <span className="ui-switch__knob" aria-hidden="true">
          {thumbIcon != null && <span className="ui-switch__thumb-icon">{thumbIcon}</span>}
        </span>
      </span>
      {(label != null || description != null) && (
        <span className="ui-switch__text">
          {label != null && <span className="ui-switch__label">{label}</span>}
          {description != null && (
            <span id={descriptionId} className="ui-switch__description">
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
});
