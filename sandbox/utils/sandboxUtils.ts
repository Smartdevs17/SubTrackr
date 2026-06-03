import { SandboxEnvironment, SandboxTestData, SandboxResourceLimits } from '../types/sandbox';

export class SandboxUtils {
  static generateNamespace(envId: string): string {
    return `sandbox_${envId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }

  static isolateKey(envId: string, key: string): string {
    return `${this.generateNamespace(envId)}:${key}`;
  }

  static validateEnvironmentStatus(env: SandboxEnvironment): { valid: boolean; reason?: string } {
    if (env.status === 'deleted') {
      return { valid: false, reason: 'Environment has been deleted' };
    }

    if (env.status === 'suspended') {
      return { valid: false, reason: 'Environment is suspended' };
    }

    if (env.expiresAt && env.expiresAt < new Date()) {
      return { valid: false, reason: 'Environment has expired' };
    }

    return { valid: true };
  }

  static calculateResourceUsage(testData: SandboxTestData): {
    storageMB: number;
    itemCount: number;
  } {
    const jsonString = JSON.stringify(testData);
    const bytes = new TextEncoder().encode(jsonString).length;
    const storageMB = bytes / (1024 * 1024);

    const itemCount =
      testData.subscriptions.length +
      testData.payments.length +
      testData.webhooks.length +
      testData.users.length;

    return { storageMB, itemCount };
  }

  static checkResourceLimits(
    limits: SandboxResourceLimits,
    currentUsage: {
      requestsPerMinute: number;
      requestsPerDay: number;
      storageMB: number;
      connections: number;
    }
  ): { withinLimits: boolean; violations: string[] } {
    const violations: string[] = [];

    if (currentUsage.requestsPerMinute > limits.maxRequestsPerMinute) {
      violations.push(
        `Requests per minute (${currentUsage.requestsPerMinute}) exceeds limit (${limits.maxRequestsPerMinute})`
      );
    }

    if (currentUsage.requestsPerDay > limits.maxRequestsPerDay) {
      violations.push(
        `Requests per day (${currentUsage.requestsPerDay}) exceeds limit (${limits.maxRequestsPerDay})`
      );
    }

    if (currentUsage.storageMB > limits.maxStorageMB) {
      violations.push(
        `Storage (${currentUsage.storageMB}MB) exceeds limit (${limits.maxStorageMB}MB)`
      );
    }

    if (currentUsage.connections > limits.maxConcurrentConnections) {
      violations.push(
        `Connections (${currentUsage.connections}) exceeds limit (${limits.maxConcurrentConnections})`
      );
    }

    return {
      withinLimits: violations.length === 0,
      violations,
    };
  }

  static sanitizeForSandbox(data: unknown): unknown {
    if (typeof data === 'string') {
      return data.replace(/[<>]/g, '');
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeForSandbox(item));
    }

    if (typeof data === 'object' && data !== null) {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (key.startsWith('_')) continue;
        sanitized[key] = this.sanitizeForSandbox(value);
      }
      return sanitized;
    }

    return data;
  }

  static generateMockResponse(template: unknown, overrides: unknown = {}): unknown {
    if (typeof template !== 'object' || template === null) {
      return overrides || template;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template as Record<string, unknown>)) {
      result[key] = (overrides as Record<string, unknown>)[key] ?? value;
    }

    return result;
  }

  static formatSandboxError(error: unknown): { code: string; message: string; details?: unknown } {
    if (error instanceof Error) {
      return {
        code: 'SANDBOX_ERROR',
        message: error.message,
        details: { stack: error.stack },
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: String(error),
    };
  }

  static createSandboxHeaders(
    envId: string,
    additionalHeaders: Record<string, string> = {}
  ): Record<string, string> {
    return {
      'X-Sandbox-Environment': envId,
      'X-Sandbox-Mode': 'true',
      'X-Request-Id': `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...additionalHeaders,
    };
  }

  static parseSandboxHeaders(headers: Record<string, string>): {
    envId?: string;
    isSandbox: boolean;
    requestId?: string;
  } {
    return {
      envId: headers['X-Sandbox-Environment'],
      isSandbox: headers['X-Sandbox-Mode'] === 'true',
      requestId: headers['X-Request-Id'],
    };
  }
}
