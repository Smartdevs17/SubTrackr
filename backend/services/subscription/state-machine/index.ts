import {
  SubscriptionState,
  SubscriptionChildState,
  STATE_HIERARCHY,
  getAllStates,
  getParentState,
  isChildOf,
} from './states';
import { guards, TRANSITION_MATRIX, TransitionEdge, TransitionContext } from './guards/index';
import { entryActions, exitActions, executeActions, StateActionContext } from './actions/index';

export {
  SubscriptionState,
  SubscriptionChildState,
  SubscriptionParentState,
  isChildOf,
  getParentState,
  getAllStates,
} from './states';
export { TransitionEdge, guards, TRANSITION_MATRIX } from './guards/index';
export { entryActions, exitActions, StateActionContext, StateAction } from './actions/index';

export interface TransitionRecord {
  from: SubscriptionState;
  to: SubscriptionState;
  edge: TransitionEdge;
  actor?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface TransitionResult {
  allowed: boolean;
  newState?: SubscriptionState;
  error?: string;
  validTransitions?: TransitionEdge[];
}

export class SubscriptionStateMachine {
  private history: Map<string, TransitionRecord[]> = new Map();
  private currentStates: Map<string, SubscriptionState> = new Map();

  constructor(initialStates?: Map<string, SubscriptionState>) {
    if (initialStates) {
      for (const [id, state] of initialStates) {
        this.currentStates.set(id, state);
      }
    }
  }

  getState(subscriptionId: string): SubscriptionState {
    return this.currentStates.get(subscriptionId) || SubscriptionChildState.TRIAL;
  }

  setState(subscriptionId: string, state: SubscriptionState): void {
    this.currentStates.set(subscriptionId, state);
  }

  validateTransition(
    subscriptionId: string,
    edge: TransitionEdge
  ): TransitionResult {
    const current = this.getState(subscriptionId);
    const guard = guards[edge];
    if (!guard) {
      return { allowed: false, error: `Unknown transition: ${edge}` };
    }

    const guardResult = guard({ subscriptionId, currentState: current });
    if (typeof guardResult === 'object' && !guardResult.allowed) {
      const validFromSameState = this.getValidTransitions(current);
      return {
        allowed: false,
        error: guardResult.reason || `Transition ${edge} not allowed from ${current}`,
        validTransitions: validFromSameState,
      };
    }

    const matrix = TRANSITION_MATRIX[edge];
    if (!matrix) {
      return { allowed: false, error: `No transition matrix entry for: ${edge}` };
    }

    const isAllowed = matrix.from.some((fromState) => {
      if (fromState === current) return true;
      if (Object.values(getParentState(current) as any).includes(current) && fromState === current) return true;
      return fromState === current || isChildOf(current, getParentState(fromState));
    });

    if (!isAllowed) {
      const validFromSameState = this.getValidTransitions(current);
      return {
        allowed: false,
        error: `Cannot apply transition ${edge} from state ${current}. Valid transitions: ${validFromSameState.join(', ')}`,
        validTransitions: validFromSameState,
      };
    }

    return { allowed: true };
  }

  async transition(
    subscriptionId: string,
    edge: TransitionEdge,
    options?: {
      actor?: string;
      reason?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<TransitionResult> {
    const validation = this.validateTransition(subscriptionId, edge);
    if (!validation.allowed) return validation;

    const current = this.getState(subscriptionId);
    const targetState = TRANSITION_MATRIX[edge].to;
    const timestamp = Date.now();

    const actionCtx: StateActionContext = {
      subscriptionId,
      previousState: current,
      newState: targetState,
      actor: options?.actor,
      reason: options?.reason,
      metadata: options?.metadata,
      timestamp,
    };

    await executeActions(exitActions[current], actionCtx);
    this.currentStates.set(subscriptionId, targetState);
    await executeActions(entryActions[targetState], actionCtx);

    const record: TransitionRecord = {
      from: current,
      to: targetState,
      edge,
      actor: options?.actor,
      reason: options?.reason,
      metadata: options?.metadata,
      timestamp,
    };

    if (!this.history.has(subscriptionId)) {
      this.history.set(subscriptionId, []);
    }
    this.history.get(subscriptionId)!.push(record);

    return { allowed: true, newState: targetState };
  }

  getHistory(subscriptionId: string): TransitionRecord[] {
    return this.history.get(subscriptionId) || [];
  }

  getValidTransitions(state: SubscriptionState): TransitionEdge[] {
    const allEdges = Object.keys(TRANSITION_MATRIX) as TransitionEdge[];
    return allEdges.filter((edge) => {
      const matrix = TRANSITION_MATRIX[edge];
      return matrix.from.some((fromState) => {
        return fromState === state || isChildOf(state, getParentState(fromState));
      });
    });
  }

  getAllStates(): SubscriptionState[] {
    return getAllStates();
  }

  generateMermaidDiagram(): string {
    let diagram = 'stateDiagram-v2\n';

    const parentStates = ['Active', 'Inactive', 'Suspended'];
    const childrenByParent: Record<string, SubscriptionState[]> = {
      Active: [SubscriptionChildState.TRIAL, SubscriptionChildState.PAID, SubscriptionChildState.PAST_DUE],
      Inactive: [SubscriptionChildState.CANCELLED, SubscriptionChildState.PAUSED_END_OF_CYCLE, SubscriptionChildState.EXPIRED],
      Suspended: [SubscriptionChildState.FRAUD_HOLD, SubscriptionChildState.ADMIN_HOLD],
    };

    for (const parent of parentStates) {
      diagram += `  state "${parent}" as ${parent} {\n`;
      for (const child of childrenByParent[parent]) {
        diagram += `    state "${child}" as ${child}\n`;
      }
      diagram += '  }\n';
    }

    diagram += '\n';
    const drawnEdges = new Set<string>();
    for (const [edge, matrix] of Object.entries(TRANSITION_MATRIX)) {
      const fromStates = matrix.from;
      for (const from of fromStates) {
        const edgeKey = `${from}->${matrix.to}`;
        if (!drawnEdges.has(edgeKey)) {
          drawnEdges.add(edgeKey);
          diagram += `  ${from} --> ${matrix.to} : ${edge}\n`;
        }
      }
    }

    return diagram;
  }
}
