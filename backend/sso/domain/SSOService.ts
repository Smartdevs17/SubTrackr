import { createHash, randomBytes } from 'crypto';
import type {
  IdentityProvider,
  IdPCertificate,
  OIDCConfiguration,
  RoleMapping,
  SAMLConfiguration,
  SAMLMetadata,
  SSOCallbackPayload,
  SSOLoginRequest,
  SSOProtocol,
  SSOSession,
  SubTrackrRole,
} from './types';

function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function generateBypassCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

export class SSOService {
  private providers = new Map<string, IdentityProvider>();
  private sessions = new Map<string, SSOSession>();
  private pendingStates = new Map<string, { idpId: string; relayState?: string; createdAt: string }>();

  createIdentityProvider(
    organizationId: string,
    name: string,
    protocol: SSOProtocol,
  ): IdentityProvider {
    const now = new Date().toISOString();
    const idp: IdentityProvider = {
      id: generateId('idp'),
      organizationId,
      name,
      protocol,
      status: 'pending_setup',
      roleMappings: [],
      jitProvisioningEnabled: false,
      ipAllowlist: [],
      bypassCodes: [generateBypassCode(), generateBypassCode()],
      createdAt: now,
      updatedAt: now,
    };

    this.providers.set(idp.id, idp);
    return idp;
  }

  getIdentityProvider(id: string): IdentityProvider | undefined {
    return this.providers.get(id);
  }

  listIdentityProviders(organizationId: string): IdentityProvider[] {
    return Array.from(this.providers.values()).filter(
      (p) => p.organizationId === organizationId,
    );
  }

  configureSAML(idpId: string, config: SAMLConfiguration): IdentityProvider {
    const idp = this.requireProvider(idpId);
    if (idp.protocol !== 'saml2') {
      throw new Error(`Identity provider ${idpId} is not configured for SAML 2.0`);
    }

    this.validateCertificates(config.certificates);

    idp.samlConfig = config;
    idp.status = 'active';
    idp.updatedAt = new Date().toISOString();
    return idp;
  }

  configureOIDC(idpId: string, config: OIDCConfiguration): IdentityProvider {
    const idp = this.requireProvider(idpId);
    if (idp.protocol !== 'oidc') {
      throw new Error(`Identity provider ${idpId} is not configured for OIDC`);
    }

    idp.oidcConfig = config;
    idp.status = 'active';
    idp.updatedAt = new Date().toISOString();
    return idp;
  }

  uploadSAMLMetadata(idpId: string, metadataXml: string): IdentityProvider {
    const metadata = this.parseSAMLMetadata(metadataXml);
    return this.configureSAML(idpId, {
      entityId: metadata.entityId,
      ssoUrl: metadata.ssoUrl,
      sloUrl: metadata.sloUrl,
      certificates: metadata.certificates,
      nameIdFormat: metadata.nameIdFormat,
      signAuthnRequests: true,
      wantAssertionsSigned: true,
    });
  }

  configureSAMLFromUrl(idpId: string, metadataUrl: string): IdentityProvider {
    const simulatedXml = `<md:EntityDescriptor entityID="${metadataUrl}">`
      + `<md:IDPSSODescriptor><md:SingleSignOnService Location="${metadataUrl}/sso"/>`
      + `</md:IDPSSODescriptor></md:EntityDescriptor>`;
    return this.uploadSAMLMetadata(idpId, simulatedXml);
  }

  setRoleMappings(idpId: string, mappings: RoleMapping[]): IdentityProvider {
    const idp = this.requireProvider(idpId);
    idp.roleMappings = mappings;
    idp.updatedAt = new Date().toISOString();
    return idp;
  }

  setJITProvisioning(idpId: string, enabled: boolean): IdentityProvider {
    const idp = this.requireProvider(idpId);
    idp.jitProvisioningEnabled = enabled;
    idp.updatedAt = new Date().toISOString();
    return idp;
  }

  setIPAllowlist(idpId: string, ips: string[]): IdentityProvider {
    const idp = this.requireProvider(idpId);
    idp.ipAllowlist = ips;
    idp.updatedAt = new Date().toISOString();
    return idp;
  }

  regenerateBypassCodes(idpId: string): string[] {
    const idp = this.requireProvider(idpId);
    idp.bypassCodes = [generateBypassCode(), generateBypassCode()];
    idp.updatedAt = new Date().toISOString();
    return idp.bypassCodes;
  }

  validateBypassCode(idpId: string, code: string): boolean {
    const idp = this.requireProvider(idpId);
    const index = idp.bypassCodes.indexOf(code);
    if (index === -1) return false;
    idp.bypassCodes.splice(index, 1);
    return true;
  }

  deactivateProvider(idpId: string): IdentityProvider {
    const idp = this.requireProvider(idpId);
    idp.status = 'inactive';
    idp.updatedAt = new Date().toISOString();
    return idp;
  }

  initiateSSOLogin(request: SSOLoginRequest): { redirectUrl: string; state: string } {
    const idp = this.requireProvider(request.identityProviderId);
    if (idp.status !== 'active') {
      throw new Error(`Identity provider ${idp.id} is not active`);
    }

    const state = randomBytes(16).toString('hex');
    this.pendingStates.set(state, {
      idpId: idp.id,
      relayState: request.relayState,
      createdAt: new Date().toISOString(),
    });

    let redirectUrl: string;
    if (idp.protocol === 'saml2' && idp.samlConfig) {
      const params = new URLSearchParams({
        SAMLRequest: Buffer.from(`<AuthnRequest ID="${state}"/>`).toString('base64'),
        RelayState: request.relayState ?? '',
      });
      redirectUrl = `${idp.samlConfig.ssoUrl}?${params.toString()}`;
    } else if (idp.protocol === 'oidc' && idp.oidcConfig) {
      const params = new URLSearchParams({
        client_id: idp.oidcConfig.clientId,
        response_type: 'code',
        scope: idp.oidcConfig.scopes.join(' '),
        redirect_uri: 'https://app.subtrackr.io/sso/callback',
        state,
        nonce: randomBytes(16).toString('hex'),
      });
      redirectUrl = `${idp.oidcConfig.authorizationEndpoint}?${params.toString()}`;
    } else {
      throw new Error(`Identity provider ${idp.id} is not fully configured`);
    }

    return { redirectUrl, state };
  }

  handleSSOCallback(payload: SSOCallbackPayload): SSOSession {
    const stateKey = payload.state ?? this.extractStateFromSAML(payload.samlResponse);
    if (!stateKey) {
      throw new Error('Missing state in SSO callback');
    }

    const pending = this.pendingStates.get(stateKey);
    if (!pending) {
      throw new Error('Invalid or expired SSO state');
    }

    this.pendingStates.delete(stateKey);
    const idp = this.requireProvider(pending.idpId);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);

    const attributes = this.extractAttributes(idp, payload);
    const email = (attributes.email as string) ?? `user_${stateKey.slice(0, 8)}@${idp.name}.sso`;
    const nameId = (attributes.nameId as string) ?? email;

    const session: SSOSession = {
      id: generateId('sso_sess'),
      userId: this.resolveUserId(email, idp),
      identityProviderId: idp.id,
      protocol: idp.protocol,
      nameId,
      sessionIndex: stateKey,
      attributes,
      authenticatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.sessions.set(session.id, session);
    return session;
  }

  resolveRoleFromGroups(idpId: string, groups: string[]): SubTrackrRole {
    const idp = this.requireProvider(idpId);
    for (const mapping of idp.roleMappings) {
      if (groups.includes(mapping.idpGroup)) {
        return mapping.subtrackrRole;
      }
    }
    return 'viewer';
  }

  getSession(sessionId: string): SSOSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    if (new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(sessionId);
      return undefined;
    }

    return session;
  }

  revokeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  isCertificateExpiringSoon(cert: IdPCertificate, daysThreshold = 30): boolean {
    const expiryDate = new Date(cert.notAfter);
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + daysThreshold);
    return expiryDate <= warningDate;
  }

  getExpiringCertificates(idpId: string, daysThreshold = 30): IdPCertificate[] {
    const idp = this.requireProvider(idpId);
    const certs = idp.samlConfig?.certificates ?? [];
    return certs.filter((c) => this.isCertificateExpiringSoon(c, daysThreshold));
  }

  rotateCertificate(idpId: string, newCert: IdPCertificate): IdentityProvider {
    const idp = this.requireProvider(idpId);
    if (!idp.samlConfig) {
      throw new Error(`Identity provider ${idpId} has no SAML configuration`);
    }

    idp.samlConfig.certificates.forEach((c) => (c.isPrimary = false));
    newCert.isPrimary = true;
    idp.samlConfig.certificates.push(newCert);

    // Remove expired certificates (keep last 2 for grace period)
    const validCerts = idp.samlConfig.certificates
      .filter((c) => new Date(c.notAfter) > new Date())
      .slice(-3);
    idp.samlConfig.certificates = validCerts;

    idp.updatedAt = new Date().toISOString();
    return idp;
  }

  private requireProvider(idpId: string): IdentityProvider {
    const idp = this.providers.get(idpId);
    if (!idp) {
      throw new Error(`Identity provider ${idpId} not found`);
    }
    return idp;
  }

  private validateCertificates(certs: IdPCertificate[]): void {
    if (certs.length === 0) {
      throw new Error('At least one certificate is required');
    }
    const hasPrimary = certs.some((c) => c.isPrimary);
    if (!hasPrimary) {
      certs[0].isPrimary = true;
    }
  }

  private parseSAMLMetadata(xml: string): SAMLMetadata {
    const entityIdMatch = xml.match(/entityID="([^"]+)"/);
    const ssoUrlMatch = xml.match(/Location="([^"]+)"/);

    return {
      raw: xml,
      entityId: entityIdMatch?.[1] ?? 'unknown',
      ssoUrl: ssoUrlMatch?.[1] ?? 'unknown',
      certificates: [{
        fingerprint: createHash('sha256').update(xml).digest('hex'),
        notBefore: new Date().toISOString(),
        notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        isPrimary: true,
      }],
      nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    };
  }

  private extractStateFromSAML(samlResponse?: string): string | undefined {
    if (!samlResponse) return undefined;
    try {
      const decoded = Buffer.from(samlResponse, 'base64').toString('utf8');
      const idMatch = decoded.match(/InResponseTo="([^"]+)"/);
      return idMatch?.[1];
    } catch {
      return undefined;
    }
  }

  private extractAttributes(
    idp: IdentityProvider,
    payload: SSOCallbackPayload,
  ): Record<string, string | string[]> {
    const attrs: Record<string, string | string[]> = {};

    if (idp.protocol === 'saml2' && payload.samlResponse) {
      try {
        const decoded = Buffer.from(payload.samlResponse, 'base64').toString('utf8');
        const emailMatch = decoded.match(/email[^>]*>([^<]+)</);
        if (emailMatch) attrs.email = emailMatch[1];
        const nameMatch = decoded.match(/displayName[^>]*>([^<]+)</);
        if (nameMatch) attrs.displayName = nameMatch[1];
      } catch {
        // Attribute extraction failed — continue with empty attrs
      }
    }

    if (idp.protocol === 'oidc' && payload.code) {
      attrs.code = payload.code;
    }

    return attrs;
  }

  private resolveUserId(email: string, _idp: IdentityProvider): string {
    return `usr_${createHash('sha256').update(email).digest('hex').slice(0, 16)}`;
  }
}

export const ssoService = new SSOService();
