'use client';

import { MonitorIcon, MoonIcon, SunIcon } from '../icons';
import { cx, useControllableState } from '../primitives';
import { withRef } from '../primitives/react-compat';
import type { ColorModeChoice } from '../theme/color-mode';
import { useColorMode } from '../theme/ThemeProvider';
import { SegmentedControl, type SegmentedControlProps } from '../navigation/SegmentedControl';

export interface ColorModeSwitchLabels {
  light: string;
  dark: string;
  system: string;
  /** Accessible name of the group. */
  group: string;
}

export const defaultColorModeSwitchLabels: ColorModeSwitchLabels = { light: 'Light', dark: 'Dark', system: 'System', group: 'Color mode' };

export interface ColorModeSwitchProps
  extends Omit<SegmentedControlProps, 'options' | 'children' | 'value' | 'defaultValue' | 'onValueChange' | 'labels'> {
  /**
   * The chosen mode (controlled). Leave `value` and `defaultValue` out to switch the page's mode: the switch then
   * reads and sets useColorMode (the nearest ThemeProvider saves and paints it).
   */
  value?: ColorModeChoice;
  /** Starts a switch that keeps its own value instead of the page's mode. */
  defaultValue?: ColorModeChoice;
  onValueChange?: (mode: ColorModeChoice) => void;
  /** Modes offered, in order. Default light, dark, system. */
  modes?: readonly ColorModeChoice[];
  /** Icons only; the names stay as accessible names and tooltips. */
  iconOnly?: boolean;
  labels?: Partial<ColorModeSwitchLabels>;
}

const ICONS = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;
const DEFAULT_MODES: readonly ColorModeChoice[] = ['light', 'dark', 'system'];

/**
 * Light / Dark / System as a segmented control. Without `value` it is the page's switch: it shows the saved choice
 * and changes it through useColorMode — saved, applied by ThemeProvider (with its cross-fade) and synced across tabs.
 * Before hydration the choice is unknown, so no segment is selected rather than a wrong one.
 */
export const ColorModeSwitch = withRef(function ColorModeSwitch({
  value: valueProp,
  defaultValue,
  onValueChange,
  modes = DEFAULT_MODES,
  iconOnly = false,
  size = 'sm',
  labels,
  className,
  ...rest
}: ColorModeSwitchProps) {
  const t = { ...defaultColorModeSwitchLabels, ...labels };
  const page = useColorMode();
  const bound = valueProp === undefined && defaultValue === undefined;
  const [own, setOwn] = useControllableState<ColorModeChoice>({ value: valueProp, defaultValue: defaultValue ?? 'system', onChange: onValueChange });
  // Bound to the page: unknown until hydrated (no segment), and `system` shown as the painted mode when not offered.
  const pageValue = page.resolvedMode === undefined ? '' : modes.includes(page.mode) ? page.mode : page.resolvedMode;
  const value = bound ? pageValue : own;

  const select = (next: string) => {
    const mode = next as ColorModeChoice;
    if (!bound) {
      setOwn(mode);
      return;
    }
    page.setMode(mode);
    onValueChange?.(mode);
  };

  return (
    <SegmentedControl
      aria-label={rest['aria-labelledby'] ? undefined : t.group}
      {...rest}
      size={size}
      className={cx('ui-color-mode-switch', className)}
      data-icon-only={iconOnly || undefined}
      // The page's transitions pause during a switch at once; the thumb that made it still glides.
      data-ui-mode-keep-motion=""
      value={value}
      onValueChange={select}
      options={modes.map((mode) => {
        const Icon = ICONS[mode];
        return { value: mode, icon: <Icon size={14} />, label: iconOnly ? undefined : t[mode], ariaLabel: iconOnly ? t[mode] : undefined };
      })}
    />
  );
});
