import { SandboxIsolationContext, SandboxResourceLimits } from '../types/sandbox';
import { sandboxService } from '../services/sandboxService';

export interface SandboxRequest {
  environmentId: string;
  apiKey: string;
  timestamp: Date;
  endpoint: string;
  method: string;
  body?: unknown;
}

export interface SandboxResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata: {
    environmentId: string;
    requestId: string;
    timestamp: Date;
    processingTime: number;
    rateLimitRemaining: number;
  };
}

export class SandboxMiddleware {
  private rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map();

  async processRequest(request: SandboxRequest): Promise<SandboxResponse> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    try {
      const isValid = await sandboxService.validateAccess(request.environmentId, request.apiKey);
      if (!isValid) {
        return this.createErrorResponse(
          request,
          requestId,
          startTime,
          'Invalid API key or environment',
          401
        );
      }

      const context = await sandboxService.getIsolationContext(request.environmentId);
      if (!context) {
        return this.createErrorResponse(
          request,
          requestId,
          startTime,
          'Environment not found',
          404
        );
      }

      if (!context.isWithinLimits) {
        return this.createErrorResponse(
          request,
          requestId,
          startTime,
          'Resource limits exceeded',
          429
        );
      }

      const rateLimitResult = await this.checkRateLimit(
        request.environmentId,
        context.resourceQuota
      );
      if (!rateLimitResult.allowed) {
        return this.createErrorResponse(request, requestId, startTime, 'Rate limit exceeded', 429);
      }

      await sandboxService.recordRequest(request.environmentId, Date.now() - startTime, false);

      return {
        success: true,
        data: null,
        metadata: {
          environmentId: request.environmentId,
          requestId,
          timestamp: new Date(),
          processingTime: Date.now() - startTime,
          rateLimitRemaining: rateLimitResult.remaining,
        },
      };
    } catch (error) {
      await sandboxService.recordRequest(request.environmentId, Date.now() - startTime, true);
      return this.createErrorResponse(request, requestId, startTime, 'Internal sandbox error', 500);
    }
  }

  async validateEnvironment(envId: string): Promise<boolean> {
    const env = await sandboxService.getEnvironment(envId);
    if (!env) return false;

    if (env.status !== 'active') return false;

    if (env.expiresAt && env.expiresAt < new Date()) {
      await sandboxService.suspendEnvironment(envId);
      return false;
    }

    return true;
  }

  async isolateData(envId: string, data: unknown): Promise<unknown> {
    const context = await sandboxService.getIsolationContext(envId);
    if (!context) throw new Error('Environment not found');

    return {
      ...(data as object),
      _sandbox: {
        environmentId: envId,
        namespace: context.dataNamespace,
        isolated: true,
      },
    };
  }

  async enforceResourceLimits(envId: string): Promise<{ withinLimits: boolean; usage: unknown }> {
    const context = await sandboxService.getIsolationContext(envId);
    if (!context) throw new Error('Environment not found');

    return {
      withinLimits: context.isWithinLimits,
      usage: context.currentUsage,
    };
  }

  private async checkRateLimit(
    envId: string,
    limits: SandboxResourceLimits
  ): Promise<{ allowed: boolean; remaining: number }> {
    const now = Date.now();
    const key = `rate_${envId}`;
    const entry = this.rateLimitStore.get(key);

    if (!entry || now > entry.resetTime) {
      this.rateLimitStore.set(key, { count: 1, resetTime: now + 60000 });
      return {
        allowed: true,
        remaining: limits.maxRequestsPerMinute - 1,
      };
    }

    if (entry.count >= limits.maxRequestsPerMinute) {
      return { allowed: false, remaining: 0 };
    }

    entry.count++;
    return {
      allowed: true,
      remaining: limits.maxRequestsPerMinute - entry.count,
    };
  }

  private createErrorResponse(
    request: SandboxRequest,
    requestId: string,
    startTime: number,
    message: string,
    _status: number
  ): SandboxResponse {
    return {
      success: false,
      error: message,
      metadata: {
        environmentId: request.environmentId,
        requestId,
        timestamp: new Date(),
        processingTime: Date.now() - startTime,
        rateLimitRemaining: 0,
      },
    };
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

export const sandboxMiddleware = new SandboxMiddleware();
