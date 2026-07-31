import { HashChainService, AuditChainEntry } from './HashChainService';

export interface AuditEventInput {
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  oldState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export class AuditWriter {
  constructor(private chain: HashChainService) {}

  write(input: AuditEventInput): AuditChainEntry {
    return this.chain.append({
      id: crypto.randomUUID(),
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      oldState: input.oldState ?? null,
      newState: input.newState ?? null,
      timestamp: Date.now(),
      metadata: input.metadata ?? {},
    });
  }

  writeBatch(inputs: AuditEventInput[]): AuditChainEntry[] {
    return inputs.map((input) => this.write(input));
  }
}
