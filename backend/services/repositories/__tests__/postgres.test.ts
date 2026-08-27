import { Pool } from 'pg';
import { PostgresSubscriptionRepository, PostgresUnitOfWork } from '../postgres';
import { Subscription } from '../interfaces';

describe('Postgres Repositories', () => {
  let pool: Pool;
  
  beforeAll(() => {
    // Mock pool
    pool = {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue({
        query: jest.fn(),
        release: jest.fn()
      })
    } as unknown as Pool;
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('PostgresSubscriptionRepository', () => {
    let repo: PostgresSubscriptionRepository;
    
    beforeEach(() => {
      repo = new PostgresSubscriptionRepository(pool);
    });

    it('should use parameterized queries for findById', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'sub1' }] });
      const result = await repo.findById('sub1');
      
      expect(pool.query).toHaveBeenCalledWith('SELECT * FROM subscriptions WHERE id = $1', ['sub1']);
      expect(result?.id).toBe('sub1');
    });

    it('should use parameterized queries for save', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'sub1' }] });
      const sub: Subscription = {
        id: 'sub1',
        userId: 'user1',
        name: 'Pro Plan',
        amount: 1000,
        currency: 'USD',
        billingCycle: 'monthly',
        status: 'active',
        nextBillingDate: new Date('2026-09-01'),
        createdAt: new Date('2026-08-01'),
        updatedAt: new Date('2026-08-01')
      };
      
      await repo.save(sub);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO subscriptions'),
        expect.arrayContaining(['sub1', 'user1', 'Pro Plan'])
      );
    });
  });

  describe('PostgresUnitOfWork', () => {
    it('should begin and commit transaction', async () => {
      const uow = new PostgresUnitOfWork(pool);
      const client = await pool.connect();
      
      await uow.run(async (u) => {
        expect(u.subscriptions).toBeDefined();
      });
      
      expect(client.query).toHaveBeenCalledWith('BEGIN');
      expect(client.query).toHaveBeenCalledWith('COMMIT');
    });
    
    it('should rollback transaction on error', async () => {
      const uow = new PostgresUnitOfWork(pool);
      const client = await pool.connect();
      
      await expect(uow.run(async () => {
        throw new Error('boom');
      })).rejects.toThrow('boom');
      
      expect(client.query).toHaveBeenCalledWith('BEGIN');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });
});
