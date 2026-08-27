import { AccountLockoutService } from '../accountLockoutService';

describe('AccountLockoutService', () => {
  let lockoutService: AccountLockoutService;
  
  beforeEach(() => {
    // Override Date.now for predictable time assertions where necessary,
    // though here we mainly rely on real time with mocked advances if needed,
    // or we just use realistic thresholds.
    lockoutService = new AccountLockoutService({
      tiers: [
        { threshold: 3, lockoutMinutes: 5 },
        { threshold: 5, lockoutMinutes: 15 },
      ],
      retentionMs: 1000 * 60 * 60, // 1 hour
    });
  });

  afterEach(() => {
    lockoutService.clearStore();
    jest.restoreAllMocks();
  });

  it('initially has no lockout', async () => {
    const status = await lockoutService.checkLockout('user1@example.com');
    expect(status.locked).toBe(false);
    expect(status.remainingMs).toBe(0);
    expect(status.failedAttempts).toBe(0);
  });

  it('records failures but does not lock until threshold', async () => {
    const email = 'user2@example.com';
    let status = await lockoutService.recordFailure(email);
    expect(status.locked).toBe(false);
    expect(status.failedAttempts).toBe(1);

    status = await lockoutService.recordFailure(email);
    expect(status.locked).toBe(false);
    expect(status.failedAttempts).toBe(2);
  });

  it('locks out the account when the first threshold is reached', async () => {
    const email = 'user3@example.com';
    await lockoutService.recordFailure(email);
    await lockoutService.recordFailure(email);
    const status = await lockoutService.recordFailure(email); // 3rd failure

    expect(status.locked).toBe(true);
    expect(status.failedAttempts).toBe(3);
    // 5 minutes in ms
    expect(status.remainingMs).toBe(5 * 60 * 1000);

    const checkStatus = await lockoutService.checkLockout(email);
    expect(checkStatus.locked).toBe(true);
    expect(checkStatus.failedAttempts).toBe(3);
    expect(checkStatus.remainingMs).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(checkStatus.remainingMs).toBeGreaterThan(0);
  });

  it('does not increase failures while locked out', async () => {
    const email = 'user4@example.com';
    await lockoutService.recordFailure(email);
    await lockoutService.recordFailure(email);
    await lockoutService.recordFailure(email); // locks out
    
    // attempting to record failure while locked
    const status = await lockoutService.recordFailure(email);
    expect(status.locked).toBe(true);
    // should still be 3, not 4
    expect(status.failedAttempts).toBe(3);
  });

  it('progresses to the next tier if failures continue after lockout expires', async () => {
    const email = 'user5@example.com';
    
    // Mock Date.now to control time
    let currentTime = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

    // Trigger first lockout
    await lockoutService.recordFailure(email);
    await lockoutService.recordFailure(email);
    await lockoutService.recordFailure(email); // 3 failures, locked for 5 mins

    // Advance time past 5 minutes
    currentTime += 5 * 60 * 1000 + 1000;

    // Now unlocked
    const unlockStatus = await lockoutService.checkLockout(email);
    expect(unlockStatus.locked).toBe(false);

    // Next failure (4th) will trigger the 3-failure tier again because 4 >= 3
    const status4 = await lockoutService.recordFailure(email);
    expect(status4.locked).toBe(true);
    expect(status4.failedAttempts).toBe(4);
    expect(status4.remainingMs).toBe(5 * 60 * 1000);

    // Advance time past the new 5-minute lockout
    currentTime += 5 * 60 * 1000 + 1000;

    const status5 = await lockoutService.recordFailure(email); // 5 failures -> next tier (15 min)

    expect(status5.locked).toBe(true);
    expect(status5.failedAttempts).toBe(5);
    expect(status5.remainingMs).toBe(15 * 60 * 1000);
  });

  it('resets failures on successful authentication', async () => {
    const email = 'user6@example.com';
    await lockoutService.recordFailure(email);
    await lockoutService.recordFailure(email); // 2 failures

    await lockoutService.resetFailures(email);

    const checkStatus = await lockoutService.checkLockout(email);
    expect(checkStatus.locked).toBe(false);
    expect(checkStatus.failedAttempts).toBe(0);
  });

  it('clears expired retentions', async () => {
    const email = 'user7@example.com';
    let currentTime = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

    await lockoutService.recordFailure(email);
    
    // Advance time past retentionMs (1 hour)
    currentTime += 2 * 60 * 60 * 1000;

    const checkStatus = await lockoutService.checkLockout(email);
    expect(checkStatus.failedAttempts).toBe(0);
  });
});
