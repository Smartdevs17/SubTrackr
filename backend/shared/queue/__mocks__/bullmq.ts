/** Lightweight BullMQ mock for unit tests (avoids Redis connections and open handles). */

export type ConnectionOptions = Record<string, unknown>;
export type JobsOptions = Record<string, unknown>;
export type QueueOptions = { connection: ConnectionOptions };

const jobStore = new Map<string, { name: string; data: unknown }>();

export class Queue {
  private name: string;

  constructor(name: string, _opts: QueueOptions) {
    this.name = name;
  }

  async add(name: string, data: unknown, opts?: JobsOptions): Promise<{ id: string }> {
    const id = (opts?.jobId as string) ?? `mock-${this.name}-${jobStore.size + 1}`;
    jobStore.set(id, { name, data });
    return { id };
  }

  async getJob(id: string): Promise<{ remove(): Promise<void> } | undefined> {
    if (!jobStore.has(id)) return undefined;
    return {
      remove: async () => {
        jobStore.delete(id);
      },
    };
  }

  async getWaitingCount(): Promise<number> {
    return jobStore.size;
  }

  async pause(): Promise<void> {}

  async resume(): Promise<void> {}

  async close(): Promise<void> {}
}

/** Reset store between tests. */
export function __resetMockJobStore(): void {
  jobStore.clear();
}
