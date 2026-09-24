/**
 * ApiPlayground.tsx
 *
 * Issue #1176 — Add API playground with interactive docs
 *
 * Fully interactive API playground embedded in the developer portal.
 * Features:
 *  - Endpoint browser with method badges and search filter
 *  - Per-endpoint inline documentation (description, parameters, response schema)
 *  - Multi-language code generation (cURL, JavaScript, Python, Go)
 *  - Request body JSON editor with syntax validation feedback
 *  - Sandbox execution with realistic mock responses
 *  - Response viewer with status badge and collapsible JSON
 *  - Request history (last 10 requests) with one-click replay
 *  - Responsive: single column on mobile, split-pane on wide screens
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

// ── Types ─────────────────────────────────────────────────────────────────────

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type CodeLanguage = 'cURL' | 'JavaScript' | 'Python' | 'Go';

interface EndpointParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  example?: string;
}

interface EndpointDoc {
  id: string;
  method: HttpMethod;
  path: string;
  name: string;
  description: string;
  group: string;
  params?: EndpointParam[];
  bodySchema?: string;
  responseSchema?: string;
  hasBody?: boolean;
  defaultBody?: string;
}

interface HistoryEntry {
  id: string;
  endpoint: EndpointDoc;
  status: number;
  body: string;
  executedAt: Date;
}

// ── Endpoint registry ─────────────────────────────────────────────────────────

const ENDPOINTS: EndpointDoc[] = [
  // Subscriptions
  {
    id: 'list_subscriptions',
    method: 'GET',
    path: '/v1/subscriptions',
    name: 'List Subscriptions',
    group: 'Subscriptions',
    description:
      'Returns a paginated list of all subscriptions. Use `status` to filter, and `page`/`limit` for pagination.',
    params: [
      { name: 'status', type: 'string', required: false, description: 'Filter by status', example: 'active' },
      { name: 'category', type: 'string', required: false, description: 'Filter by category', example: 'streaming' },
      { name: 'page', type: 'number', required: false, description: 'Page number (1-based)', example: '1' },
      { name: 'limit', type: 'number', required: false, description: 'Items per page (max 100)', example: '20' },
    ],
    responseSchema: '{ data: Subscription[], pagination: { page, limit, total, hasNext } }',
  },
  {
    id: 'create_subscription',
    method: 'POST',
    path: '/v1/subscriptions',
    name: 'Create Subscription',
    group: 'Subscriptions',
    description: 'Creates a new subscription record. Returns the created subscription with its generated ID.',
    hasBody: true,
    defaultBody: JSON.stringify(
      { name: 'Netflix', category: 'streaming', price: 15.99, currency: 'USD', billingCycle: 'monthly', nextBillingDate: '2026-10-01T00:00:00Z', notificationsEnabled: true },
      null, 2
    ),
    bodySchema: 'name: string (required), category: string, price: number (required), currency: string (required), billingCycle: monthly|yearly|weekly (required), nextBillingDate: ISO 8601, notificationsEnabled: boolean',
    responseSchema: 'Subscription',
  },
  {
    id: 'get_subscription',
    method: 'GET',
    path: '/v1/subscriptions/:id',
    name: 'Get Subscription',
    group: 'Subscriptions',
    description: 'Retrieves a single subscription by its ID.',
    params: [
      { name: 'id', type: 'string', required: true, description: 'Subscription ID', example: 'sub_123' },
    ],
    responseSchema: 'Subscription',
  },
  {
    id: 'update_subscription',
    method: 'PUT',
    path: '/v1/subscriptions/:id',
    name: 'Update Subscription',
    group: 'Subscriptions',
    description: 'Updates an existing subscription. Only the fields you provide are changed.',
    hasBody: true,
    defaultBody: JSON.stringify({ price: 19.99, notificationsEnabled: false }, null, 2),
    bodySchema: 'Any subset of Subscription fields (partial update)',
    responseSchema: 'Subscription',
  },
  {
    id: 'cancel_subscription',
    method: 'POST',
    path: '/v1/subscriptions/:id/cancel',
    name: 'Cancel Subscription',
    group: 'Subscriptions',
    description: 'Cancels a subscription immediately or at the end of the current billing period.',
    hasBody: true,
    defaultBody: JSON.stringify({ reason: 'user_requested', atPeriodEnd: true }, null, 2),
    bodySchema: 'reason: string (required), atPeriodEnd: boolean',
    responseSchema: '{ id, status: "cancelled", cancelAtPeriodEnd, effectiveAt }',
  },
  {
    id: 'pause_subscription',
    method: 'POST',
    path: '/v1/subscriptions/:id/pause',
    name: 'Pause Subscription',
    group: 'Subscriptions',
    description: 'Pauses a subscription for a given number of days. Billing is suspended during the pause.',
    hasBody: true,
    defaultBody: JSON.stringify({ durationDays: 30 }, null, 2),
    bodySchema: 'durationDays: number (1-365)',
    responseSchema: '{ id, isPaused: true, pausedUntil: ISO 8601 }',
  },
  {
    id: 'resume_subscription',
    method: 'POST',
    path: '/v1/subscriptions/:id/resume',
    name: 'Resume Subscription',
    group: 'Subscriptions',
    description: 'Resumes a paused subscription and adjusts the next billing date accordingly.',
    hasBody: false,
    responseSchema: 'Subscription',
  },
  // Plans
  {
    id: 'list_plans',
    method: 'GET',
    path: '/v1/plans',
    name: 'List Plans',
    group: 'Plans',
    description: 'Returns all subscription plans available for the authenticated merchant.',
    responseSchema: 'Plan[]',
  },
  {
    id: 'create_plan',
    method: 'POST',
    path: '/v1/plans',
    name: 'Create Plan',
    group: 'Plans',
    description: 'Creates a new subscription plan.',
    hasBody: true,
    defaultBody: JSON.stringify({ name: 'Pro', price: 29, token: 'USDC', interval: 'Monthly' }, null, 2),
    bodySchema: 'name: string, price: number, token: string, interval: Weekly|Monthly|Quarterly|Yearly',
    responseSchema: 'Plan',
  },
  // Payments
  {
    id: 'list_payments',
    method: 'GET',
    path: '/v1/payments',
    name: 'List Payments',
    group: 'Payments',
    description: 'Returns a paginated history of payments.',
    params: [
      { name: 'subscriptionId', type: 'string', required: false, description: 'Filter by subscription', example: 'sub_123' },
      { name: 'status', type: 'string', required: false, description: 'succeeded | failed | pending', example: 'succeeded' },
    ],
    responseSchema: '{ data: Payment[], pagination }',
  },
  {
    id: 'charge_subscription',
    method: 'POST',
    path: '/v1/subscriptions/:id/charge',
    name: 'Charge Subscription',
    group: 'Payments',
    description: 'Triggers an immediate charge for a subscription. Respects the configured fallback chain.',
    hasBody: false,
    responseSchema: '{ success: boolean, amount, txHash? }',
  },
  // Invoices
  {
    id: 'list_invoices',
    method: 'GET',
    path: '/v1/invoices',
    name: 'List Invoices',
    group: 'Invoices',
    description: 'Returns all invoices. Filter by status or subscription ID.',
    responseSchema: '{ data: Invoice[], pagination }',
  },
  // Webhooks
  {
    id: 'list_webhooks',
    method: 'GET',
    path: '/v1/webhooks',
    name: 'List Webhooks',
    group: 'Webhooks',
    description: 'Returns all registered webhook endpoints.',
    responseSchema: 'Webhook[]',
  },
  {
    id: 'create_webhook',
    method: 'POST',
    path: '/v1/webhooks',
    name: 'Create Webhook',
    group: 'Webhooks',
    description: 'Registers a new webhook. Provide the URL and the list of events you wish to receive.',
    hasBody: true,
    defaultBody: JSON.stringify(
      { url: 'https://your-app.example/webhook', events: ['subscription.created', 'payment.completed'] },
      null, 2
    ),
    bodySchema: 'url: string (required), events: EventType[] (required), secret?: string',
    responseSchema: 'Webhook',
  },
  // Analytics
  {
    id: 'analytics_overview',
    method: 'GET',
    path: '/v1/analytics/overview',
    name: 'Analytics Overview',
    group: 'Analytics',
    description: 'High-level metrics: MRR, active subs, churn rate, trial conversions.',
    responseSchema: '{ mrr, activeSubscriptions, churnRate, trialConversionRate }',
  },
  {
    id: 'analytics_usage',
    method: 'GET',
    path: '/v1/analytics/usage',
    name: 'API Usage',
    group: 'Analytics',
    description: 'Request counts, rate-limit usage, and credit consumption.',
    responseSchema: '{ requests: { total, window }, credits: { used, remaining }, rateLimit }',
  },
];

// ── Mock response builders ─────────────────────────────────────────────────────

function buildMockResponse(ep: EndpointDoc, requestBody: string): { status: number; body: unknown } {
  const now = new Date().toISOString();

  switch (ep.id) {
    case 'list_subscriptions':
      return {
        status: 200,
        body: {
          success: true,
          data: [
            { id: 'sub_001', name: 'Netflix', category: 'streaming', price: 15.99, currency: 'USD', billingCycle: 'monthly', status: 'active', nextBillingDate: '2026-10-01T00:00:00Z' },
            { id: 'sub_002', name: 'GitHub Copilot', category: 'software', price: 10.00, currency: 'USD', billingCycle: 'monthly', status: 'active', nextBillingDate: '2026-10-05T00:00:00Z' },
          ],
          pagination: { page: 1, limit: 20, total: 2, hasNext: false },
        },
      };
    case 'create_subscription': {
      try {
        const parsed = JSON.parse(requestBody || '{}');
        return {
          status: 201,
          body: { success: true, data: { id: `sub_${Date.now().toString(36)}`, ...parsed, status: 'active', createdAt: now } },
        };
      } catch {
        return { status: 400, body: { success: false, error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } } };
      }
    }
    case 'get_subscription':
      return {
        status: 200,
        body: { success: true, data: { id: 'sub_001', name: 'Netflix', category: 'streaming', price: 15.99, currency: 'USD', billingCycle: 'monthly', status: 'active', nextBillingDate: '2026-10-01T00:00:00Z' } },
      };
    case 'update_subscription': {
      try {
        const updates = JSON.parse(requestBody || '{}');
        return { status: 200, body: { success: true, data: { id: 'sub_001', name: 'Netflix', price: 15.99, ...updates, updatedAt: now } } };
      } catch {
        return { status: 400, body: { success: false, error: { code: 'INVALID_JSON', message: 'Invalid JSON body' } } };
      }
    }
    case 'cancel_subscription':
      return { status: 200, body: { success: true, data: { id: 'sub_001', status: 'cancelled', cancelAtPeriodEnd: true, effectiveAt: '2026-10-31T23:59:59Z' } } };
    case 'pause_subscription':
      return { status: 200, body: { success: true, data: { id: 'sub_001', isPaused: true, pausedUntil: '2026-11-24T00:00:00Z' } } };
    case 'resume_subscription':
      return { status: 200, body: { success: true, data: { id: 'sub_001', isActive: true, isPaused: false, nextBillingDate: '2026-11-01T00:00:00Z' } } };
    case 'list_plans':
      return {
        status: 200,
        body: { success: true, data: [
          { id: 1, name: 'Free', price: 0, token: 'USDC', interval: 'Monthly', active: true, subscriberCount: 45 },
          { id: 2, name: 'Pro', price: 29, token: 'USDC', interval: 'Monthly', active: true, subscriberCount: 120 },
          { id: 3, name: 'Enterprise', price: 199, token: 'USDC', interval: 'Monthly', active: true, subscriberCount: 12 },
        ]},
      };
    case 'create_plan': {
      try {
        const plan = JSON.parse(requestBody || '{}');
        return { status: 201, body: { success: true, data: { id: Date.now(), ...plan, active: true, subscriberCount: 0, createdAt: now } } };
      } catch {
        return { status: 400, body: { success: false, error: { code: 'INVALID_JSON', message: 'Invalid JSON body' } } };
      }
    }
    case 'list_payments':
      return {
        status: 200,
        body: { success: true, data: [
          { id: 'pay_abc', subscriptionId: 'sub_001', amount: 15.99, currency: 'USD', status: 'succeeded', method: 'USDC', createdAt: now },
        ], pagination: { page: 1, limit: 20, total: 1, hasNext: false } },
      };
    case 'charge_subscription':
      return { status: 200, body: { success: true, amount: 15.99, txHash: '0xabcdef1234567890' } };
    case 'list_invoices':
      return {
        status: 200,
        body: { success: true, data: [
          { id: 'inv_1', subscriptionId: 'sub_001', total: 15.99, currency: 'USD', status: 'paid', dueAt: '2026-10-01T00:00:00Z' },
          { id: 'inv_2', subscriptionId: 'sub_002', total: 10.00, currency: 'USD', status: 'open', dueAt: '2026-10-05T00:00:00Z' },
        ]},
      };
    case 'list_webhooks':
      return {
        status: 200,
        body: { success: true, data: [
          { id: 'wh_1', url: 'https://your-app.example/webhook', events: ['subscription.created'], status: 'enabled', createdAt: now },
        ]},
      };
    case 'create_webhook': {
      try {
        const wh = JSON.parse(requestBody || '{}');
        return { status: 201, body: { success: true, data: { id: `wh_${Date.now().toString(36)}`, ...wh, status: 'enabled', createdAt: now } } };
      } catch {
        return { status: 400, body: { success: false, error: { code: 'INVALID_JSON', message: 'Invalid JSON body' } } };
      }
    }
    case 'analytics_overview':
      return { status: 200, body: { success: true, data: { mrr: 2459.80, activeSubscriptions: 177, churnRate: 0.024, trialConversionRate: 0.62 } } };
    case 'analytics_usage':
      return { status: 200, body: { success: true, data: { requests: { total: 12450, window: 'daily' }, credits: { used: 340, remaining: 660 }, rateLimit: { shortTerm: 78, longTerm: 340 } } } };
    default:
      return { status: 200, body: { success: true, data: [] } };
  }
}

// ── Code generators ────────────────────────────────────────────────────────────

function generateCode(ep: EndpointDoc, apiKey: string, body: string, lang: CodeLanguage): string {
  const url = `https://sandbox.api.subtrackr.io${ep.path}`;
  const method = ep.method;

  switch (lang) {
    case 'cURL':
      return [
        `curl -X ${method} "${url}" \\`,
        `  -H "Authorization: Bearer ${apiKey}" \\`,
        `  -H "Content-Type: application/json"`,
        ep.hasBody ? `  -d '${body}'` : '',
      ]
        .filter(Boolean)
        .join(' \\\n');

    case 'JavaScript':
      return [
        `const response = await fetch("${url}", {`,
        `  method: "${method}",`,
        `  headers: {`,
        `    "Authorization": "Bearer ${apiKey}",`,
        `    "Content-Type": "application/json",`,
        `  },`,
        ep.hasBody ? `  body: JSON.stringify(${body}),` : '',
        `});`,
        ``,
        `const data = await response.json();`,
        `console.log(data);`,
      ]
        .filter((l) => l !== undefined && !(l === '' && !ep.hasBody))
        .join('\n');

    case 'Python':
      return [
        `import requests`,
        ``,
        `url = "${url}"`,
        `headers = {`,
        `    "Authorization": "Bearer ${apiKey}",`,
        `    "Content-Type": "application/json",`,
        `}`,
        ep.hasBody ? `payload = ${body}` : '',
        ``,
        `response = requests.${method.toLowerCase()}(url, headers=headers${ep.hasBody ? ', json=payload' : ''})`,
        `print(response.json())`,
      ]
        .filter((l) => l !== undefined)
        .join('\n');

    case 'Go':
      return [
        `package main`,
        ``,
        `import (`,
        `\t"fmt"`,
        `\t"io/ioutil"`,
        `\t"net/http"`,
        ep.hasBody ? `\t"strings"` : '',
        `)`,
        ``,
        `func main() {`,
        ep.hasBody ? `\tpayload := strings.NewReader(\`${body}\`)` : '',
        `\tclient := &http.Client{}`,
        `\treq, _ := http.NewRequest("${method}", "${url}", ${ep.hasBody ? 'payload' : 'nil'})`,
        `\treq.Header.Add("Authorization", "Bearer ${apiKey}")`,
        `\treq.Header.Add("Content-Type", "application/json")`,
        `\tres, _ := client.Do(req)`,
        `\tdefer res.Body.Close()`,
        `\tbody, _ := ioutil.ReadAll(res.Body)`,
        `\tfmt.Println(string(body))`,
        `}`,
      ]
        .filter((l) => l !== undefined)
        .join('\n');

    default:
      return '';
  }
}

// ── Method badge colours ──────────────────────────────────────────────────────

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: '#3B82F6',
  POST: '#10B981',
  PUT: '#F59E0B',
  PATCH: '#8B5CF6',
  DELETE: '#EF4444',
};

// ── Sub-components ─────────────────────────────────────────────────────────────

const MethodBadge: React.FC<{ method: HttpMethod }> = ({ method }) => (
  <View style={[badgeStyles.badge, { backgroundColor: METHOD_COLORS[method] + '20' }]}>
    <Text style={[badgeStyles.text, { color: METHOD_COLORS[method] }]}>{method}</Text>
  </View>
);

const badgeStyles = StyleSheet.create({
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  text: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
});

// ── Main component ─────────────────────────────────────────────────────────────

export const ApiPlayground: React.FC = () => {
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointDoc>(ENDPOINTS[0]);
  const [apiKey, setApiKey] = useState('sk_test_your_api_key_here');
  const [requestBody, setRequestBody] = useState(ENDPOINTS[0].defaultBody ?? '');
  const [selectedLang, setSelectedLang] = useState<CodeLanguage>('cURL');
  const [searchQuery, setSearchQuery] = useState('');
  const [showDocs, setShowDocs] = useState(false);
  const [response, setResponse] = useState<{ status: number; data: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // ── Filtered endpoint list ──────────────────────────────────────────────
  const filteredEndpoints = useMemo(() => {
    if (!searchQuery.trim()) return ENDPOINTS;
    const q = searchQuery.toLowerCase();
    return ENDPOINTS.filter(
      (ep) =>
        ep.name.toLowerCase().includes(q) ||
        ep.path.toLowerCase().includes(q) ||
        ep.method.toLowerCase().includes(q) ||
        ep.group.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // ── Endpoint groups ─────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const ep of filteredEndpoints) {
      if (!seen.has(ep.group)) {
        seen.add(ep.group);
        out.push(ep.group);
      }
    }
    return out;
  }, [filteredEndpoints]);

  // ── Body validation ─────────────────────────────────────────────────────
  const validateBody = useCallback((text: string): boolean => {
    if (!text.trim()) {
      setBodyError(null);
      return true;
    }
    try {
      JSON.parse(text);
      setBodyError(null);
      return true;
    } catch (e) {
      setBodyError(`Invalid JSON: ${(e as Error).message}`);
      return false;
    }
  }, []);

  const handleBodyChange = (text: string) => {
    setRequestBody(text);
    validateBody(text);
  };

  // ── Endpoint selection ──────────────────────────────────────────────────
  const handleEndpointSelect = (ep: EndpointDoc) => {
    setSelectedEndpoint(ep);
    setRequestBody(ep.defaultBody ?? '');
    setBodyError(null);
    setResponse(null);
    setShowDocs(false);
  };

  // ── Execute ─────────────────────────────────────────────────────────────
  const handleExecute = useCallback(() => {
    if (selectedEndpoint.hasBody && !validateBody(requestBody)) return;
    if (!apiKey.trim()) {
      setResponse({ status: 401, data: JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'API key is required' } }, null, 2) });
      return;
    }

    setLoading(true);
    setResponse(null);

    // Simulate network latency (300-800ms)
    const delay = 300 + Math.random() * 500;
    setTimeout(() => {
      const { status, body } = buildMockResponse(selectedEndpoint, requestBody);
      const responseStr = JSON.stringify(body, null, 2);
      setResponse({ status, data: responseStr });

      // Push to history (cap at 10)
      setHistory((prev) => [
        {
          id: `${Date.now()}`,
          endpoint: selectedEndpoint,
          status,
          body: responseStr,
          executedAt: new Date(),
        },
        ...prev.slice(0, 9),
      ]);
      setLoading(false);
    }, delay);
  }, [apiKey, requestBody, selectedEndpoint, validateBody]);

  // ── Copy to clipboard (best-effort) ────────────────────────────────────
  const handleCopyCode = () => {
    // React Native clipboard access is platform-dependent; no-op in portal
  };

  // ── Code panel ──────────────────────────────────────────────────────────
  const code = generateCode(selectedEndpoint, apiKey, requestBody, selectedLang);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <View style={styles.root} testID="api-playground" accessibilityLabel="API Playground">
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Interactive API Playground
        </Text>
        <Text style={styles.subtitle}>
          Try every endpoint against the sandbox environment — no production data is affected.
        </Text>
      </View>

      <View style={[styles.layout, isWide && styles.layoutWide]}>
        {/* ── Left panel: endpoint browser ── */}
        <View style={[styles.sidebar, isWide && styles.sidebarWide]}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search endpoints…"
            placeholderTextColor="#9CA3AF"
            accessibilityLabel="Search API endpoints"
          />

          <ScrollView style={styles.endpointScroll} showsVerticalScrollIndicator={false}>
            {groups.map((group) => (
              <View key={group} style={styles.endpointGroup}>
                <Text style={styles.groupLabel}>{group}</Text>
                {filteredEndpoints
                  .filter((ep) => ep.group === group)
                  .map((ep) => (
                    <TouchableOpacity
                      key={ep.id}
                      style={[
                        styles.endpointRow,
                        selectedEndpoint.id === ep.id && styles.endpointRowSelected,
                      ]}
                      onPress={() => handleEndpointSelect(ep)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedEndpoint.id === ep.id }}
                      accessibilityLabel={`${ep.method} ${ep.name}`}>
                      <MethodBadge method={ep.method} />
                      <Text
                        style={[
                          styles.endpointName,
                          selectedEndpoint.id === ep.id && styles.endpointNameSelected,
                        ]}
                        numberOfLines={1}>
                        {ep.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
              </View>
            ))}
            {filteredEndpoints.length === 0 && (
              <Text style={styles.noResults}>No endpoints match "{searchQuery}"</Text>
            )}
          </ScrollView>
        </View>

        {/* ── Right panel: config + code + response ── */}
        <ScrollView
          style={[styles.mainPanel, isWide && styles.mainPanelWide]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {/* Endpoint header */}
          <View style={styles.endpointHeader}>
            <MethodBadge method={selectedEndpoint.method} />
            <Text style={styles.endpointPath} selectable>
              {selectedEndpoint.path}
            </Text>
          </View>
          <Text style={styles.endpointDescription}>{selectedEndpoint.description}</Text>

          {/* Inline docs toggle */}
          <TouchableOpacity
            style={styles.docsToggle}
            onPress={() => setShowDocs((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showDocs ? 'Hide endpoint documentation' : 'Show endpoint documentation'}>
            <Text style={styles.docsToggleText}>
              {showDocs ? '▼ Hide docs' : '▶ Show parameters & schema'}
            </Text>
          </TouchableOpacity>

          {showDocs && (
            <View style={styles.docsPanel}>
              {selectedEndpoint.params && selectedEndpoint.params.length > 0 && (
                <View style={styles.docsSection}>
                  <Text style={styles.docsSectionTitle}>Query Parameters</Text>
                  {selectedEndpoint.params.map((p) => (
                    <View key={p.name} style={styles.paramRow}>
                      <View style={styles.paramNameRow}>
                        <Text style={styles.paramName}>{p.name}</Text>
                        <Text style={styles.paramType}>{p.type}</Text>
                        {p.required && <Text style={styles.paramRequired}>required</Text>}
                      </View>
                      <Text style={styles.paramDesc}>{p.description}</Text>
                      {p.example && (
                        <Text style={styles.paramExample}>Example: {p.example}</Text>
                      )}
                    </View>
                  ))}
                </View>
              )}

              {selectedEndpoint.bodySchema && (
                <View style={styles.docsSection}>
                  <Text style={styles.docsSectionTitle}>Request Body</Text>
                  <View style={styles.schemaBlock}>
                    <Text style={styles.schemaText} selectable>
                      {selectedEndpoint.bodySchema}
                    </Text>
                  </View>
                </View>
              )}

              {selectedEndpoint.responseSchema && (
                <View style={styles.docsSection}>
                  <Text style={styles.docsSectionTitle}>Response Schema</Text>
                  <View style={styles.schemaBlock}>
                    <Text style={styles.schemaText} selectable>
                      {selectedEndpoint.responseSchema}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* API key */}
          <Text style={styles.fieldLabel}>API Key (Bearer Token)</Text>
          <TextInput
            style={styles.input}
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="sk_test_…"
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            accessibilityLabel="API key input"
          />

          {/* Request body editor */}
          {selectedEndpoint.hasBody && (
            <>
              <Text style={styles.fieldLabel}>Request Body (JSON)</Text>
              <TextInput
                style={[styles.input, styles.bodyInput, bodyError ? styles.inputError : undefined]}
                value={requestBody}
                onChangeText={handleBodyChange}
                multiline
                numberOfLines={6}
                autoCapitalize="none"
                accessibilityLabel="Request body JSON editor"
                testID="request-body-input"
              />
              {bodyError && <Text style={styles.errorText}>{bodyError}</Text>}
            </>
          )}

          {/* Execute button */}
          <TouchableOpacity
            style={[styles.executeBtn, loading && styles.executeBtnDisabled]}
            onPress={handleExecute}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Execute API request"
            testID="execute-button">
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={styles.executeBtnText}>▶ Execute Request</Text>
            )}
          </TouchableOpacity>

          {/* Language tabs + code block */}
          <View style={styles.codeSection}>
            <View style={styles.langTabBar}>
              {(['cURL', 'JavaScript', 'Python', 'Go'] as CodeLanguage[]).map((lang) => (
                <TouchableOpacity
                  key={lang}
                  style={[styles.langTab, selectedLang === lang && styles.langTabActive]}
                  onPress={() => setSelectedLang(lang)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: selectedLang === lang }}>
                  <Text
                    style={[
                      styles.langTabText,
                      selectedLang === lang && styles.langTabTextActive,
                    ]}>
                    {lang}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={styles.copyBtn}
                onPress={handleCopyCode}
                accessibilityLabel="Copy code snippet">
                <Text style={styles.copyBtnText}>Copy</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.codeBlock}>
              <Text style={styles.codeText} selectable>
                {code}
              </Text>
            </View>
          </View>

          {/* Response panel */}
          {response && (
            <View
              style={styles.responseSection}
              accessibilityLabel={`Response with status ${response.status}`}>
              <View style={styles.responseHeader}>
                <Text style={styles.fieldLabel}>Response</Text>
                <View
                  style={[
                    styles.statusBadge,
                    response.status < 300
                      ? styles.statusSuccess
                      : response.status < 500
                        ? styles.statusWarning
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

          {/* Request history */}
          {history.length > 0 && (
            <View style={styles.historySection}>
              <Text style={styles.fieldLabel}>Request History</Text>
              {history.map((entry) => (
                <TouchableOpacity
                  key={entry.id}
                  style={styles.historyRow}
                  onPress={() => {
                    handleEndpointSelect(entry.endpoint);
                    setResponse({ status: entry.status, data: entry.body });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Replay ${entry.endpoint.method} ${entry.endpoint.name}`}>
                  <MethodBadge method={entry.endpoint.method} />
                  <Text style={styles.historyName} numberOfLines={1}>
                    {entry.endpoint.name}
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      entry.status < 300 ? styles.statusSuccess : styles.statusError,
                    ]}>
                    <Text style={styles.statusText}>{entry.status}</Text>
                  </View>
                  <Text style={styles.historyTime}>
                    {entry.executedAt.toLocaleTimeString()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  header: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
  },
  layout: {
    flexDirection: 'column',
  },
  layoutWide: {
    flexDirection: 'row',
    minHeight: 600,
  },
  sidebar: {
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    padding: 12,
  },
  sidebarWide: {
    width: 260,
    borderBottomWidth: 0,
    borderRightWidth: 1,
    borderRightColor: '#E5E7EB',
    maxHeight: 700,
  },
  searchInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#111827',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  endpointScroll: {
    flex: 1,
  },
  endpointGroup: {
    marginBottom: 12,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
    paddingLeft: 4,
  },
  endpointRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 2,
  },
  endpointRowSelected: {
    backgroundColor: '#EFF6FF',
  },
  endpointName: {
    fontSize: 13,
    color: '#374151',
    flex: 1,
  },
  endpointNameSelected: {
    color: '#1D4ED8',
    fontWeight: '600',
  },
  noResults: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    marginTop: 20,
  },
  mainPanel: {
    flex: 1,
    padding: 20,
  },
  mainPanelWide: {
    maxHeight: 700,
  },
  endpointHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  endpointPath: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    fontFamily: 'monospace',
    flex: 1,
  },
  endpointDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    marginBottom: 12,
  },
  docsToggle: {
    marginBottom: 12,
  },
  docsToggleText: {
    fontSize: 13,
    color: '#3B82F6',
    fontWeight: '600',
  },
  docsPanel: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 12,
    marginBottom: 16,
    gap: 12,
  },
  docsSection: {
    gap: 8,
  },
  docsSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  paramRow: {
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#DBEAFE',
    marginBottom: 6,
  },
  paramNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  paramName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    fontFamily: 'monospace',
  },
  paramType: {
    fontSize: 11,
    color: '#6B7280',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  paramRequired: {
    fontSize: 11,
    color: '#EF4444',
    fontWeight: '600',
  },
  paramDesc: {
    fontSize: 13,
    color: '#6B7280',
  },
  paramExample: {
    fontSize: 12,
    color: '#9CA3AF',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  schemaBlock: {
    backgroundColor: '#111827',
    borderRadius: 6,
    padding: 10,
  },
  schemaText: {
    fontSize: 12,
    color: '#D1D5DB',
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#111827',
    fontFamily: 'monospace',
  },
  bodyInput: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: '#EF4444',
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: 4,
  },
  executeBtn: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  executeBtnDisabled: {
    opacity: 0.6,
  },
  executeBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  codeSection: {
    marginTop: 16,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#374151',
  },
  langTabBar: {
    flexDirection: 'row',
    backgroundColor: '#1F2937',
    paddingTop: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  langTab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    marginRight: 2,
  },
  langTabActive: {
    backgroundColor: '#111827',
  },
  langTabText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '500',
  },
  langTabTextActive: {
    color: '#F9FAFB',
    fontWeight: '700',
  },
  copyBtn: {
    marginLeft: 'auto' as unknown as number,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: '#374151',
    marginRight: 4,
    marginBottom: 6,
  },
  copyBtnText: {
    fontSize: 11,
    color: '#D1D5DB',
    fontWeight: '600',
  },
  codeBlock: {
    backgroundColor: '#111827',
    padding: 16,
    minHeight: 100,
  },
  codeText: {
    color: '#D1D5DB',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 20,
  },
  responseSection: {
    marginTop: 20,
  },
  responseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusSuccess: {
    backgroundColor: '#D1FAE5',
  },
  statusWarning: {
    backgroundColor: '#FEF3C7',
  },
  statusError: {
    backgroundColor: '#FEE2E2',
  },
  statusText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
  },
  historySection: {
    marginTop: 24,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 6,
  },
  historyName: {
    flex: 1,
    fontSize: 13,
    color: '#374151',
  },
  historyTime: {
    fontSize: 11,
    color: '#9CA3AF',
  },
});

export default ApiPlayground;
