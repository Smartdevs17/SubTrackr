/**
 * Plan persistence layer — database access for plan metadata.
 */

import type { CreatePlanInput, PlanMetadata, UpdatePlanInput } from './types';

export interface IPlanRepository {
  findById(id: string): Promise<PlanMetadata | null>;
  findAllActive(): Promise<PlanMetadata[]>;
  create(input: CreatePlanInput): Promise<PlanMetadata>;
  update(id: string, input: UpdatePlanInput): Promise<PlanMetadata | null>;
  deactivate(id: string): Promise<PlanMetadata | null>;
}

let idCounter = 0;

function nextId(): string {
  idCounter += 1;
  return `plan-${idCounter}`;
}

/** In-memory repository for tests and local development. */
export class InMemoryPlanRepository implements IPlanRepository {
  private readonly plans = new Map<string, PlanMetadata>();

  constructor(seed: PlanMetadata[] = []) {
    for (const plan of seed) {
      this.plans.set(plan.id, { ...plan });
    }
  }

  async findById(id: string): Promise<PlanMetadata | null> {
    const plan = this.plans.get(id);
    return plan ? { ...plan } : null;
  }

  async findAllActive(): Promise<PlanMetadata[]> {
    return [...this.plans.values()]
      .filter((p) => p.isActive)
      .map((p) => ({ ...p }));
  }

  async create(input: CreatePlanInput): Promise<PlanMetadata> {
    const now = new Date().toISOString();
    const plan: PlanMetadata = {
      id: nextId(),
      name: input.name,
      price: input.price,
      currency: input.currency,
      billingCycle: input.billingCycle,
      features: input.features ?? [],
      limits: input.limits ?? {},
      isActive: true,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
    this.plans.set(plan.id, plan);
    return { ...plan };
  }

  async update(id: string, input: UpdatePlanInput): Promise<PlanMetadata | null> {
    const existing = this.plans.get(id);
    if (!existing) return null;

    const updated: PlanMetadata = {
      ...existing,
      ...input,
      features: input.features ?? existing.features,
      limits: input.limits ?? existing.limits,
      metadata: input.metadata ? { ...existing.metadata, ...input.metadata } : existing.metadata,
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(id, updated);
    return { ...updated };
  }

  async deactivate(id: string): Promise<PlanMetadata | null> {
    return this.update(id, { isActive: false });
  }

  /** Test helper: reset ID counter between test files. */
  static resetIdCounter(): void {
    idCounter = 0;
  }
}
