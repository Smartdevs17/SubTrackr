export interface ApiKeyRecord {
  id: string;
  merchantId: string;
  keyPrefix: string;
  keyHash: string;
  status: 'active' | 'expired' | 'revoked';
  rotatedAt: string | null;
  expiresAt: string | null;
  gracePeriodEndsAt: string | null;
  createdAt: string;
}

export interface ApiKeyRotationPolicy {
  intervalDays: 30 | 60 | 90;
  gracePeriodHours: number;
}

export interface IApiKeyRotationService {
  rotateKey(keyId: string): Promise<ApiKeyRecord>;
  forceRotateKey(keyId: string): Promise<ApiKeyRecord>;
  getRotationHistory(keyId: string): Promise<ApiKeyRecord[]>;
  getPolicy(merchantId: string): Promise<ApiKeyRotationPolicy>;
  updatePolicy(merchantId: string, policy: Partial<ApiKeyRotationPolicy>): Promise<ApiKeyRotationPolicy>;
}
