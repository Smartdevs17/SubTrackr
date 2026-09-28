/**
 * Sensitive Operations Audit Controller
 *
 * Wraps the existing AuditWriter / AuditController to automatically
 * audit every sensitive operation defined in the SENSITIVE_OPERATIONS
 * registry. Validates required metadata (e.g. reason) and captures
 * state snapshots when configured.
 */

import { AuditWriter, AuditEventInput } from '../domain/AuditWriter';
import { AuditChainEntry } from '../domain/HashChainService';
import {
  SENSITIVE_OPERATIONS,
  getSensitiveOperation,
  isSensitiveOperation,
  SensitiveOperationDefinition,
} from '../sensitiveOperations';

export interface SensitiveOpContext {
  /** The actor performing the operation (user id, system, or service name) */
  actorId: string;
  /** Resource id being acted upon */
  resourceId: string;
  /** Optional reason — required for operations flagged requiresReason */
  reason?: string;
  /** Additional metadata merged into the audit entry */
  metadata?: Record<string, unknown>;
  /** IP address of the requester */
  ipAddress?: string;
  /** User agent of the requester */
  userAgent?: string;
}

export interface SensitiveOpResult {
  success: boolean;
  auditEntry: AuditChainEntry | null;
  error?: string;
}

export class SensitiveOpsAuditController {
  constructor(private writer: AuditWriter) {}

  /**
   * Audit a sensitive operation. Validates the operation key exists,
   * enforces required metadata, and records the event via the audit chain.
   */
  audit(operationKey: string, context: SensitiveOpContext): SensitiveOpResult {
    const definition = getSensitiveOperation(operationKey);
    if (!definition) {
      return {
        success: false,
        auditEntry: null,
        error: `Unknown sensitive operation: ${operationKey}`,
      };
    }

    if (definition.requiresReason && !context.reason?.trim()) {
      return {
        success: false,
        auditEntry: null,
        error: `Operation "${operationKey}" requires a reason`,
      };
    }

    const metadata: Record<string, unknown> = {
      ...context.metadata,
      operationKey,
      category: definition.category,
      severity: definition.severity,
      label: definition.label,
    };

    if (context.reason) {
      metadata.reason = context.reason;
    }
    if (context.ipAddress) {
      metadata.ipAddress = context.ipAddress;
    }
    if (context.userAgent) {
      metadata.userAgent = context.userAgent;
    }

    const input: AuditEventInput = {
      actorId: context.actorId,
      action: operationKey,
      resourceType: definition.resourceType,
      resourceId: context.resourceId,
      metadata,
    };

    const entry = this.writer.write(input);
    return { success: true, auditEntry: entry };
  }

  /**
   * Audit a sensitive operation with state capture (old → new).
   * Use for data_modification and admin operations.
   */
  auditWithState(
    operationKey: string,
    context: SensitiveOpContext,
    oldState: Record<string, unknown> | null,
    newState: Record<string, unknown> | null,
  ): SensitiveOpResult {
    const definition = getSensitiveOperation(operationKey);
    if (!definition) {
      return {
        success: false,
        auditEntry: null,
        error: `Unknown sensitive operation: ${operationKey}`,
      };
    }

    if (definition.requiresReason && !context.reason?.trim()) {
      return {
        success: false,
        auditEntry: null,
        error: `Operation "${operationKey}" requires a reason`,
      };
    }

    const metadata: Record<string, unknown> = {
      ...context.metadata,
      operationKey,
      category: definition.category,
      severity: definition.severity,
      label: definition.label,
    };

    if (context.reason) {
      metadata.reason = context.reason;
    }
    if (context.ipAddress) {
      metadata.ipAddress = context.ipAddress;
    }
    if (context.userAgent) {
      metadata.userAgent = context.userAgent;
    }

    const input: AuditEventInput = {
      actorId: context.actorId,
      action: operationKey,
      resourceType: definition.resourceType,
      resourceId: context.resourceId,
      oldState: definition.captureState ? oldState : null,
      newState: definition.captureState ? newState : null,
      metadata,
    };

    const entry = this.writer.write(input);
    return { success: true, auditEntry: entry };
  }

  /**
   * Wrap an async handler so that its execution is automatically audited.
   * The handler runs first; the audit entry is written in the `finally`
   * block regardless of success or failure.
   */
  wrap<TArgs extends unknown[], TResult>(
    operationKey: string,
    context: SensitiveOpContext,
    handler: (...args: TArgs) => Promise<TResult>,
    getState?: () => {
      oldState?: Record<string, unknown> | null;
      newState?: Record<string, unknown> | null;
    },
  ): (...args: TArgs) => Promise<TResult & { _audit: SensitiveOpResult }> {
    return async (...args: TArgs): Promise<TResult & { _audit: SensitiveOpResult }> => {
      let result: TResult;
      let auditResult: SensitiveOpResult;
      try {
        result = await handler(...args);
        const state = getState?.();
        if (state) {
          auditResult = this.auditWithState(
            operationKey,
            context,
            state.oldState ?? null,
            state.newState ?? null,
          );
        } else {
          auditResult = this.audit(operationKey, context);
        }
      } catch (err) {
        const errorContext: SensitiveOpContext = {
          ...context,
          metadata: {
            ...context.metadata,
            error: err instanceof Error ? err.message : String(err),
            failed: true,
          },
        };
        auditResult = this.audit(operationKey, errorContext);
        throw err;
      }
      return { ...result, _audit: auditResult } as TResult & { _audit: SensitiveOpResult };
    };
  }

  /** Return all registered sensitive operation definitions */
  listOperations(): SensitiveOperationDefinition[] {
    return Object.values(SENSITIVE_OPERATIONS);
  }

  /** Check whether a key is a known sensitive operation */
  isRegistered(operationKey: string): boolean {
    return isSensitiveOperation(operationKey);
  }
}
