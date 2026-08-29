import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';

interface Endpoint {
  id: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  name: string;
  hasBody?: boolean;
  defaultBody?: string;
}

const ENDPOINTS: Endpoint[] = [
  { id: 'list_sub', method: 'GET', path: '/v1/subscriptions', name: 'List Subscriptions' },
  {
    id: 'create_sub',
    method: 'POST',
    path: '/v1/subscriptions',
    name: 'Create Subscription',
    hasBody: true,
    defaultBody: JSON.stringify(
      {
        name: 'Netflix',
        category: 'streaming',
        price: 15.99,
        currency: 'USD',
        billingCycle: 'monthly',
        startDate: '2024-01-01T00:00:00Z',
      },
      null,
      2
    ),
  },
  { id: 'get_sub', method: 'GET', path: '/v1/subscriptions/:id', name: 'Get Subscription' },
  {
    id: 'cancel_sub',
    method: 'POST',
    path: '/v1/subscriptions/:id/cancel',
    name: 'Cancel Subscription',
    hasBody: true,
    defaultBody: JSON.stringify({ reason: 'user_requested', atPeriodEnd: true }, null, 2),
  },
  { id: 'list_plans', method: 'GET', path: '/v1/plans', name: 'List Plans' },
  { id: 'list_pay', method: 'GET', path: '/v1/payments', name: 'List Payments' },
  {
    id: 'list_invoices',
    method: 'GET',
    path: '/v1/invoices',
    name: 'List Invoices',
  },
  { id: 'list_webhooks', method: 'GET', path: '/v1/webhooks', name: 'List Webhooks' },
  {
    id: 'create_webhook',
    method: 'POST',
    path: '/v1/webhooks',
    name: 'Create Webhook',
    hasBody: true,
    defaultBody: JSON.stringify(
      {
        url: 'https://your-app.com/webhook',
        events: ['subscription.created', 'payment.completed'],
      },
      null,
      2
    ),
  },
  {
    id: 'usage_analytics',
    method: 'GET',
    path: '/v1/analytics/usage',
    name: 'Usage Analytics',
  },
  { id: 'list_themes', method: 'GET', path: '/v1/themes', name: 'List Themes' },
];

const LANGUAGES = ['cURL', 'JavaScript', 'Python', 'Go'];

export const ApiPlayground: React.FC = () => {
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint>(ENDPOINTS[0]);
  const [apiKey, setApiKey] = useState('sk_test_your_api_key_here');
  const [requestBody, setRequestBody] = useState(ENDPOINTS[0].defaultBody || '');
  const [selectedLang, setSelectedLang] = useState('cURL');

  const [response, setResponse] = useState<{ status: number | null; data: string | null }>({
    status: null,
    data: null,
  });
  const [loading, setLoading] = useState(false);

  const handleEndpointSelect = (endpoint: Endpoint) => {
    setSelectedEndpoint(endpoint);
    setRequestBody(endpoint.defaultBody || '');
    setResponse({ status: null, data: null });
  };

  const generateCode = () => {
    const url = `https://sandbox.api.subtrackr.io${selectedEndpoint.path}`;
    const method = selectedEndpoint.method;
    const bodyStr = selectedEndpoint.hasBody ? `\n  -d '${requestBody}'` : '';
    const bodyJs = selectedEndpoint.hasBody ? `,\n  body: JSON.stringify(${requestBody})` : '';
    const bodyPy = selectedEndpoint.hasBody ? `\npayload = ${requestBody}` : '';
    const bodyGo = selectedEndpoint.hasBody
      ? `\npayload := strings.NewReader(\`${requestBody}\`)`
      : '';

    switch (selectedLang) {
      case 'cURL':
        return `curl -X ${method} ${url} \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json"${bodyStr}`;
      case 'JavaScript':
        return `fetch("${url}", {
  method: "${method}",
  headers: {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json"
  }${bodyJs}
})
.then(response => response.json())
.then(console.log);`;
      case 'Python':
        return `import requests
url = "${url}"
headers = {
    "Authorization": "Bearer ${apiKey}",
    "Content-Type": "application/json"
}${bodyPy}
response = requests.request("${method}", url, headers=headers${selectedEndpoint.hasBody ? ', json=payload' : ''})
print(response.json())`;
      case 'Go':
        return `package main
import (
	"fmt"
	"net/http"
	"io/ioutil"
	"strings"
)
func main() {
	url := "${url}"
	method := "${method}"${bodyGo}
	client := &http.Client { }
	req, _ := http.NewRequest(method, url, ${selectedEndpoint.hasBody ? 'payload' : 'nil'})
	req.Header.Add("Authorization", "Bearer ${apiKey}")
	req.Header.Add("Content-Type", "application/json")
	res, _ := client.Do(req)
	defer res.Body.Close()
	body, _ := ioutil.ReadAll(res.Body)
	fmt.Println(string(body))
}`;
      default:
        return '';
    }
  };

  const handleExecute = async () => {
    setLoading(true);
    // Simulate network request to sandbox
    setTimeout(() => {
      let mockResponse = {};
      let mockStatus = 200;

      if (selectedEndpoint.id === 'list_sub') {
        mockResponse = {
          success: true,
          data: [
            {
              id: 'sub_123',
              name: 'Netflix',
              category: 'streaming',
              price: 15.99,
              currency: 'USD',
              billingCycle: 'monthly',
              status: 'active',
              nextBillingDate: '2026-09-01T00:00:00Z',
            },
            {
              id: 'sub_124',
              name: 'Spotify',
              category: 'music',
              price: 9.99,
              currency: 'USD',
              billingCycle: 'monthly',
              status: 'active',
              nextBillingDate: '2026-09-04T00:00:00Z',
            },
          ],
          pagination: { page: 1, limit: 20, total: 2, hasNext: false },
        };
      } else if (selectedEndpoint.id === 'create_sub') {
        try {
          const bodyData = JSON.parse(requestBody);
          mockResponse = {
            success: true,
            data: {
              id: 'sub_new',
              ...bodyData,
              status: 'active',
              createdAt: new Date().toISOString(),
            },
          };
          mockStatus = 201;
        } catch (e) {
          mockResponse = {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' },
          };
          mockStatus = 400;
        }
      } else if (selectedEndpoint.id === 'get_sub') {
        mockResponse = {
          success: true,
          data: {
            id: 'sub_123',
            name: 'Netflix',
            category: 'streaming',
            price: 15.99,
            currency: 'USD',
            billingCycle: 'monthly',
            status: 'active',
            nextBillingDate: '2026-09-01T00:00:00Z',
          },
        };
      } else if (selectedEndpoint.id === 'cancel_sub') {
        mockResponse = {
          success: true,
          data: {
            id: 'sub_123',
            status: 'cancelled',
            cancelAtPeriodEnd: true,
            effectiveAt: '2026-09-30T00:00:00Z',
          },
        };
      } else if (selectedEndpoint.id === 'list_plans') {
        mockResponse = {
          success: true,
          data: [
            { id: 'plan_free', name: 'Free', price: 0, currency: 'USD', interval: 'monthly' },
            { id: 'plan_pro', name: 'Pro', price: 19, currency: 'USD', interval: 'monthly' },
            { id: 'plan_ent', name: 'Enterprise', price: 99, currency: 'USD', interval: 'monthly' },
          ],
        };
      } else if (selectedEndpoint.id === 'list_pay') {
        mockResponse = {
          success: true,
          data: [
            {
              id: 'pay_1',
              subscriptionId: 'sub_123',
              amount: 15.99,
              currency: 'USD',
              status: 'succeeded',
              createdAt: '2026-08-01T00:00:00Z',
            },
          ],
          pagination: { page: 1, limit: 20, total: 1, hasNext: false },
        };
      } else if (selectedEndpoint.id === 'list_invoices') {
        mockResponse = {
          success: true,
          data: [
            {
              id: 'inv_1',
              subscriptionId: 'sub_123',
              total: 15.99,
              currency: 'USD',
              status: 'paid',
              dueAt: '2026-08-01T00:00:00Z',
            },
            {
              id: 'inv_2',
              subscriptionId: 'sub_124',
              total: 9.99,
              currency: 'USD',
              status: 'open',
              dueAt: '2026-09-01T00:00:00Z',
            },
          ],
        };
      } else if (selectedEndpoint.id === 'list_webhooks') {
        mockResponse = {
          success: true,
          data: [
            {
              id: 'wh_1',
              url: 'https://your-app.com/webhook',
              events: ['subscription.created'],
              status: 'enabled',
            },
          ],
        };
      } else if (selectedEndpoint.id === 'create_webhook') {
        try {
          const body = JSON.parse(requestBody);
          mockResponse = {
            success: true,
            data: { id: 'wh_new', ...body, status: 'enabled', createdAt: new Date().toISOString() },
          };
          mockStatus = 201;
        } catch (e) {
          mockResponse = {
            success: false,
            error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' },
          };
          mockStatus = 400;
        }
      } else if (selectedEndpoint.id === 'usage_analytics') {
        mockResponse = {
          success: true,
          data: {
            requests: { total: 1234, window: 'daily' },
            credits: { used: 340, remaining: 660 },
            rateLimit: { short: 78, long: 340 },
          },
        };
      } else if (selectedEndpoint.id === 'list_themes') {
        mockResponse = {
          success: true,
          data: [
            { id: 'theme_1', name: 'Midnight', primaryColor: '#6C5CE7', status: 'active' },
            { id: 'theme_2', name: 'Ocean', primaryColor: '#0984E3', status: 'draft' },
          ],
        };
      } else {
        mockResponse = { success: true, data: [] };
      }

      if (apiKey === '') {
        mockResponse = {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Missing API Key' },
        };
        mockStatus = 401;
      }

      setResponse({ status: mockStatus, data: JSON.stringify(mockResponse, null, 2) });
      setLoading(false);
    }, 800);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Interactive API Playground</Text>

      <View style={styles.layout}>
        {/* Left Column - Configuration */}
        <View style={styles.configColumn}>
          <Text style={styles.label}>Endpoint</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.endpointsScroll}>
            {ENDPOINTS.map((ep) => (
              <TouchableOpacity
                key={ep.id}
                style={[
                  styles.endpointTab,
                  selectedEndpoint.id === ep.id && styles.endpointTabSelected,
                ]}
                onPress={() => handleEndpointSelect(ep)}>
                <Text
                  style={[
                    styles.endpointMethod,
                    { color: ep.method === 'GET' ? '#3B82F6' : '#10B981' },
                  ]}>
                  {ep.method}
                </Text>
                <Text
                  style={[
                    styles.endpointName,
                    selectedEndpoint.id === ep.id && styles.endpointNameSelected,
                  ]}>
                  {ep.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>API Key (Bearer Token)</Text>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="sk_test_..."
            placeholderTextColor="#9CA3AF"
          />

          {selectedEndpoint.hasBody && (
            <>
              <Text style={styles.label}>Request Body (JSON)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={requestBody}
                onChangeText={setRequestBody}
                multiline
                numberOfLines={8}
                autoCapitalize="none"
              />
            </>
          )}

          <TouchableOpacity style={styles.executeButton} onPress={handleExecute} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.executeButtonText}>Execute Request</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Right Column - Code & Response */}
        <View style={styles.codeColumn}>
          <View style={styles.codeSection}>
            <View style={styles.langTabs}>
              {LANGUAGES.map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[styles.langTab, selectedLang === lang && styles.langTabSelected]}
                  onPress={() => setSelectedLang(lang)}>
                  <Text
                    style={[
                      styles.langTabText,
                      selectedLang === lang && styles.langTabTextSelected,
                    ]}>
                    {lang}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.codeBlock}>
              <Text style={styles.codeText} selectable>
                {generateCode()}
              </Text>
            </View>
          </View>

          {response.data && (
            <View style={styles.responseSection}>
              <View style={styles.responseHeader}>
                <Text style={styles.label}>Response</Text>
                <View
                  style={[
                    styles.statusBadge,
                    response.status === 200 || response.status === 201
                      ? styles.statusSuccess
                      : styles.statusError,
                  ]}>
                  <Text style={styles.statusText}>{response.status}</Text>
                </View>
              </View>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText} selectable>
                  {response.data}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 20,
    marginTop: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 20,
  },
  layout: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -10,
  },
  configColumn: {
    flex: 1,
    minWidth: 300,
    paddingHorizontal: 10,
    marginBottom: 20,
  },
  codeColumn: {
    flex: 1,
    minWidth: 300,
    paddingHorizontal: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  endpointsScroll: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  endpointTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginRight: 8,
    backgroundColor: '#F9FAFB',
  },
  endpointTabSelected: {
    borderColor: '#3B82F6',
    backgroundColor: '#EFF6FF',
  },
  endpointMethod: {
    fontWeight: 'bold',
    marginRight: 8,
    fontSize: 12,
  },
  endpointName: {
    fontSize: 14,
    color: '#4B5563',
  },
  endpointNameSelected: {
    color: '#1D4ED8',
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    marginBottom: 16,
    color: '#111827',
    fontFamily: 'monospace',
  },
  textArea: {
    height: 120,
    textAlignVertical: 'top',
  },
  executeButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  executeButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
  codeSection: {
    marginBottom: 20,
  },
  langTabs: {
    flexDirection: 'row',
    backgroundColor: '#1F2937',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  langTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  langTabSelected: {
    backgroundColor: '#111827',
  },
  langTabText: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '500',
  },
  langTabTextSelected: {
    color: '#F9FAFB',
  },
  codeBlock: {
    backgroundColor: '#111827',
    padding: 16,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
  },
  codeText: {
    color: '#D1D5DB',
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
  },
  responseSection: {
    marginTop: 8,
  },
  responseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusSuccess: {
    backgroundColor: '#D1FAE5',
  },
  statusError: {
    backgroundColor: '#FEE2E2',
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
});
