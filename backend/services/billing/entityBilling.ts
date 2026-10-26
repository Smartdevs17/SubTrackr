/**
 * Multi-Entity Billing Service
 *
 * Supports billing across organizational entity hierarchies including:
 * - Entity CRUD with parent/child relationships
 * - Consolidated billing (parent pays for children)
 * - Consolidated invoicing across entities
 * - Entity analytics with MRR rollups
 * - Entity merge (acquisition) and divestiture operations
 */
import {
  EntityStatus,
  type Entity,
  type EntityMember,
  type EntityRole,
  type EntityAnalytics,
  type EntityMergeResult,
  type EntityDivestitureResult,
  type ConsolidatedInvoice,
} from '../../../src/types/entity';
import type { Subscription } from '../../../src/types/subscription';

// ── Types ────────────────────────────────────────────────────────────────────

export interface EntityBillingConfig {
  /** Default currency for new entities */
  defaultCurrency: string;
  /** Whether to auto-consolidate child billing into parent */
  autoConsolidate: boolean;
  /** Tax jurisdiction fallback */
  defaultTaxJurisdiction?: string;
}

export interface EntityCharge {
  subscriptionId: string;
  entityId: string;
  amount: number;
  currency: string;
  billingCycle: string;
  chargedAt: Date;
}

export interface EntityInvoiceLineItem {
  entityId: string;
  entityName: string;
  subscriptionId: string;
  subscriptionName: string;
  amount: number;
  currency: string;
}

export interface EntityInvoice {
  id: string;
  rootEntityId: string;
  periodStart: Date;
  periodEnd: Date;
  lineItems: EntityInvoiceLineItem[];
  totalAmount: number;
  currency: string;
  status: 'draft' | 'issued' | 'paid' | 'overdue';
  createdAt: Date;
}

export interface EntityHierarchyNode {
  entity: Entity;
  children: EntityHierarchyNode[];
  level: number;
}

export interface ConsolidatedBillingSummary {
  rootEntityId: string;
  totalAmount: number;
  currency: string;
  entityCount: number;
  subscriptionCount: number;
  periodStart: Date;
  periodEnd: Date;
  entityBreakdown: Array<{
    entityId: string;
    entityName: string;
    amount: number;
    subscriptionCount: number;
  }>;
}

// ── ID Generation ─────────────────────────────────────────────────────────────

let idCounter = 0;
const generateId = (prefix: string): string => {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
};

// ── Validation ───────────────────────────────────────────────────────────────

export class EntityBillingError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EntityBillingError';
  }
}

const validateEntityInput = (input: Partial<Entity>): void => {
  if (!input.name || input.name.trim().length === 0) {
    throw new EntityBillingError('Entity name is required', 'ENTITY_NAME_REQUIRED');
  }
  if (!input.currency || input.currency.trim().length === 0) {
    throw new EntityBillingError('Entity currency is required', 'ENTITY_CURRENCY_REQUIRED');
  }
  if (input.currency.length !== 3) {
    throw new EntityBillingError('Currency must be a 3-letter ISO code', 'ENTITY_INVALID_CURRENCY');
  }
};

const validateNoCycle = (entities: Map<string, Entity>, parentId: string, childId: string): void => {
  // Check that adding childId under parentId wouldn't create a cycle
  let current: Entity | undefined = entities.get(parentId);
  while (current) {
    if (current.id === childId) {
      throw new EntityBillingError(
        'Cannot create circular entity hierarchy',
        'ENTITY_CYCLE_DETECTED',
        { parentId, childId }
      );
    }
    current = current.parentId ? entities.get(current.parentId) : undefined;
  }
};

// ── Entity Billing Service ───────────────────────────────────────────────────

export class EntityBillingService {
  private entities = new Map<string, Entity>();
  private charges: EntityCharge[] = [];
  private invoices = new Map<string, EntityInvoice[]>();
  private config: EntityBillingConfig;

  constructor(config?: Partial<EntityBillingConfig>) {
    this.config = {
      defaultCurrency: 'USD',
      autoConsolidate: true,
      ...config,
    };
  }

  // ── Entity CRUD ──────────────────────────────────────────────────────────

  createEntity(input: Omit<Entity, 'id' | 'createdAt' | 'updatedAt' | 'childIds' | 'members'> & { members?: EntityMember[] }): Entity {
    validateEntityInput(input);

    const now = new Date();
    const entity: Entity = {
      id: generateId('ent'),
      name: input.name,
      legalName: input.legalName,
      taxJurisdiction: input.taxJurisdiction ?? this.config.defaultTaxJurisdiction,
      currency: input.currency,
      parentId: input.parentId ?? null,
      childIds: [],
      status: input.status ?? EntityStatus.ACTIVE,
      members: input.members ?? [],
      paymentMethodId: input.paymentMethodId,
      consolidatedBilling: input.consolidatedBilling ?? false,
      createdAt: now,
      updatedAt: now,
    };

    // Validate parent exists and no cycle
    if (entity.parentId) {
      const parent = this.entities.get(entity.parentId);
      if (!parent) {
        throw new EntityBillingError(
          `Parent entity ${entity.parentId} not found`,
          'ENTITY_PARENT_NOT_FOUND'
        );
      }
      validateNoCycle(this.entities, entity.parentId, entity.id);
      parent.childIds.push(entity.id);
      parent.updatedAt = now;
    }

    this.entities.set(entity.id, entity);
    return entity;
  }

  getEntity(id: string): Entity | undefined {
    const entity = this.entities.get(id);
    return entity ? { ...entity, childIds: [...entity.childIds], members: [...entity.members] } : undefined;
  }

  getAllEntities(): Entity[] {
    return Array.from(this.entities.values()).map((e) => ({
      ...e,
      childIds: [...e.childIds],
      members: [...e.members],
    }));
  }

  updateEntity(id: string, updates: Partial<Omit<Entity, 'id' | 'createdAt'>>): Entity {
    const entity = this.entities.get(id);
    if (!entity) {
      throw new EntityBillingError(`Entity ${id} not found`, 'ENTITY_NOT_FOUND');
    }

    // Validate currency if provided
    if (updates.currency) {
      validateEntityInput({ name: entity.name, currency: updates.currency });
    }

    // Validate parent change doesn't create cycle
    if (updates.parentId !== undefined && updates.parentId !== entity.parentId) {
      if (updates.parentId === id) {
        throw new EntityBillingError('Entity cannot be its own parent', 'ENTITY_SELF_PARENT');
      }
      if (updates.parentId) {
        const newParent = this.entities.get(updates.parentId);
        if (!newParent) {
          throw new EntityBillingError(
            `Parent entity ${updates.parentId} not found`,
            'ENTITY_PARENT_NOT_FOUND'
          );
        }
        validateNoCycle(this.entities, updates.parentId, id);

        // Remove from old parent's children
        if (entity.parentId) {
          const oldParent = this.entities.get(entity.parentId);
          if (oldParent) {
            oldParent.childIds = oldParent.childIds.filter((cid) => cid !== id);
            oldParent.updatedAt = new Date();
          }
        }
        // Add to new parent's children
        newParent.childIds.push(id);
        newParent.updatedAt = new Date();
      } else {
        // Removing parent - remove from old parent's children
        if (entity.parentId) {
          const oldParent = this.entities.get(entity.parentId);
          if (oldParent) {
            oldParent.childIds = oldParent.childIds.filter((cid) => cid !== id);
            oldParent.updatedAt = new Date();
          }
        }
      }
    }

    const updated: Entity = {
      ...entity,
      ...updates,
      id: entity.id,
      createdAt: entity.createdAt,
      updatedAt: new Date(),
    };
    this.entities.set(id, updated);
    return { ...updated, childIds: [...updated.childIds], members: [...updated.members] };
  }

  deleteEntity(id: string): boolean {
    const entity = this.entities.get(id);
    if (!entity) return false;

    // Cannot delete if has children
    if (entity.childIds.length > 0) {
      throw new EntityBillingError(
        'Cannot delete entity with children. Reassign or delete children first.',
        'ENTITY_HAS_CHILDREN'
      );
    }

    // Remove from parent's children
    if (entity.parentId) {
      const parent = this.entities.get(entity.parentId);
      if (parent) {
        parent.childIds = parent.childIds.filter((cid) => cid !== id);
        parent.updatedAt = new Date();
      }
    }

    this.entities.delete(id);
    return true;
  }

  // ── Entity Hierarchy ─────────────────────────────────────────────────────

  getChildEntities(parentId: string): Entity[] {
    const parent = this.entities.get(parentId);
    if (!parent) {
      throw new EntityBillingError(`Entity ${parentId} not found`, 'ENTITY_NOT_FOUND');
    }
    return parent.childIds
      .map((cid) => this.entities.get(cid))
      .filter((e): e is Entity => e !== undefined)
      .map((e) => ({ ...e, childIds: [...e.childIds], members: [...e.members] }));
  }

  getRootEntity(entityId: string): Entity {
    let current = this.entities.get(entityId);
    if (!current) {
      throw new EntityBillingError(`Entity ${entityId} not found`, 'ENTITY_NOT_FOUND');
    }
    const visited = new Set<string>();
    while (current.parentId) {
      if (visited.has(current.id)) {
        throw new EntityBillingError('Circular hierarchy detected', 'ENTITY_CYCLE_DETECTED');
      }
      visited.add(current.id);
      const parent = this.entities.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return { ...current, childIds: [...current.childIds], members: [...current.members] };
  }

  getEntityHierarchy(rootId: string): EntityHierarchyNode {
    const root = this.entities.get(rootId);
    if (!root) {
      throw new EntityBillingError(`Entity ${rootId} not found`, 'ENTITY_NOT_FOUND');
    }

    const buildNode = (entity: Entity, level: number): EntityHierarchyNode => ({
      entity: { ...entity, childIds: [...entity.childIds], members: [...entity.members] },
      children: entity.childIds
        .map((cid) => this.entities.get(cid))
        .filter((e): e is Entity => e !== undefined)
        .map((e) => buildNode(e, level + 1)),
      level,
    });

    return buildNode(root, 0);
  }

  /** Returns all descendant entity IDs (including self) */
  getDescendantIds(entityId: string): string[] {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new EntityBillingError(`Entity ${entityId} not found`, 'ENTITY_NOT_FOUND');
    }
    const ids: string[] = [entityId];
    for (const childId of entity.childIds) {
      ids.push(...this.getDescendantIds(childId));
    }
    return ids;
  }

  // ── Entity Members ───────────────────────────────────────────────────────

  addMember(entityId: string, member: EntityMember): Entity {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new EntityBillingError(`Entity ${entityId} not found`, 'ENTITY_NOT_FOUND');
    }
    if (entity.members.some((m) => m.userId === member.userId)) {
      throw new EntityBillingError(
        `User ${member.userId} is already a member of entity ${entityId}`,
        'ENTITY_DUPLICATE_MEMBER'
      );
    }
    const updated: Entity = {
      ...entity,
      members: [...entity.members, { ...member, entityId }],
      updatedAt: new Date(),
    };
    this.entities.set(entityId, updated);
    return { ...updated, childIds: [...updated.childIds], members: [...updated.members] };
  }

  removeMember(entityId: string, userId: string): Entity {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new EntityBillingError(`Entity ${entityId} not found`, 'ENTITY_NOT_FOUND');
    }
    if (!entity.members.some((m) => m.userId === userId)) {
      throw new EntityBillingError(
        `User ${userId} is not a member of entity ${entityId}`,
        'ENTITY_MEMBER_NOT_FOUND'
      );
    }
    const updated: Entity = {
      ...entity,
      members: entity.members.filter((m) => m.userId !== userId),
      updatedAt: new Date(),
    };
    this.entities.set(entityId, updated);
    return { ...updated, childIds: [...updated.childIds], members: [...updated.members] };
  }

  updateMemberRole(entityId: string, userId: string, role: EntityRole): Entity {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new EntityBillingError(`Entity ${entityId} not found`, 'ENTITY_NOT_FOUND');
    }
    const memberIdx = entity.members.findIndex((m) => m.userId === userId);
    if (memberIdx === -1) {
      throw new EntityBillingError(
        `User ${userId} is not a member of entity ${entityId}`,
        'ENTITY_MEMBER_NOT_FOUND'
      );
    }
    const updatedMembers = [...entity.members];
    updatedMembers[memberIdx] = { ...updatedMembers[memberIdx], role };
    const updated: Entity = {
      ...entity,
      members: updatedMembers,
      updatedAt: new Date(),
    };
    this.entities.set(entityId, updated);
    return { ...updated, childIds: [...updated.childIds], members: [...updated.members] };
  }

  // ── Consolidated Billing ─────────────────────────────────────────────────

  /**
   * Associates a subscription with an entity for billing purposes.
   */
  assignSubscriptionToEntity(subscriptionId: string, entityId: string): void {
    if (!this.entities.has(entityId)) {
      throw new EntityBillingError(`Entity ${entityId} not found`, 'ENTITY_NOT_FOUND');
    }
    // In a real implementation, this would update the subscription record
    // For now we track it via charges
  }

  /**
   * Records a charge against an entity.
   */
  recordCharge(charge: Omit<EntityCharge, 'chargedAt'> & { chargedAt?: Date }): EntityCharge {
    if (!this.entities.has(charge.entityId)) {
      throw new EntityBillingError(`Entity ${charge.entityId} not found`, 'ENTITY_NOT_FOUND');
    }
    const entityCharge: EntityCharge = {
      ...charge,
      chargedAt: charge.chargedAt ?? new Date(),
    };
    this.charges.push(entityCharge);
    return entityCharge;
  }

  /**
   * Gets charges for an entity, optionally filtered by period.
   */
  getEntityCharges(entityId: string, periodStart?: Date, periodEnd?: Date): EntityCharge[] {
    if (!this.entities.has(entityId)) {
      throw new EntityBillingError(`Entity ${entityId} not found`, 'ENTITY_NOT_FOUND');
    }
    return this.charges.filter((c) => {
      if (c.entityId !== entityId) return false;
      if (periodStart && c.chargedAt < periodStart) return false;
      if (periodEnd && c.chargedAt > periodEnd) return false;
      return true;
    });
  }

  /**
   * Calculates consolidated billing for a root entity and all descendants.
   * If consolidatedBilling is true on child entities, their charges roll up to the parent.
   */
  getConsolidatedBillingSummary(rootEntityId: string, periodStart: Date, periodEnd: Date): ConsolidatedBillingSummary {
    const root = this.entities.get(rootEntityId);
    if (!root) {
      throw new EntityBillingError(`Entity ${rootEntityId} not found`, 'ENTITY_NOT_FOUND');
    }

    const descendantIds = this.getDescendantIds(rootEntityId);
    const periodCharges = this.charges.filter(
      (c) => descendantIds.includes(c.entityId) && c.chargedAt >= periodStart && c.chargedAt <= periodEnd
    );

    const entityBreakdownMap = new Map<string, { entityId: string; entityName: string; amount: number; subscriptionCount: number }>();
    const subscriptionSet = new Set<string>();

    for (const charge of periodCharges) {
      const entity = this.entities.get(charge.entityId);
      if (!entity) continue;

      const existing = entityBreakdownMap.get(charge.entityId) ?? {
        entityId: charge.entityId,
        entityName: entity.name,
        amount: 0,
        subscriptionCount: 0,
      };
      existing.amount += charge.amount;
      entityBreakdownMap.set(charge.entityId, existing);
      subscriptionSet.add(charge.subscriptionId);
    }

    const entityBreakdown = Array.from(entityBreakdownMap.values());
    const totalAmount = entityBreakdown.reduce((sum, e) => sum + e.amount, 0);

    return {
      rootEntityId,
      totalAmount,
      currency: root.currency,
      entityCount: descendantIds.length,
      subscriptionCount: subscriptionSet.size,
      periodStart,
      periodEnd,
      entityBreakdown,
    };
  }

  // ── Consolidated Invoicing ───────────────────────────────────────────────

  /**
   * Generates a consolidated invoice for a root entity and all descendants.
   */
  generateConsolidatedInvoice(rootEntityId: string, periodStart: Date, periodEnd: Date, currency?: string): ConsolidatedInvoice {
    const root = this.entities.get(rootEntityId);
    if (!root) {
      throw new EntityBillingError(`Entity ${rootEntityId} not found`, 'ENTITY_NOT_FOUND');
    }

    const descendantIds = this.getDescendantIds(rootEntityId);
    const periodCharges = this.charges.filter(
      (c) => descendantIds.includes(c.entityId) && c.chargedAt >= periodStart && c.chargedAt <= periodEnd
    );

    const lineItems: EntityInvoiceLineItem[] = periodCharges.map((charge) => {
      const entity = this.entities.get(charge.entityId);
      return {
        entityId: charge.entityId,
        entityName: entity?.name ?? 'Unknown',
        subscriptionId: charge.subscriptionId,
        subscriptionName: charge.subscriptionId, // In real impl, lookup subscription name
        amount: charge.amount,
        currency: charge.currency,
      };
    });

    const totalAmount = lineItems.reduce((sum, item) => sum + item.amount, 0);

    const invoice: ConsolidatedInvoice = {
      id: generateId('cinv'),
      rootEntityId,
      periodStart,
      periodEnd,
      lineItems,
      totalAmount,
      currency: currency ?? root.currency,
      createdAt: new Date(),
    };

    // Store invoice
    const existing = this.invoices.get(rootEntityId) ?? [];
    existing.push(invoice);
    this.invoices.set(rootEntityId, existing);

    return invoice;
  }

  getEntityInvoices(entityId: string): ConsolidatedInvoice[] {
    return this.invoices.get(entityId) ?? [];
  }

  // ── Entity Analytics ─────────────────────────────────────────────────────

  /**
   * Calculates analytics for an entity, rolling up data from all descendants.
   */
  getEntityAnalytics(entityId: string): EntityAnalytics {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new EntityBillingError(`Entity ${entityId} not found`, 'ENTITY_NOT_FOUND');
    }

    const descendantIds = this.getDescendantIds(entityId);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const allCharges = this.charges.filter((c) => descendantIds.includes(c.entityId));
    const monthlyCharges = allCharges.filter((c) => c.chargedAt >= monthStart);

    const totalMRR = monthlyCharges.reduce((sum, c) => sum + c.amount, 0);
    const totalSubscriptions = new Set(allCharges.map((c) => c.subscriptionId)).size;
    const activeSubscriptions = new Set(
      monthlyCharges.map((c) => c.subscriptionId)
    ).size;

    // Churned = had charges before this month but not this month
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonthCharges = allCharges.filter(
      (c) => c.chargedAt >= previousMonthStart && c.chargedAt < monthStart
    );
    const previousMonthSubs = new Set(previousMonthCharges.map((c) => c.subscriptionId));
    const currentMonthSubs = new Set(monthlyCharges.map((c) => c.subscriptionId));
    const churnedThisMonth = Array.from(previousMonthSubs).filter(
      (id) => !currentMonthSubs.has(id)
    ).length;

    // Child breakdown
    const childBreakdown = entity.childIds
      .map((childId) => {
        const child = this.entities.get(childId);
        if (!child) return null;
        const childCharges = this.charges.filter(
          (c) => c.entityId === childId && c.chargedAt >= monthStart
        );
        return {
          entityId: childId,
          name: child.name,
          mrr: childCharges.reduce((sum, c) => sum + c.amount, 0),
        };
      })
      .filter((c): c is { entityId: string; name: string; mrr: number } => c !== null);

    return {
      entityId,
      totalMRR,
      totalSubscriptions,
      activeSubscriptions,
      churnedThisMonth,
      currency: entity.currency,
      childBreakdown,
    };
  }

  // ── Entity Merge (Acquisition) ──────────────────────────────────────────

  /**
   * Merges one entity into another (acquisition).
   * The absorbed entity's subscriptions and members migrate to the surviving entity.
   */
  mergeEntities(survivingEntityId: string, absorbedEntityId: string): EntityMergeResult {
    const surviving = this.entities.get(survivingEntityId);
    const absorbed = this.entities.get(absorbedEntityId);

    if (!surviving) {
      throw new EntityBillingError(
        `Surviving entity ${survivingEntityId} not found`,
        'ENTITY_NOT_FOUND'
      );
    }
    if (!absorbed) {
      throw new EntityBillingError(
        `Absorbed entity ${absorbedEntityId} not found`,
        'ENTITY_NOT_FOUND'
      );
    }
    if (survivingEntityId === absorbedEntityId) {
      throw new EntityBillingError(
        'Cannot merge an entity into itself',
        'ENTITY_SELF_MERGE'
      );
    }

    // Migrate members
    const migratedMembers = absorbed.members.length;
    const survivingMembers = new Map(surviving.members.map((m) => [m.userId, m]));
    for (const member of absorbed.members) {
      if (!survivingMembers.has(member.userId)) {
        surviving.members.push({ ...member, entityId: survivingEntityId });
      }
    }

    // Migrate charges to surviving entity
    let migratedSubscriptions = 0;
    const subscriptionSet = new Set<string>();
    for (const charge of this.charges) {
      if (charge.entityId === absorbedEntityId) {
        charge.entityId = survivingEntityId;
        subscriptionSet.add(charge.subscriptionId);
      }
    }
    migratedSubscriptions = subscriptionSet.size;

    // Reparent children of absorbed entity to surviving entity
    for (const childId of absorbed.childIds) {
      const child = this.entities.get(childId);
      if (child) {
        child.parentId = survivingEntityId;
        child.updatedAt = new Date();
        surviving.childIds.push(childId);
      }
    }

    // Remove absorbed from its parent's children
    if (absorbed.parentId) {
      const oldParent = this.entities.get(absorbed.parentId);
      if (oldParent) {
        oldParent.childIds = oldParent.childIds.filter((id) => id !== absorbedEntityId);
        oldParent.updatedAt = new Date();
      }
    }

    // Update surviving entity
    surviving.status = EntityStatus.ACTIVE;
    surviving.updatedAt = new Date();
    this.entities.set(survivingEntityId, surviving);

    // Remove absorbed entity
    this.entities.delete(absorbedEntityId);

    return {
      survivingEntityId,
      absorbedEntityId,
      migratedSubscriptions,
      migratedMembers,
    };
  }

  // ── Entity Divestiture ──────────────────────────────────────────────────

  /**
   * Detaches an entity from its parent, making it a root entity.
   */
  divestEntity(entityId: string): EntityDivestitureResult {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new EntityBillingError(`Entity ${entityId} not found`, 'ENTITY_NOT_FOUND');
    }
    if (!entity.parentId) {
      throw new EntityBillingError(
        `Entity ${entityId} is already a root entity`,
        'ENTITY_ALREADY_ROOT'
      );
    }

    const formerParentId = entity.parentId;

    // Remove from parent's children
    const formerParent = this.entities.get(formerParentId);
    if (formerParent) {
      formerParent.childIds = formerParent.childIds.filter((id) => id !== entityId);
      formerParent.updatedAt = new Date();
    }

    // Detach entity
    entity.parentId = null;
    entity.status = EntityStatus.DIVESTED;
    entity.updatedAt = new Date();
    this.entities.set(entityId, entity);

    // Count migrated subscriptions
    const descendantIds = this.getDescendantIds(entityId);
    const migratedSubscriptions = new Set(
      this.charges
        .filter((c) => descendantIds.includes(c.entityId))
        .map((c) => c.subscriptionId)
    ).size;

    return {
      detachedEntityId: entityId,
      formerParentId,
      migratedSubscriptions,
    };
  }

  // ── Utility ─────────────────────────────────────────────────────────────

  /**
   * Finds entities by status.
   */
  findEntitiesByStatus(status: EntityStatus): Entity[] {
    return this.getAllEntities().filter((e) => e.status === status);
  }

  /**
   * Finds entities by currency.
   */
  findEntitiesByCurrency(currency: string): Entity[] {
    return this.getAllEntities().filter((e) => e.currency === currency);
  }

  /**
   * Checks if an entity has consolidated billing enabled.
   */
  isConsolidatedBilling(entityId: string): boolean {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new EntityBillingError(`Entity ${entityId} not found`, 'ENTITY_NOT_FOUND');
    }
    return entity.consolidatedBilling;
  }

  /**
   * Gets the effective billing entity for a given entity.
   * If the entity has consolidatedBilling, returns the root entity.
   * Otherwise returns the entity itself.
   */
  getEffectiveBillingEntity(entityId: string): Entity {
    const entity = this.entities.get(entityId);
    if (!entity) {
      throw new EntityBillingError(`Entity ${entityId} not found`, 'ENTITY_NOT_FOUND');
    }
    if (entity.consolidatedBilling && entity.parentId) {
      return this.getRootEntity(entity.parentId);
    }
    return { ...entity, childIds: [...entity.childIds], members: [...entity.members] };
  }

  /**
   * Clears all data (useful for testing).
   */
  clear(): void {
    this.entities.clear();
    this.charges = [];
    this.invoices.clear();
  }
}

// Singleton export
export const entityBillingService = new EntityBillingService();
