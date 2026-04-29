import { DocumentationSection, DocumentationArticle } from '../types/portal';

export class DocumentationService {
  private sections: DocumentationSection[] = [];
  private articles: Map<string, DocumentationArticle> = new Map();

  constructor() {
    this.initializeDocumentation();
  }

  private initializeDocumentation(): void {
    this.sections = [
      {
        id: 'getting-started',
        title: 'Getting Started',
        description: 'Learn the basics of SubTrackr API',
        articles: [
          this.createArticle(
            'Quick Start Guide',
            'quick-start',
            'getting-started',
            `# Quick Start Guide

## Welcome to SubTrackr

SubTrackr provides a powerful API for managing subscriptions on the blockchain. This guide will help you get started in minutes.

## Step 1: Get Your API Key

1. Sign up at developer.subtrackr.io
2. Create a sandbox environment
3. Generate your first API key

## Step 2: Install the SDK

\`\`\`bash
npm install @subtrackr/sdk
\`\`\`

## Step 3: Make Your First Request

\`\`\`typescript
import { SubTrackr } from '@subtrackr/sdk';

const client = new SubTrackr({
  apiKey: 'your-api-key',
  environment: 'sandbox'
});

// List subscriptions
const subscriptions = await client.subscriptions.list();
console.log(subscriptions);
\`\`\`

## Next Steps

- Read the [API Reference](/docs/api)
- Explore [Integration Guides](/guides)
- Join our [Developer Community](/community)`,
            ['quick-start', 'setup', 'beginner'],
            5
          ),
          this.createArticle(
            'Authentication',
            'authentication',
            'getting-started',
            `# Authentication

## API Key Authentication

All API requests require an API key in the Authorization header:

\`\`\`bash
curl -X GET https://api.subtrackr.io/v1/subscriptions \\
  -H "Authorization: Bearer YOUR_API_KEY"
\`\`\`

## Sandbox vs Production

| Feature | Sandbox | Production |
|---------|---------|------------|
| Base URL | sandbox.api.subtrackr.io | api.subtrackr.io |
| Rate Limits | 60 req/min | 300 req/min |
| Data | Test data | Real data |
| Payments | Simulated | Real |

## Security Best Practices

1. Never expose API keys in client-side code
2. Use environment variables for key storage
3. Rotate keys regularly
4. Use least-privilege permissions`,
            ['authentication', 'security', 'api-keys'],
            8
          ),
        ],
      },
      {
        id: 'api-reference',
        title: 'API Reference',
        description: 'Complete API documentation',
        articles: [
          this.createArticle(
            'Subscriptions API',
            'subscriptions-api',
            'api-reference',
            `# Subscriptions API

## List Subscriptions

\`\`\`http
GET /v1/subscriptions
\`\`\`

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| status | string | Filter by status (active, paused, cancelled) |
| limit | number | Number of results (default: 20) |
| offset | number | Pagination offset |

### Response

\`\`\`json
{
  "data": [
    {
      "id": "sub_123",
      "userId": "user_456",
      "plan": "premium",
      "status": "active",
      "amount": 29.99,
      "currency": "USD",
      "nextBillingDate": "2026-05-28T00:00:00Z"
    }
  ],
  "total": 100,
  "hasMore": true
}
\`\`\`

## Create Subscription

\`\`\`http
POST /v1/subscriptions
\`\`\`

### Request Body

\`\`\`json
{
  "userId": "user_456",
  "planId": "plan_789",
  "paymentMethod": "wallet_0x123..."
}
\`\`\``,
            ['subscriptions', 'api', 'rest'],
            12
          ),
          this.createArticle(
            'Payments API',
            'payments-api',
            'api-reference',
            `# Payments API

## List Payments

\`\`\`http
GET /v1/payments
\`\`\`

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| subscriptionId | string | Filter by subscription |
| status | string | Filter by status |
| from | date | Start date |
| to | date | End date |

## Process Payment

\`\`\`http
POST /v1/payments
\`\`\`

### Request Body

\`\`\`json
{
  "subscriptionId": "sub_123",
  "amount": 29.99,
  "currency": "USD",
  "walletAddress": "0x..."
}
\`\`\`

### Response

\`\`\`json
{
  "id": "pay_789",
  "status": "completed",
  "transactionHash": "0xabc123...",
  "confirmedAt": "2026-04-28T12:00:00Z"
}
\`\`\``,
            ['payments', 'api', 'transactions'],
            10
          ),
        ],
      },
      {
        id: 'guides',
        title: 'Integration Guides',
        description: 'Step-by-step integration tutorials',
        articles: [
          this.createArticle(
            'Webhook Integration',
            'webhook-integration',
            'guides',
            `# Webhook Integration

## Overview

Webhooks allow you to receive real-time notifications when events occur in your SubTrackr account.

## Setting Up Webhooks

### 1. Create a Webhook Endpoint

\`\`\`typescript
import { SubTrackr } from '@subtrackr/sdk';

const client = new SubTrackr({ apiKey: 'your-key' });

const webhook = await client.webhooks.create({
  url: 'https://your-app.com/webhooks',
  events: ['subscription.created', 'payment.completed']
});
\`\`\`

### 2. Verify Webhook Signatures

\`\`\`typescript
import { verifyWebhookSignature } from '@subtrackr/sdk';

app.post('/webhooks', (req, res) => {
  const signature = req.headers['x-subtrackr-signature'];
  const isValid = verifyWebhookSignature(req.body, signature, webhookSecret);
  
  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process webhook event
  const event = req.body;
  console.log('Received event:', event.type);
  
  res.status(200).send('OK');
});
\`\`\`

## Event Types

| Event | Description |
|-------|-------------|
| subscription.created | New subscription created |
| subscription.updated | Subscription modified |
| subscription.cancelled | Subscription cancelled |
| payment.completed | Payment successful |
| payment.failed | Payment failed |`,
            ['webhooks', 'events', 'real-time'],
            15
          ),
        ],
      },
    ];

    this.sections.forEach(section => {
      section.articles.forEach(article => {
        this.articles.set(article.slug, article);
      });
    });
  }

  private createArticle(
    title: string,
    slug: string,
    category: string,
    content: string,
    tags: string[],
    readTime: number
  ): DocumentationArticle {
    return {
      id: crypto.randomUUID(),
      title,
      slug,
      content,
      category,
      tags,
      readTime,
      lastUpdated: new Date(),
    };
  }

  async getSections(): Promise<DocumentationSection[]> {
    return this.sections;
  }

  async getSection(sectionId: string): Promise<DocumentationSection | null> {
    return this.sections.find(s => s.id === sectionId) || null;
  }

  async getArticle(slug: string): Promise<DocumentationArticle | null> {
    return this.articles.get(slug) || null;
  }

  async searchArticles(query: string): Promise<DocumentationArticle[]> {
    const lowerQuery = query.toLowerCase();
    const results: DocumentationArticle[] = [];

    this.articles.forEach(article => {
      const matchesTitle = article.title.toLowerCase().includes(lowerQuery);
      const matchesContent = article.content.toLowerCase().includes(lowerQuery);
      const matchesTags = article.tags.some(tag =>
        tag.toLowerCase().includes(lowerQuery)
      );

      if (matchesTitle || matchesContent || matchesTags) {
        results.push(article);
      }
    });

    return results;
  }

  async getPopularArticles(limit: number = 5): Promise<DocumentationArticle[]> {
    return Array.from(this.articles.values())
      .sort((a, b) => b.readTime - a.readTime)
      .slice(0, limit);
  }

  async getRelatedArticles(slug: string): Promise<DocumentationArticle[]> {
    const article = this.articles.get(slug);
    if (!article) return [];

    return Array.from(this.articles.values())
      .filter(a => a.slug !== slug && a.category === article.category)
      .slice(0, 3);
  }
}
