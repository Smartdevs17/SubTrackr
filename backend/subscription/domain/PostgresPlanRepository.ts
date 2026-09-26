/**
 * PostgreSQL plan repository — reads/writes plan metadata from the `plans` table.
 */

import type { Pool } from '../../shared/db/connectionPool';
import type { CreatePlanInput, PlanMetadata, PlanLimits, PlanMetadataConfig, UpdatePlanInput } from './types';
import type { IPlanRepository } from './PlanRepository';

interface PlanDbRow {
  id: string;
  name: string;
  price: number | string;
  currency: string;
  billingCycle: string;
  features?: string[] | null;
  limits?: PlanLimits | null;
  metadata?: PlanMetadataConfig | null;
  isActive?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

const SELECT_COLUMNS = `
  id,
  name,
  price,
  currency,
  billing_cycle AS "billingCycle",
  COALESCE(features, '[]'::jsonb) AS features,
  COALESCE(limits, '{}'::jsonb) AS limits,
  COALESCE(metadata, '{}'::jsonb) AS metadata,
  COALESCE(is_active, true) AS "isActive",
  COALESCE(created_at, NOW())::text AS "createdAt",
  COALESCE(updated_at, NOW())::text AS "updatedAt"
`;

function rowToPlan(row: PlanDbRow): PlanMetadata {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    currency: row.currency,
    billingCycle: row.billingCycle,
    features: Array.isArray(row.features) ? row.features : [],
    limits: row.limits ?? {},
    isActive: row.isActive ?? true,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt ?? new Date().toISOString(),
    updatedAt: row.updatedAt ?? new Date().toISOString(),
  };
}

export class PostgresPlanRepository implements IPlanRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<PlanMetadata | null> {
    const result = await this.pool.query<PlanDbRow>(
      `SELECT ${SELECT_COLUMNS} FROM plans WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? rowToPlan(result.rows[0]) : null;
  }

  async findAllActive(): Promise<PlanMetadata[]> {
    const result = await this.pool.query<PlanDbRow>(
      `SELECT ${SELECT_COLUMNS} FROM plans WHERE COALESCE(is_active, true) = true ORDER BY id`,
    );
    return result.rows.map(rowToPlan);
  }

  async create(input: CreatePlanInput): Promise<PlanMetadata> {
    const result = await this.pool.query<PlanDbRow>(
      `INSERT INTO plans (name, price, currency, billing_cycle, features, limits, metadata, is_active)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, true)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.name,
        input.price,
        input.currency,
        input.billingCycle,
        JSON.stringify(input.features ?? []),
        JSON.stringify(input.limits ?? {}),
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return rowToPlan(result.rows[0]);
  }

  async update(id: string, input: UpdatePlanInput): Promise<PlanMetadata | null> {
    const existing = await this.findById(id);
    if (!existing) return null;

    const merged: PlanMetadata = {
      ...existing,
      ...input,
      features: input.features ?? existing.features,
      limits: input.limits ?? existing.limits,
      metadata: input.metadata ? { ...existing.metadata, ...input.metadata } : existing.metadata,
      updatedAt: new Date().toISOString(),
    };

    const result = await this.pool.query<PlanDbRow>(
      `UPDATE plans
       SET name = $2, price = $3, currency = $4, billing_cycle = $5,
           features = $6::jsonb, limits = $7::jsonb, metadata = $8::jsonb,
           is_active = $9, updated_at = NOW()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [
        id,
        merged.name,
        merged.price,
        merged.currency,
        merged.billingCycle,
        JSON.stringify(merged.features),
        JSON.stringify(merged.limits),
        JSON.stringify(merged.metadata),
        merged.isActive,
      ],
    );
    return result.rows[0] ? rowToPlan(result.rows[0]) : null;
  }

  async deactivate(id: string): Promise<PlanMetadata | null> {
    return this.update(id, { isActive: false });
  }
}

/** Maps PlanMetadata to the GraphQL PlanRow shape. */
export function planMetadataToRow(plan: PlanMetadata): {
  id: string;
  name: string;
  price: number;
  currency: string;
  billingCycle: string;
} {
  return {
    id: plan.id,
    name: plan.name,
    price: plan.price,
    currency: plan.currency,
    billingCycle: plan.billingCycle,
  };
}
