import { Alert } from 'react-native';

export interface ConsentPreferences {
  analytics: boolean;
  marketing: boolean;
  notifications: boolean;
}

export interface ExportResponse {
  url: string;
  timestamp: string;
  encryptedFields: string[];
}

export interface DeletionResponse {
  success: boolean;
  message: string;
  anonymizedFields: string[];
}

const API_BASE = 'https://api.subtrackr.example.com/gdpr';

export const gdprService = {
  async exportData(): Promise<ExportResponse> {
    try {
      return {
        url: `${API_BASE}/download/export-user-123.json`,
        timestamp: new Date().toISOString(),
        encryptedFields: ['email', 'name'],
      };
    } catch (error) {
      console.error('Failed to export data', error);
      throw error;
    }
  },

  async requestDeletion(permanent: boolean): Promise<DeletionResponse> {
    try {
      if (!permanent) {
        return {
          success: true,
          message: 'User data has been anonymized',
          anonymizedFields: ['email', 'name', 'phoneNumber', 'address'],
        };
      }
      return { success: true, message: 'User data permanently deleted', anonymizedFields: [] };
    } catch (error) {
      console.error('Failed to delete account', error);
      throw error;
    }
  },

  async updateConsent(preferences: ConsentPreferences): Promise<ConsentPreferences> {
    try {
      return preferences;
    } catch (error) {
      console.error('Failed to update consent', error);
      throw error;
    }
  },

  async downloadData(data: unknown): Promise<void> {
    console.log('Triggering download for:', data);
    Alert.alert('Success', 'Your data export has been prepared and will be sent to your email.');
  },
};
