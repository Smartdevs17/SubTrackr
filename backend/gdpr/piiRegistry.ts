/**
 * GDPR PII Field Registry
 * Classifies data fields by sensitivity and required anonymization strategy.
 */

export type AnonymizationStrategyType = 'mask' | 'hash' | 'truncate' | 'perturb' | 'none';
export type SensitivityLevel = 'direct' | 'quasi' | 'non-sensitive';

export interface PiiFieldDefinition {
  field: string;
  sensitivity: SensitivityLevel;
  strategy: AnonymizationStrategyType;
  /** Whether the field is a quasi-identifier used in k-anonymity checks */
  quasiIdentifier: boolean;
}

/** Central registry of all PII fields and their anonymization requirements */
export const PII_REGISTRY: Record<string, PiiFieldDefinition> = {
  email: {
    field: 'email',
    sensitivity: 'direct',
    strategy: 'mask',
    quasiIdentifier: false,
  },
  name: {
    field: 'name',
    sensitivity: 'direct',
    strategy: 'hash',
    quasiIdentifier: false,
  },
  ipAddress: {
    field: 'ipAddress',
    sensitivity: 'direct',
    strategy: 'truncate',
    quasiIdentifier: true,
  },
  createdAt: {
    field: 'createdAt',
    sensitivity: 'quasi',
    strategy: 'perturb',
    quasiIdentifier: true,
  },
  subscriptionStartDate: {
    field: 'subscriptionStartDate',
    sensitivity: 'quasi',
    strategy: 'perturb',
    quasiIdentifier: true,
  },
  country: {
    field: 'country',
    sensitivity: 'quasi',
    strategy: 'none',
    quasiIdentifier: true,
  },
  planId: {
    field: 'planId',
    sensitivity: 'quasi',
    strategy: 'none',
    quasiIdentifier: true,
  },
  amount: {
    field: 'amount',
    sensitivity: 'quasi',
    strategy: 'none',
    quasiIdentifier: true,
  },
  userId: {
    field: 'userId',
    sensitivity: 'direct',
    strategy: 'hash',
    quasiIdentifier: false,
  },
  phoneNumber: {
    field: 'phoneNumber',
    sensitivity: 'direct',
    strategy: 'mask',
    quasiIdentifier: false,
  },
  address: {
    field: 'address',
    sensitivity: 'direct',
    strategy: 'mask',
    quasiIdentifier: false,
  },
};

/** Export level controls which fields are anonymized */
export type ExportLevel = 'full' | 'pseudonymized' | 'anonymized';

/** Fields that are passed through unchanged per export level */
export const EXPORT_LEVEL_PASSTHROUGH: Record<ExportLevel, Set<AnonymizationStrategyType>> = {
  full: new Set(['mask', 'hash', 'truncate', 'perturb', 'none']),
  pseudonymized: new Set(['none']), // only non-pii passthrough; direct/quasi are pseudonymized via hash
  anonymized: new Set(['none']),    // all PII is irreversibly anonymized
};

export function getPiiFields(): PiiFieldDefinition[] {
  return Object.values(PII_REGISTRY);
}

export function getQuasiIdentifiers(): string[] {
  return getPiiFields()
    .filter((f) => f.quasiIdentifier)
    .map((f) => f.field);
}

export function isPiiField(field: string): boolean {
  return field in PII_REGISTRY;
}

export function getFieldDefinition(field: string): PiiFieldDefinition | undefined {
  return PII_REGISTRY[field];
}
