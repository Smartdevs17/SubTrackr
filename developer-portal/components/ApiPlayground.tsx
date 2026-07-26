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
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
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
    defaultBody: JSON.stringify({
      name: "Netflix",
      category: "streaming",
      price: 15.99,
      currency: "USD",
      billingCycle: "monthly",
      startDate: "2024-01-01T00:00:00Z"
    }, null, 2)
  },
  { id: 'list_pay', method: 'GET', path: '/v1/payments', name: 'List Payments' },
];

const LANGUAGES = ['cURL', 'JavaScript', 'Python', 'Go'];

export const ApiPlayground: React.FC = () => {
  const [selectedEndpoint, setSelectedEndpoint] = useState<Endpoint>(ENDPOINTS[0]);
  const [apiKey, setApiKey] = useState('sk_test_your_api_key_here');
  const [requestBody, setRequestBody] = useState(ENDPOINTS[0].defaultBody || '');
  const [selectedLang, setSelectedLang] = useState('cURL');
  
  const [response, setResponse] = useState<{ status: number | null, data: string | null }>({ status: null, data: null });
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
    const bodyGo = selectedEndpoint.hasBody ? `\npayload := strings.NewReader(\`${requestBody}\`)` : '';
    
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
          data: [{ id: "sub_123", name: "Netflix", price: 15.99, status: "active" }],
          pagination: { page: 1, limit: 20, total: 1 }
        };
      } else if (selectedEndpoint.id === 'create_sub') {
        try {
          const bodyData = JSON.parse(requestBody);
          mockResponse = { success: true, data: { id: "sub_new", ...bodyData, status: "active", createdAt: new Date().toISOString() } };
          mockStatus = 201;
        } catch(e) {
          mockResponse = { success: false, error: { code: "INVALID_REQUEST", message: "Invalid JSON body" } };
          mockStatus = 400;
        }
      } else {
        mockResponse = { success: true, data: [] };
      }
      
      if (apiKey === '') {
        mockResponse = { success: false, error: { code: "UNAUTHORIZED", message: "Missing API Key" } };
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
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.endpointsScroll}>
            {ENDPOINTS.map(ep => (
              <TouchableOpacity 
                key={ep.id}
                style={[styles.endpointTab, selectedEndpoint.id === ep.id && styles.endpointTabSelected]}
                onPress={() => handleEndpointSelect(ep)}
              >
                <Text style={[styles.endpointMethod, { color: ep.method === 'GET' ? '#3B82F6' : '#10B981' }]}>{ep.method}</Text>
                <Text style={[styles.endpointName, selectedEndpoint.id === ep.id && styles.endpointNameSelected]}>{ep.name}</Text>
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
              {LANGUAGES.map(lang => (
                <TouchableOpacity 
                  key={lang} 
                  style={[styles.langTab, selectedLang === lang && styles.langTabSelected]}
                  onPress={() => setSelectedLang(lang)}
                >
                  <Text style={[styles.langTabText, selectedLang === lang && styles.langTabTextSelected]}>{lang}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.codeBlock}>
              <Text style={styles.codeText} selectable>{generateCode()}</Text>
            </View>
          </View>

          {response.data && (
            <View style={styles.responseSection}>
              <View style={styles.responseHeader}>
                <Text style={styles.label}>Response</Text>
                <View style={[styles.statusBadge, response.status === 200 || response.status === 201 ? styles.statusSuccess : styles.statusError]}>
                  <Text style={styles.statusText}>{response.status}</Text>
                </View>
              </View>
              <View style={styles.codeBlock}>
                <Text style={styles.codeText} selectable>{response.data}</Text>
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
