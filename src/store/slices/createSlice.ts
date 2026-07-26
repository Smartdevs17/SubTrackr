import type { StateCreator } from 'zustand/vanilla';
import { combine } from 'zustand/middleware';
import type { SliceDefinition } from './types';

export function composeSlices<S extends Record<string, unknown>>(
  sliceDefinitions: SliceDefinition<any>[],
  initialState: Partial<S> = {}
): StateCreator<S, [], [], S> {
  return combine(initialState as S, (set, get) => {
    const result: Record<string, unknown> = {};
    for (const def of sliceDefinitions) {
      const slice = def.creator(set, get);
      for (const [key, value] of Object.entries(slice)) {
        result[key] = value;
      }
    }
    return result as S;
  });
}

export function defineSlice<T extends Record<string, unknown>>(
  name: string,
  initialState: Partial<T>,
  creator: (set: Function, get: Function) => Record<string, unknown>
): SliceDefinition<T> {
  return { name, initialState, creator };
}
