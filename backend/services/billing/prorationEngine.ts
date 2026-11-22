import { BillingCycle } from '../../../src/types/subscription';
import type {
  ProrationCalculationRequest,
  ProrationCalculationResult,
  ProrationBreakdownItem,
  ProrationConfig,
  ProrationMode,
} from '../../../src/types/prorationCalculator';
import { DEFAULT_PRORATION_CONFIG } from '../../../src/types/prorationCalculator';

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export const DAYS_PER_CYCLE: Record<BillingCycle, number> = {
  [BillingCycle.WEEKLY]: 7,
  [BillingCycle.MONTHLY]: 30,
  [BillingCycle.YEARLY]: 365,
  [BillingCycle.ANNUAL]: 365,
  [BillingCycle.CUSTOM]: 30,
};

export type ProrationPrecision = 'day' | 'hour';

export interface ExactProrationInput extends ProrationCalculationRequest {
  precision?: ProrationPrecision;
}

export interface ExactProrationResult extends ProrationCalculationResult {
  precision: ProrationPrecision;
  cycleTotalHours: number;
  hoursUsed: number;
  hoursRemaining: number;
  daysRemainingExact: number;
  daysUsedExact: number;
}

export class ProrationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProrationValidationError';
  }
}

function toMs(value: number | string | Date, fieldName: string): number {
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : value.getTime();
  if (!Number.isFinite(ms)) {
    throw new ProrationValidationError(`${fieldName} must be a valid date`);
  }
  return ms;
}

function roundCents(value: number): number {
  return Math.round((value + Math.sign(value) * 1e-9) * 100) / 100;
}

function roundHours(ms: number): number {
  return roundCents(ms / MS_PER_HOUR);
}

export function validateExactProrationRequest(request: ExactProrationInput): void {
  if (!request.currentPlanId || !request.currentPlanName || !request.newPlanId || !request.newPlanName) {
    throw new ProrationValidationError('plan IDs and names are required');
  }
  if (!(request.currentCycle in DAYS_PER_CYCLE) || !(request.newCycle in DAYS_PER_CYCLE)) {
    throw new ProrationValidationError('currentCycle and newCycle must be supported billing cycles');
  }
  for (const [field, value] of [
    ['currentPrice', request.currentPrice],
    ['newPrice', request.newPrice],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new ProrationValidationError(`${field} must be a non-negative finite number`);
    }
  }
  const startMs = toMs(request.cycleStartDate, 'cycleStartDate');
  const endMs = toMs(request.cycleEndDate, 'cycleEndDate');
  if (endMs <= startMs) {
    throw new ProrationValidationError('cycleEndDate must be after cycleStartDate');
  }
  if (request.effectiveDate !== undefined) {
    toMs(request.effectiveDate, 'effectiveDate');
  }
}

function resolveMode(request: ExactProrationInput): ProrationMode {
  if (request.mode) return request.mode;
  if (request.newPrice > request.currentPrice) return 'upgrade';
  if (request.newPrice < request.currentPrice) return 'downgrade';
  if (request.newCycle !== request.currentCycle) return 'billing_cycle_change';
  return 'upgrade';
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function calculateExactProration(request: ExactProrationInput): ExactProrationResult {
  validateExactProrationRequest(request);

  const config: ProrationConfig = { ...DEFAULT_PRORATION_CONFIG, ...request.config };
  const precision: ProrationPrecision = request.precision ?? 'day';
  const startMs = toMs(request.cycleStartDate, 'cycleStartDate');
  const endMs = toMs(request.cycleEndDate, 'cycleEndDate');
  const requestedEffectiveMs = request.effectiveDate
    ? toMs(request.effectiveDate, 'effectiveDate')
    : Date.now();
  const effectiveMs = Math.max(startMs, Math.min(endMs, requestedEffectiveMs));

  const cycleTotalMs = endMs - startMs;
  const remainingMs = endMs - effectiveMs;
  const usedMs = effectiveMs - startMs;
  const fractionRemaining = remainingMs / cycleTotalMs;

  const newCycleMs = DAYS_PER_CYCLE[request.newCycle] * MS_PER_DAY;
  const fractionNewCycle = Math.min(1, remainingMs / newCycleMs);

  const unusedRaw = request.currentPrice * fractionRemaining;
  const newRaw = request.newPrice * fractionNewCycle;
  const netRaw = newRaw - unusedRaw;
  const isCredit = netRaw < 0;
  const netProratedAmount = roundCents(Math.abs(netRaw));

  const unusedAmount = roundCents(unusedRaw);
  const proratedNewAmount = roundCents(newRaw);
  const taxRaw = config.includeTax ? (netRaw * config.defaultTaxRate) / 100 : 0;
  const taxAmount = roundCents(taxRaw);
  const totalAmountDue = Math.max(0, roundCents(netRaw + taxRaw));
  const mode = resolveMode(request);

  const cycleTotalDays = roundCents(cycleTotalMs / MS_PER_DAY);
  const daysUsedExact = roundCents(usedMs / MS_PER_DAY);
  const daysRemainingExact = roundCents(remainingMs / MS_PER_DAY);
  const hoursUsed = roundHours(usedMs);
  const hoursRemaining = roundHours(remainingMs);
  const cycleTotalHours = roundHours(cycleTotalMs);

  const breakdown: ProrationBreakdownItem[] = [
    {
      id: generateId('item'),
      label: `Unused time on ${request.currentPlanName}`,
      description: `Credit for ${precision === 'hour' ? `${hoursRemaining} hours` : `${daysRemainingExact} days`} of ${precision === 'hour' ? `${cycleTotalHours} hours` : `${cycleTotalDays} days`} remaining`,
      unitPrice: request.currentPrice,
      dailyRate: roundCents(request.currentPrice / cycleTotalDays),
      daysActive: roundCents(daysUsedExact),
      daysRemaining: roundCents(daysRemainingExact),
      totalCycleDays: roundCents(cycleTotalDays),
      amount: unusedAmount,
      isCredit: true,
      type: 'unused_portion',
    },
    {
      id: generateId('item'),
      label: `Prorated charge for ${request.newPlanName}`,
      description: `Charge for ${precision === 'hour' ? `${hoursRemaining} hours` : `${daysRemainingExact} days`} on the new plan`,
      unitPrice: request.newPrice,
      dailyRate: roundCents(request.newPrice / DAYS_PER_CYCLE[request.newCycle]),
      daysActive: 0,
      daysRemaining: roundCents(daysRemainingExact),
      totalCycleDays: DAYS_PER_CYCLE[request.newCycle],
      amount: proratedNewAmount,
      isCredit: false,
      type: 'new_portion',
    },
  ];

  if (taxAmount !== 0) {
    breakdown.push({
      id: generateId('item'),
      label: `Tax (${config.defaultTaxRate}%)`,
      description: 'Tax calculated on the unrounded net proration adjustment',
      unitPrice: taxAmount,
      dailyRate: 0,
      daysActive: 0,
      daysRemaining: roundCents(daysRemainingExact),
      totalCycleDays: roundCents(cycleTotalDays),
      amount: Math.abs(taxAmount),
      isCredit: taxAmount < 0,
      type: 'tax',
    });
  }

  const symbol = config.currency === 'USD' ? '$' : `${config.currency} `;
  const explanationText = isCredit
    ? `Switching from ${request.currentPlanName} to ${request.newPlanName} with ${daysRemainingExact} of ${cycleTotalDays} days remaining. You receive a credit of ${symbol}${unusedAmount.toFixed(2)} for unused time and pay ${symbol}${proratedNewAmount.toFixed(2)} for the new plan. Your account will be credited ${symbol}${netProratedAmount.toFixed(2)}.`
    : `Switching from ${request.currentPlanName} to ${request.newPlanName} with ${daysRemainingExact} of ${cycleTotalDays} days remaining. You are credited ${symbol}${unusedAmount.toFixed(2)} for unused time and charged ${symbol}${proratedNewAmount.toFixed(2)} for the new plan. Your net due today is ${symbol}${netProratedAmount.toFixed(2)}.`;

  return {
    id: generateId('proration'),
    mode,
    currentPlan: {
      id: request.currentPlanId,
      name: request.currentPlanName,
      price: request.currentPrice,
      cycle: request.currentCycle,
      unusedDays: roundCents(daysRemainingExact),
      unusedAmount,
      dailyRate: roundCents(request.currentPrice / cycleTotalDays),
    },
    newPlan: {
      id: request.newPlanId,
      name: request.newPlanName,
      price: request.newPrice,
      cycle: request.newCycle,
      remainingDays: roundCents(daysRemainingExact),
      proratedAmount: proratedNewAmount,
      dailyRate: roundCents(request.newPrice / DAYS_PER_CYCLE[request.newCycle]),
    },
    cycleTotalDays: roundCents(cycleTotalDays),
    daysUsed: roundCents(daysUsedExact),
    daysRemaining: roundCents(daysRemainingExact),
    netProratedAmount,
    taxAmount,
    totalAmountDue,
    isCredit,
    effectiveDate: effectiveMs,
    breakdown,
    explanationText,
    transparencySummary: {
      unusedCreditFromOldPlan: unusedAmount,
      chargeForNewPlan: proratedNewAmount,
      netAdjustment: isCredit ? -netProratedAmount : netProratedAmount,
      taxApplied: taxAmount,
      finalAmountToBillOrCredit: isCredit ? -netProratedAmount : totalAmountDue,
    },
    createdAt: Date.now(),
    precision,
    cycleTotalHours,
    hoursUsed,
    hoursRemaining,
    daysRemainingExact,
    daysUsedExact,
  };
}

export interface NetProrationResult {
  netAmount: number;
  isCredit: boolean;
  adjustments: ExactProrationResult[];
  precision: ProrationPrecision;
}

export function calculateNetProration(
  request: ExactProrationInput,
  priceChanges: Array<{ oldPrice: number; newPrice: number }>,
): NetProrationResult {
  const adjustments = priceChanges.map((change) =>
    calculateExactProration({
      ...request,
      currentPrice: change.oldPrice,
      newPrice: change.newPrice,
    }),
  );
  const netRaw = adjustments.reduce(
    (sum, result) => sum + (result.isCredit ? -result.netProratedAmount : result.netProratedAmount),
    0,
  );

  return {
    netAmount: roundCents(Math.abs(netRaw)),
    isCredit: netRaw < 0,
    adjustments,
    precision: request.precision ?? 'day',
  };
}

export const prorationEngine = { calculateExactProration, calculateNetProration };
