import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  acceptInvite,
  changeRole,
  chargeGroup,
  createGroup,
  getAdminActions,
  getAnalytics,
  getGroup,
  inviteMember,
  overrideBalance,
  removeMember,
} from '../controller/groupBillingController';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void> | void;

function wrap(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Group billing & member management routes (Issue #785).
 *
 * Mount under an Express app, e.g. `app.use(createGroupBillingRouter())`.
 */
export function createGroupBillingRouter(): Router {
  const router = Router();

  router.post('/groups', wrap(createGroup));
  router.get('/groups/:'groupId', wrap(getGroup));
  router.post('/groups/:groupId/invites', wrap(inviteMember));
  router.post('/groups/:groupId/invites/:inviteId/accept', wrap(acceptInvite));
  router.delete('/groups/:groupId/members/:address', wrap(removeMember));
  router.post('/groups/:groupId/charges', wrap(chargeGroup));
  router.get('/groups/:'groupId/analytics', wrap(getAnalytics));
  router.get('/groups/:groupId/admin/actions', wrap(getAdminActions));
  router.post('/groups/:groupId/admin/override-balance', wrap(overrideBalance));
  router.post('/groups/:groupId/admin/change-role', wrap(changeRole));

  return router;
}