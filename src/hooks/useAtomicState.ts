import { useCallback, useReducer } from 'react';
import {
  applyAtomicPatch,
  reduceAtomicState,
  resolveAtomicValue,
  type AtomicAction,
  type AtomicPatch,
} from '../utils/atomicState';

export type PatchAtomicState<T extends object> = (patch: AtomicPatch<T>) => void;
export type ResetAtomicState = () => void;
export type AtomicStateResult<T extends object> = readonly [
  T,
  PatchAtomicState<T>,
  ResetAtomicState,
];

export function useAtomicState<T extends object>(initialState: T): AtomicStateResult<T> {
  const [state, dispatch] = useReducer(
    (current: T, action: AtomicAction<T>) => reduceAtomicState(current, action, initialState),
    initialState
  );

  const patch = useCallback(
    (value: AtomicPatch<T>) => dispatch({ kind: 'patch', patch: value }),
    []
  );
  const reset = useCallback(() => dispatch({ kind: 'reset' }), []);

  return [state, patch, reset] as const;
}

export { applyAtomicPatch, resolveAtomicValue };
export type { AtomicPatch };
