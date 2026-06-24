import { SubscriptionState } from '../states';

export interface StateActionContext {
  subscriptionId: string;
  previousState: SubscriptionState;
  newState: SubscriptionState;
  actor?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export type StateAction = {
  name: string;
  execute: (ctx: StateActionContext) => void | Promise<void>;
};

export type StateActionMap = {
  onEntry?: StateAction[];
  onExit?: StateAction[];
};

function noopAction(name: string): StateAction {
  return { name, execute: () => {} };
}

const sendEmailAction: StateAction = {
  name: 'sendEmail',
  execute: (ctx: StateActionContext) => {
    console.log(`[Action] Sending email for subscription ${ctx.subscriptionId}: state changed from ${ctx.previousState} to ${ctx.newState}`);
  },
};

const stopBillingAction: StateAction = {
  name: 'stopBilling',
  execute: (ctx: StateActionContext) => {
    console.log(`[Action] Stopping billing for subscription ${ctx.subscriptionId} (reason: ${ctx.reason})`);
  },
};

const revokeAccessAction: StateAction = {
  name: 'revokeAccess',
  execute: (ctx: StateActionContext) => {
    console.log(`[Action] Revoking access for subscription ${ctx.subscriptionId}`);
  },
};

const startBillingAction: StateAction = {
  name: 'startBilling',
  execute: (ctx: StateActionContext) => {
    console.log(`[Action] Starting billing for subscription ${ctx.subscriptionId}`);
  },
};

const restoreAccessAction: StateAction = {
  name: 'restoreAccess',
  execute: (ctx: StateActionContext) => {
    console.log(`[Action] Restoring access for subscription ${ctx.subscriptionId}`);
  },
};

const notifyAdminAction: StateAction = {
  name: 'notifyAdmin',
  execute: (ctx: StateActionContext) => {
    console.log(`[Action] Notifying admin about subscription ${ctx.subscriptionId}: ${ctx.reason}`);
  },
};

export const entryActions: Partial<Record<SubscriptionState, StateAction[]>> = {
  'Inactive.Cancelled': [sendEmailAction, stopBillingAction, revokeAccessAction],
  'Inactive.PausedEndOfCycle': [sendEmailAction],
  'Inactive.Expired': [stopBillingAction, revokeAccessAction],
  'Suspended.FraudHold': [notifyAdminAction, stopBillingAction, revokeAccessAction],
  'Suspended.AdminHold': [notifyAdminAction, stopBillingAction, revokeAccessAction],
  'Active.Trial': [startBillingAction],
  'Active.Paid': [sendEmailAction, restoreAccessAction, startBillingAction],
  'Active.PastDue': [sendEmailAction],
};

export const exitActions: Partial<Record<SubscriptionState, StateAction[]>> = {
  'Active.Trial': [noopAction('notifyTrialEnding')],
  'Active.PastDue': [noopAction('notifyPaymentRecoveryFailed')],
  'Suspended.FraudHold': [noopAction('logFraudResolution')],
  'Suspended.AdminHold': [noopAction('logAdminHoldResolution')],
};

export async function executeActions(
  actions: StateAction[] | undefined,
  ctx: StateActionContext
): Promise<void> {
  if (!actions || actions.length === 0) return;
  for (const action of actions) {
    await action.execute(ctx);
  }
}
