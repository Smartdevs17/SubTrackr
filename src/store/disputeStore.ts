import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CACHE_CONSTANTS } from '../utils/constants/values';
import { errorHandler, AppError } from '../services/errorHandler';

const STORAGE_KEY = 'subtrackr-disputes';
const STORE_VERSION = 1;
const WRITE_DEBOUNCE_MS = CACHE_CONSTANTS.WRITE_DEBOUNCE_MS;

// ════════════════════════════════════════════════════════════════
// TYPES
// ════════════════════════════════════════════════════════════════

export enum DisputeStatus {
  /** Dispute has been created but not yet submitted */
  Pending = 'pending',
  /** Evidence is being collected */
  GatheringEvidence = 'gathering_evidence',
  /** Evidence submitted, awaiting review */
  UnderReview = 'under_review',
  /** Awaiting manual review decision */
  AwaitingManualReview = 'awaiting_manual_review',
  /** Dispute has been resolved */
  Resolved = 'resolved',
  /** Dispute was rejected */
  Rejected = 'rejected',
  /** Dispute expired due to time limit */
  Expired = 'expired',
}

export enum DisputeReason {
  /** Product/service not as described */
  NotAsDescribed = 'not_as_described',
  /** Product/service not received */
  NotReceived = 'not_received',
  /** Unauthorized charge */
  Unauthorized = 'unauthorized',
  /** Duplicate charge */
  Duplicate = 'duplicate',
  /** Incorrect amount charged */
  IncorrectAmount = 'incorrect_amount',
  /** Subscription cancelled but charged */
  CancelledSubscription = 'cancelled_subscription',
  /** Refund not processed */
  RefundNotProcessed = 'refund_not_processed',
  /** Other reason */
  Other = 'other',
}

export enum Resolution {
  /** Dispute won - customer gets refund */
  Refund = 'refund',
  /** Original charge upheld - no refund */
  Upheld = 'upheld',
  /** Partial refund granted */
  PartialRefund = 'partial_refund',
  /** Counter-claim successful */
  Counter = 'counter',
  /** Settlement reached between parties */
  Settlement = 'settlement',
}

export enum EvidenceType {
  /** Proof of delivery */
  ProofOfDelivery = 'proof_of_delivery',
  /** Communication records */
  Communication = 'communication',
  /** Contract/terms documentation */
  Contract = 'contract',
  /** Receipt or invoice */
  Receipt = 'receipt',
  /** Product/service description */
  ProductDescription = 'product_description',
  /** Customer interaction history */
  InteractionHistory = 'interaction_history',
  /** Other evidence */
  Other = 'other',
}

export interface Evidence {
  /** Unique evidence ID */
  id: string;
  /** Type of evidence */
  evidenceType: EvidenceType;
  /** Description of the evidence */
  description: string;
  /** URL or reference to evidence file */
  reference: string;
  /** Timestamp when evidence was submitted */
  submittedAt: Date;
  /** Who submitted the evidence */
  submittedBy: string;
}

export interface TimelineEvent {
  /** Event ID */
  id: string;
  /** Event type */
  eventType: TimelineEventType;
  /** Description of the event */
  description: string;
  /** Timestamp of the event */
  timestamp: Date;
  /** Who triggered the event */
  triggeredBy: string;
}

export enum TimelineEventType {
  Created = 'created',
  EvidenceSubmitted = 'evidence_submitted',
  StatusChanged = 'status_changed',
  ManualReviewRequested = 'manual_review_requested',
  Resolved = 'resolved',
  Expired = 'expired',
}

export interface Dispute {
  /** Unique dispute identifier */
  id: string;
  /** Charge ID this dispute is related to */
  chargeId: string;
  /** Subscription ID (if applicable) */
  subscriptionId?: string;
  /** Subscription name for display */
  subscriptionName?: string;
  /** User who created the dispute */
  userId: string;
  /** Reason for the dispute */
  reason: DisputeReason;
  /** Current status of the dispute */
  status: DisputeStatus;
  /** Evidence submitted for this dispute */
  evidence: Evidence[];
  /** Timeline events */
  timeline: TimelineEvent[];
  /** Resolution (if resolved) */
  resolution?: Resolution;
  /** Resolution notes */
  resolutionNotes?: string;
  /** When the dispute was created */
  createdAt: Date;
  /** When the dispute was last updated */
  updatedAt: Date;
  /** Deadline for submitting evidence */
  evidenceDeadline: Date;
  /** Resolution timestamp (if resolved) */
  resolvedAt?: Date;
  /** Amount in dispute */
  amount: number;
  /** Currency */
  currency: string;
}

export interface DisputeAnalytics {
  /** Total disputes filed */
  totalDisputes: number;
  /** Disputes won (refund) */
  disputesWon: number;
  /** Disputes lost (upheld) */
  disputesLost: number;
  /** Disputes settled */
  disputesSettled: number;
  /** Pending disputes */
  pendingDisputes: number;
  /** Average resolution time in seconds */
  avgResolutionTime: number;
  /** Total amount disputed */
  totalAmountDisputed: number;
  /** Total amount refunded */
  totalAmountRefunded: number;
  /** Disputes by status */
  disputesByStatus: Record<DisputeStatus, number>;
  /** Disputes by reason */
  disputesByReason: Record<DisputeReason, number>;
}

export interface DisputeFormData {
  chargeId: string;
  subscriptionId?: string;
  reason: DisputeReason;
  description?: string;
  amount: number;
  currency: string;
}

export interface EvidenceFormData {
  evidenceType: EvidenceType;
  description: string;
  reference: string;
}

// ════════════════════════════════════════════════════════════════
// STATE INTERFACE
// ════════════════════════════════════════════════════════════════

interface DisputeState {
  // State
  disputes: Dispute[];
  analytics: DisputeAnalytics;
  selectedDisputeId: string | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  createDispute: (data: DisputeFormData, userId: string) => Promise<Dispute>;
  submitEvidence: (disputeId: string, evidence: EvidenceFormData, userId: string) => Promise<void>;
  requestManualReview: (disputeId: string, userId: string) => Promise<void>;
  resolveDispute: (disputeId: string, resolution: Resolution, notes?: string, resolverId?: string) => Promise<void>;
  getDispute: (disputeId: string) => Dispute | undefined;
  getDisputesBySubscription: (subscriptionId: string) => Dispute[];
  getDisputesByUser: (userId: string) => Dispute[];
  getDisputesByStatus: (status: DisputeStatus) => Dispute[];
  selectDispute: (disputeId: string | null) => void;
  updateAnalytics: () => void;
  deleteDispute: (disputeId: string) => Promise<void>;
  clearError: () => void;
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

const generateUniqueId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `disp-${timestamp}-${randomComponent}`;
};

const generateEvidenceId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `ev-${timestamp}-${randomComponent}`;
};

const toValidDate = (value: unknown, fallback = new Date()): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value.isFinite) {
    const parsed = new Date(value as string);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
};

const normalizeDispute = (raw: Partial<Dispute>): Dispute => {
  const now = new Date();
  const evidenceDeadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  return {
    id: raw.id ?? generateUniqueId(),
    chargeId: raw.chargeId ?? '',
    subscriptionId: raw.subscriptionId,
    subscriptionName: raw.subscriptionName,
    userId: raw.userId ?? '',
    reason: raw.reason ?? DisputeReason.Other,
    status: raw.status ?? DisputeStatus.Pending,
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
    resolution: raw.resolution,
    resolutionNotes: raw.resolutionNotes,
    createdAt: toValidDate(raw.createdAt, now),
    updatedAt: toValidDate(raw.updatedAt, now),
    evidenceDeadline: toValidDate(raw.evidenceDeadline, evidenceDeadline),
    resolvedAt: raw.resolvedAt ? toValidDate(raw.resolvedAt) : undefined,
    amount: Number.isFinite(raw.amount) ? (raw.amount as number) : 0,
    currency: raw.currency ?? 'USD',
  };
};

const defaultAnalytics: DisputeAnalytics = {
  totalDisputes: 0,
  disputesWon: 0,
  disputesLost: 0,
  disputesSettled: 0,
  pendingDisputes: 0,
  avgResolutionTime: 0,
  totalAmountDisputed: 0,
  totalAmountRefunded: 0,
  disputesByStatus: {} as Record<DisputeStatus, number>,
  disputesByReason: {} as Record<DisputeReason, number>,
};

// Initialize analytics with all statuses and reasons
Object.values(DisputeStatus).forEach((status) => {
  defaultAnalytics.disputesByStatus[status] = 0;
});
Object.values(DisputeReason).forEach((reason) => {
  defaultAnalytics.disputesByReason[reason] = 0;
});

const serializeForStorage = (state: Pick<DisputeState, 'disputes' | 'analytics'>): Pick<DisputeState, 'disputes' | 'analytics'> => ({
  disputes: state.disputes.map((dispute) => ({
    ...dispute,
    createdAt: new Date(dispute.createdAt),
    updatedAt: new Date(dispute.updatedAt),
    evidenceDeadline: new Date(dispute.evidenceDeadline),
    resolvedAt: dispute.resolvedAt ? new Date(dispute.resolvedAt) : undefined,
    evidence: dispute.evidence.map((ev) => ({
      ...ev,
      submittedAt: new Date(ev.submittedAt),
    })),
    timeline: dispute.timeline.map((event) => ({
      ...event,
      timestamp: new Date(event.timestamp),
    })),
  })),
  analytics: state.analytics,
});

const migratePersistedState = (persisted: unknown): Pick<DisputeState, 'disputes' | 'analytics'> => {
  if (!persisted || typeof persisted !== 'object') {
    return { disputes: [], analytics: defaultAnalytics };
  }

  const maybeState = persisted as Partial<Pick<DisputeState, 'disputes' | 'analytics'>>;
  const disputes = Array.isArray(maybeState.disputes)
    ? maybeState.disputes.map((entry) => normalizeDispute(entry as Partial<Dispute>))
    : [];

  return {
    disputes,
    analytics: maybeState.analytics ?? defaultAnalytics,
  };
};

const pendingWrites = new Map<string, string>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let writeQueue = Promise.resolve();

const flushPendingWrites = async (): Promise<void> => {
  const entries = Array.from(pendingWrites.entries());
  pendingWrites.clear();

  for (const [, serialized] of entries) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, serialized);
    } catch (error) {
      console.error('Failed to persist disputes:', error);
    }
  }
};

const scheduleWrite = (state: Pick<DisputeState, 'disputes' | 'analytics'>): void => {
  const serialized = JSON.stringify(serializeForStorage(state));
  const key = `disputes-${Date.now()}`;
  pendingWrites.set(key, serialized);

  if (writeTimer) {
    clearTimeout(writeTimer);
  }

  writeTimer = setTimeout(() => {
    writeQueue = writeQueue.then(flushPendingWrites);
  }, WRITE_DEBOUNCE_MS);
};

// ════════════════════════════════════════════════════════════════
// STORE
// ════════════════════════════════════════════════════════════════

export const useDisputeStore = create<DisputeState>()(
  persist(
    (set, get) => ({
      // Initial state
      disputes: [],
      analytics: defaultAnalytics,
      selectedDisputeId: null,
      isLoading: false,
      error: null,

      // Create a new dispute
      createDispute: async (data: DisputeFormData, userId: string): Promise<Dispute> => {
        const now = new Date();
        const evidenceDeadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const dispute: Dispute = {
          id: generateUniqueId(),
          chargeId: data.chargeId,
          subscriptionId: data.subscriptionId,
          userId,
          reason: data.reason,
          status: DisputeStatus.Pending,
          evidence: [],
          timeline: [
            {
              id: generateUniqueId(),
              eventType: TimelineEventType.Created,
              description: `Dispute created for charge ${data.chargeId}`,
              timestamp: now,
              triggeredBy: userId,
            },
          ],
          createdAt: now,
          updatedAt: now,
          evidenceDeadline,
          amount: data.amount,
          currency: data.currency,
        };

        set((state) => {
          const newState = {
            ...state,
            disputes: [...state.disputes, dispute],
          };
          scheduleWrite(newState);
          return newState;
        });

        // Update analytics
        get().updateAnalytics();

        return dispute;
      },

      // Submit evidence for a dispute
      submitEvidence: async (disputeId: string, evidence: EvidenceFormData, userId: string): Promise<void> => {
        const now = new Date();

        set((state) => {
          const disputes = state.disputes.map((dispute) => {
            if (dispute.id === disputeId) {
              // Check if dispute is still active
              if (
                dispute.status === DisputeStatus.Resolved ||
                dispute.status === DisputeStatus.Rejected ||
                dispute.status === DisputeStatus.Expired
              ) {
                throw new Error('Cannot submit evidence to resolved dispute');
              }

              // Check evidence deadline
              if (now > dispute.evidenceDeadline) {
                throw new Error('Evidence submission deadline passed');
              }

              // Check max evidence limit
              if (dispute.evidence.length >= 20) {
                throw new Error('Maximum evidence limit reached');
              }

              const newEvidence: Evidence = {
                id: generateEvidenceId(),
                evidenceType: evidence.evidenceType,
                description: evidence.description,
                reference: evidence.reference,
                submittedAt: now,
                submittedBy: userId,
              };

              return {
                ...dispute,
                evidence: [...dispute.evidence, newEvidence],
                status: DisputeStatus.GatheringEvidence,
                updatedAt: now,
                timeline: [
                  ...dispute.timeline,
                  {
                    id: generateUniqueId(),
                    eventType: TimelineEventType.EvidenceSubmitted,
                    description: `Evidence submitted: ${evidence.description}`,
                    timestamp: now,
                    triggeredBy: userId,
                  },
                ],
              };
            }
            return dispute;
          });

          const newState = { ...state, disputes };
          scheduleWrite(newState);
          return newState;
        });
      },

      // Request manual review
      requestManualReview: async (disputeId: string, userId: string): Promise<void> => {
        const now = new Date();

        set((state) => {
          const disputes = state.disputes.map((dispute) => {
            if (dispute.id === disputeId) {
              if (
                dispute.status === DisputeStatus.Resolved ||
                dispute.status === DisputeStatus.Rejected ||
                dispute.status === DisputeStatus.Expired
              ) {
                throw new Error('Cannot request review for resolved dispute');
              }

              return {
                ...dispute,
                status: DisputeStatus.AwaitingManualReview,
                updatedAt: now,
                timeline: [
                  ...dispute.timeline,
                  {
                    id: generateUniqueId(),
                    eventType: TimelineEventType.ManualReviewRequested,
                    description: 'Manual review requested',
                    timestamp: now,
                    triggeredBy: userId,
                  },
                ],
              };
            }
            return dispute;
          });

          const newState = { ...state, disputes };
          scheduleWrite(newState);
          return newState;
        });
      },

      // Resolve a dispute
      resolveDispute: async (
        disputeId: string,
        resolution: Resolution,
        notes?: string,
        resolverId?: string
      ): Promise<void> => {
        const now = new Date();

        set((state) => {
          const disputes = state.disputes.map((dispute) => {
            if (dispute.id === disputeId) {
              if (
                dispute.status === DisputeStatus.Resolved ||
                dispute.status === DisputeStatus.Rejected ||
                dispute.status === DisputeStatus.Expired
              ) {
                throw new Error('Dispute already resolved');
              }

              return {
                ...dispute,
                status: DisputeStatus.Resolved,
                resolution,
                resolutionNotes: notes,
                resolvedAt: now,
                updatedAt: now,
                timeline: [
                  ...dispute.timeline,
                  {
                    id: generateUniqueId(),
                    eventType: TimelineEventType.Resolved,
                    description: `Dispute resolved: ${resolution}`,
                    timestamp: now,
                    triggeredBy: resolverId ?? 'system',
                  },
                ],
              };
            }
            return dispute;
          });

          const newState = { ...state, disputes };
          scheduleWrite(newState);
          return newState;
        });

        // Update analytics
        get().updateAnalytics();
      },

      // Get a specific dispute
      getDispute: (disputeId: string): Dispute | undefined => {
        return get().disputes.find((d) => d.id === disputeId);
      },

      // Get disputes by subscription
      getDisputesBySubscription: (subscriptionId: string): Dispute[] => {
        return get().disputes.filter((d) => d.subscriptionId === subscriptionId);
      },

      // Get disputes by user
      getDisputesByUser: (userId: string): Dispute[] => {
        return get().disputes.filter((d) => d.userId === userId);
      },

      // Get disputes by status
      getDisputesByStatus: (status: DisputeStatus): Dispute[] => {
        return get().disputes.filter((d) => d.status === status);
      },

      // Select a dispute
      selectDispute: (disputeId: string | null): void => {
        set({ selectedDisputeId: disputeId });
      },

      // Update analytics
      updateAnalytics: (): void => {
        const { disputes } = get();

        const analytics: DisputeAnalytics = {
          ...defaultAnalytics,
          totalDisputes: disputes.length,
          disputesByStatus: { ...defaultAnalytics.disputesByStatus },
          disputesByReason: { ...defaultAnalytics.disputesByReason },
        };

        let totalResolutionTime = 0;
        let resolvedCount = 0;

        disputes.forEach((dispute) => {
          // Count by status
          analytics.disputesByStatus[dispute.status] =
            (analytics.disputesByStatus[dispute.status] ?? 0) + 1;

          // Count by reason
          analytics.disputesByReason[dispute.reason] =
            (analytics.disputesByReason[dispute.reason] ?? 0) + 1;

          // Track amounts
          analytics.totalAmountDisputed += dispute.amount;

          if (dispute.resolution === Resolution.Refund) {
            analytics.disputesWon += 1;
            analytics.totalAmountRefunded += dispute.amount;
          } else if (dispute.resolution === Resolution.Upheld) {
            analytics.disputesLost += 1;
          } else if (dispute.resolution === Resolution.Settlement) {
            analytics.disputesSettled += 1;
          } else if (dispute.resolution === Resolution.PartialRefund) {
            analytics.disputesWon += 1;
            analytics.disputesSettled += 1;
            analytics.totalAmountRefunded += dispute.amount * 0.5;
          }

          // Calculate resolution time
          if (dispute.resolvedAt) {
            const resolutionTime = dispute.resolvedAt.getTime() - dispute.createdAt.getTime();
            totalResolutionTime += resolutionTime;
            resolvedCount += 1;
          }
        });

        analytics.pendingDisputes =
          (analytics.disputesByStatus[DisputeStatus.Pending] ?? 0) +
          (analytics.disputesByStatus[DisputeStatus.GatheringEvidence] ?? 0) +
          (analytics.disputesByStatus[DisputeStatus.UnderReview] ?? 0) +
          (analytics.disputesByStatus[DisputeStatus.AwaitingManualReview] ?? 0);

        analytics.avgResolutionTime = resolvedCount > 0 ? totalResolutionTime / resolvedCount : 0;

        set({ analytics });
      },

      // Delete a dispute
      deleteDispute: async (disputeId: string): Promise<void> => {
        set((state) => {
          const disputes = state.disputes.filter((d) => d.id !== disputeId);
          const newState = { ...state, disputes };
          scheduleWrite(newState);
          return newState;
        });

        get().updateAnalytics();
      },

      // Clear error
      clearError: (): void => {
        set({ error: null });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => AsyncStorage),
      version: STORE_VERSION,
      migrate: migratePersistedState,
      partialize: (state) => ({
        disputes: state.disputes,
        analytics: state.analytics,
      }),
    }
  )
);

// Initialize analytics on load
useDisputeStore.getState().updateAnalytics();