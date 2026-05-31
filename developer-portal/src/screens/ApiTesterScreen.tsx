import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useDeveloperPortalStore } from '../../../src/store/developerPortalStore';

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

const EXAMPLE_ENDPOINTS = [
  { method: 'GET', path: '/api/v1/subscriptions', description: 'List all subscriptions' },
  { method: 'POST', path: '/api/v1/subscriptions', description: 'Create a subscription' },
  { method: 'GET', path: '/api/v1/subscriptions/:id', description: 'Get subscription details' },
  { method: 'PUT', path: '/api/v1/subscriptions/:id', description: 'Update a subscription' },
  { method: 'DELETE', path: '/api/v1/subscriptions/:id', description: 'Delete a subscription' },
];

const ApiTesterScreen: React.FC = () => {
  const { developer, apiKeys } = useDeveloperPortalStore();
  const [selectedMethod, setSelectedMethod] = useState('GET');
  const [endpoint, setEndpoint] = useState('/api/v1/subscriptions');
  const [selectedApiKey, setSelectedApiKey] = useState('');
  const [requestBody, setRequestBody] = useState('{\n  \n}');
  const [headers, setHeaders] = useState('{\n  "Content-Type": "application/json"\n}');
  const [response, setResponse] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [responseTime, setResponseTime] = useState<number | null>(null);

  const activeKeys = apiKeys.filter((k) => k.status === 'active');

  const handleSendRequest = async () => {
    if (!selectedApiKey) {
      Alert.alert('Error', 'Please select an API key');
      return;
    }

    setIsLoading(true);
    const startTime = Date.now();

    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

      const mockResponse = {
        status: 200,
        statusText: 'OK',
        data: {
          success: true,
          data: [
            {
              id: 'sub_123',
              name: 'Netflix',
              price: 15.99,
              currency: 'USD',
              billingCycle: 'monthly',
              status: 'active',
            },
            {
              id: 'sub_456',
              name: 'Spotify',
              price: 9.99,
              currency: 'USD',
              billingCycle: 'monthly',
              status: 'active',
            },
          ],
          total: 2,
          page: 1,
          limit: 20,
        },
      };

      setResponse(mockResponse);
      setResponseTime(Date.now() - startTime);
    } catch (error) {
      setResponse({
        status: 500,
        statusText: 'Internal Server Error',
        error: 'Failed to fetch data',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadExample = (example: (typeof EXAMPLE_ENDPOINTS)[0]) => {
    setSelectedMethod(example.method);
    setEndpoint(example.path);
    if (example.method === 'POST' || example.method === 'PUT') {
      setRequestBody(
        JSON.stringify(
          {
            name: 'Netflix',
            price: 15.99,
            currency: 'USD',
            billingCycle: 'monthly',
            category: 'streaming',
          },
          null,
          2
        )
      );
    } else {
      setRequestBody('{\n  \n}');
    }
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return '#4CAF50';
    if (status >= 400 && status < 500) return '#FF9800';
    return '#F44336';
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>API Tester</Text>
          <Text style={styles.subtitle}>Test API endpoints with live requests</Text>
        </View>

        {/* API Key Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>API Key</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.keyScroll}>
            {activeKeys.map((key) => (
              <TouchableOpacity
                key={key.id}
                style={[styles.keyChip, selectedApiKey === key.id && styles.keyChipSelected]}
                onPress={() => setSelectedApiKey(key.id)}>
                <Text
                  style={[
                    styles.keyChipText,
                    selectedApiKey === key.id && styles.keyChipTextSelected,
                  ]}>
                  {key.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {activeKeys.length === 0 && (
            <Text style={styles.noKeysText}>No active API keys. Create one to get started.</Text>
          )}
        </View>

        {/* HTTP Method & Endpoint */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Request</Text>
          <View style={styles.requestRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.methodScroll}>
              {HTTP_METHODS.map((method) => (
                <TouchableOpacity
                  key={method}
                  style={[
                    styles.methodChip,
                    selectedMethod === method && styles.methodChipSelected,
                  ]}
                  onPress={() => setSelectedMethod(method)}>
                  <Text
                    style={[
                      styles.methodText,
                      selectedMethod === method && styles.methodTextSelected,
                    ]}>
                    {method}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          <TextInput
            style={styles.endpointInput}
            value={endpoint}
            onChangeText={setEndpoint}
            placeholder="/api/v1/endpoint"
            placeholderTextColor="#999"
          />
        </View>

        {/* Example Endpoints */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Example Endpoints</Text>
          {EXAMPLE_ENDPOINTS.map((example, index) => (
            <TouchableOpacity
              key={index}
              style={styles.exampleCard}
              onPress={() => loadExample(example)}>
              <View style={styles.exampleHeader}>
                <View style={styles.exampleMethodBadge}>
                  <Text style={styles.exampleMethodText}>{example.method}</Text>
                </View>
                <Text style={styles.examplePath}>{example.path}</Text>
              </View>
              <Text style={styles.exampleDescription}>{example.description}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Headers */}
        {(selectedMethod === 'POST' || selectedMethod === 'PUT' || selectedMethod === 'PATCH') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Headers</Text>
            <TextInput
              style={styles.codeInput}
              value={headers}
              onChangeText={setHeaders}
              multiline
              placeholder='{"Content-Type": "application/json"}'
              placeholderTextColor="#999"
            />
          </View>
        )}

        {/* Request Body */}
        {(selectedMethod === 'POST' || selectedMethod === 'PUT' || selectedMethod === 'PATCH') && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Request Body</Text>
            <TextInput
              style={styles.codeInput}
              value={requestBody}
              onChangeText={setRequestBody}
              multiline
              placeholder="{}"
              placeholderTextColor="#999"
            />
          </View>
        )}

        {/* Send Button */}
        <TouchableOpacity
          style={[styles.sendButton, isLoading && styles.sendButtonDisabled]}
          onPress={handleSendRequest}
          disabled={isLoading || !selectedApiKey}>
          {isLoading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.sendButtonText}>Send Request</Text>
          )}
        </TouchableOpacity>

        {/* Response */}
        {response && (
          <View style={styles.section}>
            <View style={styles.responseHeader}>
              <Text style={styles.sectionTitle}>Response</Text>
              {responseTime && <Text style={styles.responseTime}>{responseTime}ms</Text>}
            </View>
            <View style={styles.statusRow}>
              <View
                style={[styles.statusBadge, { backgroundColor: getStatusColor(response.status) }]}>
                <Text style={styles.statusText}>
                  {response.status} {response.statusText}
                </Text>
              </View>
            </View>
            <ScrollView style={styles.responseBody} horizontal>
              <Text style={styles.responseText} selectable>
                {JSON.stringify(response, null, 2)}
              </Text>
            </ScrollView>
          </View>
        )}
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
    marginBottom: 12,
  },
  keyScroll: {
    maxHeight: 50,
  },
  keyChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginRight: 8,
  },
  keyChipSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  keyChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  keyChipTextSelected: {
    color: '#FFF',
  },
  noKeysText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
  requestRow: {
    marginBottom: 12,
  },
  methodScroll: {
    maxHeight: 50,
  },
  methodChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    marginRight: 8,
  },
  methodChipSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  methodText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  methodTextSelected: {
    color: '#FFF',
  },
  endpointInput: {
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 8,
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#000',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  exampleCard: {
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  exampleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  exampleMethodBadge: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  exampleMethodText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1976D2',
  },
  examplePath: {
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#000',
    flex: 1,
  },
  exampleDescription: {
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
    minHeight: 100,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    textAlignVertical: 'top',
  },
  sendButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 24,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  responseHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  responseTime: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4CAF50',
  },
  statusRow: {
    marginBottom: 12,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  responseBody: {
    backgroundColor: '#FFF',
    padding: 12,
    borderRadius: 8,
    maxHeight: 400,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  responseText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#000',
  },
});

export default ApiTesterScreen;
