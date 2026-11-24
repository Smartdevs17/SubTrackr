import {
  INVITE_STATES,
  InviteError,
  InviteErrorCode,
  transition,
  inviteStatusLabel,
  isTerminal,
  buildInviteDeepLink,
  type InviteState,
} from '../index';

describe('mobile invite adapter (#2255)', () => {
  it('re-exports the shared vocabulary and machine', () => {
    expect(INVITE_STATES).toContain('pending');
    expect(transition('draft', 'send')).toBe('pending');
  });

  it('labels every state', () => {
    expect(inviteStatusLabel('draft')).toBe('Draft');
    expect(inviteStatusLabel('pending')).toBe('Pending');
    expect(inviteStatusLabel('accepted')).toBe('Accepted');
    expect(inviteStatusLabel('declined')).toBe('Declined');
    expect(inviteStatusLabel('expired')).toBe('Expired');
    expect(inviteStatusLabel('revoked')).toBe('Revoked');
    expect(inviteStatusLabel('nope' as InviteState)).toBe('Unknown');
  });

  it('delegates terminal-state detection', () => {
    expect(isTerminal('accepted')).toBe(true);
    expect(isTerminal('revoked')).toBe(true);
    expect(isTerminal('draft')).toBe(false);
    expect(isTerminal('pending')).toBe(false);
  });

  it('builds an encoded deep link', () => {
    expect(buildInviteDeepLink('abc 123/')).toBe('subtrackr://invite/abc%20123%2F');
  });

  it('rejects an empty token with a typed error', () => {
    try {
      buildInviteDeepLink('');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InviteError);
      expect((e as InviteError).code).toBe(InviteErrorCode.INVALID_INPUT);
    }
  });
});
