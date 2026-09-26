import type { Request, Response } from 'express';
import { fail, success } from '../../services/shared/apiResponse';
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

export function getThemes(req: Request, res: Response): void {
  const merchantId = (req.headers['x-merchant-id'] as string) || 'default';
  const merchantThemes = Array.from(themeStore.values()).filter(
    (t) => t.merchantId === merchantId,
  );
  res.status(200).json(
    success(merchantThemes, {
      requestId: extractRequestId(req) || 'unknown',
    }),
  );
}

export function getThemeById(req: Request, res: Response): void {
  const theme = themeStore.get(req.params.id);
  if (!theme) {
    res.status(404).json(
      fail('THEME_NOT_FOUND', `Theme "${req.params.id}" not found`, extractRequestId(req)),
    );
    return;
  }
  res.status(200).json(
    success(theme, { requestId: extractRequestId(req) || 'unknown' }),
  );
}

export function createTheme(req: Request, res: Response): void {
  const merchantId = (req.headers['x-merchant-id'] as string) || 'default';
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
  res.status(201).json(
    success(record, { requestId: extractRequestId(req) || 'unknown' }),
  );
}

export function updateTheme(req: Request, res: Response): void {
  const existing = themeStore.get(req.params.id);
  if (!existing) {
    res.status(404).json(
      fail('THEME_NOT_FOUND', `Theme "${req.params.id}" not found`, extractRequestId(req)),
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
  res.status(200).json(
    success(existing, { requestId: extractRequestId(req) || 'unknown' }),
  );
}

export function deleteTheme(req: Request, res: Response): void {
  const existing = themeStore.get(req.params.id);
  if (!existing) {
    res.status(404).json(
      fail('THEME_NOT_FOUND', `Theme "${req.params.id}" not found`, extractRequestId(req)),
    );
    return;
  }

  themeStore.delete(req.params.id);
  res.status(200).json(
    success({ deleted: true }, { requestId: extractRequestId(req) || 'unknown' }),
  );
}

export function activateTheme(req: Request, res: Response): void {
  const merchantId = (req.headers['x-merchant-id'] as string) || 'default';
  const theme = themeStore.get(req.params.id);

  if (!theme) {
    res.status(404).json(
      fail('THEME_NOT_FOUND', `Theme "${req.params.id}" not found`, extractRequestId(req)),
    );
    return;
  }

  for (const [, t] of themeStore) {
    if (t.merchantId === merchantId) t.isActive = false;
  }

  theme.isActive = true;
  theme.updatedAt = new Date().toISOString();

  res.status(200).json(
    success(theme, { requestId: extractRequestId(req) || 'unknown' }),
  );
}
