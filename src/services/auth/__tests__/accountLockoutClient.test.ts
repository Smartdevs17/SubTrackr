import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccountLockoutClient } from '../accountLockoutClient';

const store: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => store[key] ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: jest.fn(async (key: string) => {
    delete store[key];
  }),
}));

beforeEach(() => Object.keys(store).forEach((k) => delete store[k]));

describe('AccountLockoutClient', () => {
  let client: AccountLockoutClient;

  beforeEach(() => {
    // Clear the mock storage before each test
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (AsyncStorage.removeItem as jest.Mock).mockClear();

    // Use a custom configuration for faster thresholds in tests
    client = new AccountLockoutClient({
      tiers: [
        { threshold: 3, lockoutMinutes: 5 },
        { threshold: 5, lockoutMinutes: 15 },
      ],
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initially has no lockout', async () => {
    const status = await client.checkLockout('user@example.com');
    expect(status.locked).toBe(false);
    expect(status.failedAttempts).toBe(0);
    expect(status.remainingMs).toBe(0);
  });

  it('records failures incrementally without locking prematurely', async () => {
    let status = await client.recordFailure('user@example.com');
    expect(status.locked).toBe(false);
    expect(status.failedAttempts).toBe(1);

    status = await client.recordFailure('user@example.com');
    expect(status.locked).toBe(false);
    expect(status.failedAttempts).toBe(2);
  });

  it('locks out when the first threshold is reached', async () => {
    await client.recordFailure('user2@example.com');
    await client.recordFailure('user2@example.com');
    const status = await client.recordFailure('user2@example.com'); // 3rd failure

    expect(status.locked).toBe(true);
    expect(status.failedAttempts).toBe(3);
    expect(status.remainingMs).toBeGreaterThan(0);
    expect(status.remainingMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it('does not increase failure counts while locked out', async () => {
    await client.recordFailure('user3@example.com');
    await client.recordFailure('user3@example.com');
    await client.recordFailure('user3@example.com'); // locked out

    const status = await client.recordFailure('user3@example.com');
    expect(status.locked).toBe(true);
    expect(status.failedAttempts).toBe(3); // still 3
  });

  it('resets failures properly', async () => {
    await client.recordFailure('user4@example.com');
    await client.recordFailure('user4@example.com');

    await client.resetFailures('user4@example.com');

    const status = await client.checkLockout('user4@example.com');
    expect(status.locked).toBe(false);
    expect(status.failedAttempts).toBe(0);
  });

  it('progresses to the next tier when failures continue after a lockout', async () => {
    let currentTime = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

    await client.recordFailure('user5@example.com');
    await client.recordFailure('user5@example.com');
    await client.recordFailure('user5@example.com'); // locked (3)

    // Advance time past the 5-minute lockout
    currentTime += 5 * 60 * 1000 + 1000;

    // Next failure shouldn't trigger the second tier yet (needs 5)
    const status4 = await client.recordFailure('user5@example.com');
    // Actually, wait, when failures hit 4, tier threshold 3 applies again because 4 >= 3,
    // so it locks out for 5 minutes again, UNLESS we specifically configure it otherwise.
    // In our implementation, `applyLockoutMinutes` checks `data.failedAttempts >= tier.threshold`.
    // For 4, 4 >= 3, so it WILL apply 5 mins lockout again.
    expect(status4.locked).toBe(true);
    expect(status4.failedAttempts).toBe(4);
    expect(status4.remainingMs).toBe(5 * 60 * 1000);

    // Advance time past the new 5-minute lockout
    currentTime += 5 * 60 * 1000 + 1000;

    const status5 = await client.recordFailure('user5@example.com'); // 5th failure
    expect(status5.locked).toBe(true);
    expect(status5.failedAttempts).toBe(5);
    expect(status5.remainingMs).toBe(15 * 60 * 1000); // next tier!
  });
});
