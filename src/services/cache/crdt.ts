import { Subscription } from '../../types/subscription';

export interface SubscriptionMetadata {
  timestamps: Record<string, number>;
  deletedAt?: number;
}

export interface CRDTSubscriptionState {
  subscriptions: Record<string, Subscription>;
  metadata: Record<string, SubscriptionMetadata>;
}

export class SubscriptionCRDT {
  /**
   * Merges two CRDT subscription states deterministically.
   * Returns a new merged state.
   */
  static merge(stateA: CRDTSubscriptionState, stateB: CRDTSubscriptionState): CRDTSubscriptionState {
    const mergedSubs: Record<string, Subscription> = {};
    const mergedMeta: Record<string, SubscriptionMetadata> = {};

    const allIds = new Set([
      ...Object.keys(stateA.subscriptions || {}),
      ...Object.keys(stateB.subscriptions || {}),
      ...Object.keys(stateA.metadata || {}),
      ...Object.keys(stateB.metadata || {}),
    ]);

    for (const id of allIds) {
      const metaA = (stateA.metadata && stateA.metadata[id]) || { timestamps: {} };
      const metaB = (stateB.metadata && stateB.metadata[id]) || { timestamps: {} };

      const deletedAtA = metaA.deletedAt || 0;
      const deletedAtB = metaB.deletedAt || 0;
      const mergedDeletedAt = Math.max(deletedAtA, deletedAtB);

      // Find the maximum field update timestamp in A and B
      const maxUpdateA = Object.values(metaA.timestamps || {}).reduce((max, t) => Math.max(max, t), 0);
      const maxUpdateB = Object.values(metaB.timestamps || {}).reduce((max, t) => Math.max(max, t), 0);
      const maxUpdate = Math.max(maxUpdateA, maxUpdateB);

      // If deletedAt is newer than any field update, the item is deleted
      if (mergedDeletedAt > 0 && mergedDeletedAt >= maxUpdate) {
        mergedMeta[id] = {
          timestamps: this.mergeTimestamps(metaA.timestamps || {}, metaB.timestamps || {}),
          deletedAt: mergedDeletedAt,
        };
        // Do not add to mergedSubs (it's tombstoned)
        continue;
      }

      // Otherwise, the item is present. Let's merge the fields.
      const subA = stateA.subscriptions && stateA.subscriptions[id];
      const subB = stateB.subscriptions && stateB.subscriptions[id];

      if (!subA && !subB) {
        continue;
      }

      const mergedSub = {} as Partial<Subscription>;
      const mergedTimestamps: Record<string, number> = {};

      const allKeys = new Set([
        ...Object.keys(subA || {}),
        ...Object.keys(subB || {}),
      ]) as Set<keyof Subscription>;

      for (const key of allKeys) {
        const tA = (metaA.timestamps && metaA.timestamps[key as string]) || 0;
        const tB = (metaB.timestamps && metaB.timestamps[key as string]) || 0;

        const valA = subA ? subA[key] : undefined;
        const valB = subB ? subB[key] : undefined;

        if (tA > tB) {
          if (valA !== undefined) {
            (mergedSub as any)[key] = valA;
            mergedTimestamps[key as string] = tA;
          }
        } else if (tB > tA) {
          if (valB !== undefined) {
            (mergedSub as any)[key] = valB;
            mergedTimestamps[key as string] = tB;
          }
        } else {
          // Equal timestamps: use deterministic tie breaker or take first
          if (valA !== undefined && valB !== undefined) {
            // Convert to string safely for comparison
            const strA = typeof valA === 'object' ? JSON.stringify(valA) : String(valA);
            const strB = typeof valB === 'object' ? JSON.stringify(valB) : String(valB);
            if (strA >= strB) {
              (mergedSub as any)[key] = valA;
            } else {
              (mergedSub as any)[key] = valB;
            }
          } else if (valA !== undefined) {
            (mergedSub as any)[key] = valA;
          } else if (valB !== undefined) {
            (mergedSub as any)[key] = valB;
          }
          mergedTimestamps[key as string] = Math.max(tA, tB);
        }
      }

      // Convert date/string fields back to appropriate types if needed
      if (mergedSub.createdAt) mergedSub.createdAt = new Date(mergedSub.createdAt);
      if (mergedSub.updatedAt) mergedSub.updatedAt = new Date(mergedSub.updatedAt);
      if (mergedSub.nextBillingDate) mergedSub.nextBillingDate = new Date(mergedSub.nextBillingDate);

      mergedSubs[id] = mergedSub as Subscription;
      mergedMeta[id] = {
        timestamps: mergedTimestamps,
        deletedAt: mergedDeletedAt > 0 ? mergedDeletedAt : undefined,
      };
    }

    return {
      subscriptions: mergedSubs,
      metadata: mergedMeta,
    };
  }

  private static mergeTimestamps(
    tsA: Record<string, number>,
    tsB: Record<string, number>
  ): Record<string, number> {
    const merged: Record<string, number> = { ...tsA };
    for (const [k, v] of Object.entries(tsB)) {
      merged[k] = Math.max(merged[k] || 0, v);
    }
    return merged;
  }

  /**
   * Helper to create CRDT metadata for a new subscription.
   */
  static createMetadata(sub: Subscription, timestamp: number = Date.now()): SubscriptionMetadata {
    const timestamps: Record<string, number> = {};
    for (const key of Object.keys(sub)) {
      timestamps[key] = timestamp;
    }
    return { timestamps };
  }

  /**
   * Helper to update CRDT metadata for updated fields.
   */
  static updateMetadata(
    currentMeta: SubscriptionMetadata,
    updates: Partial<Subscription>,
    timestamp: number = Date.now()
  ): SubscriptionMetadata {
    const currentTimestamps = currentMeta ? currentMeta.timestamps : {};
    const timestamps = { ...currentTimestamps };
    for (const key of Object.keys(updates)) {
      timestamps[key] = timestamp;
    }
    return {
      ...currentMeta,
      timestamps,
    };
  }
}
