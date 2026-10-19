import { useId } from '../primitives/react-compat';

/** A string[] selection: toggles a value in `multiple` mode, replaces it in `single` mode. */
export function nextSelection(current: readonly string[], value: string, mode: 'single' | 'multiple', checked: boolean): string[] {
  if (mode === 'single') return checked ? [value] : current.filter((v) => v !== value);
  if (checked) return current.includes(value) ? [...current] : [...current, value];
  return current.filter((v) => v !== value);
}

/** The form field name for a group of native inputs: the caller's, or a stable generated one. */
export function useGroupName(name?: string) {
  const generated = useId();
  return name ?? `ui-group-${generated}`;
}
