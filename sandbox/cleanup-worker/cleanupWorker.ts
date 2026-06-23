import { containerManager } from '../orchestrator/containerManager';

interface CleanupWorkerConfig {
  checkIntervalMs?: number;
  onIdleWarning?: (sandboxIds: string[]) => void;
  onCleanup?: (sandboxIds: string[]) => void;
}

export class CleanupWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private config: CleanupWorkerConfig;

  constructor(config?: Partial<CleanupWorkerConfig>) {
    this.config = {
      checkIntervalMs: config?.checkIntervalMs ?? 60_000,
      onIdleWarning: config?.onIdleWarning,
      onCleanup: config?.onCleanup,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    console.log(
      `[CleanupWorker] Started — checking every ${this.config.checkIntervalMs}ms`
    );

    this.timer = setInterval(async () => {
      await this.checkCycle();
    }, this.config.checkIntervalMs);

    this.checkCycle().catch((err) =>
      console.error('[CleanupWorker] Initial cycle failed:', err)
    );
  }

  stop(): void {
    if (!this.running || !this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    console.log('[CleanupWorker] Stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  private async checkCycle(): Promise<void> {
    try {
      // 1. Check idle sandboxes — warn users
      const idleSandboxes = containerManager.checkIdleSandboxes();
      if (idleSandboxes.length > 0) {
        console.log(
          `[CleanupWorker] Idle warning for: ${idleSandboxes.join(', ')}`
        );
        this.config.onIdleWarning?.(idleSandboxes);
      }

      // 2. Check expired sandboxes — teardown
      const expiredSandboxes = containerManager.checkExpiredSandboxes();
      if (expiredSandboxes.length > 0) {
        console.log(
          `[CleanupWorker] Tearing down expired sandboxes: ${expiredSandboxes.join(', ')}`
        );
        this.config.onCleanup?.(expiredSandboxes);

        for (const sandboxId of expiredSandboxes) {
          try {
            await containerManager.teardown(sandboxId);
            console.log(`[CleanupWorker] Teardown complete: ${sandboxId}`);
          } catch (err) {
            console.error(
              `[CleanupWorker] Teardown failed for ${sandboxId}:`,
              err
            );
          }
        }
      }
    } catch (err) {
      console.error('[CleanupWorker] Check cycle error:', err);
    }
  }
}
