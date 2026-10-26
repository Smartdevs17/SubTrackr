import { ethers } from 'ethers';
import { CircuitBreaker, executeWithTimeout } from './rpcResilience';
import { rpcMetrics } from '../../monitoring/rpcMetrics';

export interface MonitoringJsonRpcProviderOptions {
  timeoutMs?: number;
  failureThreshold?: number;
  resetTimeoutMs?: number;
}

export class MonitoringJsonRpcProvider extends ethers.providers.JsonRpcProvider {
  private fallbackUrls: string[];
  private currentUrlIndex = 0;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private timeoutMs: number;

  constructor(urls: string | string[], network?: ethers.providers.Networkish, options?: MonitoringJsonRpcProviderOptions) {
    const urlArray = Array.isArray(urls) ? urls : [urls];
    super(urlArray[0], network);
    this.fallbackUrls = urlArray;
    
    this.timeoutMs = options?.timeoutMs ?? 5000;
    const failureThreshold = options?.failureThreshold ?? 3;
    const resetTimeoutMs = options?.resetTimeoutMs ?? 30000;

    for (const url of this.fallbackUrls) {
      this.circuitBreakers.set(url, new CircuitBreaker(url, failureThreshold, resetTimeoutMs));
    }
  }

  // Override connection to always use the current active URL
  get connection() {
    const conn = super.connection;
    conn.url = this.fallbackUrls[this.currentUrlIndex];
    return conn;
  }

  async send(method: string, params: Array<any>): Promise<any> {
    const originalIndex = this.currentUrlIndex;
    let attemptCount = 0;
    
    while (attemptCount < this.fallbackUrls.length) {
      const url = this.fallbackUrls[this.currentUrlIndex];
      const cb = this.circuitBreakers.get(url)!;

      const startTime = Date.now();
      try {
        const result = await cb.execute(() => 
          executeWithTimeout(super.send(method, params), this.timeoutMs)
        );
        const latency = Date.now() - startTime;
        rpcMetrics.recordLatency(url, latency);
        return result;
      } catch (error: any) {
        // If CircuitBreaker is OPEN or request failed/timed out, try next fallback
        attemptCount++;
        this.currentUrlIndex = (this.currentUrlIndex + 1) % this.fallbackUrls.length;
        
        // If we exhausted all fallbacks, throw the error
        if (attemptCount === this.fallbackUrls.length) {
          throw new Error(`All RPC endpoints failed. Last error: ${error.message}`);
        }
      }
    }
  }
}
