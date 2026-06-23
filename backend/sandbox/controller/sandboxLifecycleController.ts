import { Request, Response, Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  containerManager,
  MaxSandboxesError,
  TtlExtensionLimitError,
} from '../../../sandbox/orchestrator/containerManager';
import { generateStellarKeypair } from '../utils/stellarUtils';

const router = Router();

export interface ProvisionRequest {
  developerId: string;
}

export interface ExtendTtlRequest {
  sandboxId: string;
}

/**
 * POST /api/v1/sandbox/provision
 * Provision a new ephemeral sandbox instance
 */
router.post('/provision', async (req: Request, res: Response) => {
  try {
    const { developerId } = req.body as ProvisionRequest;

    if (!developerId) {
      return res.status(400).json({ error: 'developerId is required' });
    }

    const activeCount = containerManager.getActiveCount();
    if (activeCount >= 3) {
      const waitTime = containerManager.estimateWaitTime();
      return res.status(429).json({
        error: 'Maximum concurrent sandboxes (3) reached',
        estimatedWait: waitTime,
        activeSandboxCount: activeCount,
        maxConcurrent: 3,
      });
    }

    const sandboxId = `sbx_${uuidv4().slice(0, 8)}`;
    const keypair = generateStellarKeypair();
    const dbPassword = uuidv4().slice(0, 16);

    const status = await containerManager.provision({
      sandboxId,
      developerId,
      dbPassword,
      dbHostPort: 0,
      apiHostPort: 0,
      stellarAccount: keypair.publicKey,
    });

    return res.status(201).json({
      sandboxId,
      status: status.status,
      createdAt: status.createdAt,
      expiresAt: status.expiresAt,
      stellarAccount: keypair.publicKey,
      stellarSecret: keypair.secretKey,
      endpoints: {
        api: `https://sandbox-${sandboxId}.api.subtrackr.io`,
        horizon: 'https://horizon-testnet.stellar.org',
      },
      limits: {
        ram: '512MB',
        cpu: 1,
        disk: '2GB',
        ttl: '1 hour',
        maxExtensions: 1,
      },
    });
  } catch (err) {
    if (err instanceof MaxSandboxesError) {
      return res.status(429).json({
        error: err.message,
        estimatedWait: err.estimatedWait,
        maxConcurrent: err.maxConcurrent,
      });
    }
    console.error('Provision failed:', err);
    return res.status(500).json({ error: 'Failed to provision sandbox' });
  }
});

/**
 * DELETE /api/v1/sandbox/:sandboxId
 * Tear down a sandbox instance
 */
router.delete('/:sandboxId', async (req: Request, res: Response) => {
  try {
    const { sandboxId } = req.params;
    await containerManager.teardown(sandboxId);
    return res.json({ message: `Sandbox ${sandboxId} torn down successfully` });
  } catch (err) {
    console.error('Teardown failed:', err);
    return res.status(500).json({ error: 'Failed to tear down sandbox' });
  }
});

/**
 * POST /api/v1/sandbox/extend-ttl
 * Extend sandbox TTL by 2 hours (one-time extension, max 4h total)
 */
router.post('/extend-ttl', async (req: Request, res: Response) => {
  try {
    const { sandboxId } = req.body as ExtendTtlRequest;

    if (!sandboxId) {
      return res.status(400).json({ error: 'sandboxId is required' });
    }

    const extended = containerManager.extendTtl(sandboxId);
    if (!extended) {
      return res.status(404).json({ error: 'Sandbox not found' });
    }

    const status = containerManager.getStatus(sandboxId);
    return res.json({
      message: `Sandbox ${sandboxId} TTL extended by 2 hours`,
      newExpiry: status?.expiresAt,
    });
  } catch (err) {
    if (err instanceof TtlExtensionLimitError) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Extend TTL failed:', err);
    return res.status(500).json({ error: 'Failed to extend sandbox TTL' });
  }
});

/**
 * GET /api/v1/sandbox/:sandboxId
 * Get sandbox status
 */
router.get('/:sandboxId', (req: Request, res: Response) => {
  const { sandboxId } = req.params;
  const status = containerManager.getStatus(sandboxId);

  if (!status) {
    return res.status(404).json({ error: 'Sandbox not found' });
  }

  return res.json(status);
});

/**
 * GET /api/v1/sandbox/health/:sandboxId
 * Health check - updates last activity timestamp
 */
router.post('/:sandboxId/touch', (req: Request, res: Response) => {
  const { sandboxId } = req.params;
  containerManager.touchActivity(sandboxId);
  return res.json({ touched: true });
});

/**
 * POST /api/v1/sandbox/:sandboxId/extend-idle
 * User confirms they want to keep the sandbox after idle warning
 */
router.post('/:sandboxId/extend-idle', (req: Request, res: Response) => {
  const { sandboxId } = req.params;
  containerManager.touchActivity(sandboxId);
  return res.json({ message: 'Idle timer reset', sandboxId });
});

export { router as sandboxLifecycleRouter };
