/**
 * GDPR Data Deletion Service (Right to Erasure — Article 17)
 *
 * Manages user data deletion requests with a verification workflow,
 * grace period, and cascading deletion across all registered data stores.
 */

export interface DataDeleter {
  /** Delete all data for a user from a specific source */
  deleteUserData(userId: string): Promise<{ source: string; deletedCount: number }>;
  /** Source name */
  sourceName: string;
}

export type DeletionRequestStatus = 'pending' | 'grace_period' | 'in_progress' | 'completed' | 'cancelled';

export interface DeletionRequest {
  id: string;
  userId: string;
  status: DeletionRequestStatus;
  requestedAt: number;
  gracePeriodEndsAt: number;
  cancelledAt?: number;
  completedAt?: number;
  deletionResults?: { source: string; deletedCount: number }[];
  verificationToken: string;
}

export interface DeletionResult {
  success: boolean;
  request: DeletionRequest | null;
  error?: string;
}

export class DataDeletionService {
  private deleters: DataDeleter[] = [];
  private requests: Map<string, DeletionRequest> = new Map();
  private gracePeriodDays: number;

  constructor(gracePeriodDays = 30) {
    this.gracePeriodDays = gracePeriodDays;
  }

  registerDeleter(deleter: DataDeleter): void {
    this.deleters.push(deleter);
  }

  /**
   * Create a new deletion request. The request enters a grace period
   * during which the user can cancel.
   */
  createDeletionRequest(userId: string): DeletionRequest {
    const now = Date.now();
    const request: DeletionRequest = {
      id: crypto.randomUUID(),
      userId,
      status: 'grace_period',
      requestedAt: now,
      gracePeriodEndsAt: now + this.gracePeriodDays * 24 * 60 * 60 * 1000,
      verificationToken: crypto.randomUUID(),
    };
    this.requests.set(request.id, request);
    return request;
  }

  /**
   * Cancel a deletion request (only during grace period).
   */
  cancelDeletionRequest(requestId: string, userId: string): DeletionResult {
    const req = this.requests.get(requestId);
    if (!req) {
      return { success: false, request: null, error: 'Deletion request not found' };
    }
    if (req.userId !== userId) {
      return { success: false, request: null, error: 'Unauthorized' };
    }
    if (req.status !== 'grace_period' && req.status !== 'pending') {
      return { success: false, request: null, error: `Cannot cancel request in status: ${req.status}` };
    }
    req.status = 'cancelled';
    req.cancelledAt = Date.now();
    return { success: true, request: req };
  }

  /**
   * Execute the deletion. Only allowed after the grace period has ended.
   */
  async executeDeletion(requestId: string): Promise<DeletionResult> {
    const req = this.requests.get(requestId);
    if (!req) {
      return { success: false, request: null, error: 'Deletion request not found' };
    }
    if (req.status === 'cancelled') {
      return { success: false, request: null, error: 'Request was cancelled' };
    }
    if (req.status === 'completed') {
      return { success: false, request: null, error: 'Request already completed' };
    }
    if (Date.now() < req.gracePeriodEndsAt) {
      return { success: false, request: null, error: 'Grace period has not ended yet' };
    }

    req.status = 'in_progress';
    const results: { source: string; deletedCount: number }[] = [];

    for (const deleter of this.deleters) {
      const result = await deleter.deleteUserData(req.userId);
      results.push(result);
    }

    req.status = 'completed';
    req.completedAt = Date.now();
    req.deletionResults = results;
    return { success: true, request: req };
  }

  /**
   * Get a deletion request by id.
   */
  getDeletionRequest(requestId: string): DeletionRequest | null {
    return this.requests.get(requestId) ?? null;
  }

  /**
   * List all deletion requests for a user.
   */
  listDeletionRequests(userId: string): DeletionRequest[] {
    return [...this.requests.values()].filter((r) => r.userId === userId);
  }

  /**
   * Check if a user has a pending or in-progress deletion request.
   */
  hasActiveDeletionRequest(userId: string): boolean {
    return [...this.requests.values()].some(
      (r) =>
        r.userId === userId &&
        (r.status === 'grace_period' || r.status === 'pending' || r.status === 'in_progress'),
    );
  }

  /**
   * List all registered data sources that will be cleaned during deletion.
   */
  listDeletionSources(): string[] {
    return this.deleters.map((d) => d.sourceName);
  }
}
