import { SSOService } from '../domain/SSOService';
import { SCIMService } from '../domain/SCIMService';
import type {
  IdentityProvider,
  OIDCConfiguration,
  RoleMapping,
  SAMLConfiguration,
  SCIMPatchRequest,
  SCIMUser,
  SSOCallbackPayload,
  SSOProtocol,
  SSOSession,
  SubTrackrRole,
} from '../domain/types';

interface ControllerResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}

export function createSSOController(deps: {
  ssoService: SSOService;
  scimService: SCIMService;
}) {
  const { ssoService, scimService } = deps;

  return {
    createIdentityProvider(body: {
      organizationId: string;
      name: string;
      protocol: SSOProtocol;
    }): ControllerResult<IdentityProvider> {
      try {
        if (!body.organizationId || !body.name || !body.protocol) {
          return { success: false, error: 'Missing required fields', status: 400 };
        }
        if (body.protocol !== 'saml2' && body.protocol !== 'oidc') {
          return { success: false, error: 'Protocol must be saml2 or oidc', status: 400 };
        }
        const idp = ssoService.createIdentityProvider(body.organizationId, body.name, body.protocol);
        return { success: true, data: idp };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 500 };
      }
    },

    getIdentityProvider(id: string): ControllerResult<IdentityProvider> {
      const idp = ssoService.getIdentityProvider(id);
      if (!idp) return { success: false, error: 'Identity provider not found', status: 404 };
      return { success: true, data: idp };
    },

    listIdentityProviders(organizationId: string): ControllerResult<IdentityProvider[]> {
      const providers = ssoService.listIdentityProviders(organizationId);
      return { success: true, data: providers };
    },

    configureSAML(idpId: string, config: SAMLConfiguration): ControllerResult<IdentityProvider> {
      try {
        const idp = ssoService.configureSAML(idpId, config);
        return { success: true, data: idp };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    configureOIDC(idpId: string, config: OIDCConfiguration): ControllerResult<IdentityProvider> {
      try {
        const idp = ssoService.configureOIDC(idpId, config);
        return { success: true, data: idp };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    uploadSAMLMetadata(idpId: string, metadataXml: string): ControllerResult<IdentityProvider> {
      try {
        if (!metadataXml || metadataXml.trim().length === 0) {
          return { success: false, error: 'Metadata XML is required', status: 400 };
        }
        const idp = ssoService.uploadSAMLMetadata(idpId, metadataXml);
        return { success: true, data: idp };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    configureSAMLFromUrl(idpId: string, metadataUrl: string): ControllerResult<IdentityProvider> {
      try {
        if (!metadataUrl) {
          return { success: false, error: 'Metadata URL is required', status: 400 };
        }
        const idp = ssoService.configureSAMLFromUrl(idpId, metadataUrl);
        return { success: true, data: idp };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    setRoleMappings(idpId: string, mappings: RoleMapping[]): ControllerResult<IdentityProvider> {
      try {
        const idp = ssoService.setRoleMappings(idpId, mappings);
        return { success: true, data: idp };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    setJITProvisioning(idpId: string, enabled: boolean): ControllerResult<IdentityProvider> {
      try {
        const idp = ssoService.setJITProvisioning(idpId, enabled);
        return { success: true, data: idp };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    initiateSSOLogin(body: { identityProviderId: string; relayState?: string }): ControllerResult<{ redirectUrl: string; state: string }> {
      try {
        if (!body.identityProviderId) {
          return { success: false, error: 'identityProviderId is required', status: 400 };
        }
        const result = ssoService.initiateSSOLogin(body);
        return { success: true, data: result };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    handleSSOCallback(payload: SSOCallbackPayload): ControllerResult<SSOSession> {
      try {
        const session = ssoService.handleSSOCallback(payload);
        return { success: true, data: session };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 401 };
      }
    },

    deactivateProvider(idpId: string): ControllerResult<IdentityProvider> {
      try {
        const idp = ssoService.deactivateProvider(idpId);
        return { success: true, data: idp };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    regenerateBypassCodes(idpId: string): ControllerResult<string[]> {
      try {
        const codes = ssoService.regenerateBypassCodes(idpId);
        return { success: true, data: codes };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    validateBypassCode(idpId: string, code: string): ControllerResult<{ valid: boolean }> {
      try {
        const valid = ssoService.validateBypassCode(idpId, code);
        return { success: true, data: { valid } };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    getExpiringCertificates(idpId: string, daysThreshold?: number): ControllerResult {
      try {
        const certs = ssoService.getExpiringCertificates(idpId, daysThreshold);
        return { success: true, data: certs };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    // SCIM endpoints

    scimCreateUser(organizationId: string, identityProviderId: string, body: {
      externalId: string;
      email: string;
      displayName: string;
      givenName: string;
      familyName: string;
      groups?: string[];
    }): ControllerResult<SCIMUser> {
      try {
        const idp = ssoService.getIdentityProvider(identityProviderId);
        if (!idp) return { success: false, error: 'Identity provider not found', status: 404 };

        const user = scimService.createUser(
          organizationId,
          identityProviderId,
          body.externalId,
          body.email,
          body.displayName,
          body.givenName,
          body.familyName,
          body.groups ?? [],
          idp.roleMappings,
        );
        return { success: true, data: user };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    scimGetUser(userId: string): ControllerResult<SCIMUser> {
      const user = scimService.getUser(userId);
      if (!user) return { success: false, error: 'SCIM user not found', status: 404 };
      return { success: true, data: user };
    },

    scimListUsers(organizationId: string, query: {
      startIndex?: number;
      count?: number;
      filter?: string;
    }): ControllerResult {
      const result = scimService.listUsers(
        organizationId,
        query.startIndex,
        query.count,
        query.filter,
      );
      return { success: true, data: result };
    },

    scimUpdateUser(userId: string, identityProviderId: string, body: {
      email?: string;
      displayName?: string;
      givenName?: string;
      familyName?: string;
      groups?: string[];
    }): ControllerResult<SCIMUser> {
      try {
        const idp = ssoService.getIdentityProvider(identityProviderId);
        if (!idp) return { success: false, error: 'Identity provider not found', status: 404 };

        const user = scimService.updateUser(userId, body, idp.roleMappings);
        return { success: true, data: user };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    scimPatchUser(userId: string, identityProviderId: string, patch: SCIMPatchRequest): ControllerResult<SCIMUser> {
      try {
        const idp = ssoService.getIdentityProvider(identityProviderId);
        if (!idp) return { success: false, error: 'Identity provider not found', status: 404 };

        const user = scimService.patchUser(userId, patch.Operations, idp.roleMappings);
        return { success: true, data: user };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    scimDeactivateUser(userId: string): ControllerResult<SCIMUser> {
      try {
        const user = scimService.deactivateUser(userId);
        return { success: true, data: user };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    scimDeleteUser(userId: string): ControllerResult {
      try {
        scimService.deleteUser(userId);
        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },

    jitProvision(organizationId: string, identityProviderId: string, body: {
      email: string;
      displayName: string;
      groups?: string[];
    }): ControllerResult<SCIMUser> {
      try {
        const idp = ssoService.getIdentityProvider(identityProviderId);
        if (!idp) return { success: false, error: 'Identity provider not found', status: 404 };
        if (!idp.jitProvisioningEnabled) {
          return { success: false, error: 'JIT provisioning is not enabled', status: 403 };
        }

        const user = scimService.jitProvision(
          organizationId,
          identityProviderId,
          body.email,
          body.displayName,
          body.groups ?? [],
          idp.roleMappings,
        );
        return { success: true, data: user };
      } catch (err) {
        return { success: false, error: (err as Error).message, status: 400 };
      }
    },
  };
}
