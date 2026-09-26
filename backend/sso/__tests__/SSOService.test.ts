import { SSOService } from '../domain/SSOService';
import type { IdPCertificate, SAMLConfiguration } from '../domain/types';

function makeCert(overrides: Partial<IdPCertificate> = {}): IdPCertificate {
  return {
    fingerprint: 'abc123',
    notBefore: new Date().toISOString(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    isPrimary: true,
    ...overrides,
  };
}

function makeSAMLConfig(overrides: Partial<SAMLConfiguration> = {}): SAMLConfiguration {
  return {
    entityId: 'https://idp.example.com',
    ssoUrl: 'https://idp.example.com/sso',
    certificates: [makeCert()],
    nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    signAuthnRequests: true,
    wantAssertionsSigned: true,
    ...overrides,
  };
}

describe('SSOService', () => {
  let service: SSOService;

  beforeEach(() => {
    service = new SSOService();
  });

  describe('Identity Provider Management', () => {
    it('creates a SAML identity provider', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      expect(idp.id).toMatch(/^idp_/);
      expect(idp.organizationId).toBe('org_1');
      expect(idp.name).toBe('Okta');
      expect(idp.protocol).toBe('saml2');
      expect(idp.status).toBe('pending_setup');
      expect(idp.bypassCodes).toHaveLength(2);
    });

    it('creates an OIDC identity provider', () => {
      const idp = service.createIdentityProvider('org_1', 'Azure AD', 'oidc');
      expect(idp.protocol).toBe('oidc');
      expect(idp.status).toBe('pending_setup');
    });

    it('lists providers by organization', () => {
      service.createIdentityProvider('org_1', 'Okta', 'saml2');
      service.createIdentityProvider('org_1', 'Azure AD', 'oidc');
      service.createIdentityProvider('org_2', 'OneLogin', 'saml2');

      const org1Providers = service.listIdentityProviders('org_1');
      expect(org1Providers).toHaveLength(2);

      const org2Providers = service.listIdentityProviders('org_2');
      expect(org2Providers).toHaveLength(1);
    });

    it('retrieves a provider by ID', () => {
      const created = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      const fetched = service.getIdentityProvider(created.id);
      expect(fetched).toBeDefined();
      expect(fetched!.name).toBe('Okta');
    });

    it('returns undefined for unknown provider', () => {
      expect(service.getIdentityProvider('nonexistent')).toBeUndefined();
    });
  });

  describe('SAML Configuration', () => {
    it('configures SAML and activates provider', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      const config = makeSAMLConfig();

      const updated = service.configureSAML(idp.id, config);
      expect(updated.status).toBe('active');
      expect(updated.samlConfig).toBeDefined();
      expect(updated.samlConfig!.entityId).toBe('https://idp.example.com');
    });

    it('rejects SAML config on OIDC provider', () => {
      const idp = service.createIdentityProvider('org_1', 'Azure', 'oidc');
      expect(() => service.configureSAML(idp.id, makeSAMLConfig())).toThrow(
        'not configured for SAML 2.0',
      );
    });

    it('rejects empty certificates', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      expect(() =>
        service.configureSAML(idp.id, makeSAMLConfig({ certificates: [] })),
      ).toThrow('At least one certificate is required');
    });

    it('uploads SAML metadata XML', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      const xml =
        '<md:EntityDescriptor entityID="https://okta.example.com">' +
        '<md:IDPSSODescriptor><md:SingleSignOnService Location="https://okta.example.com/sso"/>' +
        '</md:IDPSSODescriptor></md:EntityDescriptor>';

      const updated = service.uploadSAMLMetadata(idp.id, xml);
      expect(updated.status).toBe('active');
      expect(updated.samlConfig!.entityId).toBe('https://okta.example.com');
    });
  });

  describe('OIDC Configuration', () => {
    it('configures OIDC and activates provider', () => {
      const idp = service.createIdentityProvider('org_1', 'Azure AD', 'oidc');
      const updated = service.configureOIDC(idp.id, {
        issuer: 'https://login.microsoftonline.com/tenant',
        authorizationEndpoint: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize',
        tokenEndpoint: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
        userinfoEndpoint: 'https://graph.microsoft.com/oidc/userinfo',
        jwksUri: 'https://login.microsoftonline.com/tenant/discovery/v2.0/keys',
        clientId: 'client_123',
        clientSecretHash: 'hashed_secret',
        scopes: ['openid', 'profile', 'email'],
      });

      expect(updated.status).toBe('active');
      expect(updated.oidcConfig).toBeDefined();
    });

    it('rejects OIDC config on SAML provider', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      expect(() =>
        service.configureOIDC(idp.id, {
          issuer: 'https://example.com',
          authorizationEndpoint: 'https://example.com/auth',
          tokenEndpoint: 'https://example.com/token',
          userinfoEndpoint: 'https://example.com/userinfo',
          jwksUri: 'https://example.com/jwks',
          clientId: 'client',
          clientSecretHash: 'hash',
          scopes: ['openid'],
        }),
      ).toThrow('not configured for OIDC');
    });
  });

  describe('Role Mapping', () => {
    it('sets role mappings', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      const updated = service.setRoleMappings(idp.id, [
        { idpGroup: 'admins', subtrackrRole: 'admin' },
        { idpGroup: 'finance', subtrackrRole: 'billing' },
      ]);
      expect(updated.roleMappings).toHaveLength(2);
    });

    it('resolves role from groups', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      service.setRoleMappings(idp.id, [
        { idpGroup: 'admins', subtrackrRole: 'admin' },
        { idpGroup: 'finance', subtrackrRole: 'billing' },
      ]);

      expect(service.resolveRoleFromGroups(idp.id, ['admins'])).toBe('admin');
      expect(service.resolveRoleFromGroups(idp.id, ['finance'])).toBe('billing');
      expect(service.resolveRoleFromGroups(idp.id, ['unknown'])).toBe('viewer');
    });
  });

  describe('JIT Provisioning', () => {
    it('enables/disables JIT provisioning', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      expect(idp.jitProvisioningEnabled).toBe(false);

      const enabled = service.setJITProvisioning(idp.id, true);
      expect(enabled.jitProvisioningEnabled).toBe(true);

      const disabled = service.setJITProvisioning(idp.id, false);
      expect(disabled.jitProvisioningEnabled).toBe(false);
    });
  });

  describe('SSO Login Flow', () => {
    it('initiates SAML login', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      service.configureSAML(idp.id, makeSAMLConfig());

      const { redirectUrl, state } = service.initiateSSOLogin({
        identityProviderId: idp.id,
      });

      expect(redirectUrl).toContain('https://idp.example.com/sso');
      expect(redirectUrl).toContain('SAMLRequest=');
      expect(state).toBeTruthy();
    });

    it('initiates OIDC login', () => {
      const idp = service.createIdentityProvider('org_1', 'Azure AD', 'oidc');
      service.configureOIDC(idp.id, {
        issuer: 'https://login.microsoftonline.com/tenant',
        authorizationEndpoint: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize',
        tokenEndpoint: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
        userinfoEndpoint: 'https://graph.microsoft.com/oidc/userinfo',
        jwksUri: 'https://login.microsoftonline.com/tenant/discovery/v2.0/keys',
        clientId: 'client_123',
        clientSecretHash: 'hashed_secret',
        scopes: ['openid', 'profile', 'email'],
      });

      const { redirectUrl, state } = service.initiateSSOLogin({
        identityProviderId: idp.id,
      });

      expect(redirectUrl).toContain('authorize');
      expect(redirectUrl).toContain('client_id=client_123');
      expect(state).toBeTruthy();
    });

    it('rejects login for inactive provider', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      expect(() => service.initiateSSOLogin({ identityProviderId: idp.id })).toThrow(
        'is not active',
      );
    });

    it('handles SSO callback and creates session', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      service.configureSAML(idp.id, makeSAMLConfig());

      const { state } = service.initiateSSOLogin({ identityProviderId: idp.id });
      const session = service.handleSSOCallback({ state });

      expect(session.id).toMatch(/^sso_sess_/);
      expect(session.identityProviderId).toBe(idp.id);
      expect(session.protocol).toBe('saml2');
      expect(session.authenticatedAt).toBeTruthy();
      expect(session.expiresAt).toBeTruthy();
    });
  });

  describe('Session Management', () => {
    it('retrieves and validates sessions', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      service.configureSAML(idp.id, makeSAMLConfig());
      const { state } = service.initiateSSOLogin({ identityProviderId: idp.id });
      const session = service.handleSSOCallback({ state });

      const fetched = service.getSession(session.id);
      expect(fetched).toBeDefined();
      expect(fetched!.id).toBe(session.id);
    });

    it('returns undefined for expired session', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      service.configureSAML(idp.id, makeSAMLConfig());
      const { state } = service.initiateSSOLogin({ identityProviderId: idp.id });
      const session = service.handleSSOCallback({ state });

      // Manually expire the session
      const stored = service.getSession(session.id)!;
      (stored as any).expiresAt = new Date(Date.now() - 1000).toISOString();

      expect(service.getSession(session.id)).toBeUndefined();
    });

    it('revokes sessions', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      service.configureSAML(idp.id, makeSAMLConfig());
      const { state } = service.initiateSSOLogin({ identityProviderId: idp.id });
      const session = service.handleSSOCallback({ state });

      service.revokeSession(session.id);
      expect(service.getSession(session.id)).toBeUndefined();
    });
  });

  describe('Certificate Management', () => {
    it('detects expiring certificates', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      const expiringCert = makeCert({
        notAfter: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      });
      service.configureSAML(idp.id, makeSAMLConfig({ certificates: [expiringCert] }));

      const expiring = service.getExpiringCertificates(idp.id, 30);
      expect(expiring).toHaveLength(1);
    });

    it('does not flag non-expiring certificates', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      service.configureSAML(idp.id, makeSAMLConfig());

      const expiring = service.getExpiringCertificates(idp.id, 30);
      expect(expiring).toHaveLength(0);
    });

    it('rotates certificates', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      service.configureSAML(idp.id, makeSAMLConfig());

      const newCert = makeCert({ fingerprint: 'new_cert_123' });
      const updated = service.rotateCertificate(idp.id, newCert);

      expect(updated.samlConfig!.certificates.find((c) => c.fingerprint === 'new_cert_123')).toBeDefined();
      expect(updated.samlConfig!.certificates.find((c) => c.isPrimary)?.fingerprint).toBe('new_cert_123');
    });
  });

  describe('Bypass Codes', () => {
    it('validates and consumes bypass codes', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      const code = idp.bypassCodes[0];

      expect(service.validateBypassCode(idp.id, code)).toBe(true);
      expect(service.validateBypassCode(idp.id, code)).toBe(false);
    });

    it('regenerates bypass codes', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      const originalCodes = [...idp.bypassCodes];

      const newCodes = service.regenerateBypassCodes(idp.id);
      expect(newCodes).toHaveLength(2);
      expect(newCodes).not.toEqual(originalCodes);
    });

    it('rejects invalid bypass code', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      expect(service.validateBypassCode(idp.id, 'INVALID')).toBe(false);
    });
  });

  describe('Provider Deactivation', () => {
    it('deactivates an active provider', () => {
      const idp = service.createIdentityProvider('org_1', 'Okta', 'saml2');
      service.configureSAML(idp.id, makeSAMLConfig());

      const deactivated = service.deactivateProvider(idp.id);
      expect(deactivated.status).toBe('inactive');
    });
  });
});
