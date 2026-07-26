/**
 * Event replay worker — replays webhook events from history
 * with idempotency key checking and ordering guarantees.
 */

export interface ReplayRequest {
  eventIds: string[];
  webhookId: string;
  targetUrl: string;
  secretKey: string;
}

export interface ReplayResult {
  eventId: string;
  status: 'replayed' | 'skipped' | 'failed';
  error?: string;
  responseCode?: number;
}

export interface StoredEvent {
  id: string;
  type: string;
  subscriptionId: string;
  payload: Record<string, unknown>;
  occurredAt: number;
  idempotencyKey: string;
}

export class EventReplayWorker {
  private eventStore: Map<string, StoredEvent> = new Map();
  private deliveredIdempotencyKeys: Set<string> = new Set();

  storeEvent(event: StoredEvent): void {
    this.eventStore.set(event.id, event);
  }

  markDelivered(idempotencyKey: string): void {
    this.deliveredIdempotencyKeys.set.add(idempotencyKey);
  }

  async replay(request: ReplayRequest): Promise<ReplayResult[]> {
    const results: ReplayResult[] = [];

    // Sort events by occurredAt for ordering guarantee per subscription
    const events = request.eventIds
      .map(id => this.eventStore.get(id))
      .filter((e): e is StoredEvent => e !== undefined)
      .sort((a, b) => a.occurredAt - b.occurredAt);

    // Group by subscription for per-subscription ordering
    const bySubscription = new Map<string, StoredEvent[]>();
    for (const event of events) {
      const group = bySubscription.get(event.subscriptionId) ?? [];
      group.push(event);
      bySubscription.set(event.subscriptionId, group);
    }

    for (const [, subEvents] of bySubscription) {
      for (const event of subEvents) {
        if (this.deliveredIdempotencyKeys.has(event.idempotencyKey)) {
          results.push({ eventId: event.id, status: 'skipped' });
          continue;
        }

        try {
          const response = await this.deliverEvent(
            request.targetUrl,
            event.payload,
            request.secretKey,
            event.idempotencyKey
          );

          if (response.ok) {
            this.deliveredIdempotencyKeys.add(event.idempotencyKey);
            results.push({ eventId: event.id, status: 'replayed', responseCode: response.status });
          } else {
            results.push({ eventId: event.id, status: 'failed', responseCode: response.status });
          }
        } catch (err) {
          results.push({
            eventId: event.id,
            status: 'failed',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
    }

    return results;
  }

  private async deliverEvent(
    url: string,
    payload: Record<string, unknown>,
    secretKey: string,
    idempotencyKey: string
  ): Promise<{ ok: boolean; status: number }> {
    const body = JSON.stringify(payload);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': this.computeSignature(body, secretKey),
        'X-Idempotency-Key': idempotencyKey,
        'X-Replay': 'true',
      },
      body,
      signal: AbortSignal.timeout(10000),
    });

    return { ok: res.ok, status: res.status };
  }

  private computeSignature(body: string, secret: string): string {
    // In production, use HMAC-SHA256
    // Placeholder: simple hash for structure
    let hash = 0;
    const input = secret + body;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return `sha256=${Math.abs(hash).toString(16)}`;
  }

  getEventHistory(webhookId: string, limit = 50): StoredEvent[] {
    return Array.from(this.eventStore.values())
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .slice(0, limit);
  }
}

export const eventReplayWorker = new EventReplayWorker();
