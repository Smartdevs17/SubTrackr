import Docker from 'dockerode';
import { EventEmitter } from 'events';

export interface SandboxContainerSpec {
  sandboxId: string;
  developerId: string;
  dbPassword: string;
  dbHostPort: number;
  apiHostPort: number;
  stellarAccount: string;
}

export interface SandboxContainerStatus {
  sandboxId: string;
  developerId: string;
  containerIds: string[];
  status: 'provisioning' | 'running' | 'stopped' | 'failed';
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
  idleWarningSent: boolean;
  ttlExtended: boolean;
}

export class ContainerManager extends EventEmitter {
  private docker: Docker;
  private containers: Map<string, SandboxContainerStatus> = new Map();
  private readonly MAX_CONCURRENT = 3;
  private readonly DEFAULT_TTL_MS = 60 * 60 * 1000;
  private readonly MAX_TTL_MS = 4 * 60 * 60 * 1000;
  private readonly EXTENSION_MS = 2 * 60 * 60 * 1000;
  private readonly IDLE_TIMEOUT_MS = 30 * 60 * 1000;
  private readonly COMPOSE_TEMPLATE_PATH = '../docker-compose.sandbox.yml';

  constructor() {
    super();
    this.docker = new Docker();
  }

  async provision(spec: SandboxContainerSpec): Promise<SandboxContainerStatus> {
    const activeCount = this.getActiveCount();
    if (activeCount >= this.MAX_CONCURRENT) {
      const waitTime = this.estimateWaitTime();
      throw new MaxSandboxesError(this.MAX_CONCURRENT, waitTime);
    }

    const now = new Date();
    const status: SandboxContainerStatus = {
      sandboxId: spec.sandboxId,
      developerId: spec.developerId,
      containerIds: [],
      status: 'provisioning',
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.DEFAULT_TTL_MS),
      lastActivityAt: now,
      idleWarningSent: false,
      ttlExtended: false,
    };

    this.containers.set(spec.sandboxId, status);

    try {
      const composeContent = await this.renderComposeTemplate(spec);
      const composeFile = `docker-compose-${spec.sandboxId}.yml`;
      await this.writeComposeFile(composeFile, composeContent);

      await this.runDockerComposeUp(composeFile);

      const containerIds = await this.resolveContainerIds(spec.sandboxId);
      status.containerIds = containerIds;
      status.status = 'running';

      await this.fundStellarAccount(spec.stellarAccount);

      this.emit('sandbox:provisioned', { sandboxId: spec.sandboxId, status });
      return status;
    } catch (err) {
      status.status = 'failed';
      this.emit('sandbox:failed', { sandboxId: spec.sandboxId, error: err });
      throw err;
    }
  }

  async teardown(sandboxId: string): Promise<void> {
    const status = this.containers.get(sandboxId);
    if (!status) return;

    try {
      const composeFile = `docker-compose-${sandboxId}.yml`;
      await this.runDockerComposeDown(composeFile);
      await this.removeVolume(sandboxId);
      await this.cleanupComposeFile(composeFile);
    } finally {
      this.containers.delete(sandboxId);
      this.emit('sandbox:removed', { sandboxId });
    }
  }

  extendTtl(sandboxId: string): boolean {
    const status = this.containers.get(sandboxId);
    if (!status) return false;

    if (status.ttlExtended) {
      throw new TtlExtensionLimitError();
    }

    const now = Date.now();
    const remainingTtl = Math.max(0, status.expiresAt.getTime() - now);
    const newTtl = Math.min(remainingTtl + this.EXTENSION_MS, this.MAX_TTL_MS);

    status.expiresAt = new Date(now + newTtl);
    status.ttlExtended = true;
    this.emit('sandbox:extended', { sandboxId, newExpiry: status.expiresAt });
    return true;
  }

  touchActivity(sandboxId: string): void {
    const status = this.containers.get(sandboxId);
    if (status) {
      status.lastActivityAt = new Date();
      status.idleWarningSent = false;
    }
  }

  getStatus(sandboxId: string): SandboxContainerStatus | undefined {
    return this.containers.get(sandboxId);
  }

  listByDeveloper(developerId: string): SandboxContainerStatus[] {
    return Array.from(this.containers.values()).filter(
      (s) => s.developerId === developerId
    );
  }

  getActiveCount(): number {
    let count = 0;
    for (const s of this.containers.values()) {
      if (s.status === 'running' || s.status === 'provisioning') count++;
    }
    return count;
  }

  estimateWaitTime(): string {
    const earliestExpiry = Array.from(this.containers.values())
      .filter((s) => s.status === 'running')
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());

    if (earliestExpiry.length === 0) return 'unknown';

    const ms = Math.max(0, earliestExpiry[0].expiresAt.getTime() - Date.now());
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 1) return 'less than a minute';
    return `~${minutes} minute${minutes !== 1 ? 's' : ''}`;
  }

  checkIdleSandboxes(): string[] {
    const now = Date.now();
    const warned: string[] = [];

    for (const [sandboxId, status] of this.containers.entries()) {
      if (status.status !== 'running') continue;

      const idleMs = now - status.lastActivityAt.getTime();
      if (idleMs >= this.IDLE_TIMEOUT_MS && !status.idleWarningSent) {
        status.idleWarningSent = true;
        warned.push(sandboxId);
      }
    }

    return warned;
  }

  checkExpiredSandboxes(): string[] {
    const now = Date.now();
    const expired: string[] = [];

    for (const [sandboxId, status] of this.containers.entries()) {
      if (status.expiresAt.getTime() <= now) {
        expired.push(sandboxId);
      }
    }

    return expired;
  }

  private async renderComposeTemplate(spec: SandboxContainerSpec): Promise<string> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const templatePath = path.resolve(__dirname, this.COMPOSE_TEMPLATE_PATH);
    let content = await fs.readFile(templatePath, 'utf-8');

    const replacements: Record<string, string> = {
      '{{SANDBOX_ID}}': spec.sandboxId,
      '{{DB_PASSWORD}}': spec.dbPassword,
      '{{DB_HOST_PORT}}': String(spec.dbHostPort),
      '{{API_HOST_PORT}}': String(spec.apiHostPort),
      '{{STELLAR_ACCOUNT}}': spec.stellarAccount,
    };

    for (const [key, value] of Object.entries(replacements)) {
      content = content.replaceAll(key, value);
    }

    return content;
  }

  private async writeComposeFile(filename: string, content: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.resolve(__dirname, filename);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  private async runDockerComposeUp(composeFile: string): Promise<void> {
    const { execSync } = await import('child_process');
    const path = await import('path');
    const filePath = path.resolve(__dirname, composeFile);
    execSync(`docker-compose -f "${filePath}" up -d --wait`, {
      stdio: 'pipe',
      timeout: 120000,
    });
  }

  private async runDockerComposeDown(composeFile: string): Promise<void> {
    const { execSync } = await import('child_process');
    const path = await import('path');
    const filePath = path.resolve(__dirname, composeFile);
    execSync(`docker-compose -f "${filePath}" down -v`, {
      stdio: 'pipe',
      timeout: 60000,
    });
  }

  private async removeVolume(sandboxId: string): Promise<void> {
    const { execSync } = await import('child_process');
    const volumeName = `subtrackr_sandbox_data_${sandboxId}`;
    try {
      execSync(`docker volume rm "${volumeName}" --force`, { stdio: 'pipe', timeout: 30000 });
    } catch {
    }
  }

  private async cleanupComposeFile(filename: string): Promise<void> {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.resolve(__dirname, filename);
    try {
      await fs.unlink(filePath);
    } catch {
    }
  }

  private async resolveContainerIds(sandboxId: string): Promise<string[]> {
    const { execSync } = await import('child_process');
    const output = execSync(
      `docker ps --filter "name=subtrackr_sandbox_${sandboxId}" --format "{{.ID}}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    return output.trim().split('\n').filter(Boolean);
  }

  private async fundStellarAccount(publicKey: string): Promise<void> {
    const response = await fetch(
      `https://friendbot.stellar.org?addr=${publicKey}`,
      { method: 'GET' }
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Stellar friendbot funding failed: ${text}`);
    }
  }
}

export class MaxSandboxesError extends Error {
  public readonly maxConcurrent: number;
  public readonly estimatedWait: string;

  constructor(maxConcurrent: number, estimatedWait: string) {
    super(
      `Maximum concurrent sandboxes (${maxConcurrent}) reached. ` +
      `Estimated wait time: ${estimatedWait}.`
    );
    this.name = 'MaxSandboxesError';
    this.maxConcurrent = maxConcurrent;
    this.estimatedWait = estimatedWait;
  }
}

export class TtlExtensionLimitError extends Error {
  constructor() {
    super(
      'TTL extension limit reached. Sandboxes can only be extended once by up to 2 hours, ' +
      'for a maximum total lifetime of 4 hours.'
    );
    this.name = 'TtlExtensionLimitError';
  }
}

export const containerManager = new ContainerManager();
