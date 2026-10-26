import { CircuitBreaker, CircuitOpenError } from '../circuitBreaker';

describe('CircuitBreaker (Backend)', () => {
  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('should start in closed state and allow calls', async () => {
    const cb = new CircuitBreaker();
    expect(cb.state).toBe('closed');

    const result = await cb.execute(async () => 'success');
    expect(result).toBe('success');
  });

  it('should trip to open state after consecutive failures', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });

    // Fail 3 times
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow('fail');
    }

    expect(cb.state).toBe('open');

    // Next call should throw CircuitOpenError immediately without calling the action
    const action = jest.fn();
    await expect(cb.execute(action)).rejects.toThrow(CircuitOpenError);
    expect(action).not.toHaveBeenCalled();
  });

  it('should transition to half-open after recovery timeout', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 1000 });

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
    const cb = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 1000 });

    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(cb.state).toBe('open');

    jest.advanceTimersByTime(1000);

    // Now in half-open state, if it fails again, it immediately trips to open
    await expect(cb.execute(async () => { throw new Error('fail2'); })).rejects.toThrow('fail2');
    expect(cb.state).toBe('open');
  });

  it('should reset consecutive failures on success', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });

    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    
    // Success resets counter
    await cb.execute(async () => 'success');

    // It should now take 3 more failures to trip
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(cb.state).toBe('closed');
    
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(cb.state).toBe('open');
  });

  it('can be manually reset', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
    expect(cb.state).toBe('open');

    cb.reset();
    expect(cb.state).toBe('closed');
    const result = await cb.execute(async () => 'success');
    expect(result).toBe('success');
  });
});
