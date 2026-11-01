/*
 * Which level Detail Dial shows: a controlled id that is unknown or disabled is an error the app must fix; an
 * uncontrolled one falls back to the first available level.
 */

export interface DetailLevelShape {
  id: string;
  disabled?: boolean;
}

export interface ResolvedLevel {
  /** The level to show, or null (only the summary). */
  id: string | null;
  /** The controlled value is unknown or disabled. */
  error: boolean;
}

export function resolveLevel(levels: readonly DetailLevelShape[], value: string | undefined, controlled: boolean): ResolvedLevel {
  const available = levels.filter((level) => !level.disabled);
  if (available.length === 0) return { id: null, error: false };
  if (value !== undefined && available.some((level) => level.id === value)) return { id: value, error: false };
  if (controlled) return { id: null, error: true };
  return { id: available[0].id, error: false };
}
