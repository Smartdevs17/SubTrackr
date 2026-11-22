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

export interface GroupAlignmentConfirmation {
  previews: AlignmentPlanPreview[];
  appliedAt: Date;
}

/**
 * Server-side counterpart to the mobile billing-alignment store: tracks the
 * 90-day re-alignment lockout per merchant/subscriber/group and produces
 * alignment previews/confirmations from the same pure domain logic.
 */
export class AlignmentService {
  private lastAlignedAt = new Map<string, Date>();
  private lastGroupAlignedAt = new Map<string, Date>();

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

  previewGroupAlignment(
    groupId: string,
    memberSubscriptions: Subscription[][],
    targetDay: AlignmentTargetDay
  ): AlignmentPlanPreview[] {
    return memberSubscriptions.map(subs => buildAlignmentPlanPreview(subs, targetDay));
  }

  canRealignGroup(groupId: string, now: Date = new Date()): boolean {
    return canRealign(this.lastGroupAlignedAt.get(groupId) ?? null, now);
  }

  daysUntilNextGroupRealignment(groupId: string, now: Date = new Date()): number {
    return daysUntilNextRealignment(this.lastGroupAlignedAt.get(groupId) ?? null, now);
  }

  confirmGroupAlignment(
    groupId: string,
    memberSubscriptions: Subscription[][],
    targetDay: AlignmentTargetDay,
    now: Date = new Date()
  ): GroupAlignmentConfirmation {
    if (!this.canRealignGroup(groupId, now)) {
      throw new Error(`Re-alignment for group ${groupId} is locked until the 90-day cooldown elapses`);
    }
    const previews = memberSubscriptions.map(subs => buildAlignmentPlanPreview(subs, targetDay));
    this.lastGroupAlignedAt.set(groupId, now);
    return { previews, appliedAt: now };
  }
}

export const alignmentService = new AlignmentService();
