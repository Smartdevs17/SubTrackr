import { CalendarSyncService, type RemoteChange } from './CalendarSyncService';
import type { SyncResult, SyncWorkerConfig } from './types';
import { DEFAULT_SYNC_CONFIG } from './types';

export class SyncWorker {
  private service: CalendarSyncService;
  private config: SyncWorkerConfig;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private webhookTimer: ReturnType<typeof setInterval> | null = null;

  constructor(service: CalendarSyncService, config: Partial<SyncWorkerConfig> = {}) {
    this.service = service;
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    this.pollTimer = setInterval(() => {
      this.runPollCycle();
    }, this.config.pollIntervalMs);

    this.webhookTimer = setInterval(() => {
      this.processWebhooks();
    }, 5_000);
  }

  stop(): void {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.webhookTimer) {
      clearInterval(this.webhookTimer);
      this.webhookTimer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  runPollCycle(remoteChangesPerConnection?: Map<string, RemoteChange[]>): SyncResult[] {
    const connections = this.service.getConnectionsNeedingPoll();
    const results: SyncResult[] = [];

    for (const conn of connections) {
      const changes = remoteChangesPerConnection?.get(conn.id) ?? [];
      const result = this.service.pollConnection(conn.id, changes);
      results.push(result);
    }

    return results;
  }

  processWebhooks(): SyncResult[] {
    return this.service.processWebhookQueue();
  }

  triggerImmediateSync(connectionId: string, remoteChanges: RemoteChange[] = []): SyncResult {
    return this.service.fullSync(connectionId, remoteChanges);
  }
}
