import { AuditWriter, AuditEventInput } from '../../../audit/domain/AuditWriter';

export interface RequestContext {
  actorId: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}

export class AuditLoggingMiddleware {
  private writer: AuditWriter;

  constructor(writer: AuditWriter) {
    this.writer = writer;
  }

  onStateMutation(
    action: string,
    context: RequestContext,
    oldState?: Record<string, unknown> | null,
    newState?: Record<string, unknown> | null,
  ): void {
    const input: AuditEventInput = {
      actorId: context.actorId,
      action,
      resourceType: context.resourceType,
      resourceId: context.resourceId ?? 'unknown',
      oldState: oldState ?? null,
      newState: newState ?? null,
      metadata: context.metadata ?? {},
    };
    this.writer.write(input);
  }

  wrapHandler(
    handler: (req: unknown, res: unknown, next?: () => void) => Promise<void>,
    action: string,
    getContext: (req: unknown) => RequestContext,
    getState?: (req: unknown) => { oldState?: Record<string, unknown> | null; newState?: Record<string, unknown> | null },
  ) {
    return async (req: unknown, res: unknown, next?: () => void): Promise<void> => {
      try {
        await handler(req, res, next);
      } finally {
        const context = getContext(req);
        const state = getState?.(req);
        this.onStateMutation(
          action,
          context,
          state?.oldState,
          state?.newState,
        );
      }
    };
  }
}
