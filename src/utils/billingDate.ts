import { BillingCycle } from '../types/subscription';

/** Advance `from` by one billing period (used after a successful renewal). */
export function advanceBillingDate(from: Date, cycle: BillingCycle): Date {
  const d = new Date(from.getTime());
  switch (cycle) {
    case BillingCycle.WEEKLY:
      d.setDate(d.getDate() + 7);
      break;
    case BillingCycle.MONTHLY:
      d.setMonth(d.getMonth() + 1);
      break;
    case BillingCycle.YEARLY:
      d.setFullYear(d.getFullYear() + 1);
      break;
    case BillingCycle.CUSTOM:
    default:
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}
