import { createJobQueueSystem } from '../queueFactory';
import { DEFAULT_PRIORITY_WEIGHTS } from '../types';

describe('createJobQueueSystem', () => {
  it('wires all four priority queues to a WFQ scheduler', async () => {
    const { scheduler, queues } = createJobQueueSystem({
      connection: { host: 'localhost', port: 6379 },
      baseQueueName: 'test',
      maxQueueSize: 50,
    });

    expect(queues.critical.priority).toBe('critical');
    expect(queues.high.priority).toBe('high');
    expect(queues.normal.priority).toBe('normal');
    expect(queues.low.priority).toBe('low');

    await scheduler.enqueue('critical', 'pay', { id: '1' });
    await scheduler.enqueue('low', 'analytics', { id: '2' });

    const snapshot = scheduler.getSnapshot();
    expect(snapshot.effectiveWeights.critical).toBeGreaterThan(snapshot.effectiveWeights.low);

    const next = await scheduler.scheduleNext();
    expect(next?.priority).toBe('critical');

    expect(DEFAULT_PRIORITY_WEIGHTS.critical).toBe(50);
  });
});
