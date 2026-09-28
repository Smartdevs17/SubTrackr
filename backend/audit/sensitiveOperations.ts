/**
 * Sensitive Operations Audit Registry
 *
 * Defines the catalogue of sensitive operations that must be audited
 * whenever they are performed. Each operation carries metadata about
 * the resource type, severity, and whether state snapshots should be
 * captured.
 */

export type SensitiveOperationCategory =
  | 'authentication'
  | 'payment'
  | 'data_access'
  | 'data_modification'
  | 'admin'
  | 'security'
  | 'compliance';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface SensitiveOperationDefinition {
  /** Unique key identifying the operation (e.g. "payment.charge") */
  key: string;
  /** Human-readable label */
  label: string;
  category: SensitiveOperationCategory;
  severity: Severity;
  /** Resource type recorded in the audit trail */
  resourceType: string;
  /** Whether old/new state snapshots should be captured */
  captureState: boolean;
  /** Whether the operation requires a reason string in metadata */
  requiresReason: boolean;
}

/**
 * Central registry of all sensitive operations.
 * Add new entries here when introducing new sensitive flows.
 */
export const SENSITIVE_OPERATIONS: Record<string, SensitiveOperationDefinition> = {
  'auth.login': {
    key: 'auth.login',
    label: 'User login',
    category: 'authentication',
    severity: 'medium',
    resourceType: 'user',
    captureState: false,
    requiresReason: false,
  },
  'auth.logout': {
    key: 'auth.logout',
    label: 'User logout',
    category: 'authentication',
    severity: 'low',
    resourceType: 'user',
    captureState: false,
    requiresReason: false,
  },
  'auth.password_change': {
    key: 'auth.password_change',
    label: 'Password change',
    category: 'authentication',
    severity: 'high',
    resourceType: 'user',
    captureState: false,
    requiresReason: false,
  },
  'auth.mfa_disable': {
    key: 'auth.mfa_disable',
    label: 'MFA disabled',
    category: 'authentication',
    severity: 'critical',
    resourceType: 'user',
    captureState: false,
    requiresReason: true,
  },
  'auth.api_key_rotate': {
    key: 'auth.api_key_rotate',
    label: 'API key rotation',
    category: 'authentication',
    severity: 'high',
    resourceType: 'api_key',
    captureState: true,
    requiresReason: false,
  },
  'payment.charge': {
    key: 'payment.charge',
    label: 'Payment charge',
    category: 'payment',
    severity: 'high',
    resourceType: 'payment',
    captureState: true,
    requiresReason: false,
  },
  'payment.refund': {
    key: 'payment.refund',
    label: 'Payment refund',
    category: 'payment',
    severity: 'high',
    resourceType: 'payment',
    captureState: true,
    requiresReason: true,
  },
  'payment.method_add': {
    key: 'payment.method_add',
    label: 'Add payment method',
    category: 'payment',
    severity: 'medium',
    resourceType: 'payment_method',
    captureState: true,
    requiresReason: false,
  },
  'payment.method_remove': {
    key: 'payment.method_remove',
    label: 'Remove payment method',
    category: 'payment',
    severity: 'medium',
    resourceType: 'payment_method',
    captureState: true,
    requiresReason: false,
  },
  'subscription.create': {
    key: 'subscription.create',
    label: 'Subscription created',
    category: 'data_modification',
    severity: 'medium',
    resourceType: 'subscription',
    captureState: true,
    requiresReason: false,
  },
  'subscription.cancel': {
    key: 'subscription.cancel',
    label: 'Subscription cancelled',
    category: 'data_modification',
    severity: 'medium',
    resourceType: 'subscription',
    captureState: true,
    requiresReason: true,
  },
  'subscription.modify': {
    key: 'subscription.modify',
    label: 'Subscription modified',
    category: 'data_modification',
    severity: 'medium',
    resourceType: 'subscription',
    captureState: true,
    requiresReason: false,
  },
  'user.data_export': {
    key: 'user.data_export',
    label: 'User data export (GDPR)',
    category: 'data_access',
    severity: 'high',
    resourceType: 'user_data',
    captureState: false,
    requiresReason: true,
  },
  'user.data_delete': {
    key: 'user.data_delete',
    label: 'User data deletion (GDPR)',
    category: 'data_modification',
    severity: 'critical',
    resourceType: 'user_data',
    captureState: true,
    requiresReason: true,
  },
  'user.profile_update': {
    key: 'user.profile_update',
    label: 'Profile update',
    category: 'data_modification',
    severity: 'low',
    resourceType: 'user',
    captureState: true,
    requiresReason: false,
  },
  'admin.user_role_change': {
    key: 'admin.user_role_change',
    label: 'User role changed by admin',
    category: 'admin',
    severity: 'critical',
    resourceType: 'user',
    captureState: true,
    requiresReason: true,
  },
  'admin.config_change': {
    key: 'admin.config_change',
    label: 'System configuration change',
    category: 'admin',
    severity: 'high',
    resourceType: 'system_config',
    captureState: true,
    requiresReason: true,
  },
  'admin.billing_plan_change': {
    key: 'admin.billing_plan_change',
    label: 'Billing plan changed by admin',
    category: 'admin',
    severity: 'high',
    resourceType: 'billing_plan',
    captureState: true,
    requiresReason: true,
  },
  'security.access_denied': {
    key: 'security.access_denied',
    label: 'Access denied event',
    category: 'security',
    severity: 'medium',
    resourceType: 'resource',
    captureState: false,
    requiresReason: false,
  },
  'security.suspicious_activity': {
    key: 'security.suspicious_activity',
    label: 'Suspicious activity detected',
    category: 'security',
    severity: 'critical',
    resourceType: 'resource',
    captureState: false,
    requiresReason: false,
  },
  'compliance.data_retention_purge': {
    key: 'compliance.data_retention_purge',
    label: 'Data retention purge executed',
    category: 'compliance',
    severity: 'high',
    resourceType: 'data',
    captureState: false,
    requiresReason: true,
  },
};

export function getSensitiveOperation(key: string): SensitiveOperationDefinition | undefined {
  return SENSITIVE_OPERATIONS[key];
}

export function isSensitiveOperation(key: string): boolean {
  return key in SENSITIVE_OPERATIONS;
}

export function listSensitiveOperations(): SensitiveOperationDefinition[] {
  return Object.values(SENSITIVE_OPERATIONS);
}

export function listSensitiveOperationsByCategory(
  category: SensitiveOperationCategory,
): SensitiveOperationDefinition[] {
  return listSensitiveOperations().filter((op) => op.category === category);
}

export function listSensitiveOperationsBySeverity(
  severity: Severity,
): SensitiveOperationDefinition[] {
  return listSensitiveOperations().filter((op) => op.severity === severity);
}
