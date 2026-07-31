export type SSOProtocol = 'saml2' | 'oidc';
export type IdPStatus = 'active' | 'inactive' | 'pending_setup';
export type SubTrackrRole = 'admin' | 'viewer' | 'billing';

export interface RoleMapping {
  idpGroup: string;
  subtrackrRole: SubTrackrRole;
}

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
  scopes: string[];
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
  bypassCodeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SCIMUser {
  id: string;
  externalId: string;
  email: string;
  displayName: string;
  role: SubTrackrRole;
  status: 'active' | 'suspended' | 'deactivated';
  groups: string[];
  provisionedAt: string;
  lastSyncedAt: string;
}

export interface SSOSession {
  id: string;
  userId: string;
  identityProviderId: string;
  protocol: SSOProtocol;
  authenticatedAt: string;
  expiresAt: string;
}

export const SSO_PROVIDER_PRESETS = [
  { id: 'okta', name: 'Okta', protocol: 'saml2' as SSOProtocol },
  { id: 'azure', name: 'Azure AD', protocol: 'oidc' as SSOProtocol },
  { id: 'onelogin', name: 'OneLogin', protocol: 'saml2' as SSOProtocol },
  { id: 'keycloak', name: 'Keycloak', protocol: 'oidc' as SSOProtocol },
] as const;

export const AVAILABLE_ROLES: SubTrackrRole[] = ['admin', 'viewer', 'billing'];
