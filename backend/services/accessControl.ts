/**
 * Access Control Service — fine-grained RBAC with role hierarchy,
 * permission checking, API key scoping, temporary elevation, and
 * unauthorized access monitoring.
 */

import { randomUUID } from 'crypto';
import { AuditService } from './auditService';
import { AlertingService } from './alerting';
import type { Alert } from './types';

// ─── Resource & Action Types ──────────────────────────────────────────────────

export type Resource =
  | 'subscriptions'
  | 'plans'
  | 'users'
  | 'billing'
  | 'analytics'
  | 'settings'
  | 'features'
  | 'api_keys'
  | 'audit_logs'
  | 'webhooks'
  | 'campaigns'
  | 'support_tickets'
  | 'fraud_rules';

export type Action = 'create' | 'read' | 'update' | 'delete' | 'manage';

export type Effect = 'allow' | 'deny';

export interface Permission {
  resource: Resource;
  actions: Action[];
  conditions?: Record<string, unknown>;
  effect?: Effect;
}

// ─── Role Definitions ─────────────────────────────────────────────────────────

export type Role = 'admin' | 'manager' | 'viewer';

/**
 * Canonical role definitions. `manage` implies all lower actions.
 * Admin inherits all, manager inherits viewer.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    { resource: 'subscriptions', actions: ['create', 'read', 'update', 'delete', 'manage'] },
    { resource: 'plans', actions: ['create', 'read', 'update', 'delete', 'manage'] },
    { resource: 'users', actions: ['create', 'read', 'update', 'delete', 'manage'] },
    { resource: 'billing', actions: ['create', 'read', 'update', 'delete', 'manage'] },
    { resource: 'analytics', actions: ['create', 'read', 'update', 'delete', 'manage'] },
    { resource: 'settings', actions: ['create', 'read', 'update', 'delete', 'manage'] },
    { resource: 'features', actions: ['create', 'read', 'update', 'delete', 'manage'] },
    { resource: 'api_keys', actions: ['create', 'read', 'update', 'delete', 'manage'] },
    { resource: 'audit_logs', actions: ['read', 'manage'] },
    { resource: 'webhooks', actions: ['create', 'read', 'update', 'delete', 'manage'] },
    { resource: 'campaigns', actions: ['create', 'read', 'update', 'delete', 'manage'] },
    { resource: 'support_tickets', actions: ['create', 'read', 'update', 'delete', 'manage'] },
    { resource: 'fraud_rules', actions: ['create', 'read', 'update', 'delete', 'manage'] },
  ],
  manager: [
    { resource: 'subscriptions', actions: ['create', 'read', 'update'] },
    { resource: 'plans', actions: ['read', 'update'] },
    { resource: 'users', actions: ['read'] },
    { resource: 'billing', actions: ['read', 'update'] },
    { resource: 'analytics', actions: ['read'] },
    { resource: 'features', actions: ['read'] },
    { resource: 'api_keys', actions: ['read', 'create'] },
    { resource: 'webhooks', actions: ['read', 'create', 'update'] },
    { resource: 'campaigns', actions: ['read', 'create', 'update'] },
    { resource: 'support_tickets', actions: ['read', 'update'] },
  ],
  viewer: [
    { resource: 'subscriptions', actions: ['read'] },
    { resource: 'plans', actions: ['read'] },
    { resource: 'users', actions: ['read'] },
    { resource: 'billing', actions: ['read'] },
    { resource: 'analytics', actions: ['read'] },
    { resource: 'features', actions: ['read'] },
    { resource: 'audit_logs', actions: ['read'] },
    { resource: 'webhooks', actions: ['read'] },
    { resource: 'campaigns', actions: ['read'] },
    { resource: 'support_tickets', actions: ['read'] },
  ],
};

/**
 * Role hierarchy: admin > manager > viewer
 * Higher roles inherit all permissions from lower roles.
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  admin: 100,
  manager: 50,
  viewer: 10,
};

// ─── Temporary Elevation ──────────────────────────────────────────────────────

export interface TemporaryElevation {
  id: string;
  userId: string;
  elevatedRole: Role;
  originalRole: Role;
  grantedBy: string;
  reason: string;
  expiresAt: number;
  active: boolean;
}

// ─── API Key Scope ────────────────────────────────────────────────────────────

export interface ApiKeyScope {
  apiKeyId: string;
  permissions: Permission[];
  allowedResources?: Resource[];
  maxRatePerMinute?: number;
}

// ─── Unauthorized Access Event ────────────────────────────────────────────────

export interface UnauthorizedAccessEvent {
  id: string;
  actorId: string;
  actorRole: Role | null;
  resource: Resource;
  action: Action;
  deniedAt: number;
  reason: string;
  ip?: string;
  userAgent?: string;
  resolved: boolean;
}

// ─── Role Assignment ──────────────────────────────────────────────────────────

export interface RoleAssignment {
  userId: string;
  role: Role;
  assignedBy: string;
  assignedAt: number;
  expiresAt?: number;
}

// ─── AccessControlService ─────────────────────────────────────────────────────

export type AccessCheckOptions = {
  allowElevated?: boolean;
  requireAllActions?: boolean;
};

export class AccessControlService {
  private assignments = new Map<string, RoleAssignment>();
  private elevations = new Map<string, TemporaryElevation>();
  private apiKeyScopes = new Map<string, ApiKeyScope>();
  private unauthorizedEvents: UnauthorizedAccessEvent[] = [];
  private auditService: AuditService;
  private alertingService: AlertingService;
  private readonly maxUnauthorizedEvents = 10_000;

  private bootstrapped = false;

  constructor(auditService: AuditService, alertingService: AlertingService) {
    this.auditService = auditService;
    this.alertingService = alertingService;
  }

  /**
   * Bootstrap the system by assigning the first admin.
   * Only callable once — subsequent calls require normal role hierarchy checks.
   */
  bootstrap(userId: string): RoleAssignment {
    if (this.bootstrapped) {
      throw new Error('System already bootstrapped');
    }
    const assignment: RoleAssignment = {
      userId,
      role: 'admin',
      assignedBy: 'system',
      assignedAt: Date.now(),
    };
    this.assignments.set(userId, assignment);
    this.bootstrapped = true;

    this.auditService.capture(
      'admin.action',
      'system',
      userId,
      'role_assignment',
      { role: 'admin', bootstrap: true }
    );

    return assignment;
  }

  // ─── Role Assignment ──────────────────────────────────────────────────────

  assignRole(
    userId: string,
    role: Role,
    assignedBy: string,
    expiresAt?: number
  ): RoleAssignment {
    if (!this.canAssignRole(assignedBy, role)) {
      throw new Error(`Actor ${assignedBy} cannot assign role ${role}`);
    }

    const assignment: RoleAssignment = {
      userId,
      role,
      assignedBy,
      assignedAt: Date.now(),
      expiresAt,
    };

    this.assignments.set(userId, assignment);

    this.auditService.capture(
      'admin.action',
      assignedBy,
      userId,
      'role_assignment',
      { role, expiresAt }
    );

    return assignment;
  }

  revokeRole(userId: string, revokedBy: string): void {
    const existing = this.assignments.get(userId);
    if (!existing) {
      throw new Error(`No role assignment found for user ${userId}`);
    }

    this.assignments.delete(userId);

    this.auditService.capture(
      'admin.action',
      revokedBy,
      userId,
      'role_revocation',
      { previousRole: existing.role }
    );
  }

  getAssignment(userId: string): RoleAssignment | null {
    const assignment = this.assignments.get(userId);
    if (!assignment) return null;

    if (assignment.expiresAt && Date.now() > assignment.expiresAt) {
      this.assignments.delete(userId);
      return null;
    }

    return assignment;
  }

  getUserRole(userId: string): Role {
    const assignment = this.getAssignment(userId);
    if (!assignment) return 'viewer';

    const elevation = this.getActiveElevation(userId);
    if (elevation) {
      return elevation.elevatedRole;
    }

    return assignment.role;
  }

  private canAssignRole(actorId: string, targetRole: Role): boolean {
    const actorRole = this.getUserRole(actorId);
    const actorLevel = ROLE_HIERARCHY[actorRole] ?? 0;
    const targetLevel = ROLE_HIERARCHY[targetRole] ?? 0;

    return actorLevel >= targetLevel;
  }

  getAllAssignments(): RoleAssignment[] {
    return Array.from(this.assignments.values());
  }

  // ─── Temporary Elevation ──────────────────────────────────────────────────

  grantTemporaryElevation(
    userId: string,
    elevatedRole: Role,
    grantedBy: string,
    durationMs: number,
    reason: string
  ): TemporaryElevation {
    const actorRole = this.getUserRole(grantedBy);
    const actorLevel = ROLE_HIERARCHY[actorRole] ?? 0;
    const targetLevel = ROLE_HIERARCHY[elevatedRole] ?? 0;

    if (actorLevel <= targetLevel) {
      throw new Error(
        `Actor with role ${actorRole} cannot elevate to ${elevatedRole}`
      );
    }

    const existing = this.getAssignment(userId);
    if (!existing) {
      throw new Error(`User ${userId} has no role assignment`);
    }

    const elevation: TemporaryElevation = {
      id: randomUUID(),
      userId,
      elevatedRole,
      originalRole: existing.role,
      grantedBy,
      reason,
      expiresAt: Date.now() + durationMs,
      active: true,
    };

    this.elevations.set(elevation.id, elevation);

    this.auditService.capture(
      'admin.action',
      grantedBy,
      userId,
      'temporary_elevation',
      {
        elevationId: elevation.id,
        originalRole: elevation.originalRole,
        elevatedRole,
        durationMs,
        reason,
      }
    );

    return elevation;
  }

  revokeElevation(elevationId: string, revokedBy: string): void {
    const elevation = this.elevations.get(elevationId);
    if (!elevation) {
      throw new Error(`Elevation ${elevationId} not found`);
    }

    elevation.active = false;

    this.auditService.capture(
      'admin.action',
      revokedBy,
      elevation.userId,
      'elevation_revocation',
      {
        elevationId,
        originalRole: elevation.originalRole,
        elevatedRole: elevation.elevatedRole,
      }
    );
  }

  getActiveElevation(userId: string): TemporaryElevation | null {
    const elevations = Array.from(this.elevations.values());
    for (const elevation of elevations) {
      if (
        elevation.userId === userId &&
        elevation.active &&
        Date.now() < elevation.expiresAt
      ) {
        return elevation;
      }
    }
    return null;
  }

  getElevationsForUser(userId: string): TemporaryElevation[] {
    return Array.from(this.elevations.values())
      .filter((e) => e.userId === userId);
  }

  // ─── Permission Checking ──────────────────────────────────────────────────

  hasPermission(
    userId: string,
    resource: Resource,
    action: Action,
    options?: AccessCheckOptions
  ): boolean {
    const role = this.getUserRole(userId);
    const permissions = ROLE_PERMISSIONS[role];

    if (!permissions) return false;

    if (options?.allowElevated === false) {
      const elevation = this.getActiveElevation(userId);
      if (elevation) {
        const originalPermissions = ROLE_PERMISSIONS[elevation.originalRole];
        return this.checkPermissions(originalPermissions, resource, action, options);
      }
    }

    return this.checkPermissions(permissions, resource, action, options);
  }

  requirePermission(
    userId: string,
    resource: Resource,
    action: Action,
    options?: AccessCheckOptions
  ): void {
    const hasAccess = this.hasPermission(userId, resource, action, options);
    if (!hasAccess) {
      const role = this.getUserRole(userId);
      this.recordUnauthorizedAccess(userId, role, resource, action, 'Insufficient permissions');
      throw new AccessDeniedError(userId, resource, action, role);
    }
  }

  private checkPermissions(
    permissions: Permission[],
    resource: Resource,
    action: Action,
    options?: AccessCheckOptions
  ): boolean {
    const resourcePerms = permissions.filter(
      (p) => p.resource === resource && p.effect !== 'deny'
    );

    if (resourcePerms.length === 0) return false;

    const allowedActions = new Set<Action>();
    for (const perm of resourcePerms) {
      if (perm.actions.includes('manage')) {
        return true;
      }
      for (const a of perm.actions) {
        allowedActions.add(a);
      }
    }

    if (options?.requireAllActions) {
      return allowedActions.has(action);
    }

    return allowedActions.has(action);
  }

  // ─── API Key Scoping ──────────────────────────────────────────────────────

  registerApiKeyScope(
    apiKeyId: string,
    permissions: Permission[],
    options?: { allowedResources?: Resource[]; maxRatePerMinute?: number }
  ): ApiKeyScope {
    const scope: ApiKeyScope = {
      apiKeyId,
      permissions,
      allowedResources: options?.allowedResources,
      maxRatePerMinute: options?.maxRatePerMinute,
    };

    this.apiKeyScopes.set(apiKeyId, scope);
    return scope;
  }

  updateApiKeyScope(
    apiKeyId: string,
    updates: Partial<Omit<ApiKeyScope, 'apiKeyId'>>
  ): ApiKeyScope | null {
    const existing = this.apiKeyScopes.get(apiKeyId);
    if (!existing) return null;

    const updated: ApiKeyScope = { ...existing, ...updates };
    this.apiKeyScopes.set(apiKeyId, updated);
    return updated;
  }

  getApiKeyScope(apiKeyId: string): ApiKeyScope | null {
    return this.apiKeyScopes.get(apiKeyId) ?? null;
  }

  removeApiKeyScope(apiKeyId: string): void {
    this.apiKeyScopes.delete(apiKeyId);
  }

  checkApiKeyPermission(
    apiKeyId: string,
    resource: Resource,
    action: Action
  ): boolean {
    const scope = this.apiKeyScopes.get(apiKeyId);
    if (!scope) return false;

    if (scope.allowedResources && !scope.allowedResources.includes(resource)) {
      return false;
    }

    return this.checkPermissions(scope.permissions, resource, action);
  }

  getAllApiKeyScopes(): ApiKeyScope[] {
    return Array.from(this.apiKeyScopes.values());
  }

  // ─── Unauthorized Access Monitoring ───────────────────────────────────────

  private recordUnauthorizedAccess(
    actorId: string,
    actorRole: Role | null,
    resource: Resource,
    action: Action,
    reason: string,
    meta?: { ip?: string; userAgent?: string }
  ): void {
    const event: UnauthorizedAccessEvent = {
      id: randomUUID(),
      actorId,
      actorRole,
      resource,
      action,
      deniedAt: Date.now(),
      reason,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
      resolved: false,
    };

    this.unauthorizedEvents.push(event);

    if (this.unauthorizedEvents.length > this.maxUnauthorizedEvents) {
      this.unauthorizedEvents = this.unauthorizedEvents.slice(-5000);
    }

    this.auditService.capture(
      'admin.action',
      actorId,
      resource,
      'access_denied',
      { action, reason, ip: meta?.ip }
    );

    const recentFromActor = this.unauthorizedEvents.filter(
      (e) => e.actorId === actorId && !e.resolved
    ).length;

    if (recentFromActor >= 5) {
      const alert: Alert = {
        id: `unauthorized-burst-${actorId}-${Date.now()}`,
        severity: 'warning',
        title: 'Repeated unauthorized access attempts',
        message: `User ${actorId} has ${recentFromActor} denied access events. Possible permission escalation attempt.`,
        timestamp: Date.now(),
        resolved: false,
        ruleId: 'unauthorized-access-burst',
      };
      this.alertingService.dispatch(alert);
    }
  }

  getUnauthorizedEvents(filter?: {
    actorId?: string;
    resolved?: boolean;
    since?: number;
  }): UnauthorizedAccessEvent[] {
    return this.unauthorizedEvents.filter((e) => {
      if (filter?.actorId && e.actorId !== filter.actorId) return false;
      if (filter?.resolved !== undefined && e.resolved !== filter.resolved) return false;
      if (filter?.since && e.deniedAt < filter.since) return false;
      return true;
    });
  }

  resolveUnauthorizedEvent(eventId: string): void {
    const event = this.unauthorizedEvents.find((e) => e.id === eventId);
    if (event) {
      event.resolved = true;
    }
  }

  getUnauthorizedAccessStats(): {
    total: number;
    unresolved: number;
    byActor: Record<string, number>;
    byResource: Record<string, number>;
  } {
    const stats = {
      total: this.unauthorizedEvents.length,
      unresolved: this.unauthorizedEvents.filter((e) => !e.resolved).length,
      byActor: {} as Record<string, number>,
      byResource: {} as Record<string, number>,
    };

    for (const e of this.unauthorizedEvents) {
      stats.byActor[e.actorId] = (stats.byActor[e.actorId] ?? 0) + 1;
      stats.byResource[e.resource] = (stats.byResource[e.resource] ?? 0) + 1;
    }

    return stats;
  }

  // ─── Role Hierarchy Complexity Guard ──────────────────────────────────────

  validateRoleHierarchy(): boolean {
    const roles = Object.keys(ROLE_HIERARCHY) as Role[];
    for (let i = 0; i < roles.length; i++) {
      for (let j = i + 1; j < roles.length; j++) {
        if (ROLE_HIERARCHY[roles[i]] === ROLE_HIERARCHY[roles[j]]) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Prevent permission escalation: ensure no user can assign a role
   * equal to or higher than their own.
   */
  preventEscalation(actorId: string, targetRole: Role): void {
    const actorRole = this.getUserRole(actorId);
    const actorLevel = ROLE_HIERARCHY[actorRole] ?? 0;
    const targetLevel = ROLE_HIERARCHY[targetRole] ?? 0;

    if (actorLevel <= targetLevel) {
      this.recordUnauthorizedAccess(
        actorId,
        actorRole,
        'users',
        'manage',
        `Permission escalation prevention: ${actorRole} cannot assign ${targetRole}`
      );
      throw new PermissionEscalationError(actorId, actorRole, targetRole);
    }
  }
}

// ─── Custom Errors ────────────────────────────────────────────────────────────

export class AccessDeniedError extends Error {
  constructor(
    public readonly userId: string,
    public readonly resource: Resource,
    public readonly action: Action,
    public readonly role: Role | null
  ) {
    super(
      `Access denied: user ${userId} (role: ${role ?? 'none'}) cannot ${action} ${resource}`
    );
    this.name = 'AccessDeniedError';
  }
}

export class PermissionEscalationError extends Error {
  constructor(
    public readonly actorId: string,
    public readonly actorRole: Role,
    public readonly targetRole: Role
  ) {
    super(
      `Permission escalation prevented: ${actorRole} cannot assign ${targetRole}`
    );
    this.name = 'PermissionEscalationError';
  }
}
