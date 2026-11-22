import type { Request, Response } from 'express';
import { fail, ok } from '../../services/shared/apiResponse';
import { extractRequestId } from './index';

interface ThemeRecord {
  id: string;
  merchantId: string;
  name: string;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const themeStore = new Map<string, ThemeRecord>();

function merchantIdOf(req: Request): string {
  const raw = req.headers['x-merchant-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || 'default';
}

export function getThemes(req: Request, res: Response): void {
  const merchantId = merchantIdOf(req);
  const merchantThemes = Array.from(themeStore.values()).filter(
    (t) => t.merchantId === merchantId,
  );
  res.status(200).json(ok(merchantThemes, extractRequestId(req)));
}

export function getThemeById(req: Request, res: Response): void {
  const theme = themeStore.get(req.params.id);
  if (!theme) {
    res.status(404).json(
      fail('NOT_FOUND', `Theme "${req.params.id}" not found`, extractRequestId(req)),
    );
    return;
  }
  res.status(200).json(ok(theme, extractRequestId(req)));
}

export function createTheme(req: Request, res: Response): void {
  const merchantId = merchantIdOf(req);
  const { id, name, config } = req.body;

  if (!id || !name || !config) {
    res.status(400).json(
      fail('BAD_REQUEST', 'Missing required fields: id, name, config', extractRequestId(req)),
    );
    return;
  }

  const now = new Date().toISOString();
  const record: ThemeRecord = {
    id,
    merchantId,
    name,
    config,
    isActive: false,
    createdAt: now,
    updatedAt: now,
  };

  themeStore.set(id, record);
  res.status(201).json(ok(record, extractRequestId(req)));
}

export function updateTheme(req: Request, res: Response): void {
  const existing = themeStore.get(req.params.id);
  if (!existing) {
    res.status(404).json(
      fail('NOT_FOUND', `Theme "${req.params.id}" not found`, extractRequestId(req)),
    );
    return;
  }

  const { name, config, isActive } = req.body;

  if (name !== undefined) existing.name = name;
  if (config !== undefined) existing.config = config;
  if (isActive !== undefined) {
    if (isActive) {
      for (const [, t] of themeStore) {
        if (t.merchantId === existing.merchantId) t.isActive = false;
      }
    }
    existing.isActive = isActive;
  }
  existing.updatedAt = new Date().toISOString();

  themeStore.set(req.params.id, existing);
  res.status(200).json(ok(existing, extractRequestId(req)));
}

export function deleteTheme(req: Request, res: Response): void {
  const existing = themeStore.get(req.params.id);
  if (!existing) {
    res.status(404).json(
      fail('NOT_FOUND', `Theme "${req.params.id}" not found`, extractRequestId(req)),
    );
    return;
  }

  themeStore.delete(req.params.id);
  res.status(200).json(ok({ deleted: true }, extractRequestId(req)));
}

export function activateTheme(req: Request, res: Response): void {
  const merchantId = merchantIdOf(req);
  const theme = themeStore.get(req.params.id);

  if (!theme) {
    res.status(404).json(
      fail('NOT_FOUND', `Theme "${req.params.id}" not found`, extractRequestId(req)),
    );
    return;
  }

  for (const [, t] of themeStore) {
    if (t.merchantId === merchantId) t.isActive = false;
  }

  theme.isActive = true;
  theme.updatedAt = new Date().toISOString();

  res.status(200).json(ok(theme, extractRequestId(req)));
}
