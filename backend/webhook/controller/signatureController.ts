import { Request, Response } from 'express';
import KeyStore from '../../shared/webhook/keyStore';

export default function signatureController(keyStore: KeyStore) {
  return {
    getKeys: (req: Request, res: Response) => {
      // For admin use only; do not expose in production without auth
      res.json({ current: keyStore.getCurrent(), active: keyStore.getActiveKeys() });
    },
    rotate: (req: Request, res: Response) => {
      const { newKey } = req.body || {};
      if (!newKey) return res.status(400).json({ error: 'newKey required' });
      keyStore.rotate(newKey);
      res.json({ ok: true });
    },
  };
}
