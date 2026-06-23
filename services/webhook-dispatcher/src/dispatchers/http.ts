import crypto from 'crypto';

export interface DispatchRequest {
  url: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
  signature: string;
  eventType: string;
  eventId: string;
  idempotencyKey: string;
}

export interface DispatchResult {
  success: boolean;
  statusCode?: number;
  latencyMs?: number;
  error?: string;
}

export interface DispatcherOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  timeout: number;
}

export class HttpWebhookDispatcher {
  private options: DispatcherOptions;

  constructor(options: DispatcherOptions) {
    this.options = options;
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const payloadBody = JSON.stringify(request.payload);

    if (Buffer.byteLength(payloadBody, 'utf8') > 1_048_576) {
      return { success: false, error: 'Payload exceeds 1MB limit' };
    }

    let attempt = 0;
    let lastError: string | undefined;

    while (attempt <= this.options.maxRetries) {
      attempt++;
      const startTime = Date.now();

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

        const response = await fetch(request.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...request.headers,
          },
          body: payloadBody,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const latencyMs = Date.now() - startTime;

        if (response.ok) {
          return { success: true, statusCode: response.status, latencyMs };
        }

        lastError = `HTTP ${response.status}`;

        if (response.status < 500) {
          return { success: false, statusCode: response.status, error: lastError, latencyMs };
        }
      } catch (err: unknown) {
        clearTimeout(undefined);
        lastError = (err as Error).message || 'Unknown error';
      }

      if (attempt <= this.options.maxRetries) {
        const delay = this.computeDelay(attempt);
        console.log(`[Dispatch] Retry ${attempt}/${this.options.maxRetries} for ${request.url} in ${delay}ms: ${lastError}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    return { success: false, error: lastError || 'Max retries exceeded' };
  }

  private computeDelay(attempt: number): number {
    const rawDelay = Math.floor(
      this.options.initialDelayMs * Math.pow(this.options.backoffFactor, Math.max(0, attempt - 1))
    );
    return Math.min(rawDelay, this.options.maxDelayMs);
  }
}
