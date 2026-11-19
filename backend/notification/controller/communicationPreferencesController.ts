/**
 * Communication preferences API (#1253) and inbound SMS webhook (#1256).
 *
 *   GET   /api/communication-preferences/:userId
 *   PUT   /api/communication-preferences/:userId
 *   POST  /api/communication-preferences/:userId/channels/:channel/opt-out
 *   POST  /api/communication-preferences/:userId/channels/:channel/opt-in
 *   POST  /api/communication-preferences/:userId/audit
 *   POST  /webhooks/twilio/sms/inbound
 *
 * The webhook validates the Twilio account credentials before parsing, so an
 * unauthenticated caller cannot drive opt-out state. Twilio authenticates with
 * HTTP Basic on the account SID rather than an HMAC signature, so verification
 * is a constant-time compare of the supplied account SID.
 */

import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { CommunicationPreferenceService, PreferenceViolationError } from '../../services/notification/communicationPreferencesService';
import { SmsInboundHandler } from '../../services/notification/smsInboundHandler';
import type { TwilioSmsPayload } from '../../services/notification/smsInboundHandler';
import { COMM_CHANNELS, COMM_CATEGORIES } from '../../services/notification/commPreferencesTypes';
import type { CommCategory, CommChannel } from '../../services/notification/commPreferencesTypes';

// ─── Validation helpers ────────────────────────────────────────────────────────

/** Constant-time string compare that tolerates differing lengths. */
export function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify a Twilio request.
 *
 * Twilio sends the account SID as HTTP Basic username with an empty password.
 * Requests without a matching SID are rejected with 401.
 */
export function isAuthorisedTwilioRequest(
  authorizationHeader: string | undefined,
  expectedAccountSid: string
): boolean {
  if (!authorizationHeader) return false;
  const [scheme, encoded] = authorizationHeader.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) return false;

  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  const accountSid = separator === -1 ? decoded : decoded.slice(0, separator);
  return safeEquals(accountSid, expectedAccountSid);
}

function isCommCategory(value: string): value is CommCategory {
  return (COMM_CATEGORIES as string[]).includes(value);
}

function isCommChannel(value: string): value is CommChannel {
  return (COMM_CHANNELS as string[]).includes(value);
}

function errorStatusFor(error: unknown): number {
  return error instanceof PreferenceViolationError ? 409 : 500;
}

// ─── Preferences router ────────────────────────────────────────────────────────

export function createCommunicationPreferencesRouter(
  preferences: CommunicationPreferenceService
): Router {
  const router = Router();

  router.get('/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      if (!userId) return res.status(400).json({ error: 'userId is required' });
      return res.json(await preferences.getPreferences(userId));
    } catch (error) {
      console.error('Error fetching communication preferences:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.put('/:userId', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      if (!userId) return res.status(400).json({ error: 'userId is required' });

      const body = req.body ?? {};
      if (typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Body must be an object' });
      }
      for (const category of Object.keys(body.categories ?? {})) {
        if (!isCommCategory(category)) {
          return res.status(400).json({ error: `Unknown category "${category}"` });
        }
      }

      const updated = await preferences.updatePreferences(userId, body, 'api');
      return res.json(updated);
    } catch (error) {
      const status = errorStatusFor(error);
      if (status === 500) console.error('Error updating communication preferences:', error);
      return res
        .status(status)
        .json({ error: error instanceof Error ? error.message : 'Internal server error' });
    }
  });

  router.post('/:userId/channels/:channel/opt-out', async (req: Request, res: Response) => {
    try {
      const { userId, channel } = req.params;
      if (!userId || !channel) return res.status(400).json({ error: 'userId and channel are required' });
      if (!isCommChannel(channel)) return res.status(400).json({ error: `Unknown channel "${channel}"` });

      const updated = await preferences.optOutChannel(
        userId,
        channel,
        typeof req.body?.reason === 'string' ? req.body.reason : 'api request',
        'api'
      );
      return res.json(updated);
    } catch (error) {
      console.error('Error opting out of channel:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/:userId/channels/:channel/opt-in', async (req: Request, res: Response) => {
    try {
      const { userId, channel } = req.params;
      if (!userId || !channel) return res.status(400).json({ error: 'userId and channel are required' });
      if (!isCommChannel(channel)) return res.status(400).json({ error: `Unknown channel "${channel}"` });

      const updated = await preferences.optInChannel(userId, channel, 'api');
      return res.json(updated);
    } catch (error) {
      console.error('Error opting in to channel:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:userId/audit', async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      if (!userId) return res.status(400).json({ error: 'userId is required' });
      return res.json({ changes: await preferences.listChanges(userId) });
    } catch (error) {
      console.error('Error fetching preference audit log:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

// ─── Inbound SMS webhook router ────────────────────────────────────────────────

export function createSmsInboundRouter(
  handler: SmsInboundHandler,
  expectedAccountSid: string
): Router {
  const router = Router();

  router.post('/inbound', async (req: Request, res: Response) => {
    if (!isAuthorisedTwilioRequest(req.headers.authorization, expectedAccountSid)) {
      return res.status(401).json({ error: 'Unauthorised Twilio request' });
    }

    // Twilio posts application/x-www-form-urlencoded.
    const payload = (req.body ?? {}) as TwilioSmsPayload;
    const result = await handler.handle(payload);

    // Twilio retries any non-2xx, so a handled message always answers 200 even
    // when the reply itself failed — the audit row carries the failure.
    if (result.error && !result.handled && result.intent === 'unknown') {
      return res.status(400).json({ error: result.error });
    }
    return res.status(200).json({
      handled: result.handled,
      duplicate: result.duplicate,
      intent: result.intent,
      keyword: result.keyword,
    });
  });

  return router;
}
