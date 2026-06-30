export type SSOProtocol = 'saml2' | 'oidc';
export type IdPStatus = 'active' | 'inactive' | 'pending_setup';
export type SCIMUserStatus = 'active' | 'suspended' | 'deactivated';
export type SubTrackrRole = 'admin' | 'viewer' | 'billing';

export interface IdPCertificate {
  fingerprint: string;
  notBefore: string;
  notAfter: string;
  isPrimary: boolean;
}

export interface SAMLConfiguration {
  entityId: string;
  ssoUrl: string;
  sloUrl?: string;
  certificates: IdPCertificate[];
  nameIdFormat: string;
  signAuthnRequests: boolean;
  wantAssertionsSigned: boolean;
}

export interface OIDCConfiguration {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  jwksUri: string;
  clientId: string;
  clientSecretHash: string;
  scopes: string[];
}

export interface RoleMapping {
  idpGroup: string;
  subtrackrRole: SubTrackrRole;
}

export interface IdentityProvider {
  id: string;
  organizationId: string;
  name: string;
  protocol: SSOProtocol;
  status: IdPStatus;
  samlConfig?: SAMLConfiguration;
  oidcConfig?: OIDCConfiguration;
  roleMappings: RoleMapping[];
  jitProvisioningEnabled: boolean;
  ipAllowlist: string[];
  bypassCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SCIMUser {
  id: string;
  externalId: string;
  organizationId: string;
  identityProviderId: string;
  email: string;
  displayName: string;
  givenName: string;
  familyName: string;
  role: SubTrackrRole;
  status: SCIMUserStatus;
  groups: string[];
  provisionedAt: string;
  lastSyncedAt: string;
  deactivatedAt?: string;
}

export interface SSOSession {
  id: string;
  userId: string;
  identityProviderId: string;
  protocol: SSOProtocol;
  nameId: string;
  sessionIndex?: string;
  attributes: Record<string, string | string[]>;
  authenticatedAt: string;
  expiresAt: string;
}

export interface SSOLoginRequest {
  identityProviderId: string;
  relayState?: string;
}

export interface SSOCallbackPayload {
  samlResponse?: string;
  code?: string;
  state?: string;
  relayState?: string;
}

export interface SAMLMetadata {
  raw: string;
  entityId: string;
  ssoUrl: string;
  sloUrl?: string;
  certificates: IdPCertificate[];
  nameIdFormat: string;
}

export interface SCIMListResponse<T> {
  schemas: string[];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface SCIMPatchOperation {
  op: 'add' | 'replace' | 'remove';
  path?: string;
  value?: unknown;
}

export interface SCIMPatchRequest {
  schemas: string[];
  Operations: SCIMPatchOperation[];
}
