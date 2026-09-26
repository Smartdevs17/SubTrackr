/**
 * Group billing & member management HTTP handlers (Issue #785).
 * In-memory store backed by src groupService helpers + GroupBillingService.
 */
import type { Request, Response } from 'express';
import { fail, ok, ERROR_HTTP_STATUS_MAP, type ErrorCode } from '../../services/shared/apiResponse';
import { groupBillingService } from '../../services/billing/groupBilling';
import type { BillingAllocationStrategy, GroupConfig, SubscriptionGroup } from '../../../src/types/group';
import {
  changeMemberRole,
  chargeGroupWithAllocation,
  createSubscriptionGroup,
  getGroupAnalytics,
  inviteGroupMember,
  joinGroupWithInvite,
  removeGroupMember,
} from '../../../src/services/groupService';

const groupStore = new Map<string, SubscriptionGroup>();

const requestIdOf = (req: Request): string | undefined =>
  (req.headers['x-request-id'] as string) || undefined;

const respondError = (res: Response, code: ErrorCode, message: string, requestId?: string): void => {
  res.status(ERROR_HTTP_STATUS_MAP[code]).json(fail(code, message, requestId));
};

const requireGroup = (groupId: string): SubscriptionGroup | null =>
  groupStore.get(groupId) ?? null;

const saveGroup = (group: SubscriptionGroup): SubscriptionGroup => {
  groupStore.set(group.groupId, group);
  return group;
};

export const resetGroupBillingStore = (): void => {
  groupStore.clear();
};

export function createGroup(req: Request, res: Response): void {
  const requestId = requestIdOf(req);
  const { owner, name, planSharingRules } = (req.body ?? {}) as {
    owner?: string;
    name?: string;
    planSharingRules?: GroupConfig['planSharingRules'];
  };

  if (!owner || !name || !planSharingRules) {
    respondError(res, 'VALIDATION_ERROR', 'owner, name, and planSharingRules are required', requestId);
    return;
  }

  const group = createSubscriptionGroup(owner, { name, planSharingRules });
  saveGroup(group);
  groupBillingService.recordAdminAction(group.groupId, 'invite', owner, owner, {
    action: 'create_group',
  });

  res.status(201).json(ok(group, requestId));
}

export function getGroup(req: Request, res: Response): void {
  const requestId = requestIdOf(req);
  const group = requireGroup(req.params.groupId);
  if (!group) {
    respondError(res, 'NOT_FOUND', `Group "${req.params.groupId}" not found`, requestId);
    return;
  }
  res.status(200).json(ok(group, requestId));
}

export function inviteMember(req: Request, res: Response): void {
  const requestId = requestIdOf(req);
  const group = requireGroup(req.params.groupId);
  if (!group) {
    respondError(res, 'NOT_FOUND', `Group "${req.params.groupId}" not found`, requestId);
    return;
  }

  const { inviteeAddress, invitedBy } = (req.body ?? {}) as {
    inviteeAddress?: string;
    invitedBy?: string;
  };

  if (!inviteeAddress || !invitedBy) {
    respondError(res, 'VALIDATION_ERROR', 'inviteeAddress and invitedBy are required', requestId);
    return;
  }

  const permission = groupBillingService.canPerformAction(group, invitedBy, 'invite');
  if (!permission.allowed) {
    respondError(res, 'FORBIDDEN', permission.reason ?? 'Invite not allowed', requestId);
    return;
  }

  try {
    const updated = inviteGroupMember(group, inviteeAddress, invitedBy);
    saveGroup(updated);
    groupBillingService.recordAdminAction(group.groupId, 'invite', invitedBy, inviteeAddress);
    const invite = updated.invites[updated.invites.length - 1];
    res.status(201).json(ok({ group: updated, invite }, requestId));
  } catch (err) {
    respondError(res, 'BAD_REQUEST', err instanceof Error ? err.message : 'Invite failed', requestId);
  }
}

export function acceptInvite(req: Request, res: Response): void {
  const requestId = requestIdOf(req);
  const group = requireGroup(req.params.groupId);
  if (!group) {
    respondError(res, 'NOT_FOUND', `Group "${req.params.groupId}" not found`, requestId);
    return;
  }

  const { displayName } = (req.body ?? {}) as { displayName?: string };

  try {
    const updated = joinGroupWithInvite(group, req.params.inviteId, displayName);
    saveGroup(updated);
    res.status(200).json(ok(updated, requestId));
  } catch (err) {
    respondError(
      res,
      'BAD_REQUEST',
      err instanceof Error ? err.message : 'Accept invite failed',
      requestId
    );
  }
}

export function removeMember(req: Request, res: Response): void {
  const requestId = requestIdOf(req);
  const group = requireGroup(req.params.groupId);
  if (!group) {
    respondError(res, 'NOT_FOUND', `Group "${req.params.groupId}" not found`, requestId);
    return;
  }

  const actorAddress =
    (req.headers['x-actor-address'] as string) ||
    ((req.body ?? {}) as { actorAddress?: string }).actorAddress ||
    group.owner;

  const permission = groupBillingService.canPerformAction(group, actorAddress, 'remove');
  if (!permission.allowed) {
    respondError(res, 'FORBIDDEN', permission.reason ?? 'Remove not allowed', requestId);
    return;
  }

  try {
    const updated = removeGroupMember(group, req.params.address);
    saveGroup(updated);
    groupBillingService.recordAdminAction(
      group.groupId,
      'remove',
      actorAddress,
      req.params.address
    );
    res.status(200).json(ok(updated, requestId));
  } catch (err) {
    respondError(res, 'BAD_REQUEST', err instanceof Error ? err.message : 'Remove failed', requestId);
  }
}

export function chargeGroup(req: Request, res: Response): void {
  const requestId = requestIdOf(req);
  const group = requireGroup(req.params.groupId);
  if (!group) {
    respondError(res, 'NOT_FOUND', `Group "${req.params.groupId}" not found`, requestId);
    return;
  }

  const body = (req.body ?? {}) as {
    amount?: number;
    strategy?: BillingAllocationStrategy;
    customWeights?: Record<string, number>;
    actorAddress?: string;
  };

  if (typeof body.amount !== 'number' || body.amount <= 0) {
    respondError(res, 'VALIDATION_ERROR', 'amount must be a positive number', requestId);
    return;
  }

  const strategy: BillingAllocationStrategy = body.strategy ?? 'equal';
  const validStrategies: BillingAllocationStrategy[] = [
    'equal',
    'usage_weighted',
    'custom_weights',
    'owner_pays',
  ];
  if (!validStrategies.includes(strategy)) {
    respondError(res, 'VALIDATION_ERROR', `Invalid allocation strategy: ${strategy}`, requestId);
    return;
  }

  try {
    const result = chargeGroupWithAllocation(group, body.amount, strategy, body.customWeights);
    saveGroup(result.group);
    res.status(201).json(
      ok(
        {
          charge: result.charge,
          allocation: result.allocation,
          group: result.group,
          billingSummary: groupBillingService.generateBillingSummary(result.group),
        },
        requestId
      )
    );
  } catch (err) {
    respondError(res, 'BAD_REQUEST', err instanceof Error ? err.message : 'Charge failed', requestId);
  }
}

export function getAnalytics(req: Request, res: Response): void {
  const requestId = requestIdOf(req);
  const group = requireGroup(req.params.groupId);
  if (!group) {
    respondError(res, 'NOT_FOUND', `Group "${req.params.groupId}" not found`, requestId);
    return;
  }

  const analytics = {
    ...getGroupAnalytics(group),
    ...groupBillingService.calculateGroupAnalytics(group),
  };

  res.status(200).json(ok(analytics, requestId));
}

export function getAdminActions(req: Request, res: Response): void {
  const requestId = requestIdOf(req);
  const group = requireGroup(req.params.groupId);
  if (!group) {
    respondError(res, 'NOT_FOUND', `Group "${req.params.groupId}" not found`, requestId);
    return;
  }

  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const actions = groupBillingService.getAdminActions(group.groupId, limit);
  res.status(200).json(ok({ actions }, requestId));
}

export function overrideBalance(req: Request, res: Response): void {
  const requestId = requestIdOf(req);
  const group = requireGroup(req.params.groupId);
  if (!group) {
    respondError(res, 'NOT_FOUND', `Group "${req.params.groupId}" not found`, requestId);
    return;
  }

  const body = (req.body ?? {}) as {
    memberAddress?: string;
    newBalance?: number;
    actorAddress?: string;
  };

  if (!body.memberAddress || typeof body.newBalance !== 'number' || !body.actorAddress) {
    respondError(
      res,
      'VALIDATION_ERROR',
      'memberAddress, newBalance, and actorAddress are required',
      requestId
    );
    return;
  }

  const updatedMember = groupBillingService.overrideMemberBalance(
    group,
    body.memberAddress,
    body.newBalance,
    body.actorAddress
  );

  if (!updatedMember) {
    respondError(res, 'FORBIDDEN', 'Billing override not permitted or member not found', requestId);
    return;
  }

  const updated: SubscriptionGroup = {
    ...group,
    members: group.members.map((m) =>
      m.address === body.memberAddress ? updatedMember : m
    ),
    updatedAt: new Date(),
  };
  saveGroup(updated);

  res.status(200).json(ok({ group: updated, member: updatedMember }, requestId));
}

export function changeRole(req: Request, res: Response): void {
  const requestId = requestIdOf(req);
  const group = requireGroup(req.params.groupId);
  if (!group) {
    respondError(res, 'NOT_FOUND', `Group "${req.params.groupId}" not found`, requestId);
    return;
  }

  const body = (req.body ?? {}) as {
    memberAddress?: string;
    role?: 'admin' | 'member';
    actorAddress?: string;
  };

  if (!body.memberAddress || !body.role || !body.actorAddress) {
    respondError(
      res,
      'VALIDATION_ERROR',
      'memberAddress, role, and actorAddress are required',
      requestId
    );
    return;
  }

  const permission = groupBillingService.canPerformAction(group, body.actorAddress, 'role_change');
  if (!permission.allowed) {
    respondError(res, 'FORBIDDEN', permission.reason ?? 'Role change not allowed', requestId);
    return;
  }

  try {
    const updated = changeMemberRole(group, body.memberAddress, body.role);
    saveGroup(updated);
    groupBillingService.recordAdminAction(
      group.groupId,
      'role_change',
      body.actorAddress,
      body.memberAddress,
      { role: body.role }
    );
    res.status(200).json(ok(updated, requestId));
  } catch (err) {
    respondError(
      res,
      'BAD_REQUEST',
      err instanceof Error ? err.message : 'Role change failed',
      requestId
    );
  }
}
