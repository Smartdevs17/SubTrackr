const DEFAULT_RETENTION_MS = 7 * 365 * 24 * 60 * 60 * 1000;

export class LogRotationJob {
  private retentionMs: number;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onRotate: (cutoff: number) => Promise<void>;

  constructor(
    onRotate: (cutoff: number) => Promise<void>,
    opts?: { retentionMs?: number; intervalMs?: number },
  ) {
    this.onRotate = onRotate;
    this.retentionMs = opts?.retentionMs ?? DEFAULT_RETENTION_MS;
    this.intervalMs = opts?.intervalMs ?? 86_400_000;
  }

  start(): void {
    if (this.timer) return;
    void this.rotate();
    this.timer = setInterval(() => void this.rotate(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async rotate(): Promise<void> {
    const cutoff = Date.now() - this.retentionMs;
    try {
      await this.onRotate(cutoff);
      console.info(`[LogRotationJob] Rotation complete. Cutoff: ${new Date(cutoff).toISOString()}`);
    } catch (err) {
      console.error('[LogRotationJob] Rotation failed:', err);
    }
  }
}
