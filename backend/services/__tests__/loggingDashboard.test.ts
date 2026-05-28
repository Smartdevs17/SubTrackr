import { clearLogBuffer, logger } from '../logging';
import { getLogDashboard } from '../loggingDashboard';

describe('logging dashboard service', () => {
  beforeEach(() => {
    clearLogBuffer();
    jest.restoreAllMocks();
  });

  it('returns filtered log entries and total count', () => {
    logger.info('First entry', { feature: 'dashboard' });
    logger.error('Second entry', { feature: 'dashboard', error: 'boom' });
    logger.debug('Debug entry', { feature: 'dashboard' });

    const result = getLogDashboard({ level: 'error' }, 20);

    expect(result.total).toBe(1);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      level: 'error',
      message: 'Second entry',
      meta: { feature: 'dashboard', error: 'boom' },
    });
  });
});
