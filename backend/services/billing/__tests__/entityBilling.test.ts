/**
 * Unit tests for EntityBillingService
 * Covers: CRUD, hierarchy, consolidated billing, invoicing, analytics,
 *         merge, divestiture, and failure paths.
 */
import {
  EntityBillingService,
  EntityBillingError,
  type ConsolidatedBillingSummary,
} from '../entityBilling';
import {
  EntityStatus,
  type Entity,
  type EntityMember,
  type EntityRole,
} from '../../../../src/types/entity';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeMember = (userId: string, role: EntityRole = 'viewer'): EntityMember => ({
  userId,
  email: `${userId}@example.com`,
  role,
  entityId: '',
});

const makeEntityInput = (overrides: Partial<{
  name: string;
  currency: string;
  parentId: string | null;
  status: EntityStatus;
  consolidatedBilling: boolean;
  members: EntityMember[];
}> = {}) => ({
  name: overrides.name ?? 'Test Entity',
  currency: overrides.currency ?? 'USD',
  parentId: overrides.parentId ?? null,
  status: overrides.status ?? EntityStatus.ACTIVE,
  consolidatedBilling: overrides.consolidatedBilling ?? false,
  members: overrides.members ?? [],
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EntityBillingService', () => {
  let service: EntityBillingService;

  beforeEach(() => {
    service = new EntityBillingService({ defaultCurrency: 'USD', autoConsolidate: true });
  });

  // ── Entity CRUD ─────────────────────────────────────────────────────────

  describe('createEntity', () => {
    it('creates an entity with generated id and timestamps', () => {
      const entity = service.createEntity(makeEntityInput({ name: 'Acme Corp' }));

      expect(entity.id).toMatch(/^ent_/);
      expect(entity.name).toBe('Acme Corp');
      expect(entity.currency).toBe('USD');
      expect(entity.status).toBe(EntityStatus.ACTIVE);
      expect(entity.parentId).toBeNull();
      expect(entity.childIds).toEqual([]);
      expect(entity.members).toEqual([]);
      expect(entity.consolidatedBilling).toBe(false);
      expect(entity.createdAt).toBeInstanceOf(Date);
      expect(entity.updatedAt).toBeInstanceOf(Date);
    });

    it('creates an entity with a parent', () => {
      const parent = service.createEntity(makeEntityInput({ name: 'Parent' }));
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: parent.id })
      );

      expect(child.parentId).toBe(parent.id);

      const updatedParent = service.getEntity(parent.id);
      expect(updatedParent?.childIds).toContain(child.id);
    });

    it('creates an entity with members', () => {
      const members = [makeMember('user1', 'admin')];
      const entity = service.createEntity(makeEntityInput({ members }));

      expect(entity.members).toHaveLength(1);
      expect(entity.members[0].userId).toBe('user1');
    });

    it('throws when name is missing', () => {
      expect(() => service.createEntity(makeEntityInput({ name: '' }))).toThrow(
        EntityBillingError
      );
      expect(() => service.createEntity(makeEntityInput({ name: '' }))).toThrow(
        'Entity name is required'
      );
    });

    it('throws when currency is missing', () => {
      expect(() => service.createEntity(makeEntityInput({ currency: '' }))).toThrow(
        EntityBillingError
      );
    });

    it('throws when currency is not 3 letters', () => {
      expect(() => service.createEntity(makeEntityInput({ currency: 'USDD' }))).toThrow(
        EntityBillingError
      );
    });

    it('throws when parent does not exist', () => {
      expect(() =>
        service.createEntity(makeEntityInput({ parentId: 'nonexistent' }))
      ).toThrow('Parent entity nonexistent not found');
    });

    it('throws when creating circular hierarchy (self as parent)', () => {
      const entity = service.createEntity(makeEntityInput({ name: 'Root' }));
      expect(() =>
        service.updateEntity(entity.id, { parentId: entity.id })
      ).toThrow('Entity cannot be its own parent');
    });

    it('throws when creating circular hierarchy (descendant as parent)', () => {
      const grandparent = service.createEntity(makeEntityInput({ name: 'Grandparent' }));
      const parent = service.createEntity(
        makeEntityInput({ name: 'Parent', parentId: grandparent.id })
      );
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: parent.id })
      );

      // Try to make grandparent a child of its own grandchild
      expect(() =>
        service.updateEntity(grandparent.id, { parentId: child.id })
      ).toThrow('Cannot create circular entity hierarchy');
    });
  });

  describe('getEntity', () => {
    it('returns undefined for nonexistent entity', () => {
      expect(service.getEntity('nonexistent')).toBeUndefined();
    });

    it('returns a copy of the entity (immutability)', () => {
      const entity = service.createEntity(makeEntityInput());
      const fetched = service.getEntity(entity.id);
      expect(fetched).toEqual(entity);
      expect(fetched).not.toBe(entity);
    });
  });

  describe('getAllEntities', () => {
    it('returns empty array when no entities', () => {
      expect(service.getAllEntities()).toEqual([]);
    });

    it('returns all created entities', () => {
      service.createEntity(makeEntityInput({ name: 'A' }));
      service.createEntity(makeEntityInput({ name: 'B' }));
      service.createEntity(makeEntityInput({ name: 'C' }));

      expect(service.getAllEntities()).toHaveLength(3);
    });
  });

  describe('updateEntity', () => {
    it('updates entity fields', () => {
      const entity = service.createEntity(makeEntityInput({ name: 'Old' }));
      const updated = service.updateEntity(entity.id, { name: 'New' });

      expect(updated.name).toBe('New');
      expect(updated.id).toBe(entity.id);
      expect(updated.createdAt).toEqual(entity.createdAt);
    });

    it('throws for nonexistent entity', () => {
      expect(() => service.updateEntity('nonexistent', { name: 'New' })).toThrow(
        EntityBillingError
      );
    });

    it('updates parent and reparents correctly', () => {
      const parent1 = service.createEntity(makeEntityInput({ name: 'Parent1' }));
      const parent2 = service.createEntity(makeEntityInput({ name: 'Parent2' }));
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: parent1.id })
      );

      const updated = service.updateEntity(child.id, { parentId: parent2.id });

      expect(updated.parentId).toBe(parent2.id);
      expect(service.getEntity(parent1.id)?.childIds).not.toContain(child.id);
      expect(service.getEntity(parent2.id)?.childIds).toContain(child.id);
    });

    it('removes parent when set to null', () => {
      const parent = service.createEntity(makeEntityInput({ name: 'Parent' }));
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: parent.id })
      );

      const updated = service.updateEntity(child.id, { parentId: null });

      expect(updated.parentId).toBeNull();
      expect(service.getEntity(parent.id)?.childIds).not.toContain(child.id);
    });
  });

  describe('deleteEntity', () => {
    it('deletes an entity without children', () => {
      const entity = service.createEntity(makeEntityInput());
      expect(service.deleteEntity(entity.id)).toBe(true);
      expect(service.getEntity(entity.id)).toBeUndefined();
    });

    it('throws when deleting entity with children', () => {
      const parent = service.createEntity(makeEntityInput({ name: 'Parent' }));
      service.createEntity(makeEntityInput({ name: 'Child', parentId: parent.id }));

      expect(() => service.deleteEntity(parent.id)).toThrow(
        'Cannot delete entity with children'
      );
    });

    it('returns false for nonexistent entity', () => {
      expect(service.deleteEntity('nonexistent')).toBe(false);
    });

    it('removes from parent children list on delete', () => {
      const parent = service.createEntity(makeEntityInput({ name: 'Parent' }));
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: parent.id })
      );

      service.deleteEntity(child.id);

      expect(service.getEntity(parent.id)?.childIds).not.toContain(child.id);
    });
  });

  // ── Entity Hierarchy ────────────────────────────────────────────────────

  describe('getChildEntities', () => {
    it('returns child entities', () => {
      const parent = service.createEntity(makeEntityInput({ name: 'Parent' }));
      service.createEntity(makeEntityInput({ name: 'Child1', parentId: parent.id }));
      service.createEntity(makeEntityInput({ name: 'Child2', parentId: parent.id }));

      const children = service.getChildEntities(parent.id);
      expect(children).toHaveLength(2);
    });

    it('throws for nonexistent parent', () => {
      expect(() => service.getChildEntities('nonexistent')).toThrow(
        EntityBillingError
      );
    });
  });

  describe('getRootEntity', () => {
    it('returns self for root entity', () => {
      const root = service.createEntity(makeEntityInput({ name: 'Root' }));
      expect(service.getRootEntity(root.id).id).toBe(root.id);
    });

    it('traverses up to find root', () => {
      const root = service.createEntity(makeEntityInput({ name: 'Root' }));
      const middle = service.createEntity(
        makeEntityInput({ name: 'Middle', parentId: root.id })
      );
      const leaf = service.createEntity(
        makeEntityInput({ name: 'Leaf', parentId: middle.id })
      );

      expect(service.getRootEntity(leaf.id).id).toBe(root.id);
    });
  });

  describe('getEntityHierarchy', () => {
    it('builds correct hierarchy tree', () => {
      const root = service.createEntity(makeEntityInput({ name: 'Root' }));
      const child1 = service.createEntity(
        makeEntityInput({ name: 'Child1', parentId: root.id })
      );
      const child2 = service.createEntity(
        makeEntityInput({ name: 'Child2', parentId: root.id })
      );
      service.createEntity(
        makeEntityInput({ name: 'Grandchild', parentId: child1.id })
      );

      const hierarchy = service.getEntityHierarchy(root.id);

      expect(hierarchy.entity.id).toBe(root.id);
      expect(hierarchy.level).toBe(0);
      expect(hierarchy.children).toHaveLength(2);
      expect(hierarchy.children[0].entity.id).toBe(child1.id);
      expect(hierarchy.children[1].entity.id).toBe(child2.id);
      expect(hierarchy.children[0].children).toHaveLength(1);
      expect(hierarchy.children[0].children[0].level).toBe(2);
    });

    it('throws for nonexistent entity', () => {
      expect(() => service.getEntityHierarchy('nonexistent')).toThrow(
        EntityBillingError
      );
    });
  });

  describe('getDescendantIds', () => {
    it('returns all descendants including self', () => {
      const root = service.createEntity(makeEntityInput({ name: 'Root' }));
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: root.id })
      );
      service.createEntity(makeEntityInput({ name: 'Grandchild', parentId: child.id }));

      const ids = service.getDescendantIds(root.id);
      expect(ids).toContain(root.id);
      expect(ids).toContain(child.id);
      expect(ids).toHaveLength(3);
    });
  });

  // ── Entity Members ──────────────────────────────────────────────────────

  describe('addMember', () => {
    it('adds a member to an entity', () => {
      const entity = service.createEntity(makeEntityInput());
      const updated = service.addMember(entity.id, makeMember('user1', 'admin'));

      expect(updated.members).toHaveLength(1);
      expect(updated.members[0].userId).toBe('user1');
      expect(updated.members[0].role).toBe('admin');
    });

    it('throws for duplicate member', () => {
      const entity = service.createEntity(makeEntityInput());
      service.addMember(entity.id, makeMember('user1'));

      expect(() => service.addMember(entity.id, makeMember('user1'))).toThrow(
        'already a member'
      );
    });

    it('throws for nonexistent entity', () => {
      expect(() => service.addMember('nonexistent', makeMember('user1'))).toThrow(
        EntityBillingError
      );
    });
  });

  describe('removeMember', () => {
    it('removes a member', () => {
      const entity = service.createEntity(makeEntityInput());
      service.addMember(entity.id, makeMember('user1'));

      const updated = service.removeMember(entity.id, 'user1');
      expect(updated.members).toHaveLength(0);
    });

    it('throws when member not found', () => {
      const entity = service.createEntity(makeEntityInput());
      expect(() => service.removeMember(entity.id, 'nonexistent')).toThrow(
        'not a member'
      );
    });
  });

  describe('updateMemberRole', () => {
    it('updates a member role', () => {
      const entity = service.createEntity(makeEntityInput());
      service.addMember(entity.id, makeMember('user1', 'viewer'));

      const updated = service.updateMemberRole(entity.id, 'user1', 'admin');
      expect(updated.members[0].role).toBe('admin');
    });

    it('throws when member not found', () => {
      const entity = service.createEntity(makeEntityInput());
      expect(() => service.updateMemberRole(entity.id, 'nonexistent', 'admin')).toThrow(
        EntityBillingError
      );
    });
  });

  // ── Consolidated Billing ────────────────────────────────────────────────

  describe('recordCharge', () => {
    it('records a charge for an entity', () => {
      const entity = service.createEntity(makeEntityInput());
      const charge = service.recordCharge({
        subscriptionId: 'sub_1',
        entityId: entity.id,
        amount: 99.99,
        currency: 'USD',
        billingCycle: 'monthly',
      });

      expect(charge.subscriptionId).toBe('sub_1');
      expect(charge.amount).toBe(99.99);
      expect(charge.chargedAt).toBeInstanceOf(Date);
    });

    it('throws for nonexistent entity', () => {
      expect(() =>
        service.recordCharge({
          subscriptionId: 'sub_1',
          entityId: 'nonexistent',
          amount: 10,
          currency: 'USD',
          billingCycle: 'monthly',
        })
      ).toThrow(EntityBillingError);
    });
  });

  describe('getEntityCharges', () => {
    it('filters charges by entity', () => {
      const entity1 = service.createEntity(makeEntityInput({ name: 'E1' }));
      const entity2 = service.createEntity(makeEntityInput({ name: 'E2' }));

      service.recordCharge({
        subscriptionId: 'sub_1',
        entityId: entity1.id,
        amount: 10,
        currency: 'USD',
        billingCycle: 'monthly',
      });
      service.recordCharge({
        subscriptionId: 'sub_2',
        entityId: entity2.id,
        amount: 20,
        currency: 'USD',
        billingCycle: 'monthly',
      });

      const charges = service.getEntityCharges(entity1.id);
      expect(charges).toHaveLength(1);
      expect(charges[0].amount).toBe(10);
    });

    it('filters by period', () => {
      const entity = service.createEntity(makeEntityInput());
      const now = new Date();

      service.recordCharge({
        subscriptionId: 'sub_1',
        entityId: entity.id,
        amount: 10,
        currency: 'USD',
        billingCycle: 'monthly',
        chargedAt: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
      });
      service.recordCharge({
        subscriptionId: 'sub_2',
        entityId: entity.id,
        amount: 20,
        currency: 'USD',
        billingCycle: 'monthly',
        chargedAt: now,
      });

      const charges = service.getEntityCharges(
        entity.id,
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        now
      );
      expect(charges).toHaveLength(1);
      expect(charges[0].amount).toBe(20);
    });
  });

  describe('getConsolidatedBillingSummary', () => {
    it('aggregates charges across entity hierarchy', () => {
      const root = service.createEntity(makeEntityInput({ name: 'Root' }));
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: root.id })
      );
      service.createEntity(
        makeEntityInput({ name: 'Grandchild', parentId: child.id })
      );

      const now = new Date();

      service.recordCharge({
        subscriptionId: 'sub_1',
        entityId: root.id,
        amount: 100,
        currency: 'USD',
        billingCycle: 'monthly',
        chargedAt: now,
      });
      service.recordCharge({
        subscriptionId: 'sub_2',
        entityId: child.id,
        amount: 50,
        currency: 'USD',
        billingCycle: 'monthly',
        chargedAt: now,
      });
      // This charge is for an entity outside the hierarchy and should be excluded
      const outsideEntity = service.createEntity(makeEntityInput({ name: 'Outside' }));
      service.recordCharge({
        subscriptionId: 'sub_3',
        entityId: outsideEntity.id,
        amount: 999,
        currency: 'USD',
        billingCycle: 'monthly',
        chargedAt: now,
      });

      const summary: ConsolidatedBillingSummary = service.getConsolidatedBillingSummary(
        root.id,
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        now
      );

      expect(summary.rootEntityId).toBe(root.id);
      expect(summary.totalAmount).toBe(150);
      expect(summary.entityCount).toBe(3);
      expect(summary.entityBreakdown).toHaveLength(2);
    });

    it('throws for nonexistent root entity', () => {
      expect(() =>
        service.getConsolidatedBillingSummary('nonexistent', new Date(), new Date())
      ).toThrow(EntityBillingError);
    });
  });

  // ── Consolidated Invoicing ──────────────────────────────────────────────

  describe('generateConsolidatedInvoice', () => {
    it('generates invoice with line items from hierarchy', () => {
      const root = service.createEntity(makeEntityInput({ name: 'Root', currency: 'EUR' }));
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: root.id })
      );

      const now = new Date();

      service.recordCharge({
        subscriptionId: 'sub_1',
        entityId: root.id,
        amount: 100,
        currency: 'EUR',
        billingCycle: 'monthly',
        chargedAt: now,
      });
      service.recordCharge({
        subscriptionId: 'sub_2',
        entityId: child.id,
        amount: 50,
        currency: 'EUR',
        billingCycle: 'monthly',
        chargedAt: now,
      });

      const invoice = service.generateConsolidatedInvoice(
        root.id,
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        now
      );

      expect(invoice.id).toMatch(/^cinv_/);
      expect(invoice.rootEntityId).toBe(root.id);
      expect(invoice.totalAmount).toBe(150);
      expect(invoice.currency).toBe('EUR');
      expect(invoice.lineItems).toHaveLength(2);
      expect(invoice.lineItems[0].entityName).toBe('Root');
      expect(invoice.lineItems[1].entityName).toBe('Child');
    });

    it('retrieves invoices by entity', () => {
      const entity = service.createEntity(makeEntityInput());
      const now = new Date();

      service.recordCharge({
        subscriptionId: 'sub_1',
        entityId: entity.id,
        amount: 10,
        currency: 'USD',
        billingCycle: 'monthly',
        chargedAt: now,
      });

      service.generateConsolidatedInvoice(
        entity.id,
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        now
      );
      service.generateConsolidatedInvoice(
        entity.id,
        new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      );

      const invoices = service.getEntityInvoices(entity.id);
      expect(invoices).toHaveLength(2);
    });

    it('throws for nonexistent entity', () => {
      expect(() =>
        service.generateConsolidatedInvoice('nonexistent', new Date(), new Date())
      ).toThrow(EntityBillingError);
    });
  });

  // ── Entity Analytics ────────────────────────────────────────────────────

  describe('getEntityAnalytics', () => {
    it('calculates analytics with rollup from descendants', () => {
      const root = service.createEntity(makeEntityInput({ name: 'Root' }));
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: root.id })
      );

      const now = new Date();

      service.recordCharge({
        subscriptionId: 'sub_1',
        entityId: root.id,
        amount: 100,
        currency: 'USD',
        billingCycle: 'monthly',
        chargedAt: now,
      });
      service.recordCharge({
        subscriptionId: 'sub_2',
        entityId: child.id,
        amount: 50,
        currency: 'USD',
        billingCycle: 'monthly',
        chargedAt: now,
      });

      const analytics = service.getEntityAnalytics(root.id);

      expect(analytics.entityId).toBe(root.id);
      expect(analytics.totalMRR).toBe(150);
      expect(analytics.totalSubscriptions).toBe(2);
      expect(analytics.activeSubscriptions).toBe(2);
      expect(analytics.churnedThisMonth).toBe(0);
      expect(analytics.currency).toBe('USD');
      expect(analytics.childBreakdown).toHaveLength(1);
      expect(analytics.childBreakdown[0].entityId).toBe(child.id);
      expect(analytics.childBreakdown[0].mrr).toBe(50);
    });

    it('detects churned subscriptions', () => {
      const entity = service.createEntity(makeEntityInput());
      const now = new Date();
      const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

      // Charge in previous month only
      service.recordCharge({
        subscriptionId: 'sub_churned',
        entityId: entity.id,
        amount: 10,
        currency: 'USD',
        billingCycle: 'monthly',
        chargedAt: previousMonth,
      });
      // Charge in current month
      service.recordCharge({
        subscriptionId: 'sub_active',
        entityId: entity.id,
        amount: 10,
        currency: 'USD',
        billingCycle: 'monthly',
        chargedAt: now,
      });

      const analytics = service.getEntityAnalytics(entity.id);
      expect(analytics.churnedThisMonth).toBe(1);
    });

    it('throws for nonexistent entity', () => {
      expect(() => service.getEntityAnalytics('nonexistent')).toThrow(
        EntityBillingError
      );
    });
  });

  // ── Entity Merge (Acquisition) ──────────────────────────────────────────

  describe('mergeEntities', () => {
    it('merges absorbed entity into surviving entity', () => {
      const surviving = service.createEntity(makeEntityInput({ name: 'Surviving' }));
      const absorbed = service.createEntity(makeEntityInput({ name: 'Absorbed' }));

      service.addMember(absorbed.id, makeMember('absorbed_user'));
      service.recordCharge({
        subscriptionId: 'sub_1',
        entityId: absorbed.id,
        amount: 50,
        currency: 'USD',
        billingCycle: 'monthly',
      });

      const result = service.mergeEntities(surviving.id, absorbed.id);

      expect(result.survivingEntityId).toBe(surviving.id);
      expect(result.absorbedEntityId).toBe(absorbed.id);
      expect(result.migratedSubscriptions).toBe(1);
      expect(result.migratedMembers).toBe(1);

      // Absorbed entity should be deleted
      expect(service.getEntity(absorbed.id)).toBeUndefined();

      // Surviving entity should have the member
      const updatedSurviving = service.getEntity(surviving.id);
      expect(updatedSurviving?.members.some((m) => m.userId === 'absorbed_user')).toBe(true);
    });

    it('reparents children of absorbed entity', () => {
      const surviving = service.createEntity(makeEntityInput({ name: 'Surviving' }));
      const absorbed = service.createEntity(makeEntityInput({ name: 'Absorbed' }));
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: absorbed.id })
      );

      service.mergeEntities(surviving.id, absorbed.id);

      expect(service.getEntity(child.id)?.parentId).toBe(surviving.id);
      expect(service.getEntity(surviving.id)?.childIds).toContain(child.id);
    });

    it('throws when merging entity into itself', () => {
      const entity = service.createEntity(makeEntityInput());
      expect(() => service.mergeEntities(entity.id, entity.id)).toThrow(
        'Cannot merge an entity into itself'
      );
    });

    it('throws when surviving entity not found', () => {
      const absorbed = service.createEntity(makeEntityInput());
      expect(() => service.mergeEntities('nonexistent', absorbed.id)).toThrow(
        EntityBillingError
      );
    });

    it('throws when absorbed entity not found', () => {
      const surviving = service.createEntity(makeEntityInput());
      expect(() => service.mergeEntities(surviving.id, 'nonexistent')).toThrow(
        EntityBillingError
      );
    });
  });

  // ── Entity Divestiture ──────────────────────────────────────────────────

  describe('divestEntity', () => {
    it('detaches entity from parent', () => {
      const parent = service.createEntity(makeEntityInput({ name: 'Parent' }));
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: parent.id })
      );

      const result = service.divestEntity(child.id);

      expect(result.detachedEntityId).toBe(child.id);
      expect(result.formerParentId).toBe(parent.id);

      // Child should now be root
      expect(service.getEntity(child.id)?.parentId).toBeNull();
      expect(service.getEntity(child.id)?.status).toBe(EntityStatus.DIVESTED);

      // Parent should not have child in children list
      expect(service.getEntity(parent.id)?.childIds).not.toContain(child.id);
    });

    it('throws for root entity', () => {
      const root = service.createEntity(makeEntityInput());
      expect(() => service.divestEntity(root.id)).toThrow(
        'is already a root entity'
      );
    });

    it('throws for nonexistent entity', () => {
      expect(() => service.divestEntity('nonexistent')).toThrow(EntityBillingError);
    });
  });

  // ── Utility Methods ─────────────────────────────────────────────────────

  describe('findEntitiesByStatus', () => {
    it('finds entities by status', () => {
      service.createEntity(makeEntityInput({ name: 'Active', status: EntityStatus.ACTIVE }));
      service.createEntity(makeEntityInput({ name: 'Inactive', status: EntityStatus.INACTIVE }));
      service.createEntity(makeEntityInput({ name: 'Active2', status: EntityStatus.ACTIVE }));

      const active = service.findEntitiesByStatus(EntityStatus.ACTIVE);
      expect(active).toHaveLength(2);

      const inactive = service.findEntitiesByStatus(EntityStatus.INACTIVE);
      expect(inactive).toHaveLength(1);
    });
  });

  describe('findEntitiesByCurrency', () => {
    it('finds entities by currency', () => {
      service.createEntity(makeEntityInput({ name: 'USD1', currency: 'USD' }));
      service.createEntity(makeEntityInput({ name: 'EUR1', currency: 'EUR' }));
      service.createEntity(makeEntityInput({ name: 'USD2', currency: 'USD' }));

      const usdEntities = service.findEntitiesByCurrency('USD');
      expect(usdEntities).toHaveLength(2);
    });
  });

  describe('isConsolidatedBilling', () => {
    it('returns true when consolidated billing is enabled', () => {
      const entity = service.createEntity(
        makeEntityInput({ consolidatedBilling: true })
      );
      expect(service.isConsolidatedBilling(entity.id)).toBe(true);
    });

    it('returns false when consolidated billing is disabled', () => {
      const entity = service.createEntity(
        makeEntityInput({ consolidatedBilling: false })
      );
      expect(service.isConsolidatedBilling(entity.id)).toBe(false);
    });

    it('throws for nonexistent entity', () => {
      expect(() => service.isConsolidatedBilling('nonexistent')).toThrow(
        EntityBillingError
      );
    });
  });

  describe('getEffectiveBillingEntity', () => {
    it('returns self when consolidated billing is false', () => {
      const parent = service.createEntity(makeEntityInput({ name: 'Parent' }));
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: parent.id, consolidatedBilling: false })
      );

      const effective = service.getEffectiveBillingEntity(child.id);
      expect(effective.id).toBe(child.id);
    });

    it('returns root when consolidated billing is true', () => {
      const root = service.createEntity(makeEntityInput({ name: 'Root' }));
      const parent = service.createEntity(
        makeEntityInput({ name: 'Parent', parentId: root.id })
      );
      const child = service.createEntity(
        makeEntityInput({ name: 'Child', parentId: parent.id, consolidatedBilling: true })
      );

      const effective = service.getEffectiveBillingEntity(child.id);
      expect(effective.id).toBe(root.id);
    });

    it('returns self when no parent even if consolidated billing is true', () => {
      const entity = service.createEntity(
        makeEntityInput({ consolidatedBilling: true })
      );
      const effective = service.getEffectiveBillingEntity(entity.id);
      expect(effective.id).toBe(entity.id);
    });
  });

  describe('clear', () => {
    it('removes all data', () => {
      service.createEntity(makeEntityInput());
      service.clear();
      expect(service.getAllEntities()).toHaveLength(0);
    });
  });
});
