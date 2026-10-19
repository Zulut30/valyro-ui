'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';
import type { IconProps } from '../icons';
import {
  clamp,
  composeHandlers,
  cx,
  Floating,
  isComposingKey,
  mergeRefs,
  useControllableState,
  useFocusTrap,
  useIsClient,
  type DismissReason,
} from '../primitives';
import { HiddenRange } from '../primitives/HiddenRange';
import { useLocale } from '../theme/ThemeProvider';
import { IconButton } from '../basic/IconButton';
import { hexToHsv, hsvToHex, hsvToRgb, normalizeHex, type HSVA } from './color';
import { useFormField } from './form-field-context';
import { FormValue } from './form-value';
import { PickerTrigger, type FieldSize } from './PickerTrigger';
import { useFormReset } from '../forms/form-reset';
import './ColorPicker.css';
import { withRef, useId } from '../primitives/react-compat';

export interface ColorPickerLabels {
  /** Saturation/brightness area. */
  area: string;
  /** The area's horizontal axis (its own control for screen readers). */
  saturation: string;
  /** The area's vertical axis. */
  brightness: string;
  /** Spoken value of the area; receives formatted percentages. */
  areaValue: (saturation: string, brightness: string) => string;
  hue: string;
  opacity: string;
  hex: string;
  eyeDropper: string;
  presets: string;
}

export const DEFAULT_COLOR_PICKER_LABELS: ColorPickerLabels = {
  area: 'Saturation and brightness',
  saturation: 'Saturation',
  brightness: 'Brightness',
  areaValue: (saturation, brightness) => `Saturation ${saturation}, brightness ${brightness}`,
  hue: 'Hue',
  opacity: 'Opacity',
  hex: 'Hex color',
  eyeDropper: 'Pick from screen',
  presets: 'Presets',
};

export interface ColorPickerProps extends Omit<ComponentPropsWithRef<'div'>, 'defaultValue' | 'onChange'> {
  /** Hex colour: `#rrggbb`, or `#rrggbbaa` when `alpha` is on and the colour is translucent. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Show the opacity slider. */
  alpha?: boolean;
  /** Preset swatches (any hex form). */
  presets?: string[];
  /** Submits the colour with the surrounding form as lowercase hex (`#rrggbb` or `#rrggbbaa`). */
  name?: string;
  /** Error state, e.g. from a FormField (marks the root with `data-invalid`). */
  invalid?: boolean;
  labels?: Partial<ColorPickerLabels>;
}

const DEFAULT_COLOR = '#0070f3';
const FALLBACK: HSVA = { h: 0, s: 0, v: 0, a: 1 };

interface EyeDropperResult {
  sRGBHex: string;
}
type EyeDropperConstructor = new () => { open(): Promise<EyeDropperResult> };

function getEyeDropper() {
  return (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
}

const PipetteIcon = withRef(function PipetteIcon({ size = 16, strokeWidth, className, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cx('ui-icon', className)}
      {...rest}
    >
      <path d="m2 22 1-1h3l9-9" />
      <path d="M3 21v-3l9-9" />
      <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
    </svg>
  );
});

/**
 * Pointer handlers that report the pointer position inside the element as 0–1 fractions, with capture. A press
 * moves focus to `focusTarget`, the hidden range input of the control.
 */
function dragHandlers(onMove: (x: number, y: number) => void, focusTarget: RefObject<HTMLElement | null>) {
  const report = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onMove(
      clamp((event.clientX - rect.left) / rect.width, 0, 1),
      clamp((event.clientY - rect.top) / rect.height, 0, 1),
    );
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      focusTarget.current?.focus({ preventScroll: true });
      report(event);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) report(event);
    },
  };
}

/** Arrow/Page/Home/End delta for sliders: `step`, ×10 with Shift or Page keys. */
function keyDelta(event: KeyboardEvent, step: number, axis: 'x' | 'y' | 'both') {
  const big = step * 10;
  const amount = event.shiftKey ? big : step;
  const horizontal = axis !== 'y';
  const vertical = axis !== 'x';
  switch (event.key) {
    case 'ArrowRight':
      return horizontal ? { x: amount } : null;
    case 'ArrowLeft':
      return horizontal ? { x: -amount } : null;
    case 'ArrowUp':
      return vertical ? { y: amount } : { x: amount };
    case 'ArrowDown':
      return vertical ? { y: -amount } : { x: -amount };
    case 'PageUp':
      return { x: big };
    case 'PageDown':
      return { x: -big };
    case 'Home':
      return { x: -Infinity };
    case 'End':
      return { x: Infinity };
    default:
      return null;
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export const ColorPicker = withRef(function ColorPicker({
  value,
  defaultValue = DEFAULT_COLOR,
  onValueChange,
  alpha = false,
  presets,
  name,
  labels: labelsProp,
  invalid = false,
  className,
  ref,
  ...rest
}: ColorPickerProps) {
  // Inside a FormField its label names the group (a `for` pointing at a div names nothing).
  const field = useFormField();
  const labels = { ...DEFAULT_COLOR_PICKER_LABELS, ...labelsProp };
  const locale = useLocale();
  const formats = useMemo(
    () => ({
      percent: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
      degree: new Intl.NumberFormat(locale, { style: 'unit', unit: 'degree', maximumFractionDigits: 0 }),
    }),
    [locale],
  );
  const [hex, setHex] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const rootRef = useRef<HTMLDivElement>(null);
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset(rootRef, () => setHex(defaultValue), value === undefined);
  // HSV is the source of truth while editing: hex alone loses the hue at zero saturation or brightness.
  const [hsva, setHsva] = useState<HSVA>(() => hexToHsv(hex) ?? FALLBACK);
  const [syncedHex, setSyncedHex] = useState(hex);
  if (hex !== syncedHex) {
    setSyncedHex(hex);
    const parsed = hexToHsv(hex);
    if (parsed && normalizeHex(hex) !== hsvToHex(hsva)) setHsva(parsed);
  }

  const [hexDraft, setHexDraft] = useState<string | null>(null);
  // The hidden range inputs take focus; the drawn area shows the ring while its focus is visible.
  const [areaFocusVisible, setAreaFocusVisible] = useState(false);
  const saturationRef = useRef<HTMLInputElement>(null);
  const isClient = useIsClient();
  const EyeDropper = isClient ? getEyeDropper() : undefined;

  const color = alpha ? hsva : { ...hsva, a: 1 };
  const current = hsvToHex(color);
  const opaque = hsvToHex({ ...hsva, a: 1 });
  const { r, g, b } = hsvToRgb(hsva);

  const update = (next: HSVA) => {
    const nextHex = hsvToHex(alpha ? next : { ...next, a: 1 });
    setHsva(next);
    setSyncedHex(nextHex);
    setHex(nextHex);
  };

  const applyHex = (input: string) => {
    const parsed = hexToHsv(input.startsWith('#') ? input : `#${input}`);
    if (parsed) update(parsed.s === 0 || parsed.v === 0 ? { ...parsed, h: hsva.h } : parsed);
  };

  const pickFromScreen = () => {
    if (!EyeDropper) return;
    new EyeDropper()
      .open()
      .then((result) => applyHex(result.sRGBHex))
      .catch((error: unknown) => {
        // The user dismissing the eyedropper (Escape) rejects with AbortError — that is not a failure.
        if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
      });
  };

  const onAreaKeyDown = (event: KeyboardEvent) => {
    const delta = keyDelta(event, 0.01, 'both');
    if (!delta) return;
    event.preventDefault();
    update({ ...hsva, s: clamp(hsva.s + (delta.x ?? 0), 0, 1), v: clamp(hsva.v + (delta.y ?? 0), 0, 1) });
  };

  const areaStyle = { '--_hue': `hsl(${hsva.h} 100% 50%)` } as CSSProperties;
  const swatchStyle = (c: string) => ({ '--_swatch': c }) as CSSProperties;

  return (
    <div
      role="group"
      aria-labelledby={rest['aria-label'] ? undefined : field?.labelId}
      {...rest}
      ref={mergeRefs(rootRef, ref)}
      className={cx('ui-color-picker', className)}
      data-invalid={invalid || undefined}
    >
      {/* Two hidden range inputs, one per axis (React Aria's ColorArea): the arrows move both from either; a
          screen reader's swipe changes the axis of the input it is on. Only saturation is a Tab stop. */}
      <div
        role="group"
        aria-label={labels.area}
        className="ui-color-picker__area"
        style={areaStyle}
        data-ui-slider=""
        data-focus-visible={areaFocusVisible || undefined}
        onKeyDown={onAreaKeyDown}
        {...dragHandlers((x, y) => update({ ...hsva, s: x, v: 1 - y }), saturationRef)}
      >
        <span
          className="ui-color-picker__thumb"
          style={{ left: pct(hsva.s), top: pct(1 - hsva.v), ...swatchStyle(opaque) }}
        />
        <HiddenRange
          ref={saturationRef}
          aria-label={labels.saturation}
          aria-valuetext={labels.areaValue(formats.percent.format(hsva.s), formats.percent.format(hsva.v))}
          min={0}
          max={100}
          value={Math.round(hsva.s * 100)}
          onValueChange={(next) => update({ ...hsva, s: clamp(next / 100, 0, 1) })}
          onFocusVisibleChange={setAreaFocusVisible}
        />
        <HiddenRange
          tabIndex={-1}
          aria-label={labels.brightness}
          aria-valuetext={labels.areaValue(formats.percent.format(hsva.s), formats.percent.format(hsva.v))}
          min={0}
          max={100}
          value={Math.round(hsva.v * 100)}
          onValueChange={(next) => update({ ...hsva, v: clamp(next / 100, 0, 1) })}
          onFocusVisibleChange={setAreaFocusVisible}
        />
      </div>

      <div className="ui-color-picker__controls">
        {EyeDropper && (
          <IconButton size="sm" label={labels.eyeDropper} icon={<PipetteIcon />} onClick={pickFromScreen} />
        )}
        <span className="ui-color-picker__preview" style={swatchStyle(current)} aria-hidden="true" />
        <div className="ui-color-picker__sliders">
          <ColorSlider
            label={labels.hue}
            channel="hue"
            value={hsva.h / 360}
            valueText={formats.degree.format(hsva.h)}
            step={1 / 360}
            max={360}
            thumbColor={`hsl(${hsva.h} 100% 50%)`}
            onChange={(x) => update({ ...hsva, h: x * 360 })}
          />
          {alpha && (
            <ColorSlider
              label={labels.opacity}
              channel="alpha"
              value={hsva.a}
              valueText={formats.percent.format(hsva.a)}
              step={0.01}
              max={100}
              thumbColor={current}
              style={{ '--_rgb': `${r} ${g} ${b}` } as CSSProperties}
              onChange={(x) => update({ ...hsva, a: Math.round(x * 100) / 100 })}
            />
          )}
        </div>
      </div>

      <div className="ui-color-picker__inputs">
        <label className="ui-field ui-color-picker__hex" data-size="sm">
          <span className="ui-field__icon">#</span>
          <span className="ui-sr-only">{labels.hex}</span>
          <input
            className="ui-field__input"
            spellCheck={false}
            autoComplete="off"
            maxLength={9}
            value={hexDraft ?? current.slice(1).toUpperCase()}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setHexDraft(event.target.value)}
            onBlur={() => {
              // Invalid text simply reverts to the current colour.
              if (hexDraft !== null) applyHex(hexDraft.trim());
              setHexDraft(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && hexDraft !== null && !isComposingKey(event)) {
                applyHex(hexDraft.trim());
                setHexDraft(null);
              }
            }}
          />
        </label>
        {alpha && <span className="ui-color-picker__alpha-value">{formats.percent.format(hsva.a)}</span>}
      </div>

      {presets && presets.length > 0 && (
        <div className="ui-color-picker__swatches" role="group" aria-label={labels.presets}>
          {presets.map((preset) => {
            const normalized = normalizeHex(preset);
            return (
              <button
                key={preset}
                type="button"
                className="ui-color-picker__swatch"
                style={swatchStyle(preset)}
                aria-label={preset}
                aria-pressed={normalized !== null && normalized === normalizeHex(current)}
                onClick={() => applyHex(preset)}
              />
            );
          })}
        </div>
      )}
      <FormValue name={name} values={[current]} />
    </div>
  );
});

interface ColorSliderProps {
  label: string;
  channel: 'hue' | 'alpha';
  /** 0–1 position. */
  value: number;
  valueText: string;
  step: number;
  /** The hidden range input runs 0–`max` in whole steps (degrees of hue, percent of opacity). */
  max: number;
  thumbColor: string;
  style?: CSSProperties;
  onChange: (value: number) => void;
}

function ColorSlider({ label, channel, value, valueText, step, max, thumbColor, style, onChange }: ColorSliderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focusVisible, setFocusVisible] = useState(false);
  return (
    <div
      className="ui-color-picker__slider"
      data-channel={channel}
      data-ui-slider=""
      data-focus-visible={focusVisible || undefined}
      style={style}
      onKeyDown={(event) => {
        const delta = keyDelta(event, step, 'x');
        if (!delta) return;
        event.preventDefault();
        onChange(clamp(value + (delta.x ?? 0), 0, 1));
      }}
      {...dragHandlers((x) => onChange(x), inputRef)}
    >
      <span className="ui-color-picker__thumb" style={{ left: `${value * 100}%`, '--_swatch': thumbColor } as CSSProperties} />
      <HiddenRange
        ref={inputRef}
        aria-label={label}
        aria-valuetext={valueText}
        min={0}
        max={max}
        value={Math.round(value * max)}
        onValueChange={(next) => onChange(clamp(next / max, 0, 1))}
        onFocusVisibleChange={setFocusVisible}
      />
    </div>
  );
}

export interface ColorPickerPopoverLabels extends ColorPickerLabels {
  /** Accessible name of the popover. */
  dialog: string;
}

export const DEFAULT_COLOR_PICKER_POPOVER_LABELS: ColorPickerPopoverLabels = {
  ...DEFAULT_COLOR_PICKER_LABELS,
  dialog: 'Choose color',
};

export interface ColorPickerPopoverProps
  extends Omit<ComponentPropsWithRef<'button'>, 'value' | 'defaultValue' | 'onChange'> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  alpha?: boolean;
  presets?: string[];
  size?: FieldSize;
  invalid?: boolean;
  /** Submits the colour with the surrounding form as lowercase hex (`#rrggbb` or `#rrggbbaa`). */
  name?: string;
  labels?: Partial<ColorPickerPopoverLabels>;
}

/** Swatch trigger (`.ui-field` look) that opens a ColorPicker in a popover. */
export const ColorPickerPopover = withRef(function ColorPickerPopover({
  value,
  defaultValue = DEFAULT_COLOR,
  onValueChange,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  alpha,
  presets,
  size,
  invalid,
  name,
  disabled,
  labels: labelsProp,
  className,
  ref,
  onClick,
  onKeyDown,
  ...rest
}: ColorPickerPopoverProps) {
  const labels = { ...DEFAULT_COLOR_PICKER_POPOVER_LABELS, ...labelsProp };
  const [hex, setHex] = useControllableState({ value, defaultValue, onChange: onValueChange });
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange });
  const triggerRef = useRef<HTMLButtonElement>(null);
  // A form reset brings the uncontrolled value back to its default (forms/form-reset.ts).
  useFormReset(triggerRef, () => setHex(defaultValue), value === undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  // Focus returns to the trigger only on Escape, never after a click elsewhere.
  useFocusTrap(panelRef, open, { restoreFocus: false });

  useEffect(() => {
    if (!open) return;
    // Wait a frame: the popover stays hidden until its first position is computed.
    const frame = requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>('input[type="range"]')?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <>
      <PickerTrigger
        {...rest}
        ref={mergeRefs(triggerRef, ref)}
        className={cx('ui-color-picker-trigger', className)}
        icon={
          <span
            className="ui-color-picker__preview ui-color-picker-trigger__swatch"
            style={{ '--_swatch': hex } as CSSProperties}
          />
        }
        hasValue
        open={open}
        size={size}
        invalid={invalid}
        disabled={disabled}
        aria-controls={open ? dialogId : undefined}
        onClick={composeHandlers(onClick, () => setOpen((o) => !o))}
        onKeyDown={composeHandlers(onKeyDown, (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        })}
      >
        {(normalizeHex(hex) ?? hex).toUpperCase()}
      </PickerTrigger>
      <FormValue name={name} values={[normalizeHex(hex) ?? hex]} disabled={disabled} />
      <Floating
        ref={panelRef}
        open={open}
        anchorRef={triggerRef}
        placement="bottom-start"
        onDismiss={(reason: DismissReason) => {
          setOpen(false);
          if (reason === 'escape') triggerRef.current?.focus();
        }}
        id={dialogId}
        role="dialog"
        aria-label={labels.dialog}
        className="ui-color-picker-trigger__popover"
      >
        <ColorPicker value={hex} onValueChange={setHex} alpha={alpha} presets={presets} labels={labels} />
      </Floating>
    </>
  );
});
