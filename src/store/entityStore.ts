import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Entity,
  EntityAnalytics,
  EntityMember,
  EntityMergeResult,
  EntityDivestitureResult,
  EntityRole,
  EntityStatus,
  ConsolidatedInvoice,
} from '../types/entity';

const generateId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;

// ---------------------------------------------------------------------------
// EntityService – domain logic (pure functions, no side-effects)
// ---------------------------------------------------------------------------

export function createEntity(
  name: string,
  currency: string,
  parentId: string | null = null,
  options: Partial<Entity> = {}
): Entity {
  const now = new Date();
  return {
    id: generateId(),
    name,
    legalName: options.legalName,
    taxJurisdiction: options.taxJurisdiction,
    currency,
    parentId,
    childIds: [],
    status: EntityStatus.ACTIVE,
    members: options.members ?? [],
    paymentMethodId: options.paymentMethodId,
    consolidatedBilling: options.consolidatedBilling ?? parentId !== null,
    createdAt: now,
    updatedAt: now,
  };
}

export function addMember(entity: Entity, member: EntityMember): Entity {
  if (entity.members.some((m) => m.userId === member.userId)) {
    throw new Error(`User ${member.userId} is already a member of entity ${entity.id}`);
  }
  return { ...entity, members: [...entity.members, member], updatedAt: new Date() };
}

export function removeMember(entity: Entity, userId: string): Entity {
  return {
    ...entity,
    members: entity.members.filter((m) => m.userId !== userId),
    updatedAt: new Date(),
  };
}

export function updateMemberRole(entity: Entity, userId: string, role: EntityRole): Entity {
  return {
    ...entity,
    members: entity.members.map((m) => (m.userId === userId ? { ...m, role } : m)),
    updatedAt: new Date(),
  };
}

/** Resolve effective role: global admin > entity admin > viewer */
export function resolveRole(entity: Entity, userId: string): EntityRole | null {
  const member = entity.members.find((m) => m.userId === userId);
  return member?.role ?? null;
}

/**
 * Build aggregate analytics for an entity and its entire descendant tree.
 * subscriptionsByEntity is a map of entityId → subscriptions with { price, isActive }.
 */
export function computeEntityAnalytics(
  entity: Entity,
  allEntities: Entity[],
  subscriptionsByEntity: Map<string, { price: number; isActive: boolean }[]>
): EntityAnalytics {
  const getSubtreeMRR = (eid: string): number => {
    const subs = subscriptionsByEntity.get(eid) ?? [];
    const direct = subs.filter((s) => s.isActive).reduce((sum, s) => sum + s.price, 0);
    const e = allEntities.find((x) => x.id === eid);
    if (!e) return direct;
    return direct + e.childIds.reduce((sum, cid) => sum + getSubtreeMRR(cid), 0);
  };

  const allSubs = subscriptionsByEntity.get(entity.id) ?? [];
  const childBreakdown = entity.childIds.map((cid) => {
    const child = allEntities.find((x) => x.id === cid);
    return { entityId: cid, name: child?.name ?? cid, mrr: getSubtreeMRR(cid) };
  });

  return {
    entityId: entity.id,
    totalMRR: getSubtreeMRR(entity.id),
    totalSubscriptions: allSubs.length,
    activeSubscriptions: allSubs.filter((s) => s.isActive).length,
    churnedThisMonth: 0, // Requires historical data; UI can extend this
    currency: entity.currency,
    childBreakdown,
  };
}

/** Merge absorbedId into survivingId (entity acquisition edge case) */
export function mergeEntities(
  entities: Entity[],
  survivingId: string,
  absorbedId: string
): { entities: Entity[]; result: EntityMergeResult } {
  const surviving = entities.find((e) => e.id === survivingId);
  const absorbed = entities.find((e) => e.id === absorbedId);
  if (!surviving || !absorbed) throw new Error('Entity not found for merge');

  const migratedMembers = absorbed.members.length;
  const mergedMembers = [
    ...surviving.members,
    ...absorbed.members.filter((m) => !surviving.members.some((sm) => sm.userId === m.userId)),
  ];

  const updatedSurviving: Entity = {
    ...surviving,
    members: mergedMembers,
    childIds: [...surviving.childIds, ...absorbed.childIds],
    updatedAt: new Date(),
  };

  // Re-parent absorbed children
  const updatedEntities = entities
    .filter((e) => e.id !== absorbedId)
    .map((e) => {
      if (absorbed.childIds.includes(e.id)) return { ...e, parentId: survivingId };
      if (e.id === survivingId) return updatedSurviving;
      // Remove absorbed from parent's childIds
      if (e.childIds.includes(absorbedId)) {
        return {
          ...e,
          childIds: e.childIds.filter((c) => c !== absorbedId),
          updatedAt: new Date(),
        };
      }
      return e;
    });

  return {
    entities: updatedEntities,
    result: {
      survivingEntityId: survivingId,
      absorbedEntityId: absorbedId,
      migratedSubscriptions: 0,
      migratedMembers,
    },
  };
}

/** Detach an entity from its parent (divestiture edge case) */
export function divestitureEntity(
  entities: Entity[],
  entityId: string
): { entities: Entity[]; result: EntityDivestitureResult } {
  const entity = entities.find((e) => e.id === entityId);
  if (!entity) throw new Error('Entity not found for divestiture');
  if (!entity.parentId) throw new Error('Entity has no parent to divest from');

  const formerParentId = entity.parentId;
  const updatedEntities = entities.map((e) => {
    if (e.id === entityId)
      return { ...e, parentId: null, consolidatedBilling: false, updatedAt: new Date() };
    if (e.id === formerParentId) {
      return { ...e, childIds: e.childIds.filter((c) => c !== entityId), updatedAt: new Date() };
    }
    return e;
  });

  return {
    entities: updatedEntities,
    result: { detachedEntityId: entityId, formerParentId, migratedSubscriptions: 0 },
  };
}

/** Generate a consolidated invoice for all subscriptions under a root entity */
export function buildConsolidatedInvoice(
  rootEntity: Entity,
  allEntities: Entity[],
  subscriptionsByEntity: Map<
    string,
    { id: string; name: string; price: number; currency: string }[]
  >
): ConsolidatedInvoice {
  const lineItems: ConsolidatedInvoice['lineItems'] = [];

  const collectLineItems = (eid: string) => {
    const entity = allEntities.find((e) => e.id === eid);
    if (!entity) return;
    const subs = subscriptionsByEntity.get(eid) ?? [];
    subs.forEach((s) =>
      lineItems.push({
        entityId: eid,
        entityName: entity.name,
        subscriptionId: s.id,
        subscriptionName: s.name,
        amount: s.price,
        currency: s.currency,
      })
    );
    entity.childIds.forEach(collectLineItems);
  };

  collectLineItems(rootEntity.id);

  const totalAmount = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    id: generateId(),
    rootEntityId: rootEntity.id,
    periodStart,
    periodEnd,
    lineItems,
    totalAmount,
    currency: rootEntity.currency,
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Zustand Store
// ---------------------------------------------------------------------------

interface EntityState {
  entities: Entity[];
  selectedEntityId: string | null;
  isLoading: boolean;
  error: string | null;

  addEntity: (
    name: string,
    currency: string,
    parentId?: string | null,
    options?: Partial<Entity>
  ) => Entity;
  updateEntity: (
    id: string,
    updates: Partial<
      Pick<
        Entity,
        | 'name'
        | 'legalName'
        | 'taxJurisdiction'
        | 'currency'
        | 'paymentMethodId'
        | 'consolidatedBilling'
        | 'status'
      >
    >
  ) => void;
  removeEntity: (id: string) => void;
  addEntityMember: (entityId: string, member: EntityMember) => void;
  removeEntityMember: (entityId: string, userId: string) => void;
  updateEntityMemberRole: (entityId: string, userId: string, role: EntityRole) => void;
  mergeEntities: (survivingId: string, absorbedId: string) => EntityMergeResult;
  divestitureEntity: (entityId: string) => EntityDivestitureResult;
  getAnalytics: (
    entityId: string,
    subscriptionsByEntity: Map<string, { price: number; isActive: boolean }[]>
  ) => EntityAnalytics | null;
  buildInvoice: (
    rootEntityId: string,
    subscriptionsByEntity: Map<
      string,
      { id: string; name: string; price: number; currency: string }[]
    >
  ) => ConsolidatedInvoice | null;
  selectEntity: (id: string | null) => void;
}

export const useEntityStore = create<EntityState>()(
  persist(
    (set, get) => ({
      entities: [],
      selectedEntityId: null,
      isLoading: false,
      error: null,

      addEntity: (name, currency, parentId = null, options = {}) => {
        const entity = createEntity(name, currency, parentId, options);
        set((state) => {
          const updatedEntities = [...state.entities, entity].map((e) => {
            if (e.id === parentId) {
              return { ...e, childIds: [...e.childIds, entity.id], updatedAt: new Date() };
            }
            return e;
          });
          return { entities: updatedEntities, error: null };
        });
        return entity;
      },

      updateEntity: (id, updates) => {
        set((state) => ({
          entities: state.entities.map((e) =>
            e.id === id ? { ...e, ...updates, updatedAt: new Date() } : e
          ),
          error: null,
        }));
      },

      removeEntity: (id) => {
        set((state) => {
          const entity = state.entities.find((e) => e.id === id);
          const updated = state.entities
            .filter((e) => e.id !== id)
            .map((e) => {
              if (entity?.parentId && e.id === entity.parentId) {
                return { ...e, childIds: e.childIds.filter((c) => c !== id) };
              }
              return e;
            });
          return {
            entities: updated,
            selectedEntityId: state.selectedEntityId === id ? null : state.selectedEntityId,
          };
        });
      },

      addEntityMember: (entityId, member) => {
        try {
          set((state) => ({
            entities: state.entities.map((e) => (e.id === entityId ? addMember(e, member) : e)),
            error: null,
          }));
        } catch (err) {
          set({ error: (err as Error).message });
        }
      },

      removeEntityMember: (entityId, userId) => {
        set((state) => ({
          entities: state.entities.map((e) => (e.id === entityId ? removeMember(e, userId) : e)),
        }));
      },

      updateEntityMemberRole: (entityId, userId, role) => {
        set((state) => ({
          entities: state.entities.map((e) =>
            e.id === entityId ? updateMemberRole(e, userId, role) : e
          ),
        }));
      },

      mergeEntities: (survivingId, absorbedId) => {
        try {
          const { entities, result } = mergeEntities(get().entities, survivingId, absorbedId);
          set({ entities, error: null });
          return result;
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      divestitureEntity: (entityId) => {
        try {
          const { entities, result } = divestitureEntity(get().entities, entityId);
          set({ entities, error: null });
          return result;
        } catch (err) {
          set({ error: (err as Error).message });
          throw err;
        }
      },

      getAnalytics: (entityId, subscriptionsByEntity) => {
        const all = get().entities;
        const entity = all.find((e) => e.id === entityId);
        if (!entity) return null;
        return computeEntityAnalytics(entity, all, subscriptionsByEntity);
      },

      buildInvoice: (rootEntityId, subscriptionsByEntity) => {
        const all = get().entities;
        const root = all.find((e) => e.id === rootEntityId);
        if (!root) return null;
        return buildConsolidatedInvoice(root, all, subscriptionsByEntity);
      },

      selectEntity: (id) => set({ selectedEntityId: id }),
    }),
    {
      name: 'subtrackr-entities',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
