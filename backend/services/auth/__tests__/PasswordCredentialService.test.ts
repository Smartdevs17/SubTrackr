import { PasswordCredentialService } from '../domain/PasswordCredentialService';
import { AuthErrorCode } from '../errors';

// Minimal KDF cost so the suite stays fast; production uses DEFAULT_PASSWORD_POLICY.
const FAST_KDF = { memoryCost: 16, timeCost: 1, parallelism: 1, keyLen: 32 };
const GOOD = 'correct horse battery staple';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

describe('PasswordCredentialService', () => {
  let clock: number;
  let service: PasswordCredentialService;

  beforeEach(() => {
    clock = 1_700_000_000_000;
    service = new PasswordCredentialService({ kdfParams: FAST_KDF }, () => clock);
  });

  it('stores a hash, not the password, and authenticates with it', () => {
    service.setPassword('u1', GOOD);
    expect(service.hasPassword('u1')).toBe(true);
    expect(
      JSON.stringify(
        (service as unknown as { passwords: Map<string, unknown> }).passwords.get('u1')
      )
    ).not.toContain(GOOD);
    expect(() => service.authenticate('u1', GOOD)).not.toThrow();
  });

  it('gives the same error for a wrong password and an unknown user', () => {
    service.setPassword('u1', GOOD);
    expect(codeOf(() => service.authenticate('u1', 'wrong password!!'))).toBe(
      AuthErrorCode.INVALID_CREDENTIALS
    );
    expect(codeOf(() => service.authenticate('ghost', GOOD))).toBe(
      AuthErrorCode.INVALID_CREDENTIALS
    );
    expect(codeOf(() => service.authenticate(undefined, GOOD))).toBe(
      AuthErrorCode.INVALID_CREDENTIALS
    );
  });

  it('enforces the password policy', () => {
    expect(codeOf(() => service.setPassword('u1', 'short'))).toBe(
      AuthErrorCode.PASSWORD_POLICY_VIOLATION
    );
    expect(codeOf(() => service.setPassword('u1', 'x'.repeat(257)))).toBe(
      AuthErrorCode.PASSWORD_POLICY_VIOLATION
    );
    expect(codeOf(() => service.setPassword('u1', 42))).toBe(
      AuthErrorCode.PASSWORD_POLICY_VIOLATION
    );
  });

  it('requires the current password to change an existing one', () => {
    service.setPassword('u1', GOOD);
    expect(codeOf(() => service.setPassword('u1', 'a brand new password'))).toBe(
      AuthErrorCode.INVALID_CREDENTIALS
    );
    expect(
      codeOf(() => service.setPassword('u1', 'a brand new password', 'not the password'))
    ).toBe(AuthErrorCode.INVALID_CREDENTIALS);
    service.setPassword('u1', 'a brand new password', GOOD);
    expect(() => service.authenticate('u1', 'a brand new password')).not.toThrow();
    expect(codeOf(() => service.authenticate('u1', GOOD))).toBe(AuthErrorCode.INVALID_CREDENTIALS);
  });

  it('locks the account after repeated failures, even for the right password', () => {
    service.setPassword('u1', GOOD);
    for (let i = 0; i < 4; i++) {
      expect(codeOf(() => service.authenticate('u1', 'wrong password!!'))).toBe(
        AuthErrorCode.INVALID_CREDENTIALS
      );
    }
    expect(codeOf(() => service.authenticate('u1', 'wrong password!!'))).toBe(
      AuthErrorCode.ACCOUNT_LOCKED
    );
    expect(codeOf(() => service.authenticate('u1', GOOD))).toBe(AuthErrorCode.ACCOUNT_LOCKED);

    clock += 15 * 60 * 1000 + 1;
    expect(() => service.authenticate('u1', GOOD)).not.toThrow();
  });

  it('forgets old failures outside the window and resets on success', () => {
    service.setPassword('u1', GOOD);
    for (let i = 0; i < 4; i++) codeOf(() => service.authenticate('u1', 'wrong password!!'));
    clock += 16 * 60 * 1000;
    expect(codeOf(() => service.authenticate('u1', 'wrong password!!'))).toBe(
      AuthErrorCode.INVALID_CREDENTIALS
    );
    service.authenticate('u1', GOOD);
    for (let i = 0; i < 4; i++) {
      expect(codeOf(() => service.authenticate('u1', 'wrong password!!'))).toBe(
        AuthErrorCode.INVALID_CREDENTIALS
      );
    }
  });
});
