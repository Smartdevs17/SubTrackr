export type AtomicPatch<T> = Partial<T> | ((previous: T) => Partial<T>);

export function resolveAtomicValue<T>(value: T | ((previous: T) => T), current: T): T {
  return typeof value === 'function' ? (value as (previous: T) => T)(current) : value;
}

export function applyAtomicPatch<T extends object>(state: T, patch: AtomicPatch<T>): T {
  const changes = typeof patch === 'function' ? patch(state) : patch;
  const keys = Object.keys(changes) as Array<keyof T>;
  if (keys.length === 0) return state;

  const hasChange = keys.some((key) => !Object.is(state[key], changes[key]));
  if (!hasChange) return state;

  return { ...state, ...changes };
}

export type AtomicAction<T> =
  | { readonly kind: 'patch'; readonly patch: AtomicPatch<T> }
  | { readonly kind: 'reset' };

export function reduceAtomicState<T extends object>(
  state: T,
  action: AtomicAction<T>,
  initialState: T = state
): T {
  if (action.kind === 'reset') return initialState;
  return applyAtomicPatch(state, action.patch);
}
