import { DUNNING_JOB_PRIORITY } from '../../../billing/jobs/dunningJob';
import { PAYMENT_JOB_PRIORITY } from '../../../billing/jobs/paymentConfirmationJob';
import { ANALYTICS_JOB_PRIORITY } from '../../../analytics/jobs/analyticsAggregationJob';
import { MV_REFRESH_JOB_PRIORITY } from '../../../analytics/jobs/mvRefreshJob';
import { NOTIFICATION_JOB_PRIORITY } from '../../../notification/jobs/notificationDeliveryJob';
import { WEBHOOK_JOB_PRIORITY } from '../../../webhook/jobs/webhookDeliveryJob';

describe('job priority assignments', () => {
  it('assigns critical priority to billing jobs', () => {
    expect(PAYMENT_JOB_PRIORITY).toBe('critical');
    expect(DUNNING_JOB_PRIORITY).toBe('critical');
  });

  it('assigns high priority to notification jobs', () => {
    expect(NOTIFICATION_JOB_PRIORITY).toBe('high');
  });

  it('assigns normal priority to webhook jobs', () => {
    expect(WEBHOOK_JOB_PRIORITY).toBe('normal');
  });

  it('assigns low priority to analytics jobs', () => {
    expect(ANALYTICS_JOB_PRIORITY).toBe('low');
    expect(MV_REFRESH_JOB_PRIORITY).toBe('low');
  });
});
