import { BulkActionsService, type BulkActionProvider } from '../bulkActions';

function provider(calls: string[], failOn?: string): BulkActionProvider {
  return {
    pause: async (id) => {
      calls.push(`pause:${id}`);
      if (id === failOn) throw new Error('provider rejected action');
    },
    cancel: async (id) => calls.push(`cancel:${id}`),
    rollback: async (action, id) => calls.push(`rollback:${action}:${id}`),
  };
}

describe('BulkActionsService', () => {
  it('commits actions across providers', async () => {
    const calls: string[] = [];
    const result = await new BulkActionsService().execute(
      [
        { provider: 'stripe', subscriptionId: 's1', action: 'pause' },
        { provider: 'stellar', subscriptionId: 's2', action: 'cancel' },
      ],
      new Map([
        ['stripe', provider(calls)],
        ['stellar', provider(calls)],
      ]),
    );
    expect(result.committed).toBe(true);
    expect(calls).toEqual(['pause:s1', 'cancel:s2']);
  });

  it('compensates completed actions when a later provider fails', async () => {
    const calls: string[] = [];
    const result = await new BulkActionsService().execute(
      [
        { provider: 'stripe', subscriptionId: 's1', action: 'pause' },
        { provider: 'stellar', subscriptionId: 's2', action: 'pause' },
      ],
      new Map([
        ['stripe', provider(calls)],
        ['stellar', provider(calls, 's2')],
      ]),
    );
    expect(result.committed).toBe(false);
    expect(result.rolledBack).toHaveLength(1);
    expect(calls).toEqual(['pause:s1', 'pause:s2', 'rollback:pause:s1']);
  });
});
