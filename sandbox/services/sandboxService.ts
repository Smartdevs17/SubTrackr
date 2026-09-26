/**
 * Stub sandboxService for developer-portal usage.
 * The sandbox module lives in src/services/sandbox/ (React Native context).
 * This thin shim allows the developer-portal service layer to import it
 * without pulling in React Native / AsyncStorage dependencies.
 */

export interface SandboxEnvironmentSummary {
  id: string;
  name: string;
  status: string;
  requestCount: number;
  errorRate: number;
}

export interface SandboxMetrics {
  requestCount: number;
  errorRate: number;
  avgResponseTime: number;
  lastActivity?: Date;
}

class SandboxService {
  async createEnvironment(_ownerId: string, name: string): Promise<SandboxEnvironmentSummary> {
    return {
      id: `env-${Math.random().toString(36).slice(2, 10)}`,
      name,
      status: 'active',
      requestCount: 0,
      errorRate: 0,
    };
  }

  async getEnvironment(_envId: string): Promise<SandboxEnvironmentSummary | null> {
    return null;
  }

  async getMetrics(_envId: string): Promise<SandboxMetrics> {
    return { requestCount: 0, errorRate: 0, avgResponseTime: 0 };
  }

  async listEnvironments(_ownerId: string): Promise<SandboxEnvironmentSummary[]> {
    return [];
  }
}

export const sandboxService = new SandboxService();
