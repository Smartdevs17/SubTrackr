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

/**
 * Align a billing date to a specific day of the month.
 * If the target day doesn't exist in the month (e.g., 31st in February),
 * it uses the last day of that month.
 * 
 * @param baseDate - The starting date
 * @param dayOfMonth - Preferred day of month (1-31)
 * @returns Date aligned to the specified day
 */
export function alignBillingToDay(baseDate: Date, dayOfMonth: number): Date {
  if (!dayOfMonth || dayOfMonth < 1 || dayOfMonth > 31) {
    return baseDate;
  }

  const aligned = new Date(baseDate.getTime());
  const currentDay = aligned.getDate();

  // Get the last day of the current month
  const lastDayOfMonth = new Date(aligned.getFullYear(), aligned.getMonth() + 1, 0).getDate();
  
  // Use the minimum of the desired day and the last day of the month
  const targetDay = Math.min(dayOfMonth, lastDayOfMonth);
  
  aligned.setDate(targetDay);

  // If the target day is before the current day, move to next month
  if (targetDay < currentDay) {
    aligned.setMonth(aligned.getMonth() + 1);
    // Recalculate for the new month's constraints
    const newLastDay = new Date(aligned.getFullYear(), aligned.getMonth() + 1, 0).getDate();
    aligned.setDate(Math.min(dayOfMonth, newLastDay));
  }

  return aligned;
}

/**
 * Calculate the next billing date with optional day-of-month alignment.
 * 
 * @param currentDate - Current billing date
 * @param cycle - Billing cycle (monthly, yearly, etc.)
 * @param dayOfMonth - Optional preferred day of month for alignment
 * @returns Next billing date
 */
export function calculateNextBillingDate(
  currentDate: Date,
  cycle: BillingCycle,
  dayOfMonth?: number
): Date {
  const nextDate = advanceBillingDate(currentDate, cycle);
  
  // Apply alignment only for monthly and yearly cycles
  if (dayOfMonth && (cycle === BillingCycle.MONTHLY || cycle === BillingCycle.YEARLY)) {
    return alignBillingToDay(nextDate, dayOfMonth);
  }
  
  return nextDate;
}
