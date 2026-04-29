import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Campaign,
  CampaignType,
  CampaignStatus,
  CampaignAnalytics,
  DeliveryChannel,
  AutomationTrigger,
} from '../types/campaign';

const STORAGE_KEY = 'subtrackr-campaign';
const STORE_VERSION = 1;

interface CampaignState {
  campaigns: Campaign[];
  isLoading: boolean;
  error: string | null;

  createCampaign: (campaign: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateCampaign: (id: string, updates: Partial<Campaign>) => Promise<void>;
  deleteCampaign: (id: string) => Promise<void>;
  launchCampaign: (id: string) => Promise<void>;
  pauseCampaign: (id: string) => Promise<void>;
  getCampaignAnalytics: (id: string) => CampaignAnalytics | null;
}

const generateUniqueId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomComponent = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${randomComponent}`;
};

const initializeAnalytics = (): CampaignAnalytics => ({
  campaignId: '',
  totalRecipients: 0,
  deliveredCount: 0,
  openedCount: 0,
  clickedCount: 0,
  convertedCount: 0,
  revenue: 0,
  startDate: new Date(),
});

export const useCampaignStore = create<CampaignState>()(
  persist(
    (set, get) => ({
      campaigns: [],
      isLoading: false,
      error: null,

      createCampaign: async (campaignData) => {
        set({ isLoading: true, error: null });
        try {
          const newCampaign: Campaign = {
            ...campaignData,
            id: generateUniqueId(),
            analytics: initializeAnalytics(),
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          set((state) => ({
            campaigns: [...state.campaigns, newCampaign],
            isLoading: false,
          }));
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to create campaign',
            isLoading: false,
          });
        }
      },

      updateCampaign: async (id: string, updates: Partial<Campaign>) => {
        set((state) => ({
          campaigns: state.campaigns.map((c) =>
            c.id === id ? { ...c, ...updates, updatedAt: new Date() } : c
          ),
        }));
      },

      deleteCampaign: async (id: string) => {
        set((state) => ({
          campaigns: state.campaigns.filter((c) => c.id !== id),
        }));
      },

      launchCampaign: async (id: string) => {
        const { campaigns } = get();
        const campaign = campaigns.find((c) => c.id === id);

        if (!campaign) return;

        const now = new Date();
        const updatedAnalytics: CampaignAnalytics = {
          ...campaign.analytics!,
          campaignId: id,
          totalRecipients: Math.floor(Math.random() * 1000) + 100,
          startDate: now,
        };

        set({
          campaigns: campaigns.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: CampaignStatus.ACTIVE,
                  analytics: updatedAnalytics,
                  updatedAt: now,
                }
              : c
          ),
        });
      },

      pauseCampaign: async (id: string) => {
        const { campaigns } = get();
        const campaign = campaigns.find((c) => c.id === id);

        if (!campaign) return;

        const now = new Date();

        set({
          campaigns: campaigns.map((c) =>
            c.id === id
              ? {
                  ...c,
                  status: CampaignStatus.PAUSED,
                  analytics: {
                    ...c.analytics!,
                    endDate: now,
                  },
                  updatedAt: now,
                }
              : c
          ),
        });
      },

      getCampaignAnalytics: (id: string) => {
        const { campaigns } = get();
        const campaign = campaigns.find((c) => c.id === id);
        return campaign?.analytics || null;
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ campaigns: state.campaigns }),
    }
  )
);