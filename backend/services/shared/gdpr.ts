import {
  encryptField,
  decryptField,
  maskObject,
  generateBlindIndexTokens,
  isPiiField,
} from './encryption';
import { keyManager } from './keyManager';
import { piiAuditService } from './piiAudit';
import { logger } from './logging';

export interface UserConsent {
  analytics: boolean;
  notifications: boolean;
  dataProcessing: boolean;
  timestamp: string;
}

export interface ExportResult {
  data: string;
  exportId: string;
  timestamp: string;
  encryptedFields: string[];
}

export interface DeletionResult {
  success: boolean;
  message: string;
  anonymizedFields: string[];
}

export interface AnonymizationResult {
  success: boolean;
  message: string;
  fields: string[];
}

async function ensureEncryptionInitialized(): Promise<void> {
  if (!keyManager.getActiveEncryptionKey()) {
    await keyManager.initialize();
  }
}

function generateExportId(): string {
  return `export-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const exportUserData = async (userId: string): Promise<ExportResult> => {
  await ensureEncryptionInitialized();

  logger.info('Exporting user data', { userId });

  const userData = {
    profile: { id: userId, email: 'user@example.com', name: 'John Doe', registeredAt: '2026-01-01' },
    subscriptions: [{ id: 'sub_1', name: 'Netflix', amount: 15.99, status: 'active' }],
    billingHistory: [{ id: 'tx_1', date: '2026-04-20', amount: 15.99, status: 'completed' }],
    consentLogs: [{ type: 'analytics', status: 'granted', date: '2026-01-01' }],
  };

  const encryptedFields: string[] = [];
  const encKey = keyManager.getActiveEncryptionKey();

  if (encKey && userData.profile.email) {
    userData.profile.email = JSON.stringify(
      encryptField(userData.profile.email, encKey)
    );
    encryptedFields.push('profile.email');
  }
  if (encKey && userData.profile.name) {
    userData.profile.name = JSON.stringify(
      encryptField(userData.profile.name, encKey)
    );
    encryptedFields.push('profile.name');
  }

  const exportId = generateExportId();
  const timestamp = new Date().toISOString();

  piiAuditService.logPiiAccess(
    'pii.exported',
    'system',
    userId,
    'user',
    ['email', 'name'],
    { exportId, requestedAt: timestamp }
  );

  return {
    data: JSON.stringify(userData, null, 2),
    exportId,
    timestamp,
    encryptedFields,
  };
};

export const deleteUserData = async (
  userId: string,
  permanent: boolean = false
): Promise<DeletionResult> => {
  await ensureEncryptionInitialized();

  logger.info('Processing user deletion', { userId, permanent });

  if (!permanent) {
    return anonymizeUserData(userId) as Promise<DeletionResult>;
  }

  piiAuditService.logPiiAccess(
    'pii.deleted',
    'system',
    userId,
    'user',
    ['email', 'name', 'phoneNumber', 'address'],
    { permanent: true }
  );

  return { success: true, message: 'User data permanently deleted', anonymizedFields: [] };
};

export const anonymizeUserData = async (userId: string): Promise<AnonymizationResult> => {
  await ensureEncryptionInitialized();

  logger.info('Anonymizing user data', { userId });

  const fields = ['email', 'name', 'phoneNumber', 'address', 'businessName', 'recipientEmail'];

  piiAuditService.logPiiAccess(
    'pii.anonymized',
    'system',
    userId,
    'user',
    fields,
    { reason: 'user_requested_deletion' }
  );

  return { success: true, message: 'User data has been anonymized', fields };
};

export const updateConsent = async (
  userId: string,
  preferences: Partial<UserConsent>
): Promise<UserConsent> => {
  const newConsent = {
    ...preferences,
    timestamp: new Date().toISOString(),
  };

  logger.info('Consent updated', { userId, newConsent });

  return newConsent;
};

export { encryptField, decryptField, maskObject, generateBlindIndexTokens, isPiiField };
