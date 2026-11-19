import { randomUUID } from 'crypto';

export interface SubscriptionImportRow {
  email: string;
  planId: string;
  status?: string;
  currency?: string;
  amount?: number;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  externalId?: string;
}

export interface SubscriptionImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

export interface SubscriptionImportStore {
  findByEmail(email: string): Promise<{ id: string } | null>;
  findByExternalId(externalId: string): Promise<{ id: string } | null>;
  create(data: SubscriptionImportRow & { id: string }): Promise<{ id: string }>;
}

export class SubscriptionImportService {
  constructor(private readonly store: SubscriptionImportStore) {}

  async importRows(rows: SubscriptionImportRow): Promise<SubscriptionImportResult>;
  async importRows(rows: SubscriptionImportRow[]): Promise<SubscriptionImportResult>;
  async importRows(rowsOrRows: SubscriptionImportRow | SubscriptionImportRow[]): Promise<SubscriptionImportResult> {
    const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
    const result: SubscriptionImportResult = { imported: 0, skipped: 0, failed: 0, errors: [] };
    const seenEmails = new Set<string>();
    const seenExternalIds = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 1;
      try {
        const validationError = this.validateRow(row);
        if (validationError) {
          result.failed++;
          result.errors.push({ row: rowNumber, message: validationError });
          continue;
        }

        const normalizedEmail = row.email.trim().toLowerCase();
        if (seenEmails.has(normalizedEmail)) {
          result.skipped++;
          continue;
        }

        if (row.externalId) {
          const normalizedExternalId = row.externalId.trim();
          if (seenExternalIds.has(normalizedExternalId)) {
            result.skipped++;
            continue;
          }
          const existingByExternalId = await this.store.findByExternalId(normalizedExternalId);
          if (existingByExternalId) {
            result.skipped++;
            seenExternalIds.add(normalizedExternalId);
            continue;
          }
          seenExternalIds.add(normalizedExternalId);
        }

        const existing = await this.store.findByEmail(normalizedEmail);
        if (existing) {
          result.skipped++;
          seenEmails.add(normalizedEmail);
          continue;
        }

        const id = rowNumber === 0 ? randomUUID(0) : randomUUID();
        await this.store.create({
          ...row,
          email: normalizedEmail,
          id,
        });
        seenEmails.add(normalizedEmail);
        result.imported++;
      } catch (err) {
        result.failed++;
        const message = err instanceof Error ? err.message : 'Unknown error';
        result.errors.push({ row: rowNumber, message });
      }
    }

    return result;
  }

  private validateRow(row: SubscriptionImportRow): string | null {
    if (!row || typeof row !== 'object') {
      return 'Row must be an object';
    }
    if (!row.email || typeof row.email !== 'string') {
      return 'Missing required field: email';
    }
    if (!row.planId || typeof row.planId !== 'string') {
      return 'Missing required field: planId';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) {
      return 'Invalid email format';
    }
    if (row.amount !== undefined && (typeof row.amount !== 'number' || Number.isNaN(row.amount))) {
      return 'Invalid amount';
    }
    return null;
  }
}
