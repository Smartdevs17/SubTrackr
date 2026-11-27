import {
  applyAtomicPatch,
  reduceAtomicState,
  resolveAtomicValue,
  type AtomicPatch,
} from '../atomicState';

describe('atomicState utilities', () => {
  interface State {
    query: string;
    page: number;
    tags: string[];
  }

  const initial: State = { query: '', page: 1, tags: [] };

  it('merges every field of a patch into a single new state object', () => {
    const next = applyAtomicPatch(initial, { query: 'netflix', page: 3 });
    expect(next).toEqual({ query: 'netflix', page: 3, tags: [] });
    expect(next).not.toBe(initial);
    expect(initial).toEqual({ query: '', page: 1, tags: [] });
  });

  it('resolves functional patches against the latest state', () => {
    const patch: AtomicPatch<State> = (previous) => ({
      page: previous.page + 1,
      tags: [...previous.tags, 'new'],
    });
    const next = applyAtomicPatch(initial, patch);
    expect(next.page).toBe(2);
    expect(next.tags).toEqual(['new']);
  });

  it('keeps referential equality for no-op patches', () => {
    expect(applyAtomicPatch(initial, {})).toBe(initial);
    expect(applyAtomicPatch(initial, { query: '' })).toBe(initial);
  });

  it('resolves functional setter values without double-applying plain values', () => {
    expect(resolveAtomicValue(5, 1)).toBe(5);
    expect(resolveAtomicValue((previous: number) => previous + 2, 1)).toBe(3);
  });

  it('resets to the captured initial state', () => {
    const changed = applyAtomicPatch(initial, { query: 'spotify' });
    expect(reduceAtomicState(changed, { kind: 'reset' }, initial)).toBe(initial);
  });

  it('dispatches patch actions through the reducer', () => {
    const next = reduceAtomicState(initial, { kind: 'patch', patch: { page: 4 } }, initial);
    expect(next.page).toBe(4);
  });
});
