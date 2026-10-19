'use client';

import { useEffect, useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import { CheckIcon, XIcon } from '../icons';
import { animateSpring, cx, mergeRefs, useControllableState } from '../primitives';
import './Stepper.css';
import { withRef } from '../primitives/react-compat';

export interface StepperStep {
  title: ReactNode;
  description?: ReactNode;
  /** Marks the step as failed; overrides its positional state. */
  error?: boolean;
}

export type StepState = 'complete' | 'current' | 'upcoming' | 'error';

export interface StepperProps extends Omit<ComponentPropsWithRef<'ol'>, 'defaultValue' | 'onChange'> {
  /** Steps in order; their state follows from `value` unless marked as failed. */
  steps: StepperStep[];
  /** Index of the current step. */
  value?: number;
  defaultValue?: number;
  onValueChange?: (index: number) => void;
  /** Steps in a row joined by connectors, or stacked in a column with a connector line down the side. */
  orientation?: 'horizontal' | 'vertical';
  /** Steps before the current one become buttons that jump back to them. */
  clickable?: boolean;
  /** Screen-reader text announced after each step title, per state. */
  labels?: Partial<StepperLabels>;
}

export type StepperLabels = Record<StepState, string>;

export const defaultStepperLabels: StepperLabels = {
  complete: 'completed',
  current: 'current step',
  upcoming: 'not started',
  error: 'error',
};

export const Stepper = withRef(function Stepper({
  steps,
  value,
  defaultValue = 0,
  onValueChange,
  orientation = 'horizontal',
  clickable = false,
  labels: labelOverrides,
  className,
  ref,
  ...rest
}: StepperProps) {
  const [current, setCurrent] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const listRef = useRef<HTMLOListElement>(null);
  // The clicked step becomes the current one, rendered without a button: hand focus to it instead of <body>.
  const focusCurrent = useRef(false);
  // Steps that just completed (not the ones complete on mount) pop their check in with a spring.
  const previous = useRef(current);
  useEffect(() => {
    const from = previous.current;
    previous.current = current;
    for (let index = from; index < current; index++) {
      const check = listRef.current?.children[index]?.querySelector('.ui-stepper__indicator > svg');
      if (check) animateSpring(check, [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'none' }], 'bouncy');
    }
    if (!focusCurrent.current) return;
    focusCurrent.current = false;
    listRef.current?.querySelectorAll<HTMLElement>(':scope > li > .ui-stepper__trigger')[current]?.focus();
  }, [current]);
  const labels = { ...defaultStepperLabels, ...labelOverrides };

  return (
    <ol {...rest} ref={mergeRefs(listRef, ref)} className={cx('ui-stepper', className)} data-orientation={orientation}>
      {steps.map((step, index) => {
        const state: StepState = step.error
          ? 'error'
          : index < current
            ? 'complete'
            : index === current
              ? 'current'
              : 'upcoming';
        const body = (
          <>
            <span className="ui-stepper__indicator" aria-hidden="true">
              {state === 'complete' ? (
                <CheckIcon size={14} strokeWidth={2.5} />
              ) : state === 'error' ? (
                <XIcon size={14} strokeWidth={2.5} />
              ) : (
                index + 1
              )}
            </span>
            <span className="ui-stepper__text">
              <span className="ui-stepper__title">{step.title}</span>
              {step.description && <span className="ui-stepper__description">{step.description}</span>}
              <span className="ui-sr-only">, {labels[state]}</span>
            </span>
          </>
        );
        return (
          <li
            key={index}
            className="ui-stepper__step"
            data-state={state}
            data-passed={index < current || undefined}
            aria-current={index === current ? 'step' : undefined}
          >
            {clickable && index < current ? (
              <button
                type="button"
                className="ui-stepper__trigger"
                onClick={() => {
                  focusCurrent.current = true;
                  setCurrent(index);
                }}
              >
                {body}
              </button>
            ) : (
              <div className="ui-stepper__trigger" tabIndex={index === current ? -1 : undefined}>
                {body}
              </div>
            )}
            {index < steps.length - 1 && <span className="ui-stepper__connector" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
});
