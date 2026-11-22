import { Request, Response, NextFunction } from 'express';
import SignatureService from '../webhook/SignatureService';

export function signatureMiddleware(signatureService: SignatureService) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Attempt to obtain raw body; if not available, stringify body
      let raw: string;
      // Some apps attach rawBody earlier; prefer that.
      // @ts-ignore
      if (req.rawBody && typeof req.rawBody === 'string') raw = req.rawBody;
      else if (typeof req.body === 'string') raw = req.body;
      else raw = JSON.stringify(req.body || '');

      const header = (req.get('X-Signature') || req.get('x-signature') || '') as string;
      await signatureService.verify(raw, header);
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'invalid_signature', message: String(err) });
    }
  };
}
