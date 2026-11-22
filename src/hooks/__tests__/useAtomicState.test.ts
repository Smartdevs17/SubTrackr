import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useAtomicState, type AtomicStateResult } from '../useAtomicState';

interface State {
  query: string;
  page: number;
}

const INITIAL: State = { query: '', page: 1 };

describe('useAtomicState', () => {
  let renderer: ReactTestRenderer;
  let current: AtomicStateResult<State>;
  let renderCount: number;

  function Probe() {
    current = useAtomicState(INITIAL);
    renderCount++;
    return null;
  }

  beforeEach(() => {
    renderCount = 0;
    act(() => {
      renderer = create(createElement(Probe));
    });
  });

  afterEach(() => {
    act(() => renderer.unmount());
  });

  it('commits multiple field changes as one render', () => {
    const rendersBeforePatch = renderCount;
    act(() => {
      current[1]({ query: 'netflix', page: 4 });
    });
    expect(current[0]).toEqual({ query: 'netflix', page: 4 });
    expect(renderCount).toBe(rendersBeforePatch + 1);
  });

  it('supports functional patches based on the latest state', () => {
    act(() => current[1]({ page: 2 }));
    act(() => current[1]((previous) => ({ page: previous.page + 3 })));
    expect(current[0].page).toBe(5);
  });

  it('does not re-render for no-op patches', () => {
    const rendersBeforePatch = renderCount;
    act(() => current[1]({ query: '' }));
    expect(renderCount).toBe(rendersBeforePatch);
  });

  it('resets all fields with a stable reset callback', () => {
    const reset = current[2];
    act(() => current[1]({ query: 'spotify', page: 9 }));
    act(() => current[2]());
    expect(current[0]).toBe(INITIAL);
    expect(current[2]).toBe(reset);
  });
});
