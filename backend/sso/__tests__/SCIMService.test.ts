import { SCIMService } from '../domain/SCIMService';
import type { RoleMapping } from '../domain/types';

const DEFAULT_MAPPINGS: RoleMapping[] = [
  { idpGroup: 'admins', subtrackrRole: 'admin' },
  { idpGroup: 'finance', subtrackrRole: 'billing' },
  { idpGroup: 'engineering', subtrackrRole: 'viewer' },
];

describe('SCIMService', () => {
  let service: SCIMService;

  beforeEach(() => {
    service = new SCIMService();
  });

  describe('User Provisioning', () => {
    it('creates a new SCIM user', () => {
      const user = service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice@example.com', 'Alice Smith', 'Alice', 'Smith',
        ['admins'], DEFAULT_MAPPINGS,
      );

      expect(user.id).toMatch(/^scim_user_/);
      expect(user.email).toBe('alice@example.com');
      expect(user.role).toBe('admin');
      expect(user.status).toBe('active');
    });

    it('assigns default viewer role for unmapped groups', () => {
      const user = service.createUser(
        'org_1', 'idp_1', 'ext_002',
        'bob@example.com', 'Bob Jones', 'Bob', 'Jones',
        ['unknown_group'], DEFAULT_MAPPINGS,
      );

      expect(user.role).toBe('viewer');
    });

    it('reactivates a deactivated user on re-provision', () => {
      const user = service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice@example.com', 'Alice Smith', 'Alice', 'Smith',
        ['admins'], DEFAULT_MAPPINGS,
      );

      service.deactivateUser(user.id);
      expect(service.getUser(user.id)!.status).toBe('deactivated');

      const reactivated = service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice.new@example.com', 'Alice New', 'Alice', 'New',
        ['finance'], DEFAULT_MAPPINGS,
      );

      expect(reactivated.id).toBe(user.id);
      expect(reactivated.status).toBe('active');
      expect(reactivated.email).toBe('alice.new@example.com');
      expect(reactivated.role).toBe('billing');
    });
  });

  describe('User Lookup', () => {
    it('finds user by ID', () => {
      const created = service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice@example.com', 'Alice', 'Alice', 'Smith',
        [], DEFAULT_MAPPINGS,
      );

      const found = service.getUser(created.id);
      expect(found).toBeDefined();
      expect(found!.email).toBe('alice@example.com');
    });

    it('finds user by external ID', () => {
      service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice@example.com', 'Alice', 'Alice', 'Smith',
        [], DEFAULT_MAPPINGS,
      );

      const found = service.getUserByExternalId('org_1', 'ext_001');
      expect(found).toBeDefined();
      expect(found!.email).toBe('alice@example.com');
    });

    it('returns undefined for unknown user', () => {
      expect(service.getUser('nonexistent')).toBeUndefined();
      expect(service.getUserByExternalId('org_1', 'nope')).toBeUndefined();
    });
  });

  describe('User Listing', () => {
    it('lists users in an organization with pagination', () => {
      for (let i = 0; i < 5; i++) {
        service.createUser(
          'org_1', 'idp_1', `ext_${i}`,
          `user${i}@example.com`, `User ${i}`, 'First', 'Last',
          [], DEFAULT_MAPPINGS,
        );
      }

      const page1 = service.listUsers('org_1', 1, 3);
      expect(page1.totalResults).toBe(5);
      expect(page1.Resources).toHaveLength(3);
      expect(page1.startIndex).toBe(1);

      const page2 = service.listUsers('org_1', 4, 3);
      expect(page2.Resources).toHaveLength(2);
    });

    it('filters users by email', () => {
      service.createUser('org_1', 'idp_1', 'ext_1', 'alice@example.com', 'Alice', 'A', 'S', [], DEFAULT_MAPPINGS);
      service.createUser('org_1', 'idp_1', 'ext_2', 'bob@example.com', 'Bob', 'B', 'J', [], DEFAULT_MAPPINGS);

      const result = service.listUsers('org_1', 1, 100, 'userName eq "alice@example.com"');
      expect(result.totalResults).toBe(1);
      expect(result.Resources[0].email).toBe('alice@example.com');
    });

    it('filters users by external ID', () => {
      service.createUser('org_1', 'idp_1', 'ext_1', 'alice@example.com', 'Alice', 'A', 'S', [], DEFAULT_MAPPINGS);
      service.createUser('org_1', 'idp_1', 'ext_2', 'bob@example.com', 'Bob', 'B', 'J', [], DEFAULT_MAPPINGS);

      const result = service.listUsers('org_1', 1, 100, 'externalId eq "ext_2"');
      expect(result.totalResults).toBe(1);
      expect(result.Resources[0].externalId).toBe('ext_2');
    });
  });

  describe('User Updates', () => {
    it('updates user fields', () => {
      const user = service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice@example.com', 'Alice', 'Alice', 'Smith',
        ['engineering'], DEFAULT_MAPPINGS,
      );

      const updated = service.updateUser(user.id, {
        email: 'alice.new@example.com',
        displayName: 'Alice New',
        groups: ['admins'],
      }, DEFAULT_MAPPINGS);

      expect(updated.email).toBe('alice.new@example.com');
      expect(updated.displayName).toBe('Alice New');
      expect(updated.role).toBe('admin');
    });

    it('applies SCIM PATCH to deactivate user', () => {
      const user = service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice@example.com', 'Alice', 'Alice', 'Smith',
        [], DEFAULT_MAPPINGS,
      );

      const patched = service.patchUser(user.id, [
        { op: 'replace', path: 'active', value: false },
      ], DEFAULT_MAPPINGS);

      expect(patched.status).toBe('deactivated');
    });

    it('applies SCIM PATCH to add groups', () => {
      const user = service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice@example.com', 'Alice', 'Alice', 'Smith',
        [], DEFAULT_MAPPINGS,
      );

      const patched = service.patchUser(user.id, [
        { op: 'add', path: 'groups', value: [{ value: 'admins' }] },
      ], DEFAULT_MAPPINGS);

      expect(patched.groups).toContain('admins');
      expect(patched.role).toBe('admin');
    });

    it('applies SCIM PATCH to update display name', () => {
      const user = service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice@example.com', 'Alice', 'Alice', 'Smith',
        [], DEFAULT_MAPPINGS,
      );

      const patched = service.patchUser(user.id, [
        { op: 'replace', path: 'displayName', value: 'Alice Updated' },
      ], DEFAULT_MAPPINGS);

      expect(patched.displayName).toBe('Alice Updated');
    });
  });

  describe('User Lifecycle', () => {
    it('deactivates a user', () => {
      const user = service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice@example.com', 'Alice', 'Alice', 'Smith',
        [], DEFAULT_MAPPINGS,
      );

      const deactivated = service.deactivateUser(user.id);
      expect(deactivated.status).toBe('deactivated');
      expect(deactivated.deactivatedAt).toBeTruthy();
    });

    it('suspends a user', () => {
      const user = service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice@example.com', 'Alice', 'Alice', 'Smith',
        [], DEFAULT_MAPPINGS,
      );

      const suspended = service.suspendUser(user.id);
      expect(suspended.status).toBe('suspended');
    });

    it('deletes a user', () => {
      const user = service.createUser(
        'org_1', 'idp_1', 'ext_001',
        'alice@example.com', 'Alice', 'Alice', 'Smith',
        [], DEFAULT_MAPPINGS,
      );

      service.deleteUser(user.id);
      expect(service.getUser(user.id)).toBeUndefined();
      expect(service.getUserByExternalId('org_1', 'ext_001')).toBeUndefined();
    });

    it('delete is idempotent for unknown user', () => {
      expect(() => service.deleteUser('nonexistent')).not.toThrow();
    });
  });

  describe('JIT Provisioning', () => {
    it('provisions a new user on first SSO login', () => {
      const user = service.jitProvision(
        'org_1', 'idp_1',
        'alice@example.com', 'Alice Smith',
        ['admins'], DEFAULT_MAPPINGS,
      );

      expect(user.email).toBe('alice@example.com');
      expect(user.displayName).toBe('Alice Smith');
      expect(user.givenName).toBe('Alice');
      expect(user.familyName).toBe('Smith');
      expect(user.role).toBe('admin');
      expect(user.status).toBe('active');
    });

    it('returns existing active user on subsequent SSO login', () => {
      const first = service.jitProvision(
        'org_1', 'idp_1',
        'alice@example.com', 'Alice Smith',
        ['admins'], DEFAULT_MAPPINGS,
      );

      const second = service.jitProvision(
        'org_1', 'idp_1',
        'alice@example.com', 'Alice Smith',
        ['admins'], DEFAULT_MAPPINGS,
      );

      expect(second.id).toBe(first.id);
    });
  });

  describe('Group Membership Sync', () => {
    it('syncs group membership additions and removals', () => {
      const alice = service.createUser(
        'org_1', 'idp_1', 'ext_alice',
        'alice@example.com', 'Alice', 'A', 'S',
        ['engineering'], DEFAULT_MAPPINGS,
      );
      const bob = service.createUser(
        'org_1', 'idp_1', 'ext_bob',
        'bob@example.com', 'Bob', 'B', 'J',
        ['engineering'], DEFAULT_MAPPINGS,
      );
      service.createUser(
        'org_1', 'idp_1', 'ext_carol',
        'carol@example.com', 'Carol', 'C', 'W',
        [], DEFAULT_MAPPINGS,
      );

      const result = service.syncGroupMembership(
        'org_1', 'idp_1', 'engineering',
        ['ext_alice', 'ext_carol'],
        DEFAULT_MAPPINGS,
      );

      expect(result.unchanged).toContain('ext_alice');
      expect(result.removed).toContain('ext_bob');
      expect(result.added).toContain('ext_carol');

      expect(service.getUser(bob.id)!.groups).not.toContain('engineering');
    });
  });
});
