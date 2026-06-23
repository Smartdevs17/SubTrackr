import {
  SubscriptionStateMachine,
  getAllStates,
  getParentState,
  isChildOf,
} from '../../state-machine/index';
import {
  SubscriptionParentState,
  SubscriptionChildState,
} from '../../state-machine/states';
import { TransitionEdge, TRANSITION_MATRIX } from '../../state-machine/guards/index';
import { entryActions, exitActions } from '../../state-machine/actions/index';

// ── State Hierarchy ───────────────────────────────────────────────────────────

describe('State Hierarchy', () => {
  it('defines all parent states', () => {
    expect(SubscriptionParentState.ACTIVE).toBe('Active');
    expect(SubscriptionParentState.INACTIVE).toBe('Inactive');
    expect(SubscriptionParentState.SUSPENDED).toBe('Suspended');
  });

  it('defines all child states', () => {
    expect(SubscriptionChildState.TRIAL).toBe('Active.Trial');
    expect(SubscriptionChildState.PAID).toBe('Active.Paid');
    expect(SubscriptionChildState.PAST_DUE).toBe('Active.PastDue');
    expect(SubscriptionChildState.CANCELLED).toBe('Inactive.Cancelled');
    expect(SubscriptionChildState.PAUSED_END_OF_CYCLE).toBe('Inactive.PausedEndOfCycle');
    expect(SubscriptionChildState.EXPIRED).toBe('Inactive.Expired');
    expect(SubscriptionChildState.FRAUD_HOLD).toBe('Suspended.FraudHold');
    expect(SubscriptionChildState.ADMIN_HOLD).toBe('Suspended.AdminHold');
  });

  it('getParentState returns correct parent', () => {
    expect(getParentState(SubscriptionChildState.TRIAL)).toBe(SubscriptionParentState.ACTIVE);
    expect(getParentState(SubscriptionChildState.PAID)).toBe(SubscriptionParentState.ACTIVE);
    expect(getParentState(SubscriptionChildState.CANCELLED)).toBe(SubscriptionParentState.INACTIVE);
    expect(getParentState(SubscriptionChildState.FRAUD_HOLD)).toBe(SubscriptionParentState.SUSPENDED);
  });

  it('getParentState returns same for parent states', () => {
    expect(getParentState(SubscriptionParentState.ACTIVE)).toBe(SubscriptionParentState.ACTIVE);
    expect(getParentState(SubscriptionParentState.INACTIVE)).toBe(SubscriptionParentState.INACTIVE);
  });

  it('isChildOf correctly identifies parent-child relationship', () => {
    expect(isChildOf(SubscriptionChildState.TRIAL, SubscriptionParentState.ACTIVE)).toBe(true);
    expect(isChildOf(SubscriptionChildState.PAID, SubscriptionParentState.ACTIVE)).toBe(true);
    expect(isChildOf(SubscriptionChildState.CANCELLED, SubscriptionParentState.INACTIVE)).toBe(true);
    expect(isChildOf(SubscriptionChildState.TRIAL, SubscriptionParentState.INACTIVE)).toBe(false);
  });

  it('getAllStates returns all 11 states', () => {
    const states = getAllStates();
    expect(states.length).toBe(11);
  });
});

// ── Transition Matrix ─────────────────────────────────────────────────────────

describe('Transition Matrix', () => {
  it('has all 12 transition edges', () => {
    const edges = Object.keys(TRANSITION_MATRIX) as TransitionEdge[];
    expect(edges.length).toBe(12);
    expect(edges).toContain('cancel');
    expect(edges).toContain('pause');
    expect(edges).toContain('resume');
    expect(edges).toContain('upgrade');
    expect(edges).toContain('downgrade');
    expect(edges).toContain('suspend_fraud');
    expect(edges).toContain('suspend_admin');
    expect(edges).toContain('unsuspend');
    expect(edges).toContain('expire');
    expect(edges).toContain('trial_to_paid');
    expect(edges).toContain('payment_fail');
    expect(edges).toContain('payment_recover');
  });

  it('every edge has a target state and source states', () => {
    for (const [edge, matrix] of Object.entries(TRANSITION_MATRIX)) {
      expect(matrix.from.length).toBeGreaterThan(0);
      expect(matrix.to).toBeDefined();
    }
  });
});

// ── Transition Guards ─────────────────────────────────────────────────────────

describe('Transition Guards', () => {
  let machine: SubscriptionStateMachine;

  beforeEach(() => {
    machine = new SubscriptionStateMachine();
  });

  it('allows cancel from Active states', () => {
    const states = [SubscriptionChildState.TRIAL, SubscriptionChildState.PAID, SubscriptionChildState.PAST_DUE, SubscriptionParentState.ACTIVE];
    for (const state of states) {
      machine.setState('sub_1', state);
      const result = machine.validateTransition('sub_1', 'cancel');
      expect(result.allowed).toBe(true);
    }
  });

  it('allows cancel from PausedEndOfCycle', () => {
    machine.setState('sub_1', SubscriptionChildState.PAUSED_END_OF_CYCLE);
    const result = machine.validateTransition('sub_1', 'cancel');
    expect(result.allowed).toBe(true);
  });

  it('denies cancel from Suspended states', () => {
    for (const state of [SubscriptionChildState.FRAUD_HOLD, SubscriptionChildState.ADMIN_HOLD]) {
      machine.setState('sub_1', state);
      const result = machine.validateTransition('sub_1', 'cancel');
      expect(result.allowed).toBe(false);
    }
  });

  it('allows pause from Active states', () => {
    for (const state of [SubscriptionChildState.TRIAL, SubscriptionChildState.PAID, SubscriptionChildState.PAST_DUE]) {
      machine.setState('sub_1', state);
      const result = machine.validateTransition('sub_1', 'pause');
      expect(result.allowed).toBe(true);
    }
  });

  it('denies pause from Inactive', () => {
    machine.setState('sub_1', SubscriptionChildState.CANCELLED);
    const result = machine.validateTransition('sub_1', 'pause');
    expect(result.allowed).toBe(false);
  });

  it('allows resume from PausedEndOfCycle', () => {
    machine.setState('sub_1', SubscriptionChildState.PAUSED_END_OF_CYCLE);
    const result = machine.validateTransition('sub_1', 'resume');
    expect(result.allowed).toBe(true);
  });

  it('denies resume from Active', () => {
    machine.setState('sub_1', SubscriptionChildState.PAID);
    const result = machine.validateTransition('sub_1', 'resume');
    expect(result.allowed).toBe(false);
  });

  it('allows upgrade from Paid and Trial', () => {
    machine.setState('sub_1', SubscriptionChildState.PAID);
    expect(machine.validateTransition('sub_1', 'upgrade').allowed).toBe(true);

    machine.setState('sub_1', SubscriptionChildState.TRIAL);
    expect(machine.validateTransition('sub_1', 'upgrade').allowed).toBe(true);
  });

  it('denies downgrade from Trial', () => {
    machine.setState('sub_1', SubscriptionChildState.TRIAL);
    const result = machine.validateTransition('sub_1', 'downgrade');
    expect(result.allowed).toBe(false);
  });

  it('allows suspend_fraud from Active states', () => {
    machine.setState('sub_1', SubscriptionChildState.PAID);
    const result = machine.validateTransition('sub_1', 'suspend_fraud');
    expect(result.allowed).toBe(true);
  });

  it('allows unsuspend from FraudHold', () => {
    machine.setState('sub_1', SubscriptionChildState.FRAUD_HOLD);
    const result = machine.validateTransition('sub_1', 'unsuspend');
    expect(result.allowed).toBe(true);
  });

  it('returns valid transitions on invalid attempt', () => {
    machine.setState('sub_1', SubscriptionChildState.CANCELLED);
    const result = machine.validateTransition('sub_1', 'upgrade');
    expect(result.allowed).toBe(false);
    expect(result.validTransitions).toBeDefined();
    expect(result.validTransitions!.length).toBeGreaterThan(0);
  });
});

// ── State Machine Transitions ─────────────────────────────────────────────────

describe('State Machine - Transitions', () => {
  let machine: SubscriptionStateMachine;

  beforeEach(() => {
    machine = new SubscriptionStateMachine();
  });

  it('defaults to Active.Trial', () => {
    expect(machine.getState('sub_1')).toBe(SubscriptionChildState.TRIAL);
  });

  it('accepts initial states via constructor', () => {
    const initial = new Map<string, typeof SubscriptionChildState[keyof typeof SubscriptionChildState]>();
    initial.set('sub_1', SubscriptionChildState.PAID);
    const m2 = new SubscriptionStateMachine(initial as Map<string, any>);
    expect(m2.getState('sub_1')).toBe(SubscriptionChildState.PAID);
  });

  it('transitions from Trial to Paid via trial_to_paid', async () => {
    machine.setState('sub_1', SubscriptionChildState.TRIAL);
    const result = await machine.transition('sub_1', 'trial_to_paid');
    expect(result.allowed).toBe(true);
    expect(result.newState).toBe(SubscriptionChildState.PAID);
  });

  it('transitions from Paid to PastDue via payment_fail', async () => {
    machine.setState('sub_1', SubscriptionChildState.PAID);
    const result = await machine.transition('sub_1', 'payment_fail');
    expect(result.allowed).toBe(true);
    expect(result.newState).toBe(SubscriptionChildState.PAST_DUE);
  });

  it('transitions from PastDue back to Paid via payment_recover', async () => {
    machine.setState('sub_1', SubscriptionChildState.PAST_DUE);
    const result = await machine.transition('sub_1', 'payment_recover');
    expect(result.allowed).toBe(true);
    expect(result.newState).toBe(SubscriptionChildState.PAID);
  });

  it('transitions from Paid to Cancelled via cancel', async () => {
    machine.setState('sub_1', SubscriptionChildState.PAID);
    const result = await machine.transition('sub_1', 'cancel');
    expect(result.allowed).toBe(true);
    expect(result.newState).toBe(SubscriptionChildState.CANCELLED);
  });

  it('transitions from Paid to PausedEndOfCycle via pause', async () => {
    machine.setState('sub_1', SubscriptionChildState.PAID);
    const result = await machine.transition('sub_1', 'pause');
    expect(result.allowed).toBe(true);
    expect(result.newState).toBe(SubscriptionChildState.PAUSED_END_OF_CYCLE);
  });

  it('transitions from PausedEndOfCycle to Paid via resume', async () => {
    machine.setState('sub_1', SubscriptionChildState.PAUSED_END_OF_CYCLE);
    const result = await machine.transition('sub_1', 'resume');
    expect(result.allowed).toBe(true);
    expect(result.newState).toBe(SubscriptionChildState.PAID);
  });

  it('transitions from Paid to FraudHold via suspend_fraud', async () => {
    machine.setState('sub_1', SubscriptionChildState.PAID);
    const result = await machine.transition('sub_1', 'suspend_fraud');
    expect(result.allowed).toBe(true);
    expect(result.newState).toBe(SubscriptionChildState.FRAUD_HOLD);
  });

  it('transitions from FraudHold to Paid via unsuspend', async () => {
    machine.setState('sub_1', SubscriptionChildState.FRAUD_HOLD);
    const result = await machine.transition('sub_1', 'unsuspend');
    expect(result.allowed).toBe(true);
    expect(result.newState).toBe(SubscriptionChildState.PAID);
  });

  it('returns error for invalid transition', async () => {
    machine.setState('sub_1', SubscriptionChildState.CANCELLED);
    const result = await machine.transition('sub_1', 'pause');
    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('default initial state is Active.Trial', () => {
    expect(machine.getState('sub_new')).toBe(SubscriptionChildState.TRIAL);
  });
});

// ── State History ─────────────────────────────────────────────────────────────

describe('State Machine - History', () => {
  let machine: SubscriptionStateMachine;

  beforeEach(() => {
    machine = new SubscriptionStateMachine();
  });

  it('records transition history', async () => {
    machine.setState('sub_1', SubscriptionChildState.TRIAL);
    await machine.transition('sub_1', 'trial_to_paid', { actor: 'system', reason: 'Trial ended' });
    await machine.transition('sub_1', 'pause', { actor: 'user', reason: 'Vacation' });

    const history = machine.getHistory('sub_1');
    expect(history.length).toBe(2);
    expect(history[0].from).toBe(SubscriptionChildState.TRIAL);
    expect(history[0].to).toBe(SubscriptionChildState.PAID);
    expect(history[0].actor).toBe('system');
    expect(history[0].reason).toBe('Trial ended');

    expect(history[1].from).toBe(SubscriptionChildState.PAID);
    expect(history[1].to).toBe(SubscriptionChildState.PAUSED_END_OF_CYCLE);
    expect(history[1].actor).toBe('user');
  });

  it('tracks history for multiple subscriptions separately', async () => {
    machine.setState('sub_1', SubscriptionChildState.TRIAL);
    machine.setState('sub_2', SubscriptionChildState.PAID);

    await machine.transition('sub_1', 'trial_to_paid');
    await machine.transition('sub_2', 'cancel');

    expect(machine.getHistory('sub_1').length).toBe(1);
    expect(machine.getHistory('sub_2').length).toBe(1);
  });

  it('returns empty history for unknown subscription', () => {
    expect(machine.getHistory('unknown')).toEqual([]);
  });
});

// ── State Actions ─────────────────────────────────────────────────────────────

describe('State Machine - Actions', () => {
  it('has entry actions for key states', () => {
    expect(entryActions['Active.Trial']).toBeDefined();
    expect(entryActions['Active.Paid']).toBeDefined();
    expect(entryActions['Active.PastDue']).toBeDefined();
    expect(entryActions['Inactive.Cancelled']).toBeDefined();
    expect(entryActions['Inactive.PausedEndOfCycle']).toBeDefined();
    expect(entryActions['Suspended.FraudHold']).toBeDefined();
    expect(entryActions['Suspended.AdminHold']).toBeDefined();
  });

  it('entry actions for Cancelled include stopBilling and revokeAccess', () => {
    const actions = entryActions['Inactive.Cancelled'];
    expect(actions).toBeDefined();
    expect(actions!.map((a) => a.name)).toContain('stopBilling');
    expect(actions!.map((a) => a.name)).toContain('revokeAccess');
  });

  it('exit actions exist for specific states', () => {
    expect(exitActions['Active.Trial']).toBeDefined();
    expect(exitActions['Active.PastDue']).toBeDefined();
    expect(exitActions['Suspended.FraudHold']).toBeDefined();
  });

  it('actions execute without throwing', async () => {
    const ctx = {
      subscriptionId: 'sub_1',
      previousState: 'Active.Paid' as any,
      newState: 'Inactive.Cancelled' as any,
      timestamp: Date.now(),
    };
    for (const action of entryActions['Inactive.Cancelled'] || []) {
      await expect(action.execute(ctx)).resolves.toBeUndefined();
    }
  });
});

// ── Valid Transitions ─────────────────────────────────────────────────────────

describe('State Machine - Valid Transitions', () => {
  let machine: SubscriptionStateMachine;

  beforeEach(() => {
    machine = new SubscriptionStateMachine();
  });

  it('returns valid transitions for Active.Trial', () => {
    machine.setState('sub_1', SubscriptionChildState.TRIAL);
    const valid = machine.getValidTransitions(SubscriptionChildState.TRIAL);
    expect(valid).toContain('cancel');
    expect(valid).toContain('pause');
    expect(valid).toContain('upgrade');
    expect(valid).toContain('trial_to_paid');
    expect(valid).toContain('suspend_fraud');
    expect(valid).toContain('suspend_admin');
    expect(valid).toContain('expire');
  });

  it('returns valid transitions for Active.Paid', () => {
    machine.setState('sub_1', SubscriptionChildState.PAID);
    const valid = machine.getValidTransitions(SubscriptionChildState.PAID);
    expect(valid).toContain('cancel');
    expect(valid).toContain('pause');
    expect(valid).toContain('upgrade');
    expect(valid).toContain('downgrade');
    expect(valid).toContain('payment_fail');
    expect(valid).toContain('suspend_fraud');
    expect(valid).toContain('suspend_admin');
    expect(valid).toContain('expire');
  });

  it('returns valid transitions for Inactive.Cancelled', () => {
    const valid = machine.getValidTransitions(SubscriptionChildState.CANCELLED);
    expect(valid.length).toBe(0);
  });

  it('returns valid transitions for PausedEndOfCycle', () => {
    const valid = machine.getValidTransitions(SubscriptionChildState.PAUSED_END_OF_CYCLE);
    expect(valid).toContain('cancel');
    expect(valid).toContain('resume');
    expect(valid).toContain('expire');
    expect(valid).toContain('suspend_fraud');
    expect(valid).toContain('suspend_admin');
  });

  it('returns valid transitions for Suspended states', () => {
    const valid = machine.getValidTransitions(SubscriptionChildState.FRAUD_HOLD);
    expect(valid).toContain('unsuspend');
    expect(valid.length).toBe(1);
  });
});

// ── Exhaustive Transition Matrix ──────────────────────────────────────────────

describe('State Machine - Exhaustive Transition Matrix', () => {
  let machine: SubscriptionStateMachine;

  beforeEach(() => {
    machine = new SubscriptionStateMachine();
  });

  const allStates = getAllStates();
  const allEdges = Object.keys(TRANSITION_MATRIX) as TransitionEdge[];

  for (const state of allStates) {
    for (const edge of allEdges) {
      const matrix = TRANSITION_MATRIX[edge];
      const isDefined = matrix.from.some((from) => {
        return from === state || isChildOf(state, getParentState(from));
      });

      it(`${edge} from ${state} should be ${isDefined ? 'allowed' : 'denied'}`, () => {
        machine.setState('sub_1', state);
        const result = machine.validateTransition('sub_1', edge);
        expect(result.allowed).toBe(isDefined);
      });
    }
  }
});

// ── Mermaid Diagram ───────────────────────────────────────────────────────────

describe('State Machine - Visualization', () => {
  it('generates a Mermaid state diagram', () => {
    const machine = new SubscriptionStateMachine();
    const diagram = machine.generateMermaidDiagram();

    expect(diagram).toContain('stateDiagram-v2');
    expect(diagram).toContain('Active');
    expect(diagram).toContain('Inactive');
    expect(diagram).toContain('Suspended');
    expect(diagram).toContain('Active.Trial');
    expect(diagram).toContain('Active.Paid');
    expect(diagram).toContain('Inactive.Cancelled');
    expect(diagram).toContain('Suspended.FraudHold');
    expect(diagram).toContain('cancel');
    expect(diagram).toContain('pause');
    expect(diagram).toContain('suspend_fraud');
  });

  it('diagram includes all parent states', () => {
    const machine = new SubscriptionStateMachine();
    const diagram = machine.generateMermaidDiagram();

    for (const state of ['Active', 'Inactive', 'Suspended']) {
      expect(diagram).toContain(`"${state}"`);
    }
  });
});

// ── Module Tests ──────────────────────────────────────────────────────────────

describe('State Machine - Module', () => {
  it('preserves existing behavior - same transition results', async () => {
    const machine = new SubscriptionStateMachine();
    machine.setState('sub_1', SubscriptionChildState.PAID);

    const cancelResult = await machine.transition('sub_1', 'cancel');
    expect(cancelResult.allowed).toBe(true);
    expect(machine.getState('sub_1')).toBe(SubscriptionChildState.CANCELLED);
  });

  it('returns 409-style error for invalid transitions', async () => {
    const machine = new SubscriptionStateMachine();
    machine.setState('sub_1', SubscriptionChildState.CANCELLED);

    const result = await machine.transition('sub_1', 'pause');
    expect(result.allowed).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.validTransitions).toBeDefined();
  });
});
