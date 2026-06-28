import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Switch,
  Alert,
  ActivityIndicator,
  Text,
  TouchableOpacity,
} from 'react-native';
import { useRoute } from '@react-navigation/native';

async function getToken(): Promise<string> {
  // Get auth token from secure storage or context
  return 'placeholder-token';
}

interface Threshold {
  level: 50 | 75 | 90 | 100;
  enabled: boolean;
}

interface AlertConfig {
  meter_id: string;
  subscription_id: string;
  plan_limit: number;
  thresholds: Threshold[];
  channels: ('in_app' | 'email' | 'push' | 'sms')[];
}

export const UsageAlertsScreen: React.FC = () => {
  const route = useRoute();
  const subscriptionId = (route.params as any)?.subscriptionId;

  const [config, setConfig] = useState<AlertConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, [subscriptionId]);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/usage-alerts/${subscriptionId}`, {
        headers: { Authorization: `Bearer ${await getToken()}` },
      });
      const data = await response.json();
      setConfig(data);
    } catch (error) {
      Alert.alert('Error', 'Failed to load alert configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleThresholdToggle = (level: 50 | 75 | 90 | 100) => {
    if (!config) return;
    const updated = {
      ...config,
      thresholds: config.thresholds.map((t) =>
        t.level === level ? { ...t, enabled: !t.enabled } : t
      ),
    };
    setConfig(updated);
  };

  const handleChannelToggle = (channel: 'in_app' | 'email' | 'push' | 'sms') => {
    if (!config) return;
    const updated = {
      ...config,
      channels: config.channels.includes(channel)
        ? config.channels.filter((c) => c !== channel)
        : [...config.channels, channel],
    };
    setConfig(updated);
  };

  const handleSave = async () => {
    if (!config) return;
    try {
      setSaving(true);
      const response = await fetch(`/api/usage-alerts/${subscriptionId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken()}`,
        },
        body: JSON.stringify(config),
      });
      if (!response.ok) throw new Error('Failed to save');
      Alert.alert('Success', 'Alert configuration saved');
    } catch (error) {
      Alert.alert('Error', 'Failed to save alert configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  if (!config) {
    return (
      <View style={styles.container}>
        <Text>No configuration found</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Threshold Settings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Usage Thresholds</Text>
        <Text style={styles.subtitle}>
          Plan Limit: {config.plan_limit.toLocaleString()} units
        </Text>

        {[50, 75, 90, 100].map((level) => {
          const threshold = config.thresholds.find((t) => t.level === level as any);
          return (
            <View key={level} style={styles.thresholdRow}>
              <View>
                <Text style={styles.thresholdLabel}>{level}% Threshold</Text>
                <Text style={styles.thresholdDesc}>
                  Alert at {level}% of plan limit
                </Text>
              </View>
              <Switch
                value={threshold?.enabled || false}
                onValueChange={() => handleThresholdToggle(level as 50 | 75 | 90 | 100)}
                disabled={saving}
              />
            </View>
          );
        })}
      </View>

      {/* Notification Channels */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notification Channels</Text>

        {['in_app', 'email', 'push', 'sms'].map((channel) => (
          <View key={channel} style={styles.channelRow}>
            <View>
              <Text style={styles.channelLabel}>
                {channel.charAt(0).toUpperCase() + channel.slice(1)}
              </Text>
              <Text style={styles.channelDesc}>
                {channel === 'in_app' && 'In-app banner notifications'}
                {channel === 'email' && 'HTML email alerts'}
                {channel === 'push' && 'Push notifications (requires Expo permissions)'}
                {channel === 'sms' && 'SMS text messages'}
              </Text>
            </View>
            <Switch
              value={config.channels.includes(channel as any)}
              onValueChange={() => handleChannelToggle(channel as any)}
              disabled={saving}
            />
          </View>
        ))}
      </View>

      {/* Save Button */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.button, saving && styles.buttonDisabled]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Text style={styles.buttonText}>Save Settings</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 16,
  },
  section: {
    marginTop: 20,
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  thresholdRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  thresholdLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  thresholdDesc: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  channelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  channelLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  channelDesc: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  actions: {
    marginTop: 20,
    marginBottom: 40,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
