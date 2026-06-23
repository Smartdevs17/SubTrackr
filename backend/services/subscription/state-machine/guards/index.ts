import {
  SubscriptionState,
  SubscriptionParentState,
  SubscriptionChildState,
  getParentState,
  isChildOf,
} from '../states';

export type TransitionEdge =
  | 'cancel'
  | 'pause'
  | 'resume'
  | 'upgrade'
  | 'downgrade'
  | 'suspend_fraud'
  | 'suspend_admin'
  | 'unsuspend'
  | 'expire'
  | 'trial_to_paid'
  | 'payment_fail'
  | 'payment_recover';

export interface TransitionContext {
  subscriptionId: string;
  currentState: SubscriptionState;
  metadata?: Record<string, unknown>;
}

export type TransitionGuard = (ctx: TransitionContext) => boolean | { allowed: boolean; reason?: string };

export const guards: Record<TransitionEdge, TransitionGuard> = {
  cancel: (ctx) => {
    if (isChildOf(ctx.currentState, SubscriptionParentState.ACTIVE)) return true;
    if (ctx.currentState === SubscriptionChildState.PAUSED_END_OF_CYCLE) return true;
    return { allowed: false, reason: 'Can only cancel from Active or PausedEndOfCycle states' };
  },

  pause: (ctx) => {
    if (isChildOf(ctx.currentState, SubscriptionParentState.ACTIVE)) return true;
    return { allowed: false, reason: 'Can only pause from Active states' };
  },

  resume: (ctx) => {
    if (ctx.currentState === SubscriptionChildState.PAUSED_END_OF_CYCLE) return true;
    return { allowed: false, reason: 'Can only resume from PausedEndOfCycle state' };
  },

  upgrade: (ctx) => {
    if (ctx.currentState === SubscriptionChildState.PAID) return true;
    if (ctx.currentState === SubscriptionChildState.TRIAL) return true;
    return { allowed: false, reason: 'Can only upgrade from Paid or Trial states' };
  },

  downgrade: (ctx) => {
    if (ctx.currentState === SubscriptionChildState.PAID) return true;
    return { allowed: false, reason: 'Can only downgrade from Paid state' };
  },

  suspend_fraud: (ctx) => {
    if (isChildOf(ctx.currentState, SubscriptionParentState.ACTIVE)) return true;
    if (ctx.currentState === SubscriptionChildState.PAUSED_END_OF_CYCLE) return true;
    return { allowed: false, reason: 'Can only apply fraud hold from Active or PausedEndOfCycle states' };
  },

  suspend_admin: (ctx) => {
    if (isChildOf(ctx.currentState, SubscriptionParentState.ACTIVE)) return true;
    if (ctx.currentState === SubscriptionChildState.PAUSED_END_OF_CYCLE) return true;
    return { allowed: false, reason: 'Can only apply admin hold from Active or PausedEndOfCycle states' };
  },

  unsuspend: (ctx) => {
    if (isChildOf(ctx.currentState, SubscriptionParentState.SUSPENDED)) return true;
    return { allowed: false, reason: 'Can only unsuspend from Suspended states' };
  },

  expire: (ctx) => {
    if (isChildOf(ctx.currentState, SubscriptionParentState.ACTIVE)) return true;
    if (ctx.currentState === SubscriptionChildState.PAUSED_END_OF_CYCLE) return true;
    return { allowed: false, reason: 'Can only expire from Active or PausedEndOfCycle states' };
  },

  trial_to_paid: (ctx) => {
    if (ctx.currentState === SubscriptionChildState.TRIAL) return true;
    return { allowed: false, reason: 'Can only convert trial to paid from Trial state' };
  },

  payment_fail: (ctx) => {
    if (ctx.currentState === SubscriptionChildState.PAID) return true;
    return { allowed: false, reason: 'Can only fail payment from Paid state' };
  },

  payment_recover: (ctx) => {
    if (ctx.currentState === SubscriptionChildState.PAST_DUE) return true;
    return { allowed: false, reason: 'Can only recover payment from PastDue state' };
  },
};

export const TRANSITION_MATRIX: Record<TransitionEdge, { from: SubscriptionState[]; to: SubscriptionState }> = {
  cancel: { from: [SubscriptionParentState.ACTIVE, SubscriptionChildState.PAUSED_END_OF_CYCLE], to: SubscriptionChildState.CANCELLED },
  pause: { from: [SubscriptionParentState.ACTIVE], to: SubscriptionChildState.PAUSED_END_OF_CYCLE },
  resume: { from: [SubscriptionChildState.PAUSED_END_OF_CYCLE], to: SubscriptionChildState.PAID },
  upgrade: { from: [SubscriptionChildState.PAID, SubscriptionChildState.TRIAL], to: SubscriptionChildState.PAID },
  downgrade: { from: [SubscriptionChildState.PAID], to: SubscriptionChildState.PAID },
  suspend_fraud: { from: [SubscriptionParentState.ACTIVE, SubscriptionChildState.PAUSED_END_OF_CYCLE], to: SubscriptionChildState.FRAUD_HOLD },
  suspend_admin: { from: [SubscriptionParentState.ACTIVE, SubscriptionChildState.PAUSED_END_OF_CYCLE], to: SubscriptionChildState.ADMIN_HOLD },
  unsuspend: { from: [SubscriptionParentState.SUSPENDED], to: SubscriptionChildState.PAID },
  expire: { from: [SubscriptionParentState.ACTIVE, SubscriptionChildState.PAUSED_END_OF_CYCLE], to: SubscriptionChildState.EXPIRED },
  trial_to_paid: { from: [SubscriptionChildState.TRIAL], to: SubscriptionChildState.PAID },
  payment_fail: { from: [SubscriptionChildState.PAID], to: SubscriptionChildState.PAST_DUE },
  payment_recover: { from: [SubscriptionChildState.PAST_DUE], to: SubscriptionChildState.PAID },
};
