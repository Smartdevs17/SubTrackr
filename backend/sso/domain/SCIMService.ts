import { randomBytes } from 'crypto';
import type {
  RoleMapping,
  SCIMListResponse,
  SCIMPatchOperation,
  SCIMUser,
  SCIMUserStatus,
  SubTrackrRole,
} from './types';

const SCIM_SCHEMAS = {
  user: 'urn:ietf:params:scim:schemas:core:2.0:User',
  listResponse: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  patchOp: 'urn:ietf:params:scim:api:messages:2.0:PatchOp',
};

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export class SCIMService {
  private users = new Map<string, SCIMUser>();
  private externalIdIndex = new Map<string, string>();

  createUser(
    organizationId: string,
    identityProviderId: string,
    externalId: string,
    email: string,
    displayName: string,
    givenName: string,
    familyName: string,
    groups: string[],
    roleMappings: RoleMapping[],
  ): SCIMUser {
    const existingId = this.externalIdIndex.get(`${organizationId}:${externalId}`);
    if (existingId) {
      return this.reactivateUser(existingId, email, displayName, givenName, familyName, groups, roleMappings);
    }

    const now = new Date().toISOString();
    const role = this.resolveRole(groups, roleMappings);

    const user: SCIMUser = {
      id: generateId('scim_user'),
      externalId,
      organizationId,
      identityProviderId,
      email,
      displayName,
      givenName,
      familyName,
      role,
      status: 'active',
      groups,
      provisionedAt: now,
      lastSyncedAt: now,
    };

    this.users.set(user.id, user);
    this.externalIdIndex.set(`${organizationId}:${externalId}`, user.id);
    return user;
  }

  getUser(userId: string): SCIMUser | undefined {
    return this.users.get(userId);
  }

  getUserByExternalId(organizationId: string, externalId: string): SCIMUser | undefined {
    const id = this.externalIdIndex.get(`${organizationId}:${externalId}`);
    return id ? this.users.get(id) : undefined;
  }

  listUsers(
    organizationId: string,
    startIndex = 1,
    count = 100,
    filter?: string,
  ): SCIMListResponse<SCIMUser> {
    let users = Array.from(this.users.values()).filter(
      (u) => u.organizationId === organizationId,
    );

    if (filter) {
      const emailMatch = filter.match(/userName eq "([^"]+)"/);
      if (emailMatch) {
        users = users.filter((u) => u.email === emailMatch[1]);
      }
      const externalIdMatch = filter.match(/externalId eq "([^"]+)"/);
      if (externalIdMatch) {
        users = users.filter((u) => u.externalId === externalIdMatch[1]);
      }
    }

    const totalResults = users.length;
    const paged = users.slice(startIndex - 1, startIndex - 1 + count);

    return {
      schemas: [SCIM_SCHEMAS.listResponse],
      totalResults,
      startIndex,
      itemsPerPage: paged.length,
      Resources: paged,
    };
  }

  updateUser(
    userId: string,
    updates: Partial<Pick<SCIMUser, 'email' | 'displayName' | 'givenName' | 'familyName' | 'groups'>>,
    roleMappings: RoleMapping[],
  ): SCIMUser {
    const user = this.users.get(userId);
    if (!user) throw new Error(`SCIM user ${userId} not found`);

    if (updates.email !== undefined) user.email = updates.email;
    if (updates.displayName !== undefined) user.displayName = updates.displayName;
    if (updates.givenName !== undefined) user.givenName = updates.givenName;
    if (updates.familyName !== undefined) user.familyName = updates.familyName;
    if (updates.groups !== undefined) {
      user.groups = updates.groups;
      user.role = this.resolveRole(updates.groups, roleMappings);
    }

    user.lastSyncedAt = new Date().toISOString();
    return user;
  }

  patchUser(
    userId: string,
    operations: SCIMPatchOperation[],
    roleMappings: RoleMapping[],
  ): SCIMUser {
    const user = this.users.get(userId);
    if (!user) throw new Error(`SCIM user ${userId} not found`);

    for (const op of operations) {
      this.applyPatchOperation(user, op, roleMappings);
    }

    user.lastSyncedAt = new Date().toISOString();
    return user;
  }

  deactivateUser(userId: string): SCIMUser {
    const user = this.users.get(userId);
    if (!user) throw new Error(`SCIM user ${userId} not found`);

    user.status = 'deactivated';
    user.deactivatedAt = new Date().toISOString();
    user.lastSyncedAt = user.deactivatedAt;
    return user;
  }

  suspendUser(userId: string): SCIMUser {
    const user = this.users.get(userId);
    if (!user) throw new Error(`SCIM user ${userId} not found`);

    user.status = 'suspended';
    user.lastSyncedAt = new Date().toISOString();
    return user;
  }

  deleteUser(userId: string): void {
    const user = this.users.get(userId);
    if (!user) return;

    this.externalIdIndex.delete(`${user.organizationId}:${user.externalId}`);
    this.users.delete(userId);
  }

  jitProvision(
    organizationId: string,
    identityProviderId: string,
    email: string,
    displayName: string,
    groups: string[],
    roleMappings: RoleMapping[],
  ): SCIMUser {
    const externalId = email;
    const existing = this.getUserByExternalId(organizationId, externalId);
    if (existing && existing.status === 'active') {
      existing.lastSyncedAt = new Date().toISOString();
      return existing;
    }

    const nameParts = displayName.split(' ');
    return this.createUser(
      organizationId,
      identityProviderId,
      externalId,
      email,
      displayName,
      nameParts[0] ?? displayName,
      nameParts.slice(1).join(' ') || displayName,
      groups,
      roleMappings,
    );
  }

  syncGroupMembership(
    organizationId: string,
    identityProviderId: string,
    groupName: string,
    memberExternalIds: string[],
    roleMappings: RoleMapping[],
  ): { added: string[]; removed: string[]; unchanged: string[] } {
    const added: string[] = [];
    const removed: string[] = [];
    const unchanged: string[] = [];

    const orgUsers = Array.from(this.users.values()).filter(
      (u) => u.organizationId === organizationId && u.identityProviderId === identityProviderId,
    );

    const currentMembers = orgUsers.filter((u) => u.groups.includes(groupName));
    const currentExternalIds = new Set(currentMembers.map((u) => u.externalId));
    const targetExternalIds = new Set(memberExternalIds);

    for (const user of currentMembers) {
      if (!targetExternalIds.has(user.externalId)) {
        user.groups = user.groups.filter((g) => g !== groupName);
        user.role = this.resolveRole(user.groups, roleMappings);
        user.lastSyncedAt = new Date().toISOString();
        removed.push(user.externalId);
      } else {
        unchanged.push(user.externalId);
      }
    }

    for (const extId of memberExternalIds) {
      if (!currentExternalIds.has(extId)) {
        const user = this.getUserByExternalId(organizationId, extId);
        if (user) {
          user.groups = [...new Set([...user.groups, groupName])];
          user.role = this.resolveRole(user.groups, roleMappings);
          user.lastSyncedAt = new Date().toISOString();
          added.push(extId);
        }
      }
    }

    return { added, removed, unchanged };
  }

  private reactivateUser(
    userId: string,
    email: string,
    displayName: string,
    givenName: string,
    familyName: string,
    groups: string[],
    roleMappings: RoleMapping[],
  ): SCIMUser {
    const user = this.users.get(userId)!;
    user.email = email;
    user.displayName = displayName;
    user.givenName = givenName;
    user.familyName = familyName;
    user.groups = groups;
    user.role = this.resolveRole(groups, roleMappings);
    user.status = 'active';
    user.deactivatedAt = undefined;
    user.lastSyncedAt = new Date().toISOString();
    return user;
  }

  private resolveRole(groups: string[], roleMappings: RoleMapping[]): SubTrackrRole {
    for (const mapping of roleMappings) {
      if (groups.includes(mapping.idpGroup)) {
        return mapping.subtrackrRole;
      }
    }
    return 'viewer';
  }

  private applyPatchOperation(
    user: SCIMUser,
    op: SCIMPatchOperation,
    roleMappings: RoleMapping[],
  ): void {
    const path = op.path?.toLowerCase();

    switch (op.op) {
      case 'replace':
        if (path === 'active' && op.value === false) {
          user.status = 'deactivated';
          user.deactivatedAt = new Date().toISOString();
        } else if (path === 'active' && op.value === true) {
          user.status = 'active';
          user.deactivatedAt = undefined;
        } else if (path === 'displayname' && typeof op.value === 'string') {
          user.displayName = op.value;
        } else if (path === 'emails' && Array.isArray(op.value)) {
          const primary = (op.value as Array<{ value: string; primary?: boolean }>).find(
            (e) => e.primary,
          );
          if (primary) user.email = primary.value;
        }
        break;

      case 'add':
        if (path === 'groups' && Array.isArray(op.value)) {
          const newGroups = (op.value as Array<{ value: string }>).map((g) => g.value);
          user.groups = [...new Set([...user.groups, ...newGroups])];
          user.role = this.resolveRole(user.groups, roleMappings);
        }
        break;

      case 'remove':
        if (path?.startsWith('groups') && typeof op.value === 'string') {
          user.groups = user.groups.filter((g) => g !== op.value);
          user.role = this.resolveRole(user.groups, roleMappings);
        }
        break;
    }
  }
}

export const scimService = new SCIMService();
