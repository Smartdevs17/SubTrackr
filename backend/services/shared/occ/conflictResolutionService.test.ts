import { withConflictResolution, useConflictStore } from '../conflictResolutionService';
import { fail, ok } from '../../../../backend/services/shared/apiResponse';

jest.useFakeTimers();

interface MockEntity {
  id: string;
  version: number;
  name: string;
}

describe('withConflictResolution', () => {
  let mutationFn: jest.Mock;
  let fetchLatestFn: jest.Mock;

  beforeEach(() => {
    // Reset mocks and store before each test
    mutationFn = jest.fn();
    fetchLatestFn = jest.fn();
    useConflictStore.getState().resolve(null);
    jest.clearAllTimers();
  });

  const createConflictError = (version: number) =>
    fail('CONFLICT_VERSION_MISMATCH', 'Conflict detected', 'req-1', { version });

  it('should succeed on the first attempt if there is no conflict', async () => {
    const entity: MockEntity = { id: 'sub-1', version: 1, name: 'Initial' };
    const successResponse = ok({ ...entity, version: 2 });
    mutationFn.mockResolvedValue(successResponse);

    const result = await withConflictResolution({ mutationFn, fetchLatestFn, entity });

    expect(mutationFn).toHaveBeenCalledTimes(1);
    expect(mutationFn).toHaveBeenCalledWith(entity);
    expect(fetchLatestFn).not.toHaveBeenCalled();
    expect(result).toEqual(successResponse);
  });

  it('should retry on a version conflict and succeed on the second attempt', async () => {
    const initialEntity: MockEntity = { id: 'sub-1', version: 1, name: 'My Change' };
    const dbEntity: MockEntity = { id: 'sub-1', version: 2, name: 'Server Change' };
    const successResponse = ok({ ...initialEntity, version: 3 });

    // First call fails with conflict
    mutationFn.mockResolvedValueOnce(createConflictError(2));
    // Fetching latest version succeeds
    fetchLatestFn.mockResolvedValueOnce(dbEntity);
    // Second call succeeds
    mutationFn.mockResolvedValueOnce(successResponse);

    const result = await withConflictResolution({ mutationFn, fetchLatestFn, entity: initialEntity });

    expect(fetchLatestFn).toHaveBeenCalledTimes(1);
    expect(fetchLatestFn).toHaveBeenCalledWith('sub-1');

    expect(mutationFn).toHaveBeenCalledTimes(2);
    // First attempt with original entity
    expect(mutationFn).toHaveBeenCalledWith(initialEntity);
    // Second attempt with merged entity
    expect(mutationFn).toHaveBeenCalledWith({
      ...dbEntity, // Base is the latest from server
      ...initialEntity, // User's changes are re-applied
      version: 2, // Version is updated to the latest from server
    });

    expect(result).toEqual(successResponse);
    expect(useConflictStore.getState().conflict).toBeNull();
  });

  it('should exhaust retries and populate the conflict store', async () => {
    const initialEntity: MockEntity = { id: 'sub-1', version: 1, name: 'My Change' };
    const dbEntityV2: MockEntity = { id: 'sub-1', version: 2, name: 'Server Change 1' };
    const dbEntityV3: MockEntity = { id: 'sub-1', version: 3, name: 'Server Change 2' };
    const dbEntityV4: MockEntity = { id: 'sub-1', version: 4, name: 'Server Change 3' };

    // Fail all 3 attempts
    mutationFn
      .mockResolvedValueOnce(createConflictError(2))
      .mockResolvedValueOnce(createConflictError(3))
      .mockResolvedValueOnce(createConflictError(4));

    // Provide updated entities for each fetch
    fetchLatestFn
      .mockResolvedValueOnce(dbEntityV2)
      .mockResolvedValueOnce(dbEntityV3)
      .mockResolvedValueOnce(dbEntityV4) // For the final conflict state
      .mockResolvedValueOnce(dbEntityV4); // For the final conflict state

    const result = await withConflictResolution({ mutationFn, fetchLatestFn, entity: initialEntity, maxRetries: 3 });

    expect(mutationFn).toHaveBeenCalledTimes(3);
    expect(fetchLatestFn).toHaveBeenCalledTimes(4); // 3 for retries, 1 for final state
    expect(result.success).toBe(false);

    const conflictState = useConflictStore.getState().conflict;
    expect(conflictState).not.toBeNull();
    expect(conflictState?.entityId).toBe('sub-1');
    expect(conflictState?.localState).toEqual(initialEntity);
    expect(conflictState?.remoteState).toEqual(dbEntityV4);
  });

  it('should use exponential backoff between retries', async () => {
    const entity: MockEntity = { id: 'sub-1', version: 1, name: 'Initial' };
    const dbEntityV2: MockEntity = { id: 'sub-1', version: 2, name: 'Server Change 1' };
    const dbEntityV3: MockEntity = { id: 'sub-1', version: 3, name: 'Server Change 2' };

    mutationFn
      .mockResolvedValueOnce(createConflictError(2))
      .mockResolvedValueOnce(createConflictError(3));

    fetchLatestFn
      .mockResolvedValueOnce(dbEntityV2)
      .mockResolvedValueOnce(dbEntityV3);

    const promise = withConflictResolution({ mutationFn, fetchLatestFn, entity, maxRetries: 3, initialBackoffMs: 50 });

    // First retry is immediate
    await jest.runAllTimersAsync();
    expect(setTimeout).toHaveBeenCalledTimes(0);

    // Second retry has backoff
    await jest.runAllTimersAsync();
    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 100); // 50 * 2^1

    // Third retry
    await jest.runAllTimersAsync();
    expect(setTimeout).toHaveBeenCalledTimes(2);
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 200); // 50 * 2^2

    await promise;
  });

  it('should call onConflictResolved callback instead of using the store if provided', async () => {
    const onConflictResolved = jest.fn();
    const entity: MockEntity = { id: 'sub-1', version: 1, name: 'My Change' };
    const dbEntity: MockEntity = { id: 'sub-1', version: 2, name: 'Server Change' };

    mutationFn.mockResolvedValue(createConflictError(2));
    fetchLatestFn.mockResolvedValue(dbEntity);

    await withConflictResolution({ mutationFn, fetchLatestFn, entity, maxRetries: 1, onConflictResolved });

    expect(onConflictResolved).toHaveBeenCalledTimes(1);
    expect(onConflictResolved).toHaveBeenCalledWith({
      entityId: 'sub-1',
      localState: entity,
      remoteState: dbEntity,
      error: expect.any(Object),
    });
    expect(useConflictStore.getState().conflict).toBeNull();
  });
});