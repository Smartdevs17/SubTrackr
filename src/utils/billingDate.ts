import { BillingCycle } from '../types/subscription';

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);

  const daysInTargetMonth = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();
  result.setDate(Math.min(day, daysInTargetMonth));

  return result;
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  const month = result.getMonth();
  const day = result.getDate();

  result.setDate(1);
  result.setFullYear(result.getFullYear() + years);
  result.setMonth(month);

  const daysInTargetMonth = new Date(
    result.getFullYear(),
    month + 1,
    0
  ).getDate();
  result.setDate(Math.min(day, daysInTargetMonth));

  return result;
}

/** Advance `from` by one billing period (used after a successful renewal). */
export function advanceBillingDate(from: Date, cycle: BillingCycle): Date {
  const d = new Date(from.getTime());
  switch (cycle) {
    case BillingCycle.WEEKLY:
      d.setDate(d.getDate() + 7);
      break;
    case BillingCycle.MONTHLY:
      return addMonths(d, 1);
    case BillingCycle.YEARLY:
      return addYears(d, 1);
    case BillingCycle.CUSTOM:
    default:
      return addMonths(d, 1);
  }
  return d;
}
