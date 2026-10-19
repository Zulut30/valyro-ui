'use client';

import { useRef, useState, type ComponentPropsWithRef, type CSSProperties, type KeyboardEvent } from 'react';
import { StarIcon } from '../icons';
import { clamp, cx, getDirection, inlineArrowStep, mergeRefs, useControllableState } from '../primitives';
import { useFormField } from './form-field-context';
import { FormValue, useMissingValue } from './form-value';
import { useFormReset } from '../forms/form-reset';
import './RatingInput.css';
import { withRef } from '../primitives/react-compat';

export interface RatingInputProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange'> {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  /** Number of stars. */
  max?: number;
  /** Allow x.5 values (each star has a left and right half). */
  allowHalf?: boolean;
  /** Display only; fractional values like 4.3 render as partial stars. */
  readOnly?: boolean;
  /** Dims the stars and ignores input; the rating is not submitted with the form. */
  disabled?: boolean;
  /** Star size: 16 / 20 / 28px. */
  size?: 'sm' | 'md' | 'lg';
  /** Empty stars turn the danger color (`aria-invalid`). Also shown after a submit attempt while a required rating is missing. */
  invalid?: boolean;
  /** Text per whole star, e.g. ["Bad", …, "Excellent"]; shown next to the stars for the hovered or chosen value. */
  valueLabels?: string[];
  /**
   * The old name of `valueLabels`.
   * @deprecated Use `valueLabels` (in the other components `labels` overrides built-in text).
   */
  labels?: string[];
  /** Accessible name of a value (each star, and the whole read-only rating). Default: "4 out of 5". */
  getValueLabel?: (value: number, max: number) => string;
  /** Submits the rating with the surrounding form as a number ("3.5"; empty when unrated). Not for `readOnly`. */
  name?: string;
  /** Blocks native form submission while nothing is rated. */
  required?: boolean;
}

const defaultValueLabel = (value: number, max: number) => `${value} out of ${max}`;

const ICON_SIZE = { sm: 16, md: 20, lg: 28 } as const;

const VERTICAL_STEP: Record<string, number> = { ArrowUp: 1, ArrowDown: -1 };

export const RatingInput = withRef(function RatingInput({
  value,
  defaultValue = 0,
  onValueChange,
  max = 5,
  allowHalf = false,
  readOnly = false,
  disabled = false,
  size = 'md',
  invalid = false,
  valueLabels,
  labels,
  getValueLabel = defaultValueLabel,
  name,
  required,
  className,
  ref,
  'aria-labelledby': labelledBy,
  ...rest
}: RatingInputProps) {
  const [rating, setRating] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const [hover, setHover] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset(rootRef, () => setRating(defaultValue), value === undefined);
  const field = useFormField();
  const [missing, markMissing] = useMissingValue(rating > 0);

  const step = allowHalf ? 0.5 : 1;
  const interactive = !readOnly && !disabled;
  const shown = interactive && hover !== null ? hover : rating;
  const captions = valueLabels ?? labels;
  const textFor = (v: number) => (v > 0 ? captions?.[Math.ceil(v) - 1] : undefined);
  const caption = textFor(shown);
  // Keyboard stop: the checked radio, or the first one when nothing is chosen yet.
  const tabStop = rating > 0 ? clamp(Math.round(rating / step) * step, step, max) : step;

  const select = (next: number) => {
    setRating(next);
    rootRef.current?.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!interactive) return;
    const current = rating > 0 ? tabStop : 0;
    // Stars fill from the right under dir="rtl", so ArrowLeft raises the rating there.
    const delta = VERTICAL_STEP[event.key] ?? inlineArrowStep(event.key, getDirection(event.currentTarget));
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'ArrowDown':
        next = clamp(current + delta * step, step, max);
        break;
      case 'Home':
        next = step;
        break;
      case 'End':
        next = max;
        break;
      case ' ':
      case 'Enter':
        next = Number((event.target as HTMLElement).dataset.value ?? tabStop);
        break;
      default:
        return;
    }
    event.preventDefault();
    select(next);
  };

  const stars = Array.from({ length: max }, (_, i) => {
    const fill = clamp(shown - i, 0, 1);
    const values = allowHalf ? [i + 0.5, i + 1] : [i + 1];
    return (
      <span
        key={i}
        className="ui-rating-input__star"
        data-filled={fill === 1 || undefined}
        data-partial={(fill > 0 && fill < 1) || undefined}
        style={{ '--_fill': `${fill * 100}%` } as CSSProperties}
      >
        <StarIcon size={ICON_SIZE[size]} className="ui-rating-input__empty" />
        <span className="ui-rating-input__fill" aria-hidden="true">
          <StarIcon size={ICON_SIZE[size]} fill="currentColor" />
        </span>
        {!readOnly &&
          values.map((v) => (
            <span
              key={v}
              role="radio"
              aria-checked={rating === v}
              aria-label={textFor(v) ? `${getValueLabel(v, max)} – ${textFor(v)}` : getValueLabel(v, max)}
              aria-disabled={disabled || undefined}
              tabIndex={interactive && v === tabStop ? 0 : -1}
              className="ui-rating-input__hit"
              data-value={v}
              data-half={allowHalf ? (v % 1 ? 'start' : 'end') : undefined}
              onPointerEnter={() => interactive && setHover(v)}
              onClick={() => interactive && select(v)}
            />
          ))}
      </span>
    );
  });

  const common = {
    ...rest,
    ref: mergeRefs(rootRef, ref),
    className: cx('ui-rating-input', className),
    'data-size': size,
    'data-readonly': readOnly || undefined,
    'data-disabled': disabled || undefined,
    'data-invalid': invalid || missing || undefined,
  };

  if (readOnly) {
    return (
      <div {...common} role="img" aria-label={rest['aria-label'] ?? getValueLabel(rating, max)}>
        <span className="ui-rating-input__stars">{stars}</span>
        {caption && <span className="ui-rating-input__caption">{caption}</span>}
      </div>
    );
  }

  return (
    <div
      {...common}
      role="radiogroup"
      aria-labelledby={labelledBy ?? field?.labelId}
      aria-disabled={disabled || undefined}
      aria-invalid={invalid || missing || undefined}
      // FormField's `required` only marks its label (aria-hidden); announce it on the group.
      aria-required={(required ?? field?.required) || undefined}
      onKeyDown={onKeyDown}
      onPointerLeave={() => setHover(null)}
    >
      <span className="ui-rating-input__stars">{stars}</span>
      {captions && (
        <span className="ui-rating-input__caption" aria-hidden="true">
          {caption}
        </span>
      )}
      <FormValue
        name={name}
        values={[rating > 0 ? String(rating) : '']}
        disabled={disabled}
        required={required}
        onMissing={(focus) => {
          markMissing();
          if (focus) rootRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
        }}
      />
    </div>
  );
});
