import { by, device, element, expect, waitFor } from 'detox';

const BILLING_LABELS: Record<'monthly' | 'yearly' | 'weekly', string> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
  weekly: 'Weekly',
};

export const launchCleanApp = async () => {
  await device.launchApp({ newInstance: true, delete: true });
  await waitFor(element(by.id('app-root')))
    .toExist()
    .withTimeout(30000);
  await waitFor(element(by.id('home-screen')))
    .toExist()
    .withTimeout(30000);
};

export const createSubscription = async (
  name: string,
  price: string,
  cycle: 'monthly' | 'yearly' | 'weekly' = 'monthly'
) => {
  await element(by.id('add-subscription-button')).tap();
  await waitFor(element(by.id('add-subscription-screen')))
    .toBeVisible()
    .withTimeout(10000);
  await expect(element(by.id('subscription-form-title'))).toBeVisible();

  await element(by.id('subscription-name-input')).replaceText(name);
  await element(by.id('subscription-price-input')).replaceText(price);

  if (cycle !== 'monthly') {
    await element(by.id(`billing-cycle-option-${cycle}`)).tap();
  }

  await element(by.id('save-subscription-button')).tap();
  await dismissAnySystemAlert();

  await waitFor(element(by.text(name)))
    .toBeVisible()
    .withTimeout(15000);
};

export const openSubscriptionByName = async (name: string) => {
  await waitFor(element(by.text(name)))
    .toBeVisible()
    .withTimeout(10000);
  await element(by.text(name)).tap();
  await waitFor(element(by.id('subscription-detail-screen')))
    .toBeVisible()
    .withTimeout(10000);
};

export const expectBillingCycle = async (cycle: 'monthly' | 'yearly' | 'weekly') => {
  await expect(element(by.id('subscription-billing-cycle-value'))).toHaveText(
    BILLING_LABELS[cycle]
  );
};

export const dismissAnySystemAlert = async () => {
  const labels = ['OK', 'Ok', 'Later', 'Cancel'];
  for (const label of labels) {
    const alertButton = element(by.text(label));
    try {
      await waitFor(alertButton).toBeVisible().withTimeout(600);
      await alertButton.tap();
      return;
    } catch {
      // No-op: button not present.
    }
  }
};
