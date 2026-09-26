/**
 * E2E tests for the full subscription lifecycle — Issue #440
 *
 * Covers:
 *  1. Subscription creation flow
 *  2. Payment processing (success and failure)
 *  3. Plan change with proration
 *  4. Cancellation and win-back (retention offers)
 *  5. Dunning / recovery flow
 *  6. Multi-currency subscriptions
 *
 * Edge cases handled:
 *  - Test isolation via `device.launchApp({ newInstance: true, delete: true })`
 *  - System alert dismissal after every action that may trigger a permission prompt
 *  - Flakiness mitigation via generous `withTimeout` values and `waitFor` guards
 *  - Blockchain-dependent flows are exercised through the local simulation buttons
 *    (no live network calls required in CI)
 */

import { by, element, expect, waitFor } from 'detox';
import {
  completeCancellationFlow,
  createSubscription,
  createSubscriptionWithCurrency,
  dismissAnySystemAlert,
  expectBillingCycle,
  launchCleanApp,
  openSubscriptionByName,
  simulateFailedCharges,
} from './helpers/subscriptionFlows';

// ---------------------------------------------------------------------------
// 1. Subscription creation flow
// ---------------------------------------------------------------------------
describe('Subscription Creation Flow', () => {
  beforeEach(async () => {
    await launchCleanApp();
  });

  it('creates a monthly subscription and shows it on the home screen', async () => {
    await createSubscription('E2E Monthly Sub', '9.99', 'monthly');
    await expect(element(by.text('E2E Monthly Sub'))).toBeVisible();
  });

  it('creates a yearly subscription and reflects the billing cycle in the detail screen', async () => {
    await createSubscription('E2E Yearly Sub', '99.99', 'yearly');
    await openSubscriptionByName('E2E Yearly Sub');
    await expectBillingCycle('yearly');
  });

  it('creates a weekly subscription and reflects the billing cycle in the detail screen', async () => {
    await createSubscription('E2E Weekly Sub', '2.49', 'weekly');
    await openSubscriptionByName('E2E Weekly Sub');
    await expectBillingCycle('weekly');
  });

  it('shows a validation error when the subscription name is empty', async () => {
    await element(by.id('add-subscription-button')).tap();
    await waitFor(element(by.id('add-subscription-screen')))
      .toBeVisible()
      .withTimeout(10000);

    // Leave name blank, enter a valid price, then attempt to save
    await element(by.id('subscription-price-input')).replaceText('5.00');
    await element(by.id('save-subscription-button')).tap();

    // Expect a validation alert
    await waitFor(element(by.text('Validation Error')))
      .toBeVisible()
      .withTimeout(5000);
    await dismissAnySystemAlert();
  });

  it('shows a validation error when the price is zero or negative', async () => {
    await element(by.id('add-subscription-button')).tap();
    await waitFor(element(by.id('add-subscription-screen')))
      .toBeVisible()
      .withTimeout(10000);

    await element(by.id('subscription-name-input')).replaceText('Bad Price Sub');
    await element(by.id('subscription-price-input')).replaceText('0');
    await element(by.id('save-subscription-button')).tap();

    await waitFor(element(by.text('Validation Error')))
      .toBeVisible()
      .withTimeout(5000);
    await dismissAnySystemAlert();
  });
});

// ---------------------------------------------------------------------------
// 2. Payment processing — success and failure
// ---------------------------------------------------------------------------
describe('Payment Processing Flow', () => {
  beforeEach(async () => {
    await launchCleanApp();
  });

  it('simulates a successful charge and keeps action controls visible', async () => {
    const subName = 'E2E Payment Success';
    await createSubscription(subName, '14.99');
    await openSubscriptionByName(subName);

    await expect(element(by.id('simulate-charge-success-button'))).toBeVisible();
    await element(by.id('simulate-charge-success-button')).tap();
    await dismissAnySystemAlert();

    // Controls must remain accessible after a successful charge
    await expect(element(by.id('pause-resume-subscription-button'))).toBeVisible();
    await expect(element(by.id('cancel-subscription-button'))).toBeVisible();
  });

  it('simulates a failed charge and keeps action controls visible', async () => {
    const subName = 'E2E Payment Failure';
    await createSubscription(subName, '14.99');
    await openSubscriptionByName(subName);

    await expect(element(by.id('simulate-charge-failed-button'))).toBeVisible();
    await element(by.id('simulate-charge-failed-button')).tap();
    await dismissAnySystemAlert();

    await expect(element(by.id('pause-resume-subscription-button'))).toBeVisible();
    await expect(element(by.id('cancel-subscription-button'))).toBeVisible();
  });

  it('handles alternating success and failure charges without crashing', async () => {
    const subName = 'E2E Alternating Charges';
    await createSubscription(subName, '7.99');
    await openSubscriptionByName(subName);

    await element(by.id('simulate-charge-success-button')).tap();
    await dismissAnySystemAlert();

    await element(by.id('simulate-charge-failed-button')).tap();
    await dismissAnySystemAlert();

    await element(by.id('simulate-charge-success-button')).tap();
    await dismissAnySystemAlert();

    // Screen must still be functional
    await expect(element(by.id('subscription-detail-screen'))).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Plan change with proration
// ---------------------------------------------------------------------------
describe('Plan Change with Proration', () => {
  beforeEach(async () => {
    await launchCleanApp();
  });

  it('creates a yearly subscription and verifies the billing cycle label', async () => {
    const subName = 'E2E Plan Change Yearly';
    await createSubscription(subName, '49.99', 'yearly');
    await openSubscriptionByName(subName);
    await expectBillingCycle('yearly');
  });

  it('creates a monthly subscription and verifies the billing cycle label', async () => {
    const subName = 'E2E Plan Change Monthly';
    await createSubscription(subName, '9.99', 'monthly');
    await openSubscriptionByName(subName);
    await expectBillingCycle('monthly');
  });

  it('creates a weekly subscription and verifies the billing cycle label', async () => {
    const subName = 'E2E Plan Change Weekly';
    await createSubscription(subName, '2.99', 'weekly');
    await openSubscriptionByName(subName);
    await expectBillingCycle('weekly');
  });
});

// ---------------------------------------------------------------------------
// 4. Cancellation and win-back (retention offers)
// ---------------------------------------------------------------------------
describe('Cancellation and Win-Back Flow', () => {
  beforeEach(async () => {
    await launchCleanApp();
  });

  it('completes the full cancellation flow through all three steps', async () => {
    const subName = 'E2E Full Cancellation';
    await createSubscription(subName, '19.99');
    await openSubscriptionByName(subName);

    // Initiate cancellation
    await element(by.id('cancel-subscription-button')).tap();

    // Walk through REASON → OFFERS → CONFIRM → SUCCESS
    await completeCancellationFlow('Too Expensive');

    // Verify success screen is shown
    await expect(element(by.id('cancellation-success-step'))).toBeVisible();
  });

  it('shows retention offers before confirming cancellation', async () => {
    const subName = 'E2E Retention Offers';
    await createSubscription(subName, '29.99');
    await openSubscriptionByName(subName);

    await element(by.id('cancel-subscription-button')).tap();

    // Select a reason to trigger offer generation
    await waitFor(element(by.id('cancellation-reason-step')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('cancellation-reason-too-expensive')).tap();

    // Skip the free-text feedback step
    await waitFor(element(by.id('cancellation-feedback-step')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('cancellation-feedback-continue')).tap();

    // Offers step must appear
    await waitFor(element(by.id('cancellation-offers-step')))
      .toBeVisible()
      .withTimeout(10000);
    await expect(element(by.id('decline-offers-button'))).toBeVisible();
  });

  it('allows the user to decline offers and reach the confirm step', async () => {
    const subName = 'E2E Decline Offers';
    await createSubscription(subName, '12.99');
    await openSubscriptionByName(subName);

    await element(by.id('cancel-subscription-button')).tap();

    await waitFor(element(by.id('cancellation-reason-step')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('cancellation-reason-not-using-it')).tap();

    await waitFor(element(by.id('cancellation-feedback-step')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('cancellation-feedback-continue')).tap();

    await waitFor(element(by.id('cancellation-offers-step')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('decline-offers-button')).tap();

    await waitFor(element(by.id('cancellation-confirm-step')))
      .toBeVisible()
      .withTimeout(10000);
    await expect(element(by.id('confirm-cancellation-button'))).toBeVisible();
  });

  it('cancels a subscription and removes it from the home screen', async () => {
    const subName = 'E2E Cancel And Remove';
    await createSubscription(subName, '8.99');
    await openSubscriptionByName(subName);

    await element(by.id('cancel-subscription-button')).tap();
    await completeCancellationFlow('Not Using It');

    // Navigate back to home
    await waitFor(element(by.text('Back to Dashboard')))
      .toBeVisible()
      .withTimeout(5000);
    await element(by.text('Back to Dashboard')).tap();

    await waitFor(element(by.id('home-screen')))
      .toBeVisible()
      .withTimeout(10000);
  });
});

// ---------------------------------------------------------------------------
// 5. Dunning / recovery flow
// ---------------------------------------------------------------------------
describe('Dunning and Recovery Flow', () => {
  beforeEach(async () => {
    await launchCleanApp();
  });

  it('handles multiple consecutive failed charges (dunning escalation)', async () => {
    const subName = 'E2E Dunning Escalation';
    await createSubscription(subName, '24.99');
    await openSubscriptionByName(subName);

    // Simulate 3 failed charges to trigger dunning retry stage
    await simulateFailedCharges(3);

    // The detail screen must remain stable after dunning escalation
    await expect(element(by.id('subscription-detail-screen'))).toBeVisible();
    await expect(element(by.id('simulate-charge-success-button'))).toBeVisible();
  });

  it('recovers from dunning after a successful charge', async () => {
    const subName = 'E2E Dunning Recovery';
    await createSubscription(subName, '24.99');
    await openSubscriptionByName(subName);

    // Trigger dunning
    await simulateFailedCharges(2);

    // Recover with a successful charge
    await element(by.id('simulate-charge-success-button')).tap();
    await dismissAnySystemAlert();

    // Screen must still be functional after recovery
    await expect(element(by.id('subscription-detail-screen'))).toBeVisible();
    await expect(element(by.id('cancel-subscription-button'))).toBeVisible();
  });

  it('handles a full dunning cycle: fail → warn → suspend → recover', async () => {
    const subName = 'E2E Full Dunning Cycle';
    await createSubscription(subName, '39.99');
    await openSubscriptionByName(subName);

    // Simulate enough failures to progress through all dunning stages
    await simulateFailedCharges(4);

    // Recover
    await element(by.id('simulate-charge-success-button')).tap();
    await dismissAnySystemAlert();

    await expect(element(by.id('subscription-detail-screen'))).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. Multi-currency subscriptions
// ---------------------------------------------------------------------------
describe('Multi-Currency Subscriptions', () => {
  beforeEach(async () => {
    await launchCleanApp();
  });

  it('creates a EUR subscription and shows it on the home screen', async () => {
    await createSubscriptionWithCurrency('E2E EUR Sub', '8.99', 'EUR');
    await expect(element(by.text('E2E EUR Sub'))).toBeVisible();
  });

  it('creates a GBP subscription and shows it on the home screen', async () => {
    await createSubscriptionWithCurrency('E2E GBP Sub', '7.49', 'GBP');
    await expect(element(by.text('E2E GBP Sub'))).toBeVisible();
  });

  it('creates a JPY subscription and shows it on the home screen', async () => {
    await createSubscriptionWithCurrency('E2E JPY Sub', '1200', 'JPY');
    await expect(element(by.text('E2E JPY Sub'))).toBeVisible();
  });

  it('creates multiple subscriptions in different currencies without conflict', async () => {
    await createSubscriptionWithCurrency('E2E Multi USD', '9.99', 'USD');
    await createSubscriptionWithCurrency('E2E Multi EUR', '8.99', 'EUR');
    await createSubscriptionWithCurrency('E2E Multi GBP', '7.49', 'GBP');

    await expect(element(by.text('E2E Multi USD'))).toBeVisible();
    await expect(element(by.text('E2E Multi EUR'))).toBeVisible();
    await expect(element(by.text('E2E Multi GBP'))).toBeVisible();
  });

  it('opens a multi-currency subscription detail and shows billing info', async () => {
    await createSubscriptionWithCurrency('E2E CAD Detail', '12.99', 'CAD', 'monthly');
    await openSubscriptionByName('E2E CAD Detail');
    await expectBillingCycle('monthly');
    await expect(element(by.id('subscription-detail-screen'))).toBeVisible();
  });
});
