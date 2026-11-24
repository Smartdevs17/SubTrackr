/**
 * mobile/src/features/invites/index.ts
 *
 * Issue #2255: mobile adapter for the shared household-invite state machine.
 *
 * This module is the single mobile entry point for invite state handling. It
 * re-exports the backend machine verbatim (via the relative `.ts` path below)
 * and adds a few device-facing helpers. Because both platforms import the same
 * backend module, invite states and transitions cannot drift between the app
 * and the API.
 *
 * Zero dependencies, no React imports, no I/O — safe to unit-test in Node.
 */

import {
  INVITE_STATES,
  INVITE_EVENTS,
  TERMINAL_INVITE_STATES,
  InviteErrorCode,
  InviteError,
  DEFAULT_INVITE_CONFIG,
  transition,
  canTransition,
  normalizeInvite,
  createInviteMachine,
  isInviteState,
  isInviteEvent,
  isInviteExpired,
  isTerminalInviteState,
  noopInviteMetrics,
  noopInviteLogger,
  type InviteState,
  type InviteEvent,
  type InviteConfig,
  type InviteInput,
  type Invite,
  type InviteMetrics,
  type InviteLogger,
  type InviteMachine,
  type InviteTransitionContext,
  type InviteTransitionResult,
} from '../../../../backend/src/services/invites.ts';

export {
  INVITE_STATES,
  INVITE_EVENTS,
  TERMINAL_INVITE_STATES,
  InviteErrorCode,
  InviteError,
  DEFAULT_INVITE_CONFIG,
  transition,
  canTransition,
  normalizeInvite,
  createInviteMachine,
  isInviteState,
  isInviteEvent,
  isInviteExpired,
  isTerminalInviteState,
  noopInviteMetrics,
  noopInviteLogger,
  type InviteState,
  type InviteEvent,
  type InviteConfig,
  type InviteInput,
  type Invite,
  type InviteMetrics,
  type InviteLogger,
  type InviteMachine,
  type InviteTransitionContext,
  type InviteTransitionResult,
};

/** Human-readable label for an invite state, used by status badges. */
export function inviteStatusLabel(state: InviteState): string {
  switch (state) {
    case 'draft':
      return 'Draft';
    case 'pending':
      return 'Pending';
    case 'accepted':
      return 'Accepted';
    case 'declined':
      return 'Declined';
    case 'expired':
      return 'Expired';
    case 'revoked':
      return 'Revoked';
    default:
      return 'Unknown';
  }
}

/** Whether no further action is possible for an invite in this state. */
export function isTerminal(state: InviteState): boolean {
  return isTerminalInviteState(state);
}

/** Build the in-app deep link that opens the accept/decline screen for a token. */
export function buildInviteDeepLink(token: string): string {
  if (typeof token !== 'string' || token.length === 0) {
    throw new InviteError(InviteErrorCode.INVALID_INPUT, 'token must be a non-empty string', {
      token,
    });
  }
  return `subtrackr://invite/${encodeURIComponent(token)}`;
}
