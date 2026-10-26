/**
 * Tests for the customer tax exemption service (issue #1740).
 */

import {
  createTaxExemptionService,
  InMemoryCustomerTaxStatusStore,
  TaxExemptionValidationError,
  TAX_EXEMPTION_OP,
} from '../taxExemptionService';
import { HashChainService, AuditWriter } from '../../../audit/domain';
import { SensitiveOpsAuditController } from '../../../audit/controller/sensitiveOpsAuditController';

function makeService(failAudit = false) {
  const chain = new HashChainService();
  const writer = new AuditWriter(chain);
  const auditController = new SensitiveOpsAuditController(writer);
  if (failAudit) {
    jest.spyOn(auditController, 'auditWithState').mockReturnValue({
      success: false,
      auditEntry: null,
      error: 'chain unavailable',
    });
  }
  const store = new InMemoryCustomerTaxStatusStore();
  const service = createTaxExemptionService({ store, auditController, auditChain: chain });
  return { service, store, chain, auditController };
}

const baseSet = {
  isExempt: true,
  reason: 'Certificate on file',
  actorId: 'admin-1',
};

describe('tax exemption service — flags (#1740)', () => {
  it('stores and reads back a per-customer flag with certificate metadata', async () => {
    const { service } = makeService();
    const result = await service.set('cust-1', {
      ...baseSet,
      certificateId: 'CERT-9',
      certificateExpiry: 1_900_000_000_000,
      issuingAuthority: 'IRS',
      exemptJurisdictions: ['us-ca'],
    });

    expect(result.customerId).toBe('cust-1');
    expect(result.status.isExempt).toBe(true);
    expect(result.status.certificateId).toBe('CERT-9');
    expect(result.status.certificateExpiry).toBe(1_900_000_000_000);
    expect(result.status.issuingAuthority).toBe('IRS');
    expect(result.status.exemptJurisdictions).toEqual(['US-CA']);

    const stored = await service.get('cust-1');
    expect(stored).toEqual(result.status);
  });

  it('defaults optional fields and returns null for unknown customers', async () => {
    const { service } = makeService();
    await service.set('cust-2', { isExempt: false, reason: 'cleared' });

    const stored = await service.get('cust-2');
    expect(stored).toEqual({
      isExempt: false,
      certificateId: '',
      certificateExpiry: 0,
      issuingAuthority: '',
      exemptJurisdictions: [],
    });
    expect(await service.get('missing')).toBeNull();
    expect(await service.get('')).toBeNull();
  });

  it('rejects invalid input', async () => {
    const { service } = makeService();
    await expect(service.set('', baseSet)).rejects.toBeInstanceOf(TaxExemptionValidationError);
    await expect(
      service.set('cust-3', { isExempt: 'yes' as unknown as boolean, reason: 'x' }),
    ).rejects.toBeInstanceOf(TaxExemptionValidationError);
    await expect(
      service.set('cust-3', { isExempt: true, reason: '' }),
    ).rejects.toBeInstanceOf(TaxExemptionValidationError);
    await expect(
      service.set('cust-3', { isExempt: true, reason: 'x', certificateExpiry: -1 }),
    ).rejects.toBeInstanceOf(TaxExemptionValidationError);
    await expect(
      service.set('cust-3', {
        isExempt: true,
        reason: 'x',
        exemptJurisdictions: [1 as unknown as string],
      }),
    ).rejects.toBeInstanceOf(TaxExemptionValidationError);
  });
});

describe('tax exemption service — auditing (#1740)', () => {
  it('writes a chained audit entry with old and new state', async () => {
    const { service, chain } = makeService();

    const created = await service.set('cust-a', { ...baseSet, actorId: 'admin-7' });
    expect(created.auditEntry).not.toBeNull();
    expect(created.auditEntry!.action).toBe(TAX_EXEMPTION_OP);
    expect(created.auditEntry!.actorId).toBe('admin-7');
    expect(created.auditEntry!.resourceType).toBe('customer_tax_status');
    expect(created.auditEntry!.resourceId).toBe('cust-a');
    expect(created.auditEntry!.oldState).toBeNull();
    expect(created.auditEntry!.newState).toMatchObject({ isExempt: true });
    expect(created.auditEntry!.metadata.reason).toBe('Certificate on file');

    await service.set('cust-a', { isExempt: false, reason: 'expired', actorId: 'admin-7' });
    const entries = service.listAudit('cust-a');
    expect(entries).toHaveLength(2);
    expect(entries[1].oldState).toMatchObject({ isExempt: true });
    expect(entries[1].newState).toMatchObject({ isExempt: false });
    expect(entries[0].hash).toBe(chain.getChain()[0].hash);
    expect(chain.verify().valid).toBe(true);
  });

  it('does not persist the flag when the audit write fails', async () => {
    const { service, store } = makeService(true);

    await expect(service.set('cust-b', baseSet)).rejects.toThrow('chain unavailable');
    expect(await store.get('cust-b')).toBeNull();
  });

  it('filters the audit trail by customer', async () => {
    const { service } = makeService();
    await service.set('cust-x', { isExempt: true, reason: 'a' });
    await service.set('cust-y', { isExempt: true, reason: 'b' });

    expect(service.listAudit('cust-x')).toHaveLength(1);
    expect(service.listAudit('cust-x')[0].resourceId).toBe('cust-x');
    expect(service.listAudit('cust-y')).toHaveLength(1);
    expect(service.listAudit('nobody')).toEqual([]);
  });
});

describe('tax exemption service — exemption resolution (#1740)', () => {
  it('is exempt everywhere when no jurisdictions are listed', async () => {
    const { service } = makeService();
    await service.set('cust-global', { isExempt: true, reason: 'x' });

    expect(await service.isExempt('cust-global', 'DE')).toBe(true);
    expect(await service.isExempt('cust-global', '')).toBe(true);
  });

  it('only exempts the listed jurisdictions, case-insensitively', async () => {
    const { service } = makeService();
    await service.set('cust-scoped', {
      isExempt: true,
      reason: 'x',
      exemptJurisdictions: ['US-CA', 'DE'],
    });

    expect(await service.isExempt('cust-scoped', 'us-ca')).toBe(true);
    expect(await service.isExempt('cust-scoped', 'DE')).toBe(true);
    expect(await service.isExempt('cust-scoped', 'FR')).toBe(false);
  });

  it('treats expired certificates as taxable', async () => {
    const { service } = makeService();
    await service.set('cust-expired', {
      isExempt: true,
      reason: 'x',
      certificateExpiry: Date.now() - 1_000,
    });

    expect(await service.isExempt('cust-expired', 'DE')).toBe(false);
  });

  it('is not exempt without a stored flag', async () => {
    const { service } = makeService();
    expect(await service.isExempt('unknown', 'DE')).toBe(false);
    expect(await service.isExempt('', 'DE')).toBe(false);
  });
});
