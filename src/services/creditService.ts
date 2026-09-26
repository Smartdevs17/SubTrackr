import type {
  CreditAccountState,
  CreditApplicationInput,
  CreditApplicationResult,
  CreditExpirationResult,
  CreditInvoiceApplication,
  CreditLedgerEntry,
  CreditLot,
  CreditPolicy,
  CreditPurchaseInput,
  CreditTransferInput,
} from '../types/credit';

const DEFAULT_POLICY: CreditPolicy = {
  expirationDays: 365,
  transferable: true,
  autoApplyToUpcomingInvoices: true,
  allowPartialApplication: true,
};

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

function toValidDate(value: unknown, fallback: Date | null = null): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

export function normalizeCreditPolicy(policy?: Partial<CreditPolicy>): CreditPolicy {
  return {
    expirationDays: Math.max(
      0,
      Math.floor(policy?.expirationDays ?? DEFAULT_POLICY.expirationDays)
    ),
    transferable: policy?.transferable ?? DEFAULT_POLICY.transferable,
    autoApplyToUpcomingInvoices:
      policy?.autoApplyToUpcomingInvoices ?? DEFAULT_POLICY.autoApplyToUpcomingInvoices,
    allowPartialApplication:
      policy?.allowPartialApplication ?? DEFAULT_POLICY.allowPartialApplication,
  };
}

export function buildCreditAccount(
  accountId: string,
  currency = 'USD',
  policy?: Partial<CreditPolicy>
): CreditAccountState {
  return {
    accountId,
    currency,
    balance: 0,
    runningTotal: 0,
    totalPurchased: 0,
    totalApplied: 0,
    totalExpired: 0,
    totalTransferredIn: 0,
    totalTransferredOut: 0,
    revision: 0,
    policy: normalizeCreditPolicy(policy),
    lots: [],
    ledger: [],
    applications: [],
    nextExpirationAt: null,
  };
}

export function normalizeCreditAccount(raw: Partial<CreditAccountState>): CreditAccountState {
  const account = buildCreditAccount(raw.accountId ?? `account-${Date.now()}`, raw.currency);
  const lots = Array.isArray(raw.lots)
    ? raw.lots.map(
        (lot): CreditLot => ({
          id: lot.id,
          amountRemaining: Number.isFinite(lot.amountRemaining)
            ? (lot.amountRemaining as number)
            : 0,
          originalAmount: Number.isFinite(lot.originalAmount) ? (lot.originalAmount as number) : 0,
          createdAt: toValidDate(lot.createdAt, new Date()) ?? new Date(),
          expiresAt: toValidDate(lot.expiresAt, null),
          paymentMethod: lot.paymentMethod ?? 'manual',
          reference: lot.reference,
          note: lot.note,
        })
      )
    : [];
  const ledger = Array.isArray(raw.ledger)
    ? raw.ledger.map(
        (entry): CreditLedgerEntry => ({
          ...entry,
          createdAt: toValidDate(entry.createdAt, new Date()) ?? new Date(),
          expiresAt: toValidDate(entry.expiresAt, null),
        })
      )
    : [];
  const applications = Array.isArray(raw.applications)
    ? raw.applications.map(
        (entry): CreditInvoiceApplication => ({
          ...entry,
          createdAt: toValidDate(entry.createdAt, new Date()) ?? new Date(),
        })
      )
    : [];

  const runningTotal = ledger.length
    ? ledger[ledger.length - 1].balanceAfter
    : (raw.runningTotal ?? 0);
  const balance = Number.isFinite(raw.balance) ? (raw.balance as number) : runningTotal;

  return {
    ...account,
    accountId: raw.accountId ?? account.accountId,
    currency: raw.currency ?? account.currency,
    balance,
    runningTotal,
    totalPurchased: Number.isFinite(raw.totalPurchased) ? (raw.totalPurchased as number) : 0,
    totalApplied: Number.isFinite(raw.totalApplied) ? (raw.totalApplied as number) : 0,
    totalExpired: Number.isFinite(raw.totalExpired) ? (raw.totalExpired as number) : 0,
    totalTransferredIn: Number.isFinite(raw.totalTransferredIn)
      ? (raw.totalTransferredIn as number)
      : 0,
    totalTransferredOut: Number.isFinite(raw.totalTransferredOut)
      ? (raw.totalTransferredOut as number)
      : 0,
    revision: Number.isFinite(raw.revision)
      ? (raw.revision as number)
      : ledger.length + applications.length,
    policy: normalizeCreditPolicy(raw.policy),
    lots,
    ledger,
    applications,
    nextExpirationAt: toValidDate(raw.nextExpirationAt, null),
  };
}

function resolveNextExpiration(lots: CreditLot[]): Date | null {
  const next = lots
    .filter((lot) => lot.amountRemaining > 0 && lot.expiresAt)
    .map((lot) => lot.expiresAt as Date)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return next ?? null;
}

function appendLedgerEntry(
  account: CreditAccountState,
  entry: Omit<CreditLedgerEntry, 'runningTotal' | 'balanceAfter' | 'id' | 'createdAt'>
): CreditAccountState {
  const createdAt = new Date();
  const nextBalance = Math.max(0, account.balance + entry.amount);
  const ledgerEntry: CreditLedgerEntry = {
    ...entry,
    id: generateId('credit-ledger'),
    createdAt,
    balanceAfter: nextBalance,
    runningTotal: nextBalance,
  };

  return {
    ...account,
    balance: nextBalance,
    runningTotal: nextBalance,
    revision: account.revision + 1,
    ledger: [...account.ledger, ledgerEntry],
  };
}

function rebuildDerivedState(account: CreditAccountState): CreditAccountState {
  return {
    ...account,
    nextExpirationAt: resolveNextExpiration(account.lots),
  };
}

export function purchaseCredit(
  account: CreditAccountState,
  input: CreditPurchaseInput
): CreditAccountState {
  if (account.revision !== (input.expectedRevision ?? account.revision)) {
    throw new Error('Credit balance changed. Refresh before purchasing again.');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Credit purchase amount must be positive.');
  }

  const expiresAt =
    input.expiresAt ??
    (account.policy.expirationDays > 0
      ? new Date(Date.now() + account.policy.expirationDays * 24 * 60 * 60 * 1000)
      : null);

  const lot: CreditLot = {
    id: generateId('credit-lot'),
    amountRemaining: input.amount,
    originalAmount: input.amount,
    createdAt: new Date(),
    expiresAt,
    paymentMethod: input.paymentMethod,
    reference: input.reference,
    note: input.note,
  };

  const nextAccount = appendLedgerEntry(account, {
    accountId: account.accountId,
    type: 'purchase',
    amount: input.amount,
    currency: input.currency ?? account.currency,
    paymentMethod: input.paymentMethod,
    subscriptionId: input.subscriptionId,
    invoiceId: input.invoiceId,
    reference: input.reference,
    note: input.note,
    expiresAt,
  });

  return rebuildDerivedState({
    ...nextAccount,
    totalPurchased: account.totalPurchased + input.amount,
    lots: [...account.lots, lot],
  });
}

export function transferCredit(
  source: CreditAccountState,
  target: CreditAccountState,
  input: CreditTransferInput
): { source: CreditAccountState; target: CreditAccountState } {
  if (source.revision !== (input.expectedRevision ?? source.revision)) {
    throw new Error('Credit balance changed. Refresh before transferring again.');
  }
  if (!source.policy.transferable) {
    throw new Error('This account does not allow credit transfers.');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Transfer amount must be positive.');
  }
  if (source.balance < input.amount) {
    throw new Error('Insufficient credit balance.');
  }

  const transferOut = appendLedgerEntry(source, {
    accountId: source.accountId,
    type: 'transfer_out',
    amount: -input.amount,
    currency: input.currency ?? source.currency,
    relatedAccountId: target.accountId,
    reference: input.reference,
    note: input.note,
  });

  const transferIn = appendLedgerEntry(target, {
    accountId: target.accountId,
    type: 'transfer_in',
    amount: input.amount,
    currency: input.currency ?? target.currency,
    relatedAccountId: source.accountId,
    reference: input.reference,
    note: input.note,
  });

  let remaining = input.amount;
  const nextSourceUpdatedLots = source.lots.map((lot) => {
    if (remaining <= 0 || lot.amountRemaining <= 0) return lot;
    const consumed = Math.min(lot.amountRemaining, remaining);
    remaining -= consumed;
    return {
      ...lot,
      amountRemaining: lot.amountRemaining - consumed,
    };
  });

  const newTargetLots: CreditLot[] = [];
  let transferRemaining = input.amount;
  for (const lot of source.lots) {
    if (transferRemaining <= 0) break;
    if (lot.amountRemaining <= 0) continue;
    const consumed = Math.min(lot.amountRemaining, transferRemaining);
    transferRemaining -= consumed;
    newTargetLots.push({
      id: generateId('credit-lot'),
      amountRemaining: consumed,
      originalAmount: consumed,
      createdAt: new Date(),
      expiresAt: lot.expiresAt,
      paymentMethod: lot.paymentMethod,
      reference: input.reference ?? lot.reference,
      note: input.note ?? lot.note,
    });
  }

  const nextSource = rebuildDerivedState({
    ...transferOut,
    totalTransferredOut: source.totalTransferredOut + input.amount,
    lots: nextSourceUpdatedLots,
  });

  const nextTarget = rebuildDerivedState({
    ...transferIn,
    totalTransferredIn: target.totalTransferredIn + input.amount,
    lots: [...target.lots, ...newTargetLots],
  });

  return { source: nextSource, target: nextTarget };
}

function consumeLotsForApplication(account: CreditAccountState, amount: number) {
  let remaining = amount;
  const nextLots = account.lots.map((lot) => {
    if (remaining <= 0 || lot.amountRemaining <= 0) return lot;
    const consumed = Math.min(lot.amountRemaining, remaining);
    remaining -= consumed;
    return {
      ...lot,
      amountRemaining: lot.amountRemaining - consumed,
    };
  });

  return {
    lots: nextLots,
    consumed: amount - remaining,
    remaining,
  };
}

export function applyCreditToInvoice(
  account: CreditAccountState,
  input: CreditApplicationInput
): CreditApplicationResult {
  if (account.revision !== (input.expectedRevision ?? account.revision)) {
    throw new Error('Credit balance changed. Refresh before applying to invoice.');
  }
  if (!Number.isFinite(input.invoiceTotal) || input.invoiceTotal <= 0) {
    throw new Error('Invoice total must be positive.');
  }
  if (account.balance <= 0) {
    return {
      account,
      application: null,
      appliedAmount: 0,
      remainingDue: input.invoiceTotal,
      autoApplied: false,
    };
  }

  const appliedAmount = Math.min(account.balance, input.invoiceTotal);
  const { lots, consumed } = consumeLotsForApplication(account, appliedAmount);
  if (consumed <= 0) {
    return {
      account,
      application: null,
      appliedAmount: 0,
      remainingDue: input.invoiceTotal,
      autoApplied: false,
    };
  }

  const nextAccount = appendLedgerEntry(account, {
    accountId: account.accountId,
    type: 'application',
    amount: -consumed,
    currency: input.currency ?? account.currency,
    subscriptionId: input.subscriptionId,
    invoiceId: input.invoiceId,
    reference: input.reference,
    note: input.note,
  });

  const remainingDue = Math.max(0, input.invoiceTotal - consumed);
  const application: CreditInvoiceApplication = {
    id: generateId('credit-application'),
    accountId: account.accountId,
    subscriptionId: input.subscriptionId,
    invoiceId: input.invoiceId,
    invoiceTotal: input.invoiceTotal,
    appliedAmount: consumed,
    remainingDue,
    status: remainingDue > 0 ? 'partial' : 'paid',
    runningBalanceAfter: nextAccount.balance,
    createdAt: new Date(),
  };

  return {
    account: rebuildDerivedState({
      ...nextAccount,
      totalApplied: account.totalApplied + consumed,
      lots,
      applications: [...account.applications, application],
    }),
    application,
    appliedAmount: consumed,
    remainingDue,
    autoApplied: true,
  };
}

export function expireCredits(
  account: CreditAccountState,
  now = new Date()
): CreditExpirationResult {
  const expiredLotIds: string[] = [];
  let expiredAmount = 0;
  const nextLots = account.lots.map((lot) => {
    if (!lot.expiresAt || lot.amountRemaining <= 0) return lot;
    if (lot.expiresAt.getTime() > now.getTime()) return lot;
    expiredLotIds.push(lot.id);
    expiredAmount += lot.amountRemaining;
    return {
      ...lot,
      amountRemaining: 0,
    };
  });

  if (expiredAmount <= 0) {
    return {
      account: rebuildDerivedState(account),
      expiredAmount: 0,
      expiredLotIds: [],
      notificationMessage: null,
    };
  }

  const nextAccount = appendLedgerEntry(account, {
    accountId: account.accountId,
    type: 'expiration',
    amount: -expiredAmount,
    currency: account.currency,
    note: `Expired ${expiredLotIds.length} credit lot(s).`,
  });

  return {
    account: rebuildDerivedState({
      ...nextAccount,
      totalExpired: account.totalExpired + expiredAmount,
      lots: nextLots,
    }),
    expiredAmount,
    expiredLotIds,
    notificationMessage: `${expiredAmount.toFixed(2)} ${account.currency} of credits expired.`,
  };
}

export function summarizeCreditAccount(account: CreditAccountState) {
  return {
    accountId: account.accountId,
    currency: account.currency,
    balance: account.balance,
    runningTotal: account.runningTotal,
    revision: account.revision,
    nextExpirationAt: account.nextExpirationAt,
    totalPurchased: account.totalPurchased,
    totalApplied: account.totalApplied,
    totalExpired: account.totalExpired,
    totalTransferredIn: account.totalTransferredIn,
    totalTransferredOut: account.totalTransferredOut,
    policy: account.policy,
    ledger: account.ledger,
    applications: account.applications,
    lots: account.lots,
  };
}
