/**
 * Customer Tax Exemption Service (issue #1740)
 *
 * Persists the per-customer tax-exempt flag (with exemption-certificate
 * metadata and the jurisdictions the exemption covers), applies it at
 * invoice time via `TaxService.isCustomerTaxExempt`, and records every
 * flag change on the hash-chain audit trail.
 *
 * Every change is audited *before* it is persisted: an exemption flag is
 * never written without a chained `compliance.tax_exempt_change` entry.
 */

import type { Pool } from '../../shared/db/connectionPool';
import { TaxService } from './taxService';
import type { CustomerTaxStatus } from './taxTypes';
import { SensitiveOpsAuditController } from '../../audit/controller/sensitiveOpsAuditController';
import type { AuditChainEntry, HashChainService } from '../../audit/domain/HashChainService';

/** Sensitive-operation key registered in SENSITIVE_OPERATIONS. */
export const TAX_EXEMPTION_OP = 'compliance.tax_exempt_change';
const TAX_EXEMPTION_RESOURCE = 'customer_tax_status';

export class TaxExemptionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxExemptionValidationError';
  }
}

function copyStatus(status: CustomerTaxStatus): CustomerTaxStatus {
  return {
    isExempt: status.isExempt,
    certificateId: status.certificateId,
    certificateExpiry: status.certificateExpiry,
    issuingAuthority: status.issuingAuthority,
    exemptJurisdictions: [...status.exemptJurisdictions],
    ...(status.digitalGoodsOverride !== undefined
      ? { digitalGoodsOverride: status.digitalGoodsOverride }
      : {}),
  };
}

function toAuditState(status: CustomerTaxStatus | null): Record<string, unknown> | null {
  if (!status) return null;
  return {
    isExempt: status.isExempt,
    certificateId: status.certificateId,
    certificateExpiry: status.certificateExpiry,
    issuingAuthority: status.issuingAuthority,
    exemptJurisdictions: [...status.exemptJurisdictions],
    ...(status.digitalGoodsOverride !== undefined
      ? { digitalGoodsOverride: status.digitalGoodsOverride }
      : {}),
  };
}

export interface CustomerTaxStatusStore {
  get(customerId: string): Promise<CustomerTaxStatus | null>;
  set(customerId: string, status: CustomerTaxStatus, updatedBy?: string): Promise<void>;
}

/** In-memory store for tests and ephemeral deployments. */
export class InMemoryCustomerTaxStatusStore implements CustomerTaxStatusStore {
  private statuses = new Map<string, CustomerTaxStatus>();

  async get(customerId: string): Promise<CustomerTaxStatus | null> {
    const status = this.statuses.get(customerId);
    return status ? copyStatus(status) : null;
  }

  async set(customerId: string, status: CustomerTaxStatus): Promise<void> {
    this.statuses.set(customerId, copyStatus(status));
  }
}

/** Postgres-backed store (migration 008_customer_tax_status.sql). */
export class PostgresCustomerTaxStatusStore implements CustomerTaxStatusStore {
  constructor(private pool: Pool) {}

  async get(customerId: string): Promise<CustomerTaxStatus | null> {
    const result = await this.pool.query<{
      is_exempt: boolean;
      certificate_id: string;
      certificate_expiry: number | string;
      issuing_authority: string;
      exempt_jurisdictions: string[] | null;
    }>(
      `SELECT is_exempt, certificate_id, certificate_expiry, issuing_authority, exempt_jurisdictions
         FROM customer_tax_status
        WHERE customer_id = $1`,
      [customerId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      isExempt: row.is_exempt,
      certificateId: row.certificate_id,
      certificateExpiry: Number(row.certificate_expiry ?? 0),
      issuingAuthority: row.issuing_authority,
      exemptJurisdictions: row.exempt_jurisdictions ?? [],
    };
  }

  async set(customerId: string, status: CustomerTaxStatus, updatedBy?: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO customer_tax_status
         (customer_id, is_exempt, certificate_id, certificate_expiry, issuing_authority,
          exempt_jurisdictions, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (customer_id) DO UPDATE SET
         is_exempt            = EXCLUDED.is_exempt,
         certificate_id       = EXCLUDED.certificate_id,
         certificate_expiry   = EXCLUDED.certificate_expiry,
         issuing_authority    = EXCLUDED.issuing_authority,
         exempt_jurisdictions = EXCLUDED.exempt_jurisdictions,
         updated_by           = EXCLUDED.updated_by,
         updated_at           = now()`,
      [
        customerId,
        status.isExempt,
        status.certificateId,
        status.certificateExpiry,
        status.issuingAuthority,
        status.exemptJurisdictions,
        updatedBy ?? null,
      ],
    );
  }
}

export interface SetTaxExemptionInput {
  isExempt: boolean;
  certificateId?: string;
  /** Epoch milliseconds; 0 or omitted means no expiry. */
  certificateExpiry?: number;
  issuingAuthority?: string;
  /** Jurisdiction keys the exemption covers; empty or omitted means all. */
  exemptJurisdictions?: string[];
  actorId?: string;
  /** Mandatory: exemption changes are a requiresReason audit operation. */
  reason: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface SetTaxExemptionResult {
  customerId: string;
  status: CustomerTaxStatus;
  auditEntry: AuditChainEntry | null;
}

export interface TaxExemptionService {
  get(customerId: string): Promise<CustomerTaxStatus | null>;
  set(customerId: string, input: SetTaxExemptionInput): Promise<SetTaxExemptionResult>;
  /** Whether the customer's stored flag makes them exempt in the jurisdiction. */
  isExempt(customerId: string, jurisdictionKey: string): Promise<boolean>;
  /** Audit-trail entries for one customer (newest last). */
  listAudit(customerId: string): AuditChainEntry[];
}

export function createTaxExemptionService(deps: {
  store: CustomerTaxStatusStore;
  auditController: Pick<SensitiveOpsAuditController, 'auditWithState'>;
  auditChain: Pick<HashChainService, 'getChain'>;
}): TaxExemptionService {
  const { store, auditController, auditChain } = deps;

  return {
    async get(customerId: string): Promise<CustomerTaxStatus | null> {
      const id = (customerId ?? '').trim();
      if (!id) return null;
      const status = await store.get(id);
      return status ? copyStatus(status) : null;
    },

    async set(customerId: string, input: SetTaxExemptionInput): Promise<SetTaxExemptionResult> {
      const id = (customerId ?? '').trim();
      if (!id) {
        throw new TaxExemptionValidationError('customerId is required');
      }
      if (typeof input?.isExempt !== 'boolean') {
        throw new TaxExemptionValidationError('isExempt must be a boolean');
      }
      const reason = (input.reason ?? '').trim();
      if (!reason) {
        throw new TaxExemptionValidationError('reason is required for tax exemption changes');
      }

      let certificateExpiry = 0;
      if (input.certificateExpiry !== undefined && input.certificateExpiry !== null) {
        certificateExpiry = Number(input.certificateExpiry);
        if (!Number.isFinite(certificateExpiry) || certificateExpiry < 0) {
          throw new TaxExemptionValidationError(
            'certificateExpiry must be a non-negative epoch-millisecond timestamp',
          );
        }
      }

      let exemptJurisdictions: string[] = [];
      if (input.exemptJurisdictions !== undefined && input.exemptJurisdictions !== null) {
        if (
          !Array.isArray(input.exemptJurisdictions) ||
          input.exemptJurisdictions.some((j) => typeof j !== 'string')
        ) {
          throw new TaxExemptionValidationError('exemptJurisdictions must be an array of strings');
        }
        exemptJurisdictions = input.exemptJurisdictions
          .map((j) => j.trim().toUpperCase())
          .filter((j) => j.length > 0);
      }

      const newStatus: CustomerTaxStatus = {
        isExempt: input.isExempt,
        certificateId: typeof input.certificateId === 'string' ? input.certificateId : '',
        certificateExpiry,
        issuingAuthority: typeof input.issuingAuthority === 'string' ? input.issuingAuthority : '',
        exemptJurisdictions,
      };
      const actorId = (input.actorId ?? '').trim() || 'system';

      // Audit first: the flag is never persisted without a chained audit entry.
      const oldStatus = await store.get(id);
      const auditResult = auditController.auditWithState(
        TAX_EXEMPTION_OP,
        {
          actorId,
          resourceId: id,
          reason,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata: { customerId: id, exemptJurisdictions },
        },
        toAuditState(oldStatus),
        toAuditState(newStatus),
      );
      if (!auditResult.success || !auditResult.auditEntry) {
        throw new Error(auditResult.error ?? 'Failed to audit tax exemption change');
      }

      await store.set(id, newStatus, actorId);

      return { customerId: id, status: newStatus, auditEntry: auditResult.auditEntry };
    },

    async isExempt(customerId: string, jurisdictionKey: string): Promise<boolean> {
      const id = (customerId ?? '').trim();
      if (!id) return false;
      const status = await store.get(id);
      if (!status) return false;
      return TaxService.isCustomerTaxExempt(status, (jurisdictionKey ?? '').trim().toUpperCase());
    },

    listAudit(customerId: string): AuditChainEntry[] {
      const id = (customerId ?? '').trim();
      if (!id) return [];
      return auditChain
        .getChain()
        .filter((entry) => entry.resourceType === TAX_EXEMPTION_RESOURCE && entry.resourceId === id);
    },
  };
}
