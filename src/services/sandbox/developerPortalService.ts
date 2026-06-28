import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DeveloperProfile,
  DeveloperStatus,
  OnboardingStep,
  DocumentationSection,
  IntegrationGuide,
} from '../../types/developerPortal';

const DEVELOPER_STORAGE_KEY = 'subtrackr-developer';

const generateId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `dev_${timestamp}_${random}`;
};

const DEFAULT_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'create-account',
    title: 'Create Developer Account',
    description: 'Sign up for a developer account to access the SubTrackr API.',
    isCompleted: false,
    isRequired: true,
    order: 1,
  },
  {
    id: 'verify-email',
    title: 'Verify Email Address',
    description: 'Confirm your email address to activate your account.',
    isCompleted: false,
    isRequired: true,
    order: 2,
  },
  {
    id: 'generate-api-key',
    title: 'Generate API Key',
    description: 'Create your first API key to start making API calls.',
    isCompleted: false,
    isRequired: true,
    order: 3,
    action: 'generate-api-key',
  },
  {
    id: 'create-sandbox',
    title: 'Create Sandbox Environment',
    description: 'Set up a sandbox environment for testing your integration.',
    isCompleted: false,
    isRequired: true,
    order: 4,
    action: 'create-sandbox',
  },
  {
    id: 'explore-docs',
    title: 'Explore Documentation',
    description: 'Review the API documentation and integration guides.',
    isCompleted: false,
    isRequired: false,
    order: 5,
    link: '/docs',
  },
  {
    id: 'first-api-call',
    title: 'Make First API Call',
    description: 'Test your integration by making your first API call.',
    isCompleted: false,
    isRequired: true,
    order: 6,
  },
];

const DOCUMENTATION_SECTIONS: DocumentationSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    slug: 'getting-started',
    content: `# Getting Started with SubTrackr API

Welcome to the SubTrackr API documentation. This guide will help you get started with integrating SubTrackr into your application.

## Overview

The SubTrackr API allows you to:
- Manage subscriptions programmatically
- Track subscription usage and analytics
- Handle billing and payments
- Generate reports and insights

## Authentication

All API requests require authentication using an API key. Include your API key in the Authorization header:

\`\`\`
Authorization: Bearer sk_live_your_api_key_here
\`\`\`

## Base URL

\`\`\`
https://api.subtrackr.com/v1
\`\`\`

## Rate Limits

- Free tier: 100 requests/minute
- Basic tier: 1,000 requests/minute
- Pro tier: 10,000 requests/minute
- Enterprise: Custom limits`,
    category: 'Basics',
    order: 1,
    tags: ['introduction', 'authentication', 'setup'],
    lastUpdated: new Date(),
  },
  {
    id: 'subscriptions-api',
    title: 'Subscriptions API',
    slug: 'subscriptions-api',
    content: `# Subscriptions API

## List Subscriptions

\`\`\`
GET /subscriptions
\`\`\`

Returns a list of all subscriptions for the authenticated user.

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| page | integer | Page number (default: 1) |
| limit | integer | Items per page (default: 20) |
| status | string | Filter by status: active, inactive, cancelled |
| category | string | Filter by category |

### Response

\`\`\`json
{
  "data": [
    {
      "id": "sub_123",
      "name": "Netflix",
      "price": 15.99,
      "currency": "USD",
      "billingCycle": "monthly",
      "status": "active"
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20
}
\`\`\`

## Create Subscription

\`\`\`
POST /subscriptions
\`\`\`

Create a new subscription.

### Request Body

\`\`\`json
{
  "name": "Netflix",
  "price": 15.99,
  "currency": "USD",
  "billingCycle": "monthly",
  "category": "streaming"
}
\`\`\``,
    category: 'API Reference',
    order: 2,
    tags: ['subscriptions', 'api', 'crud'],
    lastUpdated: new Date(),
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    slug: 'webhooks',
    content: `# Webhooks

## Overview

Webhooks allow you to receive real-time notifications when events occur in your SubTrackr account.

## Setting Up Webhooks

1. Go to Developer Portal > Webhooks
2. Click "Add Webhook"
3. Enter your endpoint URL
4. Select events to subscribe to
5. Save your webhook

## Event Types

| Event | Description |
|-------|-------------|
| subscription.created | A new subscription was created |
| subscription.updated | A subscription was updated |
| subscription.cancelled | A subscription was cancelled |
| payment.succeeded | A payment was successful |
| payment.failed | A payment failed |

## Webhook Payload

\`\`\`json
{
  "id": "evt_123",
  "type": "subscription.created",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "subscriptionId": "sub_123",
    "name": "Netflix",
    "price": 15.99
  }
}
\`\`\`

## Verifying Webhooks

All webhook payloads include a signature header for verification:

\`\`\`
X-SubTrackr-Signature: sha256=...
\`\`\``,
    category: 'API Reference',
    order: 3,
    tags: ['webhooks', 'events', 'notifications'],
    lastUpdated: new Date(),
  },
  {
    id: 'error-handling',
    title: 'Error Handling',
    slug: 'error-handling',
    content: `# Error Handling

## Error Response Format

All errors follow a consistent format:

\`\`\`json
{
  "error": {
    "code": "invalid_request",
    "message": "The request body is invalid",
    "details": {
      "field": "price",
      "issue": "Must be a positive number"
    }
  }
}
\`\`\`

## Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| unauthorized | 401 | Invalid or missing API key |
| forbidden | 403 | Insufficient permissions |
| not_found | 404 | Resource not found |
| invalid_request | 400 | Invalid request parameters |
| rate_limit_exceeded | 429 | Too many requests |
| internal_error | 500 | Server error |

## Best Practices

1. Always check the HTTP status code first
2. Handle rate limiting with exponential backoff
3. Log error details for debugging
4. Implement retry logic for transient errors`,
    category: 'API Reference',
    order: 4,
    tags: ['errors', 'debugging', 'best-practices'],
    lastUpdated: new Date(),
  },
];

const INTEGRATION_GUIDES: IntegrationGuide[] = [
  {
    id: 'quickstart-node',
    title: 'Node.js Quickstart',
    description: 'Get started with SubTrackr API in Node.js',
    difficulty: 'beginner',
    estimatedTime: '15 minutes',
    prerequisites: ['Node.js 16+', 'npm or yarn'],
    steps: [
      {
        title: 'Install the SDK',
        content: 'Install the SubTrackr Node.js SDK using npm.',
        code: 'npm install @subtrackr/sdk',
        language: 'bash',
      },
      {
        title: 'Initialize the Client',
        content: 'Create a new SubTrackr client with your API key.',
        code: `import { SubTrackr } from '@subtrackr/sdk';

const client = new SubTrackr({
  apiKey: process.env.SUBTRACKR_API_KEY,
});`,
        language: 'typescript',
      },
      {
        title: 'List Subscriptions',
        content: 'Fetch all subscriptions for the authenticated user.',
        code: `const subscriptions = await client.subscriptions.list({
  page: 1,
  limit: 20,
});

console.log(subscriptions.data);`,
        language: 'typescript',
      },
      {
        title: 'Create a Subscription',
        content: 'Create a new subscription.',
        code: `const subscription = await client.subscriptions.create({
  name: 'Netflix',
  price: 15.99,
  currency: 'USD',
  billingCycle: 'monthly',
  category: 'streaming',
});

console.log(subscription.id);`,
        language: 'typescript',
      },
    ],
    tags: ['nodejs', 'quickstart', 'sdk'],
    order: 1,
  },
  {
    id: 'quickstart-python',
    title: 'Python Quickstart',
    description: 'Get started with SubTrackr API in Python',
    difficulty: 'beginner',
    estimatedTime: '15 minutes',
    prerequisites: ['Python 3.8+'],
    steps: [
      {
        title: 'Install the SDK',
        content: 'Install the SubTrackr Python SDK using pip.',
        code: 'pip install subtrackr',
        language: 'bash',
      },
      {
        title: 'Initialize the Client',
        content: 'Create a new SubTrackr client with your API key.',
        code: `import os
from subtrackr import SubTrackr

client = SubTrackr(api_key=os.environ["SUBTRACKR_API_KEY"])`,
        language: 'python',
      },
      {
        title: 'List Subscriptions',
        content: 'Fetch all subscriptions for the authenticated user.',
        code: `subscriptions = client.subscriptions.list(page=1, limit=20)

for sub in subscriptions.data:
    print(f"{sub.name}: \${sub.price}/{sub.billing_cycle}")`,
        language: 'python',
      },
      {
        title: 'Create a Subscription',
        content: 'Create a new subscription.',
        code: `subscription = client.subscriptions.create(
    name="Netflix",
    price=15.99,
    currency="USD",
    billing_cycle="monthly",
    category="streaming",
)

print(f"Created subscription: {subscription.id}")`,
        language: 'python',
      },
    ],
    tags: ['python', 'quickstart', 'sdk'],
    order: 2,
  },
  {
    id: 'webhook-integration',
    title: 'Webhook Integration',
    description: 'Learn how to receive and handle SubTrackr webhooks',
    difficulty: 'intermediate',
    estimatedTime: '30 minutes',
    prerequisites: ['Public endpoint or webhook testing tool', 'Node.js or Python'],
    steps: [
      {
        title: 'Set Up Webhook Endpoint',
        content: 'Create an endpoint to receive webhook events.',
        code: `import express from 'express';
import crypto from 'crypto';

const app = express();
app.use(express.json());

app.post('/webhooks/subtrackr', (req, res) => {
  const signature = req.headers['x-subtrackr-signature'];
  const payload = JSON.stringify(req.body);
  
  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
    
  if (signature !== \`sha256=\${expectedSignature}\`) {
    return res.status(401).send('Invalid signature');
  }
  
  // Handle event
  const { type, data } = req.body;
  console.log(\`Received event: \${type}\`);
  
  res.status(200).send('OK');
});`,
        language: 'typescript',
      },
      {
        title: 'Register Webhook in Dashboard',
        content: 'Configure your webhook endpoint in the SubTrackr developer portal.',
      },
      {
        title: 'Test with Sandbox Events',
        content: 'Use the sandbox environment to test your webhook integration.',
      },
    ],
    tags: ['webhooks', 'integration', 'events'],
    order: 3,
  },
  {
    id: 'crypto-payments',
    title: 'Crypto Payment Integration',
    description: 'Integrate cryptocurrency payments for subscriptions',
    difficulty: 'advanced',
    estimatedTime: '1 hour',
    prerequisites: ['Understanding of blockchain', 'WalletConnect project ID'],
    steps: [
      {
        title: 'Configure Crypto Settings',
        content: 'Enable cryptocurrency payments in your SubTrackr configuration.',
        code: `const client = new SubTrackr({
  apiKey: process.env.SUBTRACKR_API_KEY,
  crypto: {
    enabled: true,
    networks: ['ethereum', 'polygon'],
    tokens: ['USDC', 'USDT', 'DAI'],
  },
});`,
        language: 'typescript',
      },
      {
        title: 'Create Crypto Subscription',
        content: 'Create a subscription with cryptocurrency payment.',
        code: `const subscription = await client.subscriptions.create({
  name: 'Premium Plan',
  price: 99.99,
  currency: 'USDC',
  billingCycle: 'monthly',
  paymentMethod: 'crypto',
  crypto: {
    network: 'polygon',
    token: 'USDC',
  },
});`,
        language: 'typescript',
      },
      {
        title: 'Monitor Stream Status',
        content: 'Track the status of crypto payment streams.',
        code: `const stream = await client.crypto.getStream(subscription.id);

console.log(\`Stream status: \${stream.status}\`);
console.log(\`Amount streamed: \${stream.streamedAmount}\`);`,
        language: 'typescript',
      },
    ],
    tags: ['crypto', 'payments', 'blockchain', 'advanced'],
    order: 4,
  },
];

class DeveloperPortalService {
  private developers: Map<string, DeveloperProfile> = new Map();
  private onboardingSteps: Map<string, OnboardingStep[]> = new Map();

  async registerDeveloper(
    email: string,
    name: string,
    company?: string,
    website?: string
  ): Promise<DeveloperProfile> {
    const id = generateId();
    const now = new Date();

    const developer: DeveloperProfile = {
      id,
      email,
      name,
      company,
      website,
      status: DeveloperStatus.ACTIVE,
      tier: 'free',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };

    this.developers.set(id, developer);
    this.onboardingSteps.set(id, [...DEFAULT_ONBOARDING_STEPS]);
    await this.persistDevelopers();
    return developer;
  }

  async getDeveloper(developerId: string): Promise<DeveloperProfile | null> {
    return this.developers.get(developerId) || null;
  }

  async updateDeveloper(
    developerId: string,
    updates: Partial<DeveloperProfile>
  ): Promise<DeveloperProfile | null> {
    const developer = this.developers.get(developerId);
    if (!developer) return null;

    const updated = { ...developer, ...updates, updatedAt: new Date() };
    this.developers.set(developerId, updated);
    await this.persistDevelopers();
    return updated;
  }

  async getOnboardingSteps(developerId: string): Promise<OnboardingStep[]> {
    return this.onboardingSteps.get(developerId) || [];
  }

  async completeOnboardingStep(
    developerId: string,
    stepId: string
  ): Promise<OnboardingStep[] | null> {
    const steps = this.onboardingSteps.get(developerId);
    if (!steps) return null;

    const updatedSteps = steps.map((step) =>
      step.id === stepId ? { ...step, isCompleted: true } : step
    );

    this.onboardingSteps.set(developerId, updatedSteps);
    await this.persistOnboardingSteps(developerId);
    return updatedSteps;
  }

  async isOnboardingComplete(developerId: string): Promise<boolean> {
    const steps = this.onboardingSteps.get(developerId) || [];
    return steps.filter((s) => s.isRequired).every((s) => s.isCompleted);
  }

  getDocumentationSections(): DocumentationSection[] {
    return DOCUMENTATION_SECTIONS;
  }

  getDocumentationByCategory(category: string): DocumentationSection[] {
    return DOCUMENTATION_SECTIONS.filter((s) => s.category === category);
  }

  getDocumentationBySlug(slug: string): DocumentationSection | null {
    return DOCUMENTATION_SECTIONS.find((s) => s.slug === slug) || null;
  }

  searchDocumentation(query: string): DocumentationSection[] {
    const lowerQuery = query.toLowerCase();
    return DOCUMENTATION_SECTIONS.filter(
      (section) =>
        section.title.toLowerCase().includes(lowerQuery) ||
        section.content.toLowerCase().includes(lowerQuery) ||
        section.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
    );
  }

  getIntegrationGuides(): IntegrationGuide[] {
    return INTEGRATION_GUIDES;
  }

  getIntegrationGuideById(id: string): IntegrationGuide | null {
    return INTEGRATION_GUIDES.find((g) => g.id === id) || null;
  }

  getIntegrationGuidesByDifficulty(difficulty: IntegrationGuide['difficulty']): IntegrationGuide[] {
    return INTEGRATION_GUIDES.filter((g) => g.difficulty === difficulty);
  }

  searchIntegrationGuides(query: string): IntegrationGuide[] {
    const lowerQuery = query.toLowerCase();
    return INTEGRATION_GUIDES.filter(
      (guide) =>
        guide.title.toLowerCase().includes(lowerQuery) ||
        guide.description.toLowerCase().includes(lowerQuery) ||
        guide.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
    );
  }

  private async persistDevelopers(): Promise<void> {
    try {
      const data = Array.from(this.developers.entries());
      await AsyncStorage.setItem(DEVELOPER_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to persist developers:', error);
    }
  }

  private async persistOnboardingSteps(developerId: string): Promise<void> {
    try {
      const steps = this.onboardingSteps.get(developerId);
      if (steps) {
        await AsyncStorage.setItem(
          `${DEVELOPER_STORAGE_KEY}-onboarding-${developerId}`,
          JSON.stringify(steps)
        );
      }
    } catch (error) {
      console.error('Failed to persist onboarding steps:', error);
    }
  }

  async loadDevelopers(): Promise<void> {
    try {
      const data = await AsyncStorage.getItem(DEVELOPER_STORAGE_KEY);
      if (data) {
        const entries = JSON.parse(data) as [string, DeveloperProfile][];
        this.developers = new Map(entries);
      }

      for (const [id] of this.developers) {
        const stepsData = await AsyncStorage.getItem(`${DEVELOPER_STORAGE_KEY}-onboarding-${id}`);
        if (stepsData) {
          this.onboardingSteps.set(id, JSON.parse(stepsData));
        } else {
          this.onboardingSteps.set(id, [...DEFAULT_ONBOARDING_STEPS]);
        }
      }
    } catch (error) {
      console.error('Failed to load developers:', error);
    }
  }
}

export const developerPortalService = new DeveloperPortalService();
