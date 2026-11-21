/** Transactional pause/cancel orchestration across billing providers. */

export type BulkAction = 'pause' | 'cancel';

export interface BulkActionRequest {
  provider: string;
  subscriptionId: string;
  action: BulkAction;
  payload?: Record<string, unknown>;
}

export interface BulkActionProvider {
  pause(subscriptionId: string, payload?: Record<string, unknown>): Promise<void>;
  cancel(subscriptionId: string, payload?: Record<string, unknown>): Promise<void>;
  rollback(action: BulkAction, subscriptionId: string): Promise<void>;
}

export interface BulkActionResult {
  committed: boolean;
  applied: BulkActionRequest[];
  rolledBack: BulkActionRequest[];
  error?: string;
}

export class BulkActionsService {
  async execute(
    requests: BulkActionRequest[],
    providers: ReadonlyMap<string, BulkActionProvider>,
  ): Promise<BulkActionResult> {
    if (requests.length === 0) throw new Error('At least one bulk action is required');

    const seen = new Set<string>();
    for (const request of requests) {
      const key = `${request.provider}:${request.subscriptionId}:${request.action}`;
      if (seen.has(key)) throw new Error(`Duplicate bulk action: ${key}`);
      seen.add(key);
      if (!providers.has(request.provider)) throw new Error(`Unknown billing provider: ${request.provider}`);
    }

    const applied: BulkActionRequest[] = [];
    try {
      for (const request of requests) {
        const provider = providers.get(request.provider)!;
        await provider[request.action](request.subscriptionId, request.payload);
        applied.push(request);
      }
      return { committed: true, applied, rolledBack: [] };
    } catch (err) {
      const rolledBack: BulkActionRequest[] = [];
      for (const request of [...applied].reverse()) {
        await providers.get(request.provider)!.rollback(request.action, request.subscriptionId);
        rolledBack.push(request);
      }
      return {
        committed: false,
        applied,
        rolledBack,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export const bulkActionsService = new BulkActionsService();
