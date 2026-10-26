import { AccessControlService, ROLE_HIERARCHY, ROLE_PERMISSIONS } from '../../accessControl';
import { AuditService } from '../auditService';
import { AlertingService } from '../../notification/alerting';

describe('AccessControlService', () => {
  let svc: AccessControlService;
  let audit: AuditService;
  let alerting: AlertingService;

  beforeEach(() => {
    audit = new AuditService('test-secret');
    alerting = new AlertingService();
    svc = new AccessControlService(audit, alerting);
    svc.bootstrap('root-admin');
  });

  describe('role hierarchy', () => {
    it('orders roles correctly', () => {
      expect(ROLE_HIERARCHY.admin).toBeGreaterThan(ROLE_HIERARCHY.manager);
      expect(ROLE_HIERARCHY.manager).toBeGreaterThan(ROLE_HIERARCHY.viewer);
    });

    it('validates hierarchy has no duplicates', () => {
      expect(svc.validateRoleHierarchy()).toBe(true);
    });
  });

  describe('bootstrap', () => {
    it('only allows one bootstrap', () => {
      expect(() => svc.bootstrap('other')).toThrow('already bootstrapped');
    });
  });

  describe('role assignment', () => {
    it('assigns a role to a user', () => {
      svc.assignRole('user-1', 'admin', 'root-admin');
      const assignment = svc.getAssignment('user-1');
      expect(assignment).not.toBeNull();
      expect(assignment!.role).toBe('admin');
    });

    it('throws when viewer tries to assign admin', () => {
      svc.assignRole('viewer-user', 'viewer', 'root-admin');
      expect(() => svc.assignRole('user-3', 'admin', 'viewer-user')).toThrow();
    });

    it('revokes a role', () => {
      svc.assignRole('user-1', 'manager', 'root-admin');
      svc.revokeRole('user-1', 'root-admin');
      expect(svc.getAssignment('user-1')).toBeNull();
    });

    it('expires role assignments', () => {
      svc.assignRole('user-1', 'viewer', 'root-admin', Date.now() - 1000);
      expect(svc.getAssignment('user-1')).toBeNull();
    });
  });

  describe('permission checking', () => {
    it('grants admin access to all resources', () => {
      svc.assignRole('admin-1', 'admin', 'root-admin');
      expect(svc.hasPermission('admin-1', 'subscriptions', 'manage')).toBe(true);
      expect(svc.hasPermission('admin-1', 'billing', 'delete')).toBe(true);
      expect(svc.hasPermission('admin-1', 'settings', 'update')).toBe(true);
    });

    it('grants manager create, read, update but not delete on subscriptions', () => {
      svc.assignRole('mgr-1', 'manager', 'root-admin');
      expect(svc.hasPermission('mgr-1', 'subscriptions', 'create')).toBe(true);
      expect(svc.hasPermission('mgr-1', 'subscriptions', 'read')).toBe(true);
      expect(svc.hasPermission('mgr-1', 'subscriptions', 'update')).toBe(true);
      expect(svc.hasPermission('mgr-1', 'subscriptions', 'delete')).toBe(false);
    });

    it('grants viewer read-only access', () => {
      svc.assignRole('viewer-1', 'viewer', 'root-admin');
      expect(svc.hasPermission('viewer-1', 'subscriptions', 'read')).toBe(true);
      expect(svc.hasPermission('viewer-1', 'subscriptions', 'create')).toBe(false);
      expect(svc.hasPermission('viewer-1', 'billing', 'update')).toBe(false);
    });

    it('defaults unassigned users to viewer role', () => {
      expect(svc.hasPermission('unknown', 'subscriptions', 'read')).toBe(true);
      expect(svc.hasPermission('unknown', 'settings', 'update')).toBe(false);
    });

    it('throws AccessDeniedError on requirePermission failure', () => {
      svc.assignRole('viewer-1', 'viewer', 'root-admin');
      expect(() =>
        svc.requirePermission('viewer-1', 'billing', 'delete')
      ).toThrow('Access denied');
    });
  });

  describe('temporary elevation', () => {
    it('grants and respects temporary elevation', () => {
      svc.assignRole('user-1', 'viewer', 'root-admin');

      const elevation = svc.grantTemporaryElevation(
        'user-1',
        'manager',
        'root-admin',
        60_000,
        'Testing elevation'
      );

      expect(elevation.elevatedRole).toBe('manager');
      expect(elevation.originalRole).toBe('viewer');

      expect(svc.getUserRole('user-1')).toBe('manager');
      expect(svc.hasPermission('user-1', 'subscriptions', 'update')).toBe(true);
    });

    it('expires elevations after duration', () => {
      svc.assignRole('user-1', 'viewer', 'root-admin');

      svc.grantTemporaryElevation('user-1', 'manager', 'root-admin', -1, 'Already expired');

      expect(svc.getActiveElevation('user-1')).toBeNull();
    });

    it('prevents lower roles from elevating others', () => {
      svc.assignRole('viewer-1', 'viewer', 'root-admin');
      svc.assignRole('mgr-1', 'manager', 'root-admin');

      expect(() =>
        svc.grantTemporaryElevation('viewer-1', 'admin', 'mgr-1', 60_000, 'Escalate')
      ).toThrow('cannot elevate');
    });
  });

  describe('API key scoping', () => {
    it('registers and checks API key permissions', () => {
      svc.registerApiKeyScope('key-1', [
        { resource: 'subscriptions', actions: ['read'] },
      ]);

      expect(svc.checkApiKeyPermission('key-1', 'subscriptions', 'read')).toBe(true);
      expect(svc.checkApiKeyPermission('key-1', 'subscriptions', 'create')).toBe(false);
      expect(svc.checkApiKeyPermission('key-1', 'billing', 'read')).toBe(false);
    });

    it('restricts API keys by allowed resources', () => {
      svc.registerApiKeyScope(
        'key-2',
        [{ resource: 'subscriptions', actions: ['read'] }],
        { allowedResources: ['subscriptions'] }
      );

      expect(svc.checkApiKeyPermission('key-2', 'subscriptions', 'read')).toBe(true);
      expect(svc.checkApiKeyPermission('key-2', 'analytics', 'read')).toBe(false);
    });

    it('returns null for unknown API keys', () => {
      expect(svc.getApiKeyScope('nonexistent')).toBeNull();
    });
  });

  describe('unauthorized access monitoring', () => {
    it('records unauthorized access events', () => {
      svc.assignRole('viewer-1', 'viewer', 'root-admin');
      expect(() =>
        svc.requirePermission('viewer-1', 'billing', 'delete')
      ).toThrow();

      const events = svc.getUnauthorizedEvents({ actorId: 'viewer-1' });
      expect(events.length).toBe(1);
      expect(events[0].resource).toBe('billing');
      expect(events[0].action).toBe('delete');
    });

    it('aggregates unauthorized access stats', () => {
      svc.assignRole('viewer-1', 'viewer', 'root-admin');

      for (let i = 0; i < 3; i++) {
        try {
          svc.requirePermission('viewer-1', 'billing', 'delete');
        } catch {}
      }

      const stats = svc.getUnauthorizedAccessStats();
      expect(stats.total).toBe(3);
      expect(stats.byActor['viewer-1']).toBe(3);
      expect(stats.byResource['billing']).toBe(3);
    });

    it('resolves unauthorized events', () => {
      svc.assignRole('viewer-1', 'viewer', 'root-admin');
      try { svc.requirePermission('viewer-1', 'billing', 'delete'); } catch {}

      const events = svc.getUnauthorizedEvents({ resolved: false });
      expect(events.length).toBe(1);

      svc.resolveUnauthorizedEvent(events[0].id);
      expect(svc.getUnauthorizedEvents({ resolved: false }).length).toBe(0);
    });
  });

  describe('permission escalation prevention', () => {
    it('prevents escalation via direct call', () => {
      svc.assignRole('viewer-1', 'viewer', 'root-admin');
      expect(() => svc.preventEscalation('viewer-1', 'manager')).toThrow(
        'Permission escalation prevented'
      );
    });

    it('allows valid escalation check from higher role', () => {
      expect(() => svc.preventEscalation('root-admin', 'viewer')).not.toThrow();
    });
  });

  describe('audit integration', () => {
    it('audits role assignments', () => {
      svc.assignRole('user-1', 'manager', 'root-admin');
      const report = audit.generateReport(0, Date.now());
      expect(report.totalEvents).toBe(2); // bootstrap + assignment
      const assignmentEvent = report.events.find(
        e => e.actorId === 'root-admin' && e.resourceType === 'role_assignment'
      );
      expect(assignmentEvent).toBeTruthy();
      expect(assignmentEvent!.metadata).toMatchObject({ role: 'manager' });
    });

    it('audits role revocations', () => {
      svc.assignRole('user-1', 'manager', 'root-admin');
      svc.revokeRole('user-1', 'root-admin');
      const report = audit.generateReport(0, Date.now());
      expect(report.totalEvents).toBe(3); // bootstrap + assign + revoke
    });
  });
});
