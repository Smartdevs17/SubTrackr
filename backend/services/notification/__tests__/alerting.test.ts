import { AlertingService, createDispatcher } from '../alerting';
import type { Alert, AlertChannelConfig } from '../types';

const makeAlert = (overrides: Partial<Alert> = {}): Alert => ({
  id: 'alert-1',
  severity: 'critical',
  title: 'Test Alert',
  message: 'Something went wrong',
  timestamp: Date.now(),
  resolved: false,
  ruleId: 'test-rule',
  ...overrides,
});

describe('AlertingService', () => {
  it('dispatches to console channel without throwing', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const svc = new AlertingService([{ type: 'console' }]);
    await svc.dispatch(makeAlert());
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('is idempotent — same alert dispatched only once', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const svc = new AlertingService([{ type: 'console' }]);
    const alert = makeAlert();
    await svc.dispatch(alert);
    await svc.dispatch(alert);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('dispatchAll skips resolved alerts', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const svc = new AlertingService([{ type: 'console' }]);
    await svc.dispatchAll([
      makeAlert({ id: 'a1', resolved: false }),
      makeAlert({ id: 'a2', resolved: true }),
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('addChannel adds a new dispatcher', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const svc = new AlertingService([]);
    svc.addChannel({ type: 'console' });
    await svc.dispatch(makeAlert({ id: 'new-alert' }));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('createDispatcher throws when webhookUrl is missing for slack', () => {
    const config: AlertChannelConfig = { type: 'slack' };
    expect(() => createDispatcher(config)).toThrow('webhookUrl required');
  });

  it('createDispatcher throws when webhookUrl is missing for pagerduty', () => {
    const config: AlertChannelConfig = { type: 'pagerduty' };
    expect(() => createDispatcher(config)).toThrow('webhookUrl required');
  });

  it('dispatches to webhook channel (slack) via fetch', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    const svc = new AlertingService([
      { type: 'slack', webhookUrl: 'https://hooks.slack.com/test' },
    ]);
    await svc.dispatch(makeAlert({ id: 'slack-alert' }));

    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('dispatches to webhook channel (pagerduty) via fetch', async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;

    const svc = new AlertingService([
      { type: 'pagerduty', webhookUrl: 'https://events.pagerduty.com/v2/enqueue' },
    ]);
    await svc.dispatch(makeAlert({ id: 'pd-alert' }));

    expect(mockFetch).toHaveBeenCalledWith(
      'https://events.pagerduty.com/v2/enqueue',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
