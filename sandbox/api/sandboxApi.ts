import { SandboxService, sandboxService } from '../services/sandboxService';
import { SandboxMiddleware, sandboxMiddleware } from '../middleware/sandboxMiddleware';
import { SandboxUtils } from '../utils/sandboxUtils';
import { SandboxConfig } from '../types/sandbox';

export class SandboxApi {
  private sandboxService: SandboxService;
  private middleware: SandboxMiddleware;

  constructor() {
    this.sandboxService = sandboxService;
    this.middleware = sandboxMiddleware;
  }

  async createEnvironment(
    developerId: string,
    name: string = 'Default Sandbox',
    config?: Partial<SandboxConfig>
  ): Promise<ApiResponse> {
    try {
      const environment = await this.sandboxService.createEnvironment(developerId, name, config);

      return {
        success: true,
        data: environment,
        message: 'Sandbox environment created successfully',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create environment',
      };
    }
  }

  async getEnvironment(environmentId: string): Promise<ApiResponse> {
    try {
      const environment = await this.sandboxService.getEnvironment(environmentId);

      if (!environment) {
        return { success: false, error: 'Environment not found' };
      }

      const validation = SandboxUtils.validateEnvironmentStatus(environment);
      if (!validation.valid) {
        return { success: false, error: validation.reason };
      }

      return { success: true, data: environment };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get environment',
      };
    }
  }

  async getEnvironmentsByDeveloper(developerId: string): Promise<ApiResponse> {
    try {
      const environments = await this.sandboxService.getEnvironmentsByDeveloper(developerId);
      return { success: true, data: environments };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get environments',
      };
    }
  }

  async updateEnvironment(
    environmentId: string,
    updates: Partial<SandboxConfig>
  ): Promise<ApiResponse> {
    try {
      const environment = await this.sandboxService.updateConfig(environmentId, updates);

      if (!environment) {
        return { success: false, error: 'Environment not found' };
      }

      return {
        success: true,
        data: environment,
        message: 'Environment updated successfully',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update environment',
      };
    }
  }

  async deleteEnvironment(environmentId: string): Promise<ApiResponse> {
    try {
      const deleted = await this.sandboxService.deleteEnvironment(environmentId);

      if (!deleted) {
        return { success: false, error: 'Environment not found' };
      }

      return { success: true, message: 'Environment deleted successfully' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete environment',
      };
    }
  }

  async suspendEnvironment(environmentId: string): Promise<ApiResponse> {
    try {
      const suspended = await this.sandboxService.suspendEnvironment(environmentId);

      if (!suspended) {
        return { success: false, error: 'Environment not found' };
      }

      return { success: true, message: 'Environment suspended successfully' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to suspend environment',
      };
    }
  }

  async getTestData(environmentId: string): Promise<ApiResponse> {
    try {
      const testData = await this.sandboxService.getTestData(environmentId);

      if (!testData) {
        return { success: false, error: 'Environment not found' };
      }

      return { success: true, data: testData };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get test data',
      };
    }
  }

  async resetTestData(environmentId: string): Promise<ApiResponse> {
    try {
      const testData = await this.sandboxService.resetTestData(environmentId);

      if (!testData) {
        return { success: false, error: 'Environment not found' };
      }

      return {
        success: true,
        data: testData,
        message: 'Test data reset successfully',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset test data',
      };
    }
  }

  async getMetrics(environmentId: string): Promise<ApiResponse> {
    try {
      const metrics = await this.sandboxService.getMetrics(environmentId);

      if (!metrics) {
        return { success: false, error: 'No metrics found' };
      }

      return { success: true, data: metrics };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get metrics',
      };
    }
  }

  async processRequest(
    environmentId: string,
    apiKey: string,
    endpoint: string,
    method: string
  ): Promise<ApiResponse> {
    try {
      const response = await this.middleware.processRequest({
        environmentId,
        apiKey,
        timestamp: new Date(),
        endpoint,
        method,
      });

      return {
        success: response.success,
        data: response.data,
        error: response.error,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process request',
      };
    }
  }

  async validateAccess(environmentId: string, apiKey: string): Promise<ApiResponse> {
    try {
      const isValid = await this.sandboxService.validateAccess(environmentId, apiKey);
      return { success: true, data: { valid: isValid } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to validate access',
      };
    }
  }

  async getIsolationContext(environmentId: string): Promise<ApiResponse> {
    try {
      const context = await this.sandboxService.getIsolationContext(environmentId);

      if (!context) {
        return { success: false, error: 'Environment not found' };
      }

      return { success: true, data: context };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get isolation context',
      };
    }
  }
}

export interface ApiResponse {
  success: boolean;
  data?: unknown;
  message?: string;
  error?: string;
}

export const sandboxApi = new SandboxApi();
