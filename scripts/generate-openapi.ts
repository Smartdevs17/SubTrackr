#!/usr/bin/env node
/**
 * Issue #1784 — OpenAPI specification generation from source schemas
 *
 * Generates developer-portal/docs/openapi.json and spec/openapi.yaml
 * from source Zod validation schemas in backend/services/shared/schemas.ts.
 *
 * Usage:
 *   npx tsx scripts/generate-openapi.ts          # Regenerate OpenAPI specs
 *   npx tsx scripts/generate-openapi.ts --check  # Verify specs have no drift
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import {
  createPlanSchema,
  updatePlanSchema,
  planQuerySchema,
  createSubscriptionSchema,
  updateSubscriptionSchema,
  cancelSubscriptionSchema,
  pauseSubscriptionSchema,
  subscriptionQuerySchema,
  paymentRequestSchema,
  refundRequestSchema,
  paymentQuerySchema,
  createWebhookSchema,
  createApiKeySchema,
  analyticsQuerySchema,
  forecastRequestSchema,
  customerQuerySchema,
  fallbackChainSchema,
  fallbackQuerySchema,
  corsPolicySchema,
  idParamSchema,
  subscriptionIdParamSchema,
  planIdParamSchema,
} from '../backend/services/shared/schemas';

const root = process.cwd();
const jsonPath = path.join(root, 'developer-portal/docs/openapi.json');
const yamlPath = path.join(root, 'spec/openapi.yaml');

function schemaToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema['$schema'];
  return jsonSchema;
}

export function generateOpenApiSpec(): Record<string, unknown> {
  const planInput = schemaToJsonSchema(createPlanSchema);
  const planUpdate = schemaToJsonSchema(updatePlanSchema);
  const subInput = schemaToJsonSchema(createSubscriptionSchema);
  const subUpdate = schemaToJsonSchema(updateSubscriptionSchema);
  const subCancel = schemaToJsonSchema(cancelSubscriptionSchema);
  const subPause = schemaToJsonSchema(pauseSubscriptionSchema);
  const paymentRequest = schemaToJsonSchema(paymentRequestSchema);
  const refundRequest = schemaToJsonSchema(refundRequestSchema);
  const webhookInput = schemaToJsonSchema(createWebhookSchema);
  const apiKeyInput = schemaToJsonSchema(createApiKeySchema);
  const analyticsQuery = schemaToJsonSchema(analyticsQuerySchema);
  const forecastRequest = schemaToJsonSchema(forecastRequestSchema);
  const fallbackChain = schemaToJsonSchema(fallbackChainSchema);
  const corsPolicy = schemaToJsonSchema(corsPolicySchema);

  const errorEnvelopeSchema = {
    type: 'object',
    required: ['success', 'error', 'meta'],
    properties: {
      success: { type: 'boolean', const: false },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          details: { type: 'object', additionalProperties: true },
          version: { type: 'string' },
        },
      },
      meta: {
        type: 'object',
        required: ['timestamp', 'requestId', 'apiVersion'],
        properties: {
          timestamp: { type: 'string', format: 'date-time' },
          requestId: { type: 'string' },
          apiVersion: { type: 'string' },
        },
      },
    },
  };

  const metaSchema = {
    type: 'object',
    required: ['timestamp', 'requestId', 'apiVersion'],
    properties: {
      timestamp: { type: 'string', format: 'date-time' },
      requestId: { type: 'string' },
      apiVersion: { type: 'string' },
    },
  };

  const paginationSchema = {
    type: 'object',
    properties: {
      nextCursor: { type: ['string', 'null'] },
      hasMore: { type: 'boolean' },
      limit: { type: 'integer' },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'SubTrackr API',
      version: '1.0.0',
      description:
        'API specification for SubTrackr subscription management, billing, webhooks, and payments.\n\nBase paths are versioned under `/v1` and authenticated with a Bearer token (`sk_test_...` for sandbox, `sk_live_...` for production).',
      contact: {
        name: 'SubTrackr Support',
        email: 'support@subtrackr.io',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: 'https://api.subtrackr.io/v1',
        description: 'Production Server',
      },
      {
        url: 'https://sandbox.api.subtrackr.io/v1',
        description: 'Sandbox Server',
      },
      {
        url: 'http://localhost:3000/v1',
        description: 'Local Development Server',
      },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication' },
      { name: 'Subscriptions', description: 'Manage subscriptions' },
      { name: 'Plans', description: 'Plans and pricing' },
      { name: 'Payments', description: 'Payment records' },
      { name: 'Invoices', description: 'Invoices and billing' },
      { name: 'Webhooks', description: 'Webhook configuration and delivery' },
      { name: 'Analytics', description: 'Usage and subscription analytics' },
      { name: 'Themes', description: 'Theme management for merchants' },
    ],
    paths: {
      '/auth/login': {
        post: {
          summary: 'Authenticate user',
          operationId: 'loginUser',
          tags: ['Auth'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string' },
                  },
                  required: ['email', 'password'],
                  example: { email: 'dev@example.com', password: 'secret' },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Authentication successful',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      token: { type: 'string' },
                      expiresIn: { type: 'integer' },
                    },
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/subscriptions': {
        get: {
          summary: 'List subscriptions',
          operationId: 'listSubscriptions',
          tags: ['Subscriptions'],
          security: [{ BearerAuth: [] }],
          parameters: [
            {
              name: 'status',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['active', 'paused', 'cancelled', 'past_due', 'trialing'],
              },
            },
            { name: 'customerId', in: 'query', schema: { type: 'string' } },
            { name: 'planId', in: 'query', schema: { type: 'string' } },
            {
              name: 'cursor',
              in: 'query',
              schema: { type: 'string' },
              description: 'Opaque pagination cursor',
            },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          ],
          responses: {
            '200': {
              description: 'List of subscriptions',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/SubscriptionList' },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
        post: {
          summary: 'Create subscription',
          operationId: 'createSubscription',
          tags: ['Subscriptions'],
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SubscriptionInput' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Subscription created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Subscription' },
                },
              },
            },
            '400': { $ref: '#/components/responses/BadRequest' },
            '422': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/subscriptions/{id}': {
        get: {
          summary: 'Get subscription',
          operationId: 'getSubscription',
          tags: ['Subscriptions'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Subscription',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Subscription' },
                },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
        put: {
          summary: 'Update subscription',
          operationId: 'updateSubscription',
          tags: ['Subscriptions'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SubscriptionUpdate' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated subscription',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Subscription' },
                },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
            '422': { $ref: '#/components/responses/ValidationError' },
          },
        },
        delete: {
          summary: 'Delete subscription',
          operationId: 'deleteSubscription',
          tags: ['Subscriptions'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '204': { description: 'Subscription deleted' },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/subscriptions/{id}/cancel': {
        post: {
          summary: 'Cancel subscription',
          operationId: 'cancelSubscription',
          tags: ['Subscriptions'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SubscriptionCancel' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Subscription cancelled',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Subscription' },
                },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
      },
      '/plans': {
        get: {
          summary: 'List plans',
          operationId: 'listPlans',
          tags: ['Plans'],
          parameters: [
            { name: 'active', in: 'query', schema: { type: 'boolean' } },
            {
              name: 'currency',
              in: 'query',
              schema: { type: 'string', minLength: 3, maxLength: 3 },
            },
            {
              name: 'cursor',
              in: 'query',
              schema: { type: 'string' },
              description: 'Opaque pagination cursor',
            },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
            { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          ],
          responses: {
            '200': {
              description: 'List of plans with cursor pagination',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['success', 'data', 'meta'],
                    properties: {
                      success: { type: 'boolean', const: true },
                      data: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/Plan' },
                      },
                      pagination: { $ref: '#/components/schemas/Pagination' },
                      meta: { $ref: '#/components/schemas/Meta' },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          summary: 'Create plan',
          operationId: 'createPlan',
          tags: ['Plans'],
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlanInput' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Plan created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Plan' },
                },
              },
            },
            '422': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/plans/{id}': {
        get: {
          summary: 'Get plan by ID',
          operationId: 'getPlanById',
          tags: ['Plans'],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Plan details',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Plan' },
                },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
          },
        },
        patch: {
          summary: 'Update plan',
          operationId: 'updatePlan',
          tags: ['Plans'],
          security: [{ BearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PlanUpdate' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Updated plan',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Plan' },
                },
              },
            },
            '404': { $ref: '#/components/responses/NotFound' },
            '422': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/payments': {
        get: {
          summary: 'List payments',
          operationId: 'listPayments',
          tags: ['Payments'],
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'customerId', in: 'query', schema: { type: 'string' } },
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string', enum: ['succeeded', 'failed', 'pending'] },
            },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          ],
          responses: {
            '200': {
              description: 'List of payments',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Payment' },
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
        post: {
          summary: 'Record or initiate payment',
          operationId: 'recordPayment',
          tags: ['Payments'],
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaymentInput' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Payment recorded',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Payment' },
                },
              },
            },
            '422': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/invoices': {
        get: {
          summary: 'List invoices',
          operationId: 'listInvoices',
          tags: ['Invoices'],
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'subscriptionId', in: 'query', schema: { type: 'string' } },
            {
              name: 'status',
              in: 'query',
              schema: { type: 'string', enum: ['paid', 'open', 'void'] },
            },
          ],
          responses: {
            '200': {
              description: 'List of invoices',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Invoice' },
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/webhooks': {
        get: {
          summary: 'List webhooks',
          operationId: 'listWebhooks',
          tags: ['Webhooks'],
          security: [{ BearerAuth: [] }],
          responses: {
            '200': {
              description: 'List of webhooks',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Webhook' },
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
        post: {
          summary: 'Create webhook endpoint',
          operationId: 'createWebhook',
          tags: ['Webhooks'],
          security: [{ BearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/WebhookInput' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Webhook created',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Webhook' },
                },
              },
            },
            '422': { $ref: '#/components/responses/ValidationError' },
          },
        },
      },
      '/analytics/usage': {
        get: {
          summary: 'Get usage analytics',
          operationId: 'getUsageAnalytics',
          tags: ['Analytics'],
          security: [{ BearerAuth: [] }],
          parameters: [
            { name: 'startDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'endDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
            {
              name: 'granularity',
              in: 'query',
              schema: { type: 'string', enum: ['hour', 'day', 'week', 'month'], default: 'day' },
            },
          ],
          responses: {
            '200': {
              description: 'Usage analytics data',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      period: { type: 'string' },
                      totalRequests: { type: 'integer' },
                      activeSubscriptions: { type: 'integer' },
                      revenue: { type: 'number' },
                    },
                  },
                },
              },
            },
            '401': { $ref: '#/components/responses/Unauthorized' },
          },
        },
      },
      '/themes': {
        get: {
          summary: 'Get theme settings',
          operationId: 'getThemes',
          tags: ['Themes'],
          responses: {
            '200': {
              description: 'Theme settings',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/Theme' },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
        },
      },
      schemas: {
        Subscription: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            userId: { type: 'string' },
            planId: { type: 'string' },
            status: {
              type: 'string',
              enum: ['active', 'paused', 'cancelled', 'past_due', 'trialing'],
            },
            currentPeriodStart: { type: 'string', format: 'date-time' },
            currentPeriodEnd: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        SubscriptionInput: subInput,
        SubscriptionUpdate: subUpdate,
        SubscriptionCancel: subCancel,
        SubscriptionPause: subPause,
        SubscriptionList: {
          type: 'object',
          properties: {
            data: {
              type: 'array',
              items: { $ref: '#/components/schemas/Subscription' },
            },
            pagination: { $ref: '#/components/schemas/Pagination' },
          },
        },
        Pagination: paginationSchema,
        Meta: metaSchema,
        StandardErrorEnvelope: errorEnvelopeSchema,
        Plan: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            interval: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
            active: { type: 'boolean' },
          },
        },
        PlanInput: planInput,
        PlanUpdate: planUpdate,
        Payment: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            status: { type: 'string', enum: ['succeeded', 'failed', 'pending'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        PaymentInput: paymentRequest,
        RefundInput: refundRequest,
        Invoice: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            subscriptionId: { type: 'string' },
            amount: { type: 'number' },
            currency: { type: 'string' },
            status: { type: 'string', enum: ['paid', 'open', 'void'] },
            dueDate: { type: 'string', format: 'date-time' },
          },
        },
        Webhook: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            url: { type: 'string', format: 'uri' },
            events: { type: 'array', items: { type: 'string' } },
            status: { type: 'string', enum: ['enabled', 'disabled'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        WebhookInput: webhookInput,
        ApiKeyInput: apiKeyInput,
        AnalyticsQuery: analyticsQuery,
        ForecastRequest: forecastRequest,
        FallbackChain: fallbackChain,
        CorsPolicy: corsPolicy,
        Theme: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            primaryColor: { type: 'string' },
            status: { type: 'string', enum: ['active', 'draft'] },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Missing or invalid authorization',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StandardErrorEnvelope' },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StandardErrorEnvelope' },
            },
          },
        },
        BadRequest: {
          description: 'Bad request',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StandardErrorEnvelope' },
            },
          },
        },
        ValidationError: {
          description: 'Request payload validation failed',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/StandardErrorEnvelope' },
            },
          },
        },
      },
    },
  };
}

export function generateSpecs(): { json: string; yaml: string } {
  const specObj = generateOpenApiSpec();
  const jsonContent = JSON.stringify(specObj, null, 2) + '\n';
  const yamlContent = YAML.stringify(specObj);
  return { json: jsonContent, yaml: yamlContent };
}

function main() {
  const isCheck = process.argv.includes('--check');
  const { json: generatedJson, yaml: generatedYaml } = generateSpecs();

  if (isCheck) {
    let hasDrift = false;
    if (!fs.existsSync(jsonPath)) {
      console.error(`[openapi:check] Missing ${jsonPath}`);
      hasDrift = true;
    } else {
      const currentJson = fs.readFileSync(jsonPath, 'utf8');
      if (currentJson.trim() !== generatedJson.trim()) {
        console.error(`[openapi:check] Drift detected in ${jsonPath}`);
        hasDrift = true;
      }
    }

    if (!fs.existsSync(yamlPath)) {
      console.error(`[openapi:check] Missing ${yamlPath}`);
      hasDrift = true;
    } else {
      const currentYaml = fs.readFileSync(yamlPath, 'utf8');
      if (currentYaml.trim() !== generatedYaml.trim()) {
        console.error(`[openapi:check] Drift detected in ${yamlPath}`);
        hasDrift = true;
      }
    }

    if (hasDrift) {
      console.error('[openapi:check] Run "npm run openapi:generate" to synchronize OpenAPI specs.');
      process.exit(1);
    }

    console.log('[openapi:check] OpenAPI specifications are up-to-date. No drift detected.');
    process.exit(0);
  }

  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(yamlPath), { recursive: true });

  fs.writeFileSync(jsonPath, generatedJson);
  fs.writeFileSync(yamlPath, generatedYaml);

  console.log(`[openapi:generate] Generated OpenAPI 3.1.0 specification:`);
  console.log(`  - ${path.relative(root, jsonPath)}`);
  console.log(`  - ${path.relative(root, yamlPath)}`);
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main();
} else if (process.argv[1] && process.argv[1].endsWith('generate-openapi.ts')) {
  main();
}
