import {
  ConnectionStringRotator,
  parseConnectionString,
  redactConnectionString,
} from '../connectionStringRotation';

describe('connectionStringRotation', () => {
  describe('parseConnectionString', () => {
    it('parses a postgres URL', () => {
      const parsed = parseConnectionString(
        'postgresql://app:s3cret@db.internal:6432/subtrackr?sslmode=require',
        'primary',
        'primary',
      );
      expect(parsed.host).toBe('db.internal');
      expect(parsed.port).toBe(6432);
      expect(parsed.database).toBe('subtrackr');
      expect(parsed.user).toBe('app');
      expect(parsed.password).toBe('s3cret');
      expect(parsed.ssl).toBe(true);
      expect(parsed.role).toBe('primary');
    });

    it('defaults port and database', () => {
      const parsed = parseConnectionString('postgres://user@localhost/', 'replica', 'replica-1');
      expect(parsed.port).toBe(5432);
      expect(parsed.database).toBe('subtrackr');
      expect(parsed.password).toBe('');
    });

    it('rejects empty and invalid URLs', () => {
      expect(() => parseConnectionString('', 'primary', 'primary')).toThrow(/Empty/);
      expect(() => parseConnectionString('not-a-url', 'primary', 'primary')).toThrow(/Invalid/);
      expect(() => parseConnectionString('mysql://localhost/db', 'primary', 'primary')).toThrow(
        /Unsupported protocol/,
      );
    });
  });

  describe('redactConnectionString', () => {
    it('masks passwords', () => {
      expect(redactConnectionString('postgresql://app:s3cret@db:5432/subtrackr')).toContain(
        '***',
      );
      expect(redactConnectionString('postgresql://app:s3cret@db:5432/subtrackr')).not.toContain(
        's3cret',
      );
    });
  });

  describe('ConnectionStringRotator', () => {
    it('loads primary and replica URLs', () => {
      const rotator = new ConnectionStringRotator({
        primaryUrl: 'postgresql://u:p@primary:5432/subtrackr',
        replicaUrls:
          'postgresql://u:p@r1:5432/subtrackr,postgresql://u:p@r2:5433/subtrackr',
      });

      expect(rotator.getPrimary()?.host).toBe('primary');
      expect(rotator.getReplicas()).toHaveLength(2);
      expect(rotator.getReplicas()[0]?.name).toBe('replica-1');
      expect(rotator.getReplicas()[1]?.port).toBe(5433);
    });

    it('round-robins healthy replicas and skips failed ones', () => {
      const rotator = new ConnectionStringRotator({
        replicaUrls: [
          'postgresql://u:p@r1:5432/db',
          'postgresql://u:p@r2:5432/db',
        ],
      });

      expect(rotator.nextReplica()?.name).toBe('replica-1');
      expect(rotator.nextReplica()?.name).toBe('replica-2');
      expect(rotator.nextReplica()?.name).toBe('replica-1');

      rotator.markFailed('replica-1');
      expect(rotator.nextReplica()?.name).toBe('replica-2');
      expect(rotator.nextReplica()?.name).toBe('replica-2');

      rotator.markFailed('replica-2');
      expect(rotator.nextReplica()).toBeNull();
    });

    it('rotates connection strings and bumps generation', () => {
      const rotator = new ConnectionStringRotator({
        primaryUrl: 'postgresql://u:old@primary:5432/db',
        replicaUrls: 'postgresql://u:old@r1:5432/db',
      });

      rotator.markFailed('replica-1');
      const generation = rotator.rotate({
        primaryUrl: 'postgresql://u:new@primary:5432/db',
        replicaUrls: 'postgresql://u:new@r1:5432/db,postgresql://u:new@r2:5432/db',
      });

      expect(generation).toBe(1);
      expect(rotator.getGeneration()).toBe(1);
      expect(rotator.getPrimary()?.password).toBe('new');
      expect(rotator.getReplicas()).toHaveLength(2);
      expect(rotator.isFailed('replica-1')).toBe(false);
      expect(rotator.toSafeSnapshot()[0]?.url).toContain('***');
    });

    it('builds from env DATABASE_URL / DATABASE_READ_URLS', () => {
      const rotator = ConnectionStringRotator.fromEnv({
        DATABASE_URL: 'postgresql://u:p@primary:5432/subtrackr',
        DATABASE_READ_URLS: 'postgresql://u:p@replica:6432/subtrackr',
      });
      expect(rotator.getPrimary()?.host).toBe('primary');
      expect(rotator.getReplicas()[0]?.port).toBe(6432);
    });
  });
});
