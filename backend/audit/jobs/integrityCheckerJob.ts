import { HashChainService } from '../domain/HashChainService';

export interface IntegrityCheckResult {
  passed: boolean;
  checkedEntries: number;
  firstInvalidIndex: number | null;
  checkedAt: number;
}

export class IntegrityCheckerJob {
  private chain: HashChainService;
  private intervalMs: number;
  private onViolation: ((result: IntegrityCheckResult) => void) | null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    chain: HashChainService,
    opts?: {
      intervalMs?: number;
      onViolation?: (result: IntegrityCheckResult) => void;
    },
  ) {
    this.chain = chain;
    this.intervalMs = opts?.intervalMs ?? 3_600_000;
    this.onViolation = opts?.onViolation ?? null;
  }

  start(): void {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check(): Promise<void> {
    const result = this.chain.verify();
    const checkResult: IntegrityCheckResult = {
      passed: result.valid,
      checkedEntries: this.chain.getChainLength(),
      firstInvalidIndex: result.firstInvalidIndex,
      checkedAt: Date.now(),
    };

    if (!checkResult.passed) {
      console.error(
        `[IntegrityChecker] Hash chain integrity VIOLATION at index ${checkResult.firstInvalidIndex}`,
      );
      if (this.onViolation) {
        this.onViolation(checkResult);
      }
    } else {
      console.info(`[IntegrityChecker] Chain integrity OK (${checkResult.checkedEntries} entries)`);
    }
  }
}
