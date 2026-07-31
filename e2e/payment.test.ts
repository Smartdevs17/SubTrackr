import { by } from 'detox';
import {
  createSubscription,
  launchSeededApp,
  openSubscriptionByName,
} from './helpers/subscriptionFlows';
import { expectVisible, tapWhenReady } from './helpers/waits';
import { fixtures } from './helpers/testData';

describe('Subscription Charging Flow E2E', () => {
  beforeEach(async () => {
    // Deterministic charge responses: success then a controlled failure, served
    // by the mock network layer rather than a live billing backend.
    await launchSeededApp(fixtures.empty, { scenario: 'charge-failure' });
  });

  it('simulates successful and failed billing events', async () => {
    const subName = 'E2E Charge Flow';
    await createSubscription(subName, '11.99');
    await openSubscriptionByName(subName);

    await tapWhenReady(by.id('simulate-charge-success-button'));
    await tapWhenReady(by.id('simulate-charge-failed-button'));

    // Validate action controls still available after charging operations.
    await expectVisible(by.id('cancel-subscription-button'));
    await expectVisible(by.id('pause-resume-subscription-button'));
  });
});
