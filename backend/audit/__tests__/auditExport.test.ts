import { AuditController } from '../controller/auditController';
import { AuditWriter } from '../domain/AuditWriter';
import { BlockchainAnchor } from '../domain/BlockchainAnchor';
import { HashChainService } from '../domain/HashChainService';

describe('AuditController exports', () => {
  const createController = () => {
    const chain = new HashChainService();
    return new AuditController(chain, new AuditWriter(chain), new BlockchainAnchor(chain));
  };

  it('exports filtered CSV with actor and ISO event time', async () => {
    const controller = createController();
    await controller.record({ actorId: 'auditor@example.com', action: 'invoice.read', resourceType: 'invoice', resourceId: 'inv-1' });
    await controller.record({ actorId: 'admin@example.com', action: 'user.update', resourceType: 'user', resourceId: 'usr-1' });

    const report = await controller.exportReport({ resourceType: 'invoice' }, 'csv');
    expect(report.count).toBe(1);
    expect(report.content).toContain('actor_id,occurred_at');
    expect(report.content).toContain('"auditor@example.com"');
    expect(report.content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(report.content).not.toContain('admin@example.com');
  });

  it('exports JSON with actor and readable event time', async () => {
    const controller = createController();
    await controller.record({ actorId: 'actor-1', action: 'refund.create', resourceType: 'payment', resourceId: 'pay-1' });

    const report = await controller.exportReport({}, 'json');
    expect(JSON.parse(report.content)[0]).toMatchObject({
      actorId: 'actor-1',
      action: 'refund.create',
    });
    expect(JSON.parse(report.content)[0].occurredAt).toEqual(expect.any(String));
  });
});
