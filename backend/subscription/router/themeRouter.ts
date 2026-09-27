import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  getThemes,
  getThemeById,
  createTheme,
  updateTheme,
  deleteTheme,
  activateTheme,
} from '../controller/themeController';
import {
  getBranding,
  updateBranding,
  getPortalTheme,
} from '../controller/brandingController';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

export function createThemeRouter(): Router {
  const router = Router();

  router.get(
    '/themes',
    asyncHandler(async (req, res) => {
      getThemes(req, res);
    }),
  );

  router.get(
    '/themes/:id',
    asyncHandler(async (req, res) => {
      getThemeById(req, res);
    }),
  );

  router.post(
    '/themes',
    asyncHandler(async (req, res) => {
      createTheme(req, res);
    }),
  );

  router.patch(
    '/themes/:id',
    asyncHandler(async (req, res) => {
      updateTheme(req, res);
    }),
  );

  router.delete(
    '/themes/:id',
    asyncHandler(async (req, res) => {
      deleteTheme(req, res);
    }),
  );

  router.post(
    '/themes/:id/activate',
    asyncHandler(async (req, res) => {
      activateTheme(req, res);
    }),
  );

  router.get(
    '/themes/export/:id',
    asyncHandler(async (req, res) => {
      const { getThemeById: findTheme } = await import('../controller/themeController');
      getThemeById(req, res);
    }),
  );

  // ── Tenant branding (Issue #1110) ────────────────────────────────────────

  router.get(
    '/branding',
    asyncHandler(async (req, res) => {
      getBranding(req, res);
    }),
  );

  router.put(
    '/branding',
    asyncHandler(async (req, res) => {
      updateBranding(req, res);
    }),
  );

  router.get(
    '/branding/portal',
    asyncHandler(async (req, res) => {
      getPortalTheme(req, res);
    }),
  );

  return router;
}
