import { createHash } from 'crypto';

export interface AnonymizationStrategy {
  apply(value: string, salt?: string): string;
}

/**
 * MaskStrategy: replaces characters after the first with `*`.
 * Email: j***@example.com  |  Other: first char + `***`
 */
export class MaskStrategy implements AnonymizationStrategy {
  apply(value: string): string {
    if (!value) return value;
    const atIndex = value.indexOf('@');
    if (atIndex > 0) {
      const local = value.slice(0, atIndex);
      const domain = value.slice(atIndex);
      return local[0] + '*'.repeat(Math.max(local.length - 1, 3)) + domain;
    }
    return value[0] + '*'.repeat(Math.max(value.length - 1, 3));
  }
}

/**
 * HashStrategy: SHA-256 of (value + salt), returns hex digest.
 * Irreversible when salt is per-export and discarded.
 */
export class HashStrategy implements AnonymizationStrategy {
  apply(value: string, salt: string = ''): string {
    return createHash('sha256')
      .update(value + salt)
      .digest('hex');
  }
}

/**
 * TruncateStrategy: removes the last octet(s) from IP addresses.
 * 192.168.1.100 → 192.168.1.*
 */
export class TruncateStrategy implements AnonymizationStrategy {
  apply(value: string): string {
    if (!value) return value;
    // IPv4
    const ipv4 = value.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
    if (ipv4) return ipv4[1] + '.*';
    // IPv6: zero last group
    const ipv6 = value.match(/^((?:[0-9a-fA-F:]+:))[0-9a-fA-F]+$/);
    if (ipv6) return ipv6[1] + '0';
    // Generic: drop last segment after the last delimiter
    const lastDot = value.lastIndexOf('.');
    if (lastDot > 0) return value.slice(0, lastDot) + '.*';
    return value.slice(0, Math.ceil(value.length / 2)) + '***';
  }
}

/**
 * PerturbStrategy: shifts date values by a random offset in [-3, +3] days.
 * The offset is deterministically seeded from (value + salt) so the same
 * input always produces the same perturbed output within a single export.
 */
export class PerturbStrategy implements AnonymizationStrategy {
  private readonly maxDays: number;

  constructor(maxDays = 3) {
    this.maxDays = maxDays;
  }

  apply(value: string, salt: string = ''): string {
    if (!value) return value;
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;

    // Deterministic offset: hash → 0..1 → scale to [-maxDays, +maxDays]
    const hashHex = createHash('sha256').update(value + salt).digest('hex');
    const fraction = parseInt(hashHex.slice(0, 8), 16) / 0xffffffff;
    const offsetDays = Math.round((fraction * 2 - 1) * this.maxDays);

    date.setDate(date.getDate() + offsetDays);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD
  }
}
