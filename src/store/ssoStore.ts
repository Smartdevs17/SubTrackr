import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { asyncStorageAdapter } from '../utils/storage';
import type {
  IdentityProvider,
  RoleMapping,
  SCIMUser,
  SSOProtocol,
  SubTrackrRole,
} from '../types/sso';

const STORAGE_KEY = 'subtrackr-sso-settings';

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

interface SSOState {
  providers: IdentityProvider[];
  scimUsers: SCIMUser[];
  isLoading: boolean;
  error: string | null;

  addProvider: (organizationId: string, name: string, protocol: SSOProtocol) => IdentityProvider;
  removeProvider: (id: string) => void;
  activateProvider: (id: string) => void;
  deactivateProvider: (id: string) => void;
  setRoleMappings: (id: string, mappings: RoleMapping[]) => void;
  toggleJIT: (id: string) => void;
  uploadMetadata: (id: string, metadataXml: string) => void;
  setIPAllowlist: (id: string, ips: string[]) => void;

  addSCIMUser: (user: Omit<SCIMUser, 'id' | 'provisionedAt' | 'lastSyncedAt'>) => SCIMUser;
  deactivateSCIMUser: (userId: string) => void;
  updateSCIMUserRole: (userId: string, role: SubTrackrRole) => void;
  removeSCIMUser: (userId: string) => void;

  clearError: () => void;
}

export const useSSOStore = create<SSOState>()(
  persist(
    (set, get) => ({
      providers: [],
      scimUsers: [],
      isLoading: false,
      error: null,

      addProvider: (organizationId, name, protocol) => {
        const now = new Date().toISOString();
        const provider: IdentityProvider = {
          id: generateId('idp'),
          organizationId,
          name,
          protocol,
          status: 'pending_setup',
          roleMappings: [],
          jitProvisioningEnabled: false,
          ipAllowlist: [],
          bypassCodeCount: 2,
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({ providers: [...state.providers, provider] }));
        return provider;
      },

      removeProvider: (id) => {
        set((state) => ({
          providers: state.providers.filter((p) => p.id !== id),
          scimUsers: state.scimUsers.filter((u) => u.id !== id),
        }));
      },

      activateProvider: (id) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, status: 'active' as const, updatedAt: new Date().toISOString() } : p,
          ),
        }));
      },

      deactivateProvider: (id) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, status: 'inactive' as const, updatedAt: new Date().toISOString() } : p,
          ),
        }));
      },

      setRoleMappings: (id, mappings) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, roleMappings: mappings, updatedAt: new Date().toISOString() } : p,
          ),
        }));
      },

      toggleJIT: (id) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id
              ? { ...p, jitProvisioningEnabled: !p.jitProvisioningEnabled, updatedAt: new Date().toISOString() }
              : p,
          ),
        }));
      },

      uploadMetadata: (id, metadataXml) => {
        const entityIdMatch = metadataXml.match(/entityID="([^"]+)"/);
        const ssoUrlMatch = metadataXml.match(/Location="([^"]+)"/);

        if (!entityIdMatch || !ssoUrlMatch) {
          set({ error: 'Invalid SAML metadata XML' });
          return;
        }

        set((state) => ({
          providers: state.providers.map((p) => {
            if (p.id !== id) return p;
            return {
              ...p,
              status: 'active' as const,
              samlConfig: {
                entityId: entityIdMatch[1],
                ssoUrl: ssoUrlMatch[1],
                certificates: [{
                  fingerprint: `cert_${Date.now().toString(36)}`,
                  notBefore: new Date().toISOString(),
                  notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
                  isPrimary: true,
                }],
                nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
                signAuthnRequests: true,
                wantAssertionsSigned: true,
              },
              updatedAt: new Date().toISOString(),
            };
          }),
          error: null,
        }));
      },

      setIPAllowlist: (id, ips) => {
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, ipAllowlist: ips, updatedAt: new Date().toISOString() } : p,
          ),
        }));
      },

      addSCIMUser: (userData) => {
        const now = new Date().toISOString();
        const user: SCIMUser = {
          ...userData,
          id: generateId('scim_user'),
          provisionedAt: now,
          lastSyncedAt: now,
        };

        set((state) => ({ scimUsers: [...state.scimUsers, user] }));
        return user;
      },

      deactivateSCIMUser: (userId) => {
        set((state) => ({
          scimUsers: state.scimUsers.map((u) =>
            u.id === userId ? { ...u, status: 'deactivated' as const, lastSyncedAt: new Date().toISOString() } : u,
          ),
        }));
      },

      updateSCIMUserRole: (userId, role) => {
        set((state) => ({
          scimUsers: state.scimUsers.map((u) =>
            u.id === userId ? { ...u, role, lastSyncedAt: new Date().toISOString() } : u,
          ),
        }));
      },

      removeSCIMUser: (userId) => {
        set((state) => ({
          scimUsers: state.scimUsers.filter((u) => u.id !== userId),
        }));
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorageAdapter),
      partialize: (state) => ({
        providers: state.providers,
        scimUsers: state.scimUsers,
      }),
    },
  ),
);
