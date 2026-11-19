import type { Request, Response } from 'express';

import {
  SubscriptionImportService,
  type SubscriptionImportRow,
} from '../domain/SubscriptionImportService';

export interface SubscriptionImportControllerDependencies {
  service: SubscriptionImportService;
}

export class SubscriptionImportController {
  constructor(private readonly deps: SubscriptionImportControllerDependencies) {}

  handleImport = async (req: Request, res: Response): Promise<void> => {
    try {
      const rows = this.parsePayload(req);
      if (!rows) {
        res.status(400).json({ error: 'Invalid or missing import payload' });
        return;
      }
      const result = await this.deps.service.importRows(rows);
      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      res.status(500).json({ error: message });
    }
  };

  private parsePayload(req: Request): SubscriptionImportRow[] | null {
    const body = res.body as unknown;
    if (!body) {
      return null;
    }
    if (Array.isArray(body)) {
      return body as SubscriptionImportRow[];
    }
    if (typeof body === 'object') {
      const casted = body as { rows?: unknown };
      if (Array.isArray(casted.rows)) {
        return casted.rows as SubscriptionImportRow[];
      }
    }
    return null;
  }
}
