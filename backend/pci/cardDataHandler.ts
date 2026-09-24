/**
 * PCI DSS — Card Data Handler (Requirement 3: Protect stored cardholder data)
 *
 * Implements tokenization of card data so that raw PANs are never stored
 * in the application database. Only tokens and truncated/masked references
 * are persisted.
 */

import { createHash, createCipheriv, randomBytes } from 'crypto';

export interface CardData {
  /** Primary Account Number (card number) */
  pan: string;
  /** Cardholder name */
  holderName: string;
  /** Expiry MM/YY */
  expiry: string;
  /** CVV — never stored, only used transiently */
  cvv: string;
  /** Billing address */
  billingAddress?: string;
}

export interface CardToken {
  token: string;
  last4: string;
  cardBrand: string;
  holderName: string;
  expiry: string;
  createdAt: number;
  /** Fingerprint — hash of PAN for duplicate detection without storing PAN */
  fingerprint: string;
}

/**
 * In-memory token vault. In production, this would be backed by a
 * HSM (Hardware Security Module) or a secure vault service.
 */
export const PCI_TOKEN_VAULT: Map<string, { encryptedPan: string; iv: string }> = new Map();

const ENCRYPTION_KEY = process.env['PCI_ENCRYPTION_KEY'] ?? randomBytes(32);

function detectCardBrand(pan: string): string {
  const cleaned = pan.replace(/\s/g, '');
  if (/^4/.test(cleaned)) return 'visa';
  if (/^5[1-5]/.test(cleaned)) return 'mastercard';
  if (/^3[47]/.test(cleaned)) return 'amex';
  if (/^6(?:011|5)/.test(cleaned)) return 'discover';
  if (/^(?:2131|1800|35)/.test(cleaned)) return 'jcb';
  return 'unknown';
}

function validateLuhn(pan: string): boolean {
  const cleaned = pan.replace(/\D/g, '');
  if (cleaned.length < 13 || cleaned.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    let digit = parseInt(cleaned[i], 10);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export class CardDataHandler {
  /**
   * Tokenize a card. The PAN is encrypted and stored in the vault;
   * a non-reversible token is returned for application use.
   */
  tokenize(card: CardData): { success: boolean; token?: CardToken; error?: string } {
    // Validate PAN
    if (!validateLuhn(card.pan)) {
      return { success: false, error: 'Invalid card number (Luhn check failed)' };
    }
    if (card.cvv.length < 3 || card.cvv.length > 4) {
      return { success: false, error: 'Invalid CVV length' };
    }

    const cleanedPan = card.pan.replace(/\s/g, '');
    const last4 = cleanedPan.slice(-4);
    const cardBrand = detectCardBrand(cleanedPan);
    const fingerprint = createHash('sha256').update(cleanedPan).digest('hex');

    // Encrypt PAN for vault storage
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(cleanedPan, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const token = `tok_${randomBytes(16).toString('hex')}`;
    PCI_TOKEN_VAULT.set(token, {
      encryptedPan: encrypted.toString('base64') + ':' + authTag.toString('base64'),
      iv: iv.toString('base64'),
    });

    // CVV is NEVER stored — discard immediately after validation
    // (in real usage, CVV is sent to payment processor and forgotten)

    const cardToken: CardToken = {
      token,
      last4,
      cardBrand,
      holderName: card.holderName,
      expiry: card.expiry,
      createdAt: Date.now(),
      fingerprint,
    };

    return { success: true, token: cardToken };
  }

  /**
   * Detokenize — retrieve the full PAN from the vault.
   * This should only be called by the payment processor integration,
   * never by general application code.
   */
  detokenize(token: string): { success: boolean; pan?: string; error?: string } {
    const entry = PCI_TOKEN_VAULT.get(token);
    if (!entry) {
      return { success: false, error: 'Token not found' };
    }

    try {
      const [encryptedData, authTagB64] = entry.encryptedPan.split(':');
      const iv = Buffer.from(entry.iv, 'base64');
      const authTag = Buffer.from(authTagB64, 'base64');
      const encrypted = Buffer.from(encryptedData, 'base64');

      // Use createDecipheriv — note: in production this would use a HSM
      const { createDecipheriv } = require('crypto');
      const decipher = createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return { success: true, pan: decrypted.toString('utf8') };
    } catch {
      return { success: false, error: 'Failed to decrypt token' };
    }
  }

  /**
   * Remove a tokenized card from the vault (card removal / token expiry).
   */
  deleteToken(token: string): boolean {
    return PCI_TOKEN_VAULT.delete(token);
  }

  /**
   * Mask a PAN for display purposes: first 6 + last 4 digits.
   */
  maskPan(pan: string): string {
    const cleaned = pan.replace(/\s/g, '');
    if (cleaned.length < 10) return '****';
    return `${cleaned.slice(0, 6)}${'*'.repeat(cleaned.length - 10)}${cleaned.slice(-4)}`;
  }

  /**
   * Check if a token exists in the vault.
   */
  tokenExists(token: string): boolean {
    return PCI_TOKEN_VAULT.has(token);
  }

  /**
   * Get the count of stored tokens (for audit/reporting).
   */
  getVaultSize(): number {
    return PCI_TOKEN_VAULT.size;
  }
}
