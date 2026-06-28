import { IntegrationGuide, DocumentationSection } from '../../types/sandbox';

const INTEGRATION_GUIDES: IntegrationGuide[] = [
  {
    id: 'getting-started',
    title: 'Getting Started with SubTrackr API',
    description: 'Learn how to set up your development environment and make your first API call.',
    category: 'Quick Start',
    difficulty: 'beginner',
    estimatedTime: '15 minutes',
    tags: ['setup', 'authentication', 'first-call'],
    steps: [
      {
        id: 'step-1',
        title: 'Create a Developer Account',
        content:
          'Sign up for a SubTrackr developer account to access the API and sandbox environment.',
      },
      {
        id: 'step-2',
        title: 'Generate API Keys',
        content:
          'Navigate to the API Keys section in your developer portal and generate a new key pair.',
      },
      {
        id: 'step-3',
        title: 'Configure Your Environment',
        content: 'Set up your development environment with the necessary credentials and base URL.',
        codeExample: `const SUBTRACKR_API_KEY = 'sk_your_api_key_here';
const SUBTRACKR_BASE_URL = 'https://sandbox.subtrackr.io/api/v1';`,
        language: 'javascript',
      },
      {
        id: 'step-4',
        title: 'Make Your First Request',
        content: 'Test your setup by fetching your sandbox subscriptions.',
        codeExample: `const response = await fetch(\`\${SUBTRACKR_BASE_URL}/subscriptions\`, {
  headers: {
    'Authorization': \`Bearer \${SUBTRACKR_API_KEY}\`,
    'Content-Type': 'application/json',
  },
});

const data = await response.json();
console.log(data);`,
        language: 'javascript',
      },
    ],
  },
  {
    id: 'subscription-management',
    title: 'Managing Subscriptions',
    description: 'Learn how to create, update, and manage subscriptions through the API.',
    category: 'Core Features',
    difficulty: 'intermediate',
    estimatedTime: '30 minutes',
    tags: ['subscriptions', 'crud', 'management'],
    steps: [
      {
        id: 'step-1',
        title: 'Create a Subscription',
        content: 'Use the POST endpoint to create a new subscription in your sandbox.',
        codeExample: `const subscription = await fetch(\`\${SUBTRACKR_BASE_URL}/subscriptions\`, {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${SUBTRACKR_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: 'Netflix',
    category: 'streaming',
    price: 15.99,
    currency: 'USD',
    billingCycle: 'monthly',
    nextBillingDate: '2025-02-01',
  }),
});`,
        language: 'javascript',
      },
      {
        id: 'step-2',
        title: 'Update Subscription Details',
        content: 'Modify an existing subscription using the PATCH endpoint.',
        codeExample: `const updated = await fetch(\`\${SUBTRACKR_BASE_URL}/subscriptions/\${id}\`, {
  method: 'PATCH',
  headers: {
    'Authorization': \`Bearer \${SUBTRACKR_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    price: 17.99,
    notificationsEnabled: true,
  }),
});`,
        language: 'javascript',
      },
      {
        id: 'step-3',
        title: 'Delete a Subscription',
        content: 'Remove a subscription using the DELETE endpoint.',
        codeExample: `await fetch(\`\${SUBTRACKR_BASE_URL}/subscriptions/\${id}\`, {
  method: 'DELETE',
  headers: {
    'Authorization': \`Bearer \${SUBTRACKR_API_KEY}\`,
  },
});`,
        language: 'javascript',
      },
    ],
  },
  {
    id: 'webhook-integration',
    title: 'Setting Up Webhooks',
    description: 'Configure webhooks to receive real-time notifications about subscription events.',
    category: 'Integrations',
    difficulty: 'intermediate',
    estimatedTime: '25 minutes',
    tags: ['webhooks', 'events', 'notifications'],
    steps: [
      {
        id: 'step-1',
        title: 'Register a Webhook Endpoint',
        content: 'Create a webhook endpoint in your application to receive events.',
        codeExample: `const express = require('express');
const app = express();

app.post('/webhooks/subtrackr', express.json(), (req, res) => {
  const event = req.body;
  
  switch (event.type) {
    case 'subscription.created':
      console.log('New subscription created:', event.data);
      break;
    case 'subscription.renewed':
      console.log('Subscription renewed:', event.data);
      break;
    case 'subscription.cancelled':
      console.log('Subscription cancelled:', event.data);
      break;
  }
  
  res.status(200).json({ received: true });
});`,
        language: 'javascript',
      },
      {
        id: 'step-2',
        title: 'Configure Webhook in SubTrackr',
        content: 'Register your webhook endpoint URL in the SubTrackr developer portal.',
      },
      {
        id: 'step-3',
        title: 'Verify Webhook Signatures',
        content: 'Ensure webhook payloads are authentic by verifying the signature.',
        codeExample: `const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}`,
        language: 'javascript',
      },
    ],
  },
  {
    id: 'crypto-payments',
    title: 'Integrating Crypto Payments',
    description: 'Learn how to set up and manage cryptocurrency payment streams for subscriptions.',
    category: 'Advanced',
    difficulty: 'advanced',
    estimatedTime: '45 minutes',
    tags: ['crypto', 'superfluid', 'payments'],
    steps: [
      {
        id: 'step-1',
        title: 'Connect a Wallet',
        content: 'Establish a connection to a cryptocurrency wallet for payment processing.',
        codeExample: `const walletConnection = await fetch(\`\${SUBTRACKR_BASE_URL}/wallet/connect\`, {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${SUBTRACKR_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    address: '0x...',
    chainId: 1,
  }),
});`,
        language: 'javascript',
      },
      {
        id: 'step-2',
        title: 'Create a Payment Stream',
        content: 'Set up a continuous payment stream using Superfluid protocol.',
        codeExample: `const stream = await fetch(\`\${SUBTRACKR_BASE_URL}/crypto/streams\`, {
  method: 'POST',
  headers: {
    'Authorization': \`Bearer \${SUBTRACKR_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    subscriptionId: 'sub_123',
    token: 'USDC',
    flowRate: '1000000',
    recipient: '0x...',
  }),
});`,
        language: 'javascript',
      },
    ],
  },
];

const DOCUMENTATION_SECTIONS: DocumentationSection[] = [
  {
    id: 'api-reference',
    title: 'API Reference',
    content: 'Complete reference for all SubTrackr API endpoints.',
    subsections: [
      {
        id: 'authentication',
        title: 'Authentication',
        content: 'Learn how to authenticate your API requests using API keys.',
        subsections: [],
        lastUpdated: new Date('2025-01-15'),
      },
      {
        id: 'subscriptions-api',
        title: 'Subscriptions',
        content: 'Endpoints for managing subscriptions, including CRUD operations.',
        subsections: [],
        lastUpdated: new Date('2025-01-15'),
      },
      {
        id: 'analytics-api',
        title: 'Analytics',
        content: 'Endpoints for retrieving subscription analytics and insights.',
        subsections: [],
        lastUpdated: new Date('2025-01-10'),
      },
      {
        id: 'webhooks-api',
        title: 'Webhooks',
        content: 'Endpoints for managing webhook configurations and events.',
        subsections: [],
        lastUpdated: new Date('2025-01-12'),
      },
    ],
    lastUpdated: new Date('2025-01-15'),
  },
  {
    id: 'guides',
    title: 'Integration Guides',
    content: 'Step-by-step guides for common integration scenarios.',
    subsections: [],
    lastUpdated: new Date('2025-01-14'),
  },
  {
    id: 'sdks',
    title: 'SDKs & Libraries',
    content: 'Official client libraries for popular programming languages.',
    subsections: [
      {
        id: 'javascript-sdk',
        title: 'JavaScript/TypeScript SDK',
        content: 'Official SDK for JavaScript and TypeScript applications.',
        subsections: [],
        lastUpdated: new Date('2025-01-13'),
      },
      {
        id: 'python-sdk',
        title: 'Python SDK',
        content: 'Official SDK for Python applications.',
        subsections: [],
        lastUpdated: new Date('2025-01-13'),
      },
    ],
    lastUpdated: new Date('2025-01-13'),
  },
  {
    id: 'rate-limits',
    title: 'Rate Limits',
    content: 'Understanding and working with API rate limits.',
    subsections: [],
    lastUpdated: new Date('2025-01-11'),
  },
  {
    id: 'error-handling',
    title: 'Error Handling',
    content: 'Common error codes and how to handle them gracefully.',
    subsections: [],
    lastUpdated: new Date('2025-01-10'),
  },
];

class DocumentationService {
  private static instance: DocumentationService;

  private constructor() {}

  static getInstance(): DocumentationService {
    if (!DocumentationService.instance) {
      DocumentationService.instance = new DocumentationService();
    }
    return DocumentationService.instance;
  }

  getIntegrationGuides(): IntegrationGuide[] {
    return INTEGRATION_GUIDES;
  }

  getIntegrationGuide(id: string): IntegrationGuide | undefined {
    return INTEGRATION_GUIDES.find((guide) => guide.id === id);
  }

  getGuidesByCategory(category: string): IntegrationGuide[] {
    return INTEGRATION_GUIDES.filter((guide) => guide.category === category);
  }

  getGuidesByDifficulty(difficulty: 'beginner' | 'intermediate' | 'advanced'): IntegrationGuide[] {
    return INTEGRATION_GUIDES.filter((guide) => guide.difficulty === difficulty);
  }

  searchGuides(query: string): IntegrationGuide[] {
    const lowerQuery = query.toLowerCase();
    return INTEGRATION_GUIDES.filter(
      (guide) =>
        guide.title.toLowerCase().includes(lowerQuery) ||
        guide.description.toLowerCase().includes(lowerQuery) ||
        guide.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
    );
  }

  getDocumentationSections(): DocumentationSection[] {
    return DOCUMENTATION_SECTIONS;
  }

  getDocumentationSection(id: string): DocumentationSection | undefined {
    return DOCUMENTATION_SECTIONS.find((section) => section.id === id);
  }

  searchDocumentation(query: string): DocumentationSection[] {
    const lowerQuery = query.toLowerCase();
    const results: DocumentationSection[] = [];

    const searchRecursive = (sections: DocumentationSection[]) => {
      sections.forEach((section) => {
        if (
          section.title.toLowerCase().includes(lowerQuery) ||
          section.content.toLowerCase().includes(lowerQuery)
        ) {
          results.push(section);
        }
        searchRecursive(section.subsections);
      });
    };

    searchRecursive(DOCUMENTATION_SECTIONS);
    return results;
  }
}

export const documentationService = DocumentationService.getInstance();
