'use client';

import { useEffect, useRef, type HTMLAttributes } from 'react';
import { useControllableState } from '../primitives/useControllableState';
import { withUserProps, type UserProps } from '../primitives/prop-getters';

/*
 * The behaviour of Stepper without its markup: the current step (controlled or not), each step's state from its
 * position (complete, current, upcoming) unless it failed, `aria-current="step"`, and with `clickable` the steps
 * already passed as buttons that go back to them; the step gone back to takes the focus (it is no longer a
 * button), so it does not drop to <body>. Stepper renders with it.
 */

export type StepState = 'complete' | 'current' | 'upcoming' | 'error';

export interface StepperOptions {
  /** The steps in order; one with `error` shows as failed whatever its position. */
  steps: readonly { error?: boolean }[];
  /** Index of the current step. */
  value?: number;
  defaultValue?: number;
  onValueChange?: (index: number) => void;
  /** Steps before the current one go back to it when pressed. */
  clickable?: boolean;
}

export interface StepperState {
  /** Index of the current step. */
  value: number;
  setValue: (index: number) => void;
  getStepState: (index: number) => StepState;
  /** Whether the step is pressable: `clickable` and before the current one. Render its trigger as a `<button>`. */
  isClickable: (index: number) => boolean;
  /** A step's `<li>`: its state and `aria-current`. */
  getStepProps: (index: number, props?: UserProps) => HTMLAttributes<HTMLElement> & { 'data-state': StepState; 'data-passed'?: true };
  /** The step's content: a `<button>` that goes back while isClickable, else an element the focus can rest on. */
  getTriggerProps: (index: number, props?: UserProps) => HTMLAttributes<HTMLElement> & {
    type?: 'button';
    ref: (node: HTMLElement | null) => void;
  };
}

export function useStepper({ steps, value: valueProp, defaultValue = 0, onValueChange, clickable = false }: StepperOptions): StepperState {
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue, onChange: onValueChange });
  const triggers = useRef(new Map<number, HTMLElement>());
  // One ref callback per step, so a trigger's ref does not change on every render.
  const refs = useRef(new Map<number, (node: HTMLElement | null) => void>());
  // The pressed step becomes the current one, rendered without a button: hand focus to it instead of <body>.
  const focusCurrent = useRef(false);
  useEffect(() => {
    if (!focusCurrent.current) return;
    focusCurrent.current = false;
    triggers.current.get(value)?.focus();
  }, [value]);

  const triggerRef = (index: number) => {
    let ref = refs.current.get(index);
    if (!ref) {
      ref = (node) => {
        if (node) triggers.current.set(index, node);
        else triggers.current.delete(index);
      };
      refs.current.set(index, ref);
    }
    return ref;
  };
  const getStepState = (index: number): StepState =>
    steps[index]?.error ? 'error' : index < value ? 'complete' : index === value ? 'current' : 'upcoming';
  const isClickable = (index: number) => clickable && index < value;

  return {
    value,
    setValue,
    getStepState,
    isClickable,
    getStepProps: (index, props) =>
      withUserProps(
        {
          'data-state': getStepState(index),
          'data-passed': index < value || undefined,
          'aria-current': index === value ? 'step' : undefined,
        },
        props,
      ) as never,
    getTriggerProps: (index, props) =>
      withUserProps(
        isClickable(index)
          ? {
              ref: triggerRef(index),
              type: 'button',
              onClick: () => {
                focusCurrent.current = true;
                setValue(index);
              },
            }
          : { ref: triggerRef(index), tabIndex: index === value ? -1 : undefined },
        props,
      ) as never,
  };
}
