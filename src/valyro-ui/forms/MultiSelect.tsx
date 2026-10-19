'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ComponentPropsWithRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ChevronDownIcon, SearchIcon, XIcon } from '../icons';
import { animateSpring, composeHandlers, cx, Floating, mergeRefs, useControllableState, useListNavigation } from '../primitives';
import { Button } from '../basic/Button';
import {
  filterItems,
  firstEnabledIndex,
  flattenItems,
  Listbox,
  matchesQuery,
  optionId,
  useFieldLabelIds,
  type SelectItem,
  type SelectOption,
} from './Listbox';
import './MultiSelect.css';
import { withRef, useId, useLayoutEffect } from '../primitives/react-compat';

export interface MultiSelectLabels {
  /** Button in the popover footer that removes every value. */
  clearAll: string;
  /** Footer summary. */
  selectedCount: (count: number) => string;
  /** Accessible name of a chip's remove button. */
  removeValue: (label: string) => string;
}

export const defaultMultiSelectLabels: MultiSelectLabels = {
  clearAll: 'Clear all',
  selectedCount: (count) => `${count} selected`,
  removeValue: (label) => `Remove ${label}`,
};

/**
 * How many chips of `widths` fit in `space` px with `gap` between them. When not all of them do, room is kept for
 * the `more`-wide "+N" after the last one. Always at least one chip (it is truncated if even it doesn't fit).
 */
export function fittingChips(widths: readonly number[], space: number, gap: number, more: number) {
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= space) return widths.length;
  let used = 0;
  let count = 0;
  for (const width of widths) {
    const next = used + (count > 0 ? gap : 0) + width;
    if (next + gap + more > space) break;
    used = next;
    count++;
  }
  return Math.max(1, count);
}

export interface MultiSelectProps
  extends Omit<ComponentPropsWithRef<'button'>, 'value' | 'defaultValue' | 'onChange' | 'children' | 'type'> {
  /** Options to pick from, flat or in labelled groups. */
  options: SelectItem[];
  /** Selected values in the order they were picked. */
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Field text while nothing is selected. */
  placeholder?: string;
  /** Field height and text size. */
  size?: 'sm' | 'md' | 'lg';
  /** Error border and aria-invalid on the trigger (an explicit `aria-invalid` wins). */
  invalid?: boolean;
  /** Adds a filter box at the top of the popover. */
  searchable?: boolean;
  /** Placeholder and accessible name of the filter box. */
  searchPlaceholder?: string;
  /**
   * Chips shown in the field before collapsing the rest into "+N". `'auto'`: as many whole chips as the field's
   * width holds (measured again when it resizes), so chips are never squeezed into a few letters.
   */
  maxChips?: number | 'auto';
  /** Shown in the popover when no option matches the filter or `options` is empty. */
  emptyText?: ReactNode;
  labels?: Partial<MultiSelectLabels>;
  /** Submits every selected value with the surrounding form (one hidden input per value). */
  name?: string;
}

/**
 * Multi-value select: chips in the field, checkboxes in the list. `className` and `style` go to the
 * field wrapper; `ref` and other props to the combobox trigger button. Chip remove buttons follow the
 * trigger in Tab order; Backspace on the trigger removes the last value. While the list is open, Tab
 * moves into its "Clear all" button.
 */
export const MultiSelect = withRef(function MultiSelect({
  options,
  value: valueProp,
  defaultValue,
  onValueChange,
  open: openProp,
  defaultOpen,
  onOpenChange,
  placeholder = 'Select…',
  size = 'md',
  invalid = false,
  searchable = false,
  searchPlaceholder = 'Search…',
  maxChips = 2,
  emptyText = 'No results',
  labels: labelsProp,
  name,
  disabled,
  className,
  style,
  ref,
  onClick,
  onKeyDown,
  'aria-invalid': ariaInvalid,
  ...rest
}: MultiSelectProps) {
  const [value, setValue] = useControllableState<string[]>({
    value: valueProp,
    defaultValue: defaultValue ?? [],
    onChange: onValueChange,
  });
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen ?? false, onChange: onOpenChange });
  const [query, setQuery] = useState('');
  const labels = { ...defaultMultiSelectLabels, ...labelsProp };
  const fieldRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLSpanElement>(null);
  const clearAllRef = useRef<HTMLButtonElement>(null);
  // Index of the chip whose remove button should take focus after a keyboard removal.
  const focusChip = useRef<number | null>(null);
  const listId = useId();
  const fieldLabelIds = useFieldLabelIds(triggerRef, open, listId);

  const allOptions = useMemo(() => flattenItems(options), [options]);
  const visibleItems = useMemo(
    () => (query ? filterItems(options, (option) => matchesQuery(option, query)) : options),
    [options, query],
  );
  const flat = useMemo(() => flattenItems(visibleItems), [visibleItems]);
  const selectedOptions = value.map(
    (v): SelectOption => allOptions.find((option) => option.value === v) ?? { value: v, label: v },
  );

  const toggle = (index: number) => {
    const picked = flat[index].value;
    setValue((prev) => (prev.includes(picked) ? prev.filter((v) => v !== picked) : [...prev, picked]));
  };

  const remove = (removed: string) => setValue((prev) => prev.filter((v) => v !== removed));

  // A removed chip unmounts with its button, so focus moves to the chip that takes its place, the one before it, or the trigger.
  useLayoutEffect(() => {
    const index = focusChip.current;
    if (index === null) return;
    focusChip.current = null;
    const buttons = chipsRef.current?.querySelectorAll<HTMLButtonElement>('.ui-multi-select__chip-remove') ?? [];
    (buttons[Math.min(index, buttons.length - 1)] ?? triggerRef.current)?.focus();
  });

  // A chip for a newly picked option pops in (not the ones there on mount, nor ones re-shown by the "+N" fit).
  const shownValues = useRef<readonly string[] | null>(null);
  useLayoutEffect(() => {
    const previous = shownValues.current;
    shownValues.current = value;
    if (!previous) return;
    const added = value.filter((v) => !previous.includes(v));
    if (!added.length) return;
    for (const chip of chipsRef.current?.querySelectorAll<HTMLElement>(':scope > .ui-multi-select__chip') ?? []) {
      if (added.includes(chip.dataset.value ?? '')) {
        animateSpring(chip, [{ opacity: 0, transform: 'scale(0.85)' }, { opacity: 1, transform: 'none' }], 'snappy');
      }
    }
  }, [value]);

  const nav = useListNavigation({
    count: flat.length,
    isDisabled: (i) => !!flat[i].disabled,
    // With a search box, letters filter the list instead of jumping to a row.
    getLabel: searchable ? undefined : (i) => flat[i].label,
    onSelect: toggle,
    initialIndex: open ? firstEnabledIndex(flat) : -1,
  });

  const show = () => {
    nav.setActiveIndex(firstEnabledIndex(flat));
    setOpen(true);
  };

  const hide = (restoreFocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  };

  // The popover is positioned (and made visible) one render after it mounts, so focus waits a frame.
  useEffect(() => {
    if (!open || !searchable) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open, searchable]);

  // The popover is portaled to the end of <body>, so Tab would never reach its footer: hand focus to "Clear all" explicitly.
  const focusClearAll = (event: KeyboardEvent) => {
    const button = clearAllRef.current;
    if (event.key !== 'Tab' || event.shiftKey || !button) return false;
    event.preventDefault();
    button.focus();
    return true;
  };

  const handleClearAllKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Tab') return;
    if (event.shiftKey) {
      event.preventDefault();
      (searchable ? searchRef : triggerRef).current?.focus();
    } else {
      // Back on the trigger, the browser's own Tab continues to whatever follows the field.
      hide(true);
    }
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        show();
      } else if (event.key === 'Backspace' && value.length > 0) {
        event.preventDefault();
        remove(value[value.length - 1]);
      }
      return;
    }
    if (focusClearAll(event)) return;
    if (event.key === 'Tab') {
      hide(false);
      return;
    }
    nav.onKeyDown(event);
  };

  const handleTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Keyboard-generated clicks (detail 0, e.g. Space keyup) are already handled in onKeyDown.
    if (event.detail === 0) return;
    // Safari does not focus buttons on click; keyboard navigation needs focus on the trigger.
    event.currentTarget.focus();
    if (open) hide(false);
    else show();
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value;
    setQuery(next);
    nav.setActiveIndex(firstEnabledIndex(flattenItems(filterItems(options, (option) => matchesQuery(option, next)))));
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // IME composition (Japanese, Chinese, Korean): Enter and Escape confirm or cancel the conversion, not the field.
    // keyCode 229: Safari reports the composition's last keydown with isComposing false.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (focusClearAll(event)) return;
    if (event.key === 'Tab') {
      // Hand focus back to the trigger so Tab continues from there, not from the portal at the end of <body>.
      hide(true);
      return;
    }
    // Space, Home and End edit the search text.
    if (event.key === ' ' || event.key === 'Home' || event.key === 'End') return;
    nav.onKeyDown(event);
  };

  /*
   * maxChips="auto": one render shows every chip at its full width, a layout effect measures them and keeps the
   * ones that fit (before paint, so the full row never shows). A new selection or a new field width measures again.
   */
  const autoChips = maxChips === 'auto';
  const fitKey = `${size}\u0001${disabled ? 'off' : 'on'}\u0001${selectedOptions.map((option) => `${option.value}\u0000${option.label}`).join('\u0001')}`;
  const [rowWidth, setRowWidth] = useState(0);
  const [fit, setFit] = useState<{ key: string; width: number; count: number } | null>(null);
  const fitCount = autoChips && fit?.key === fitKey && fit.width === rowWidth ? fit.count : null;
  const measuring = autoChips && fitCount === null && selectedOptions.length > 0;

  useLayoutEffect(() => {
    if (!measuring) return;
    const row = chipsRef.current;
    // Not laid out (a hidden tab, a closed dialog): every chip stays and the row clips them until it gets a width.
    if (!row || row.clientWidth === 0) return;
    const widths = Array.from(row.querySelectorAll<HTMLElement>(':scope > .ui-multi-select__chip'), (chip) => chip.offsetWidth);
    const more = row.querySelector<HTMLElement>(':scope > .ui-multi-select__more')?.offsetWidth ?? 0;
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const width = row.clientWidth;
    setRowWidth(width);
    setFit({ key: fitKey, width, count: fittingChips(widths, width, gap, more) });
  });

  useEffect(() => {
    const row = chipsRef.current;
    if (!autoChips || !row) return;
    // A new width (or a first one, for a field that mounted hidden) invalidates the count.
    const observer = new ResizeObserver(() => setRowWidth(row.clientWidth));
    observer.observe(row);
    return () => observer.disconnect();
  }, [autoChips]);

  const chipLimit = autoChips ? (fitCount ?? selectedOptions.length) : maxChips;
  const visibleChips = selectedOptions.slice(0, chipLimit);
  const overflow = selectedOptions.length - visibleChips.length;
  const activeId = open && nav.activeIndex >= 0 ? optionId(listId, nav.activeIndex) : undefined;

  return (
    <>
      <div
        ref={fieldRef}
        className={cx('ui-field', 'ui-multi-select', className)}
        style={style}
        data-size={size}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        aria-disabled={disabled || undefined}
        data-open={open || undefined}
        data-has-value={selectedOptions.length > 0 || undefined}
        data-max-chips={autoChips ? 'auto' : undefined}
        data-measuring={measuring || undefined}
      >
        {/* Covers the whole field so any click outside a chip's remove button toggles the list. */}
        <button
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={searchable ? undefined : activeId}
          aria-invalid={ariaInvalid ?? (invalid || undefined)}
          {...rest}
          ref={mergeRefs(triggerRef, ref)}
          disabled={disabled}
          className="ui-multi-select__trigger"
          onClick={composeHandlers(onClick, handleTriggerClick)}
          onKeyDown={composeHandlers(onKeyDown, handleTriggerKeyDown)}
        >
          <span className="ui-sr-only">
            {selectedOptions.length ? selectedOptions.map((option) => option.label).join(', ') : placeholder}
          </span>
        </button>
        <span ref={chipsRef} className="ui-multi-select__values">
          {selectedOptions.length === 0 && (
            <span className="ui-multi-select__placeholder" aria-hidden="true">
              {placeholder}
            </span>
          )}
          {visibleChips.map((option, index) => (
            <span key={option.value} className="ui-multi-select__chip" data-value={option.value}>
              <span className="ui-multi-select__chip-label" aria-hidden="true">
                {option.label}
              </span>
              {!disabled && (
                <button
                  type="button"
                  className="ui-multi-select__chip-remove"
                  aria-label={labels.removeValue(option.label)}
                  // Pointer removal leaves focus where it was instead of on a button that is about to unmount.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    if (document.activeElement === event.currentTarget) focusChip.current = index;
                    remove(option.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Backspace' && event.key !== 'Delete') return;
                    event.preventDefault();
                    focusChip.current = event.key === 'Backspace' ? Math.max(index - 1, 0) : index;
                    remove(option.value);
                  }}
                >
                  <XIcon size={12} strokeWidth={2.25} />
                </button>
              )}
            </span>
          ))}
          {overflow > 0 && (
            <span
              className="ui-multi-select__more"
              aria-hidden="true"
              title={selectedOptions
                .slice(chipLimit)
                .map((option) => option.label)
                .join(', ')}
            >
              +{overflow}
            </span>
          )}
          {/* Measured for the room "+N" needs: as wide as its largest possible count. */}
          {measuring && (
            <span className="ui-multi-select__more" data-measure="" aria-hidden="true">
              +{selectedOptions.length}
            </span>
          )}
        </span>
        <ChevronDownIcon className="ui-multi-select__chevron" />
      </div>
      {name && value.map((v) => <input key={v} type="hidden" name={name} value={v} disabled={disabled} />)}
      <Floating
        open={open && !disabled}
        anchorRef={fieldRef}
        placement="bottom-start"
        offset={6}
        matchAnchorWidth
        onDismiss={(reason) => hide(reason === 'escape')}
        className="ui-listbox__popover ui-multi-select__popover"
        // Keeps focus on the trigger / search box while clicking rows and buttons.
        onMouseDown={(event) => {
          if (event.target !== searchRef.current) event.preventDefault();
        }}
      >
        {searchable && (
          <div className="ui-multi-select__search">
            <SearchIcon className="ui-multi-select__search-icon" />
            <input
              ref={searchRef}
              type="text"
              role="combobox"
              aria-label={searchPlaceholder}
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={activeId}
              autoComplete="off"
              spellCheck={false}
              className="ui-multi-select__search-input"
              placeholder={searchPlaceholder}
              value={query}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
        )}
        <Listbox
          id={listId}
          items={visibleItems}
          activeIndex={nav.activeIndex}
          onActiveIndexChange={nav.setActiveIndex}
          isSelected={(v) => value.includes(v)}
          onSelect={toggle}
          indicator="checkbox"
          multiple
          label={rest['aria-label']}
          labelledBy={rest['aria-labelledby'] ?? (rest['aria-label'] ? undefined : fieldLabelIds)}
          emptyState={emptyText}
        />
        {value.length > 0 && (
          <div className="ui-multi-select__footer">
            <span className="ui-multi-select__count">{labels.selectedCount(value.length)}</span>
            <Button
              ref={clearAllRef}
              variant="ghost"
              size="sm"
              onKeyDown={handleClearAllKeyDown}
              onClick={() => {
                setValue([]);
                (searchable ? searchRef : triggerRef).current?.focus();
              }}
            >
              {labels.clearAll}
            </Button>
          </div>
        )}
      </Floating>
    </>
  );
});
