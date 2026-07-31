import { Subscription } from '../../../src/types/subscription';
import { AlignmentPlanPreview, AlignmentTargetDay } from '../../../src/types/billingAlignment';
import {
  buildAlignmentPlanPreview,
  canRealign,
  daysUntilNextRealignment,
} from '../../../src/utils/billingAlignment';

export interface AlignmentConfirmation {
  preview: AlignmentPlanPreview;
  appliedAt: Date;
}

/**
 * Server-side counterpart to the mobile billing-alignment store: tracks the
 * 90-day re-alignment lockout per merchant/subscriber and produces alignment
 * previews/confirmations from the same pure domain logic.
 */
export class AlignmentService {
  private lastAlignedAt = new Map<string, Date>();

  previewAlignment(
    userId: string,
    subscriptions: Subscription[],
    targetDay: AlignmentTargetDay
  ): AlignmentPlanPreview {
    return buildAlignmentPlanPreview(subscriptions, targetDay);
  }

  canRealign(userId: string, now: Date = new Date()): boolean {
    return canRealign(this.lastAlignedAt.get(userId) ?? null, now);
  }

  daysUntilNextRealignment(userId: string, now: Date = new Date()): number {
    return daysUntilNextRealignment(this.lastAlignedAt.get(userId) ?? null, now);
  }

  confirmAlignment(
    userId: string,
    subscriptions: Subscription[],
    targetDay: AlignmentTargetDay,
    now: Date = new Date()
  ): AlignmentConfirmation {
    if (!this.canRealign(userId, now)) {
      throw new Error(`Re-alignment for ${userId} is locked until the 90-day cooldown elapses`);
    }
    const preview = buildAlignmentPlanPreview(subscriptions, targetDay);
    this.lastAlignedAt.set(userId, now);
    return { preview, appliedAt: now };
  }
}

export const alignmentService = new AlignmentService();
