/** Multi-entity / brand management types (Issue #562) */

export enum EntityRole {
  GLOBAL_ADMIN = 'global_admin',
  ENTITY_ADMIN = 'entity_admin',
  VIEWER = 'viewer',
}

export enum EntityStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  ACQUIRED = 'acquired',
  DIVESTED = 'divested',
}

export interface EntityMember {
  userId: string;
  email: string;
  role: EntityRole;
  entityId: string;
}

export interface Entity {
  id: string;
  name: string;
  /** Legal / registered name (may differ from display name) */
  legalName?: string;
  /** Tax jurisdiction for consolidated reporting */
  taxJurisdiction?: string;
  /** ISO 4217 currency for this entity's billing */
  currency: string;
  parentId: string | null;
  childIds: string[];
  status: EntityStatus;
  members: EntityMember[];
  /** Payment method shared from parent, or entity-specific */
  paymentMethodId?: string;
  /** If true, parent account pays all subscriptions for this entity */
  consolidatedBilling: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Aggregate stats rolled up across an entity and all descendants */
export interface EntityAnalytics {
  entityId: string;
  totalMRR: number;
  totalSubscriptions: number;
  activeSubscriptions: number;
  churnedThisMonth: number;
  currency: string;
  /** MRR broken down by direct children */
  childBreakdown: { entityId: string; name: string; mrr: number }[];
}

/** Result of merging two entity hierarchies (acquisition) */
export interface EntityMergeResult {
  survivingEntityId: string;
  absorbedEntityId: string;
  migratedSubscriptions: number;
  migratedMembers: number;
}

/** Result of splitting an entity out of a hierarchy (divestiture) */
export interface EntityDivestitureResult {
  detachedEntityId: string;
  formerParentId: string;
  migratedSubscriptions: number;
}

export interface ConsolidatedInvoice {
  id: string;
  rootEntityId: string;
  periodStart: Date;
  periodEnd: Date;
  lineItems: {
    entityId: string;
    entityName: string;
    subscriptionId: string;
    subscriptionName: string;
    amount: number;
    currency: string;
  }[];
  totalAmount: number;
  currency: string;
  createdAt: Date;
}
