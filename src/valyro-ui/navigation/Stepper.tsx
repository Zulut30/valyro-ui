'use client';

import { useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { CheckIcon, XIcon } from '../icons';
import { cx } from '../primitives';
import { collectionPart, partsOf } from '../primitives/compound';
import { useStepper, type StepState } from './useStepper';
import './Stepper.css';
import { withRef } from '../primitives/react-compat';

export type { StepState } from './useStepper';

export interface StepperStep {
  title: ReactNode;
  description?: ReactNode;
  /** Marks the step as failed; overrides its positional state. */
  error?: boolean;
}

export interface StepperProps extends Omit<ComponentPropsWithRef<'ol'>, 'defaultValue' | 'onChange'> {
  /** Steps in order; their state follows from `value` unless marked as failed. Or compose them as `Stepper.Step` children. */
  steps?: StepperStep[];
  /** The compound form instead of `steps`: `Stepper.Step` elements. */
  children?: ReactNode;
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

export type StepperStepPartProps = StepperStep;

/** A step of the compound form (`Stepper.Step`). */
export const StepperStepPart = collectionPart<StepperStepPartProps>('Stepper.Step');

export const Stepper = withRef(function Stepper({
  steps: stepsProp,
  children,
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
  const steps = stepsProp ?? partsOf<StepperStepPartProps>(children, StepperStepPart).map(({ props }) => props);
  // The current step, the step states and going back come from the headless hook.
  const stepper = useStepper({ steps, value, defaultValue, onValueChange, clickable });
  const current = stepper.value;
  // A step completed after mount pops its check in (data-ui-enter, no JavaScript): the steps below the
  // lowest one reached so far have been complete all along and keep a still check.
  const [settled, setSettled] = useState(current);
  if (current < settled) setSettled(current);
  const labels = { ...defaultStepperLabels, ...labelOverrides };

  return (
    <ol {...rest} ref={ref} className={cx('ui-stepper', className)} data-orientation={orientation}>
      {steps.map((step, index) => {
        const state = stepper.getStepState(index);
        const body = (
          <>
            <span className="ui-stepper__indicator" aria-hidden="true">
              {state === 'complete' ? (
                <CheckIcon size={14} strokeWidth={2.5} data-ui-enter={index >= settled ? 'pop' : undefined} />
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
          <li key={index} className="ui-stepper__step" {...stepper.getStepProps(index)}>
            {stepper.isClickable(index) ? (
              <button className="ui-stepper__trigger" {...stepper.getTriggerProps(index)} type="button">
                {body}
              </button>
            ) : (
              <div className="ui-stepper__trigger" {...stepper.getTriggerProps(index)}>
                {body}
              </div>
            )}
            {index < steps.length - 1 && <span className="ui-stepper__connector" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}, { Step: StepperStepPart });
