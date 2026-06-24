export const SubscriptionParentState = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  SUSPENDED: 'Suspended',
} as const;

export type SubscriptionParentState = (typeof SubscriptionParentState)[keyof typeof SubscriptionParentState];

export const SubscriptionChildState = {
  TRIAL: 'Active.Trial',
  PAID: 'Active.Paid',
  PAST_DUE: 'Active.PastDue',
  CANCELLED: 'Inactive.Cancelled',
  PAUSED_END_OF_CYCLE: 'Inactive.PausedEndOfCycle',
  EXPIRED: 'Inactive.Expired',
  FRAUD_HOLD: 'Suspended.FraudHold',
  ADMIN_HOLD: 'Suspended.AdminHold',
} as const;

export type SubscriptionChildState = (typeof SubscriptionChildState)[keyof typeof SubscriptionChildState];

export type SubscriptionState = SubscriptionParentState | SubscriptionChildState;

export interface StateNode {
  name: SubscriptionState;
  parent?: SubscriptionParentState;
  children?: StateNode[];
  initial?: boolean;
}

export const STATE_HIERARCHY: StateNode[] = [
  {
    name: SubscriptionParentState.ACTIVE,
    children: [
      { name: SubscriptionChildState.TRIAL, parent: SubscriptionParentState.ACTIVE, initial: true },
      { name: SubscriptionChildState.PAID, parent: SubscriptionParentState.ACTIVE },
      { name: SubscriptionChildState.PAST_DUE, parent: SubscriptionParentState.ACTIVE },
    ],
  },
  {
    name: SubscriptionParentState.INACTIVE,
    children: [
      { name: SubscriptionChildState.CANCELLED, parent: SubscriptionParentState.INACTIVE },
      { name: SubscriptionChildState.PAUSED_END_OF_CYCLE, parent: SubscriptionParentState.INACTIVE },
      { name: SubscriptionChildState.EXPIRED, parent: SubscriptionParentState.INACTIVE },
    ],
  },
  {
    name: SubscriptionParentState.SUSPENDED,
    children: [
      { name: SubscriptionChildState.FRAUD_HOLD, parent: SubscriptionParentState.SUSPENDED },
      { name: SubscriptionChildState.ADMIN_HOLD, parent: SubscriptionParentState.SUSPENDED },
    ],
  },
];

export function getParentState(state: SubscriptionState): SubscriptionParentState {
  if (Object.values(SubscriptionParentState).includes(state as SubscriptionParentState)) {
    return state as SubscriptionParentState;
  }
  const dotIdx = state.indexOf('.');
  if (dotIdx > 0) {
    return state.slice(0, dotIdx) as SubscriptionParentState;
  }
  return state as SubscriptionParentState;
}

export function isChildOf(state: SubscriptionState, parent: SubscriptionParentState): boolean {
  return getParentState(state) === parent;
}

export function getAllStates(): SubscriptionState[] {
  return [
    SubscriptionParentState.ACTIVE,
    SubscriptionParentState.INACTIVE,
    SubscriptionParentState.SUSPENDED,
    SubscriptionChildState.TRIAL,
    SubscriptionChildState.PAID,
    SubscriptionChildState.PAST_DUE,
    SubscriptionChildState.CANCELLED,
    SubscriptionChildState.PAUSED_END_OF_CYCLE,
    SubscriptionChildState.EXPIRED,
    SubscriptionChildState.FRAUD_HOLD,
    SubscriptionChildState.ADMIN_HOLD,
  ];
}
