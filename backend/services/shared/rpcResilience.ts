import { rpcMetrics } from '../../monitoring/rpcMetrics';

export class CircuitBreaker {
  private endpoint: string;
  private failureThreshold: number;
  private resetTimeoutMs: number;

  private failures = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private nextAttemptTime = 0;

  constructor(endpoint: string, failureThreshold = 5, resetTimeoutMs = 30000) {
    this.endpoint = endpoint;
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  async execute<T>(action: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() > this.nextAttemptTime) {
        this.state = 'HALF_OPEN';
        rpcMetrics.updateCircuitState(this.endpoint, 'HALF_OPEN');
      } else {
        throw new Error(`CircuitBreaker OPEN for endpoint: ${this.endpoint}`);
      }
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      rpcMetrics.updateCircuitState(this.endpoint, 'CLOSED');
    }
  }

  private onFailure() {
    this.failures++;
    rpcMetrics.recordError(this.endpoint);
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
      rpcMetrics.updateCircuitState(this.endpoint, 'OPEN');
    } else if (this.state === 'HALF_OPEN') {
      // If it fails during half-open, immediately re-open
      this.state = 'OPEN';
      this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
      rpcMetrics.updateCircuitState(this.endpoint, 'OPEN');
    }
  }
}

export function executeWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
