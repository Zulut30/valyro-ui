'use client';

import type { ChangeEvent, ComponentPropsWithRef, FocusEvent } from 'react';
import { withRef } from './react-compat';
import { composeHandlers, cx } from './utils';

/*
 * The visually hidden `<input type="range">` inside a custom slider thumb (React Aria's sliders work the same
 * way): it is what takes focus, so VoiceOver on iOS and TalkBack change the value with their swipe gestures, which
 * do not adjust an element with role slider. The slider keeps its own keys (it calls preventDefault, so the native
 * step does not apply); a swipe, or any other native adjustment, arrives as `onValueChange`. The drawn thumb shows
 * the focus ring while `onFocusVisibleChange` says focus is visible (keyboard, screen reader), not after a press.
 *
 * The element a drag of such a slider starts on carries `data-ui-slider`: with no role slider left on it, that is
 * what tells a BottomSheet or a 3D scene around it that the drag belongs to the slider.
 */

export interface HiddenRangeProps extends Omit<ComponentPropsWithRef<'input'>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> {
  value: number;
  min: number;
  max: number;
  /** Native step (what a swipe moves). Default 1. */
  step?: number | 'any';
  onValueChange: (value: number) => void;
  onFocusVisibleChange?: (visible: boolean) => void;
}

/** Whether focus arrived the way `:focus-visible` matches (keyboard, screen reader), not by a press. */
export function isFocusVisible(element: Element) {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

export const HiddenRange = withRef(function HiddenRange({
  value,
  min,
  max,
  step = 1,
  onValueChange,
  onFocusVisibleChange,
  className,
  onFocus,
  onBlur,
  ...rest
}: HiddenRangeProps) {
  return (
    <input
      {...rest}
      type="range"
      className={cx('ui-sr-only', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        const next = event.currentTarget.valueAsNumber;
        if (Number.isFinite(next)) onValueChange(next);
      }}
      onFocus={composeHandlers(onFocus, (event: FocusEvent<HTMLInputElement>) => onFocusVisibleChange?.(isFocusVisible(event.currentTarget)))}
      onBlur={composeHandlers(onBlur, () => onFocusVisibleChange?.(false))}
    />
  );
});
