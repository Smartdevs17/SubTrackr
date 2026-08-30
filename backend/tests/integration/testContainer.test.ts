import { testContainerManager, detectFlakyTest } from '../setup/testContainer';

describe('TestContainerManager and Fixtures', () => {
  beforeAll(async () => {
    await testContainerManager.startContainer();
  });

  afterAll(async () => {
    await testContainerManager.stopContainer();
  });

  it('manages container lifecycle and database seeding', async () => {
    expect(testContainerManager.isContainerActive()).toBe(true);
    await testContainerManager.seedDatabase({ users: [{ id: 'u1' }] });
    await testContainerManager.cleanDatabase();
  });

  it('detects flaky test behavior accurately', async () => {
    const result = await detectFlakyTest(() => {
      // Deterministic test passing
    }, 2);
    expect(result.isFlaky).toBe(false);
    expect(result.passed).toBe(2);
  });

  it('matches API response snapshots', () => {
    const apiResponse = {
      status: 'success',
      data: {
        id: 'sub_123',
        amount: 15.99,
        currency: 'USD',
      },
    };
    expect(apiResponse).toMatchSnapshot();
  });
});
