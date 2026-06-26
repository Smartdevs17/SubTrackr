export interface BenchmarkConsent {
  userId: string;
  optedIn: boolean;
  vertical: string | null;
  region: string | null;
  companySize: string | null;
  revenueBand: string | null;
  consentedAt: Date;
  expiresAt: Date;
}

const CONSENT_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

export class BenchmarkConsentService {
  private consents: Map<string, BenchmarkConsent> = new Map();

  async getConsent(userId: string): Promise<BenchmarkConsent | null> {
    const consent = this.consents.get(userId);
    if (!consent) return null;
    if (consent.expiresAt < new Date()) {
      this.consents.delete(userId);
      return null;
    }
    return consent;
  }

  async setConsent(
    userId: string,
    optedIn: boolean,
    opts?: {
      vertical?: string;
      region?: string;
      companySize?: string;
      revenueBand?: string;
    },
  ): Promise<BenchmarkConsent> {
    const consent: BenchmarkConsent = {
      userId,
      optedIn,
      vertical: opts?.vertical ?? null,
      region: opts?.region ?? null,
      companySize: opts?.companySize ?? null,
      revenueBand: opts?.revenueBand ?? null,
      consentedAt: new Date(),
      expiresAt: new Date(Date.now() + CONSENT_DURATION_MS),
    };
    this.consents.set(userId, consent);
    return consent;
  }

  async revokeConsent(userId: string): Promise<void> {
    this.consents.delete(userId);
  }

  async getOptedInUsers(): Promise<string[]> {
    const users: string[] = [];
    const now = new Date();
    for (const [userId, consent] of this.consents) {
      if (consent.optedIn && consent.expiresAt > now) {
        users.push(userId);
      }
    }
    return users;
  }

  async purgeUserData(userId: string): Promise<void> {
    this.consents.delete(userId);
  }
}
