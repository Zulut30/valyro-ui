import { useId } from '../primitives/react-compat';

export { nextSelection } from '../primitives/selection';

/** The form field name for a group of native inputs: the caller's, or a stable generated one. */
export function useGroupName(name?: string) {
  const generated = useId();
  return name ?? `ui-group-${generated}`;
}
