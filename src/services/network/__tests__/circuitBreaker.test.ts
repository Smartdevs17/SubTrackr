import { CircuitBreaker, CircuitOpenError } from '../circuitBreaker';
import { mobileTracer, MobileTracer } from '../trace';

describe('CircuitBreaker (Frontend)', () => {
  let mockTracer: jest.Mocked<MobileTracer>;

  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    mockTracer = {
      startClientSpan: jest.fn().mockReturnValue({ context: { traceId: 'test-trace' } }),
      endSpan: jest.fn(),
    } as any;
  });

  it('should start in closed state and allow calls', async () => {
    const cb = new CircuitBreaker({ tracer: mockTracer });
    expect(cb.state).toBe('closed');

    const result = await cb.execute(async () => 'success');
    expect(result).toBe('success');
    
    // No state change, no trace for state change
    expect(mockTracer.startClientSpan).not.toHaveBeenCalled();
  });

  it('should trip to open state after consecutive failures and trace transition', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, tracer: mockTracer });

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow('fail');
    }

    expect(cb.state).toBe('open');
    expect(mockTracer.startClientSpan).toHaveBeenCalledWith('CircuitBreaker default state change', {
      'circuit.previous_state': 'closed',
      'circuit.new_state': 'open',
    });

    // Next call should throw CircuitOpenError immediately without calling the action
    const action = jest.fn();
    mockTracer.startClientSpan.mockClear();
    mockTracer.endSpan.mockClear();

    await expect(cb.execute(action)).rejects.toThrow(CircuitOpenError);
    expect(action).not.toHaveBeenCalled();

    // Fast-fail should be traced
    expect(mockTracer.startClientSpan).toHaveBeenCalledWith('CircuitBreaker default fast-fail', {
      'circuit.state': 'open',
    });
    expect(mockTracer.endSpan).toHaveBeenCalled();
  });

  it('should transition to half-open after recovery timeout', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 1000, tracer: mockTracer });

    await expect(cb.execute(async () => {
      throw new Error('fail');
    })).rejects.toThrow('fail');

    expect(cb.state).toBe('open');

    // Advance time by 1000ms
    jest.advanceTimersByTime(1000);

    // Call should now be allowed (half-open)
    const result = await cb.execute(async () => 'success');
    expect(result).toBe('success');
    // But since successThreshold is 2 by default, it should still be half-open
    expect(cb.state).toBe('half-open');

    // Second success should close it
    await cb.execute(async () => 'success2');
    expect(cb.state).toBe('closed');
  });

  it('should trip back to open if a failure occurs while half-open', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 1000, tracer: mockTracer });

    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(cb.state).toBe('open');

    jest.advanceTimersByTime(1000);

    // Now in half-open state, if it fails again, it immediately trips to open
    await expect(cb.execute(async () => { throw new Error('fail2'); })).rejects.toThrow('fail2');
    expect(cb.state).toBe('open');
  });

  it('can be manually reset', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, tracer: mockTracer });
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(cb.state).toBe('open');

    cb.reset();
    expect(cb.state).toBe('closed');
    const result = await cb.execute(async () => 'success');
    expect(result).toBe('success');
  });
});
