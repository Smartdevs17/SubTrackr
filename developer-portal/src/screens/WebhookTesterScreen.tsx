import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  Alert,
  Switch,
} from 'react-native';

const EVENT_TYPES = [
  { value: 'subscription.created', label: 'Subscription Created', icon: '➕' },
  { value: 'subscription.updated', label: 'Subscription Updated', icon: '✏️' },
  { value: 'subscription.cancelled', label: 'Subscription Cancelled', icon: '❌' },
  { value: 'payment.succeeded', label: 'Payment Succeeded', icon: '✅' },
  { value: 'payment.failed', label: 'Payment Failed', icon: '⚠️' },
  { value: 'invoice.created', label: 'Invoice Created', icon: '📄' },
  { value: 'invoice.paid', label: 'Invoice Paid', icon: '💰' },
];

const WebhookTesterScreen: React.FC = () => {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState('');
  const [testPayload, setTestPayload] = useState(
    JSON.stringify(
      {
        id: 'evt_123',
        type: 'subscription.created',
        timestamp: new Date().toISOString(),
        data: {
          subscriptionId: 'sub_123',
          name: 'Netflix',
          price: 15.99,
          currency: 'USD',
          billingCycle: 'monthly',
        },
      },
      null,
      2
    )
  );
  const [includeSignature, setIncludeSignature] = useState(true);
  const [testResults, setTestResults] = useState<any>(null);

  const toggleEvent = (eventType: string) => {
    if (selectedEvents.includes(eventType)) {
      setSelectedEvents(selectedEvents.filter((e) => e !== eventType));
    } else {
      setSelectedEvents([...selectedEvents, eventType]);
    }
  };

  const handleTestWebhook = async () => {
    if (!webhookUrl.trim()) {
      Alert.alert('Error', 'Please enter a webhook URL');
      return;
    }

    try {
      // Simulate webhook test
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setTestResults({
        success: true,
        statusCode: 200,
        responseTime: Math.floor(Math.random() * 500) + 100,
        timestamp: new Date().toISOString(),
        headers: {
          'Content-Type': 'application/json',
          'X-SubTrackr-Signature': includeSignature ? 'sha256=abc123...' : undefined,
        },
      });

      Alert.alert('Success', 'Webhook test completed successfully');
    } catch (error) {
      setTestResults({
        success: false,
        error: 'Failed to deliver webhook',
      });
      Alert.alert('Error', 'Webhook test failed');
    }
  };

  const generateSecret = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = 'whsec_';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setSecret(result);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Webhook Tester</Text>
          <Text style={styles.subtitle}>Test webhook delivery and configuration</Text>
        </View>

        {/* Webhook URL */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Webhook URL</Text>
          <TextInput
            style={styles.input}
            value={webhookUrl}
            onChangeText={setWebhookUrl}
            placeholder="https://your-domain.com/webhooks/subtrackr"
            placeholderTextColor="#999"
            autoCapitalize="none"
            keyboardType="url"
          />
          <Text style={styles.hint}>Enter the URL where you want to receive webhook events</Text>
        </View>

        {/* Event Types */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Event Types</Text>
          <Text style={styles.sectionSubtitle}>Select events to subscribe to</Text>
          {EVENT_TYPES.map((event) => (
            <TouchableOpacity
              key={event.value}
              style={[
                styles.eventCard,
                selectedEvents.includes(event.value) && styles.eventCardSelected,
              ]}
              onPress={() => toggleEvent(event.value)}>
              <Text style={styles.eventIcon}>{event.icon}</Text>
              <View style={styles.eventInfo}>
                <Text
                  style={[
                    styles.eventLabel,
                    selectedEvents.includes(event.value) && styles.eventLabelSelected,
                  ]}>
                  {event.label}
                </Text>
                <Text style={styles.eventValue}>{event.value}</Text>
              </View>
              <View
                style={[
                  styles.checkbox,
                  selectedEvents.includes(event.value) && styles.checkboxSelected,
                ]}>
                {selectedEvents.includes(event.value) && <Text style={styles.checkmark}>✓</Text>}
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Webhook Secret */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Webhook Secret</Text>
          <View style={styles.secretRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={secret}
              onChangeText={setSecret}
              placeholder="whsec_..."
              placeholderTextColor="#999"
              secureTextEntry
            />
            <TouchableOpacity style={styles.generateButton} onPress={generateSecret}>
              <Text style={styles.generateButtonText}>Generate</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Use this secret to verify webhook signatures</Text>
        </View>

        {/* Signature Option */}
        <View style={styles.section}>
          <View style={styles.switchRow}>
            <View style={styles.switchInfo}>
              <Text style={styles.switchLabel}>Include Signature</Text>
              <Text style={styles.switchHint}>
                Add X-SubTrackr-Signature header for verification
              </Text>
            </View>
            <Switch value={includeSignature} onValueChange={setIncludeSignature} />
          </View>
        </View>

        {/* Test Payload */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Test Payload</Text>
          <TextInput
            style={styles.codeInput}
            value={testPayload}
            onChangeText={setTestPayload}
            multiline
            placeholder="{}"
            placeholderTextColor="#999"
          />
        </View>

        {/* Test Button */}
        <TouchableOpacity
          style={styles.testButton}
          onPress={handleTestWebhook}
          disabled={!webhookUrl.trim()}>
          <Text style={styles.testButtonText}>Send Test Webhook</Text>
        </TouchableOpacity>

        {/* Test Results */}
        {testResults && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Test Results</Text>
            <View
              style={[
                styles.resultsCard,
                testResults.success ? styles.resultsSuccess : styles.resultsError,
              ]}>
              <View style={styles.resultsHeader}>
                <Text style={styles.resultsStatus}>
                  {testResults.success ? '✅ Success' : '❌ Failed'}
                </Text>
                {testResults.statusCode && (
                  <Text style={styles.resultsCode}>HTTP {testResults.statusCode}</Text>
                )}
              </View>
              {testResults.responseTime && (
                <Text style={styles.resultsTime}>Response Time: {testResults.responseTime}ms</Text>
              )}
              {testResults.timestamp && (
                <Text style={styles.resultsTimestamp}>
                  {new Date(testResults.timestamp).toLocaleString()}
                </Text>
              )}
              {testResults.error && <Text style={styles.resultsError}>{testResults.error}</Text>}
            </View>
          </View>
        )}

        {/* Best Practices */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Best Practices</Text>
          <View style={styles.practiceCard}>
            <Text style={styles.practiceIcon}>🔒</Text>
            <View style={styles.practiceContent}>
              <Text style={styles.practiceTitle}>Verify Signatures</Text>
              <Text style={styles.practiceText}>
                Always verify webhook signatures to ensure requests are from SubTrackr
              </Text>
            </View>
          </View>
          <View style={styles.practiceCard}>
            <Text style={styles.practiceIcon}>⚡</Text>
            <View style={styles.practiceContent}>
              <Text style={styles.practiceTitle}>Respond Quickly</Text>
              <Text style={styles.practiceText}>
                Return a 200 response within 5 seconds to acknowledge receipt
              </Text>
            </View>
          </View>
          <View style={styles.practiceCard}>
            <Text style={styles.practiceIcon}>🔄</Text>
            <View style={styles.practiceContent}>
              <Text style={styles.practiceTitle}>Handle Retries</Text>
              <Text style={styles.practiceText}>
                Implement idempotency to handle duplicate webhook deliveries
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    color: '#000',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
  },
  eventCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 2,
    borderColor: '#E0E0E0',
  },
  eventCardSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#F0F8FF',
  },
  eventIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  eventInfo: {
    flex: 1,
  },
  eventLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 2,
  },
  eventLabelSelected: {
    color: '#007AFF',
  },
  eventValue: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#666',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  checkmark: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secretRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  generateButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
  },
  generateButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  switchInfo: {
    flex: 1,
    marginRight: 16,
  },
  switchLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  switchHint: {
    fontSize: 12,
    color: '#666',
  },
  codeInput: {
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#000',
    minHeight: 150,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    textAlignVertical: 'top',
  },
  testButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 24,
  },
  testButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  resultsCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  resultsSuccess: {
    backgroundColor: '#E8F5E9',
    borderColor: '#4CAF50',
  },
  resultsError: {
    backgroundColor: '#FFEBEE',
    borderColor: '#F44336',
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  resultsStatus: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  resultsCode: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  resultsTime: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  resultsTimestamp: {
    fontSize: 12,
    color: '#999',
  },
  resultsError: {
    fontSize: 14,
    color: '#F44336',
    marginTop: 8,
  },
  practiceCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  practiceIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  practiceContent: {
    flex: 1,
  },
  practiceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  practiceText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
});

export default WebhookTesterScreen;
