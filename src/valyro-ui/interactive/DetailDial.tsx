'use client';

import { useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cx, useControllableState } from '../primitives';
import { useId, withRef } from '../primitives/react-compat';
import { AlertCircleIcon } from '../icons';
import { SegmentedControl } from '../navigation/SegmentedControl';
import { RadioGroup } from '../forms/RadioGroup';
import { useLabels } from '../agents/labels';
import { resolveLevel } from './detail';
import { useHeightGlide } from './glide';
import './DetailDial.css';

export interface DetailLevel {
  /** Stable id: the value of the dial. */
  id: string;
  /** Short name in the switcher: `Short`, `Explained`, `Deep dive`. */
  label: string;
  /** The prepared text of this level. */
  content: ReactNode;
  /** One line under the label in the vertical switcher. */
  description?: ReactNode;
  /** Shown but not selectable. */
  disabled?: boolean;
}

export interface DetailDialLabels {
  /** Name of the switcher. */
  group: string;
  /** Read out after the level changes. */
  announce: (label: string) => string;
  /** The controlled value is unknown or disabled. */
  invalid: string;
}

const DEFAULT_LABELS: DetailDialLabels = {
  group: 'Level of detail',
  announce: (label) => `Showing: ${label}`,
  invalid: 'This level of detail is not available.',
};

export interface DetailDialProps extends Omit<ComponentPropsWithRef<'section'>, 'children' | 'defaultValue'> {
  /** Levels from the least to the most detailed, two to four. The texts are the author's: nothing is generated. */
  levels: DetailLevel[];
  /** The point that stays put above the changing text. */
  summary?: ReactNode;
  /** Id of the shown level. An unknown or disabled id shows the summary and an error. */
  value?: string;
  /** Initial level when uncontrolled. Default: the first available. */
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  /** `horizontal` (default): a segmented control; `vertical`: a list of levels with their descriptions. */
  orientation?: 'horizontal' | 'vertical';
  /** How the text changes: `fade` (default) or `none`. Never animates the height; reduced motion drops the fade. */
  transition?: 'none' | 'fade';
  labels?: Partial<DetailDialLabels>;
}

/**
 * One explanation at the depth the reader picks: a short answer, an explanation or a full breakdown, around a summary
 * that stays put. The change is immediate (a fade only accompanies it), focus stays on the switcher and the new
 * level's name is announced, not its whole text.
 */
export const DetailDial = withRef(function DetailDial({
  levels,
  summary,
  value: valueProp,
  defaultValue,
  onValueChange,
  orientation = 'horizontal',
  transition = 'fade',
  labels,
  className,
  ref,
  ...rest
}: DetailDialProps) {
  const copy = useLabels(DEFAULT_LABELS, labels);
  const uid = useId();
  const first = levels.find((level) => !level.disabled)?.id;
  const [raw, setRaw] = useControllableState<string | undefined>({
    value: valueProp,
    defaultValue: defaultValue ?? first,
    onChange: onValueChange as (id: string | undefined) => void,
  });
  const { id, error } = resolveLevel(levels, raw, valueProp !== undefined);
  const current = levels.find((level) => level.id === id);
  // Only a change the reader made is announced; the first render reads normally.
  const [announcement, setAnnouncement] = useState('');
  const available = levels.some((level) => !level.disabled);
  // Another level: its height glides from the previous one's (with `transition="none"` it just changes).
  const frameRef = useHeightGlide<HTMLDivElement>(transition === 'none' ? 'static' : current?.id);

  const choose = (next: string) => {
    const level = levels.find((item) => item.id === next);
    if (!level || level.disabled) return;
    setRaw(next);
    setAnnouncement(copy.announce(level.label));
  };

  return (
    <section ref={ref} className={cx('ui-detail-dial', className)} data-orientation={orientation} data-transition={transition} {...rest}>
      {summary != null && <div className="ui-detail-dial__summary">{summary}</div>}
      {available && (
        <div className="ui-detail-dial__switch">
          {orientation === 'horizontal' ? (
            <SegmentedControl
              aria-label={copy.group}
              aria-controls={`${uid}-content`}
              size="sm"
              value={id ?? ''}
              onValueChange={choose}
              options={levels.map((level) => ({ value: level.id, label: level.label, disabled: level.disabled }))}
            />
          ) : (
            <RadioGroup
              aria-label={copy.group}
              aria-controls={`${uid}-content`}
              variant="cards"
              size="sm"
              value={id ?? ''}
              onValueChange={choose}
              options={levels.map((level) => ({ value: level.id, label: level.label, description: level.description, disabled: level.disabled }))}
            />
          )}
        </div>
      )}
      {error && (
        <p className="ui-detail-dial__error" role="alert">
          <AlertCircleIcon aria-hidden="true" />
          <span>{copy.invalid}</span>
        </p>
      )}
      <div ref={frameRef} className="ui-detail-dial__frame">
        {current && (
          <div className="ui-detail-dial__content" id={`${uid}-content`} key={current.id} data-level={current.id}>
            {current.content}
          </div>
        )}
      </div>
      <div className="ui-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </section>
  );
});
