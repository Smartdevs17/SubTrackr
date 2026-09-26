import { logger, queryLogs, clearLogBuffer, runWithLogContext } from '../logging';

describe('backend logging service', () => {
  beforeEach(() => {
    clearLogBuffer();
    jest.restoreAllMocks();
  });

  it('records structured log entries and includes service/module metadata', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('Service started', { feature: 'billing' });

    const entries = queryLogs({ text: 'Service started' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      message: 'Service started',
      level: 'info',
      service: 'subtrackr-backend',
      module: 'backend',
      meta: { feature: 'billing' },
    });
    expect(entries[0].timestamp).toBeDefined();
    expect(spy).toHaveBeenCalled();
  });

  it('propagates correlation ids across async boundaries', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runWithLogContext('corr-id-123', async () => {
      logger.debug('Async operation started', { userId: 'user-1' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      logger.info('Async operation completed');
    });

    const entries = queryLogs({ correlationId: 'corr-id-123' });
    expect(entries.length).toBe(2);
    expect(entries[0].correlationId).toBe('corr-id-123');
    expect(entries[1].correlationId).toBe('corr-id-123');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('redacts sensitive fields in metadata', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    logger.warn('User data access', {
      userId: 'user-2',
      email: 'jane@doe.com',
      password: 'secret123',
      cardNumber: '4111111111111111',
    });

    const entries = queryLogs({ level: 'warn' });
    expect(entries).toHaveLength(1);
    expect(entries[0].meta).toEqual({
      userId: 'user-2',
      email: '[REDACTED]',
      password: '[REDACTED]',
      cardNumber: '[REDACTED]',
    });
    expect(spy).toHaveBeenCalled();
  });

  it('filters the log buffer by module and text', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('First message', { detail: 'one' });
    const childLogger = logger.child('parser');
    childLogger.error('Parse failed', { line: 42 });

    const entries = queryLogs({ module: 'parser', text: 'Parse failed' });
    expect(entries).toHaveLength(1);
    expect(entries[0].module).toContain('parser');
    expect(entries[0].message).toBe('Parse failed');
    expect(entries[0].meta).toEqual({ line: 42 });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
