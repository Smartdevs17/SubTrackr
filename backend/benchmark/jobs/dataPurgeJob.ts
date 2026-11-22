export class DataPurgeJob {
  private onPurge: (userId: string) => Promise<void>;
  private pendingPurges: Set<string> = new Set();

  constructor(onPurge: (userId: string) => Promise<void>) {
    this.onPurge = onPurge;
  }

  queuePurge(userId: string): void {
    this.pendingPurges.add(userId);
  }

  async processPurges(): Promise<number> {
    let count = 0;
    for (const userId of this.pendingPurges) {
      try {
        await this.onPurge(userId);
        count++;
      } catch (err) {
        console.error(`[DataPurgeJob] Failed to purge data for user ${userId}:`, err);
      }
    }
    this.pendingPurges.clear();
    return count;
  }

  getPendingCount(): number {
    return this.pendingPurges.size;
  }
}
