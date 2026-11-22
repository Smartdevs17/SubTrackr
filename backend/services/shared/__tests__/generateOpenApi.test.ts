import { generateOpenApiSpec, generateSpecs } from '../../../../scripts/generate-openapi';
import YAML from 'yaml';

describe('OpenAPI specification generator (issue #1784)', () => {
  it('generates a valid OpenAPI 3.1.0 specification', () => {
    const spec = generateOpenApiSpec() as any;
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info.title).toBe('SubTrackr API');
    expect(spec.info.version).toBe('1.0.0');
  });

  it('contains all required paths and tags', () => {
    const spec = generateOpenApiSpec() as any;
    expect(spec.paths['/plans']).toBeDefined();
    expect(spec.paths['/subscriptions']).toBeDefined();
    expect(spec.paths['/payments']).toBeDefined();
    expect(spec.paths['/webhooks']).toBeDefined();
    expect(spec.tags.length).toBeGreaterThan(0);
  });

  it('incorporates source schemas into components.schemas', () => {
    const spec = generateOpenApiSpec() as any;
    const schemas = spec.components.schemas;
    expect(schemas.PlanInput).toBeDefined();
    expect(schemas.PlanUpdate).toBeDefined();
    expect(schemas.SubscriptionInput).toBeDefined();
    expect(schemas.SubscriptionUpdate).toBeDefined();
    expect(schemas.PaymentInput).toBeDefined();
    expect(schemas.WebhookInput).toBeDefined();
    expect(schemas.StandardErrorEnvelope).toBeDefined();
  });

  it('includes cursor pagination and standard error envelopes in responses', () => {
    const spec = generateOpenApiSpec() as any;
    const plansGet = spec.paths['/plans'].get;
    expect(plansGet.parameters.some((p: any) => p.name === 'cursor')).toBe(true);

    const validationResponse = spec.components.responses.ValidationError;
    expect(validationResponse).toBeDefined();
    expect(validationResponse.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/StandardErrorEnvelope'
    );
  });

  it('generates valid JSON and YAML strings', () => {
    const { json, yaml } = generateSpecs();
    const parsedJson = JSON.parse(json);
    const parsedYaml = YAML.parse(yaml);

    expect(parsedJson.openapi).toBe('3.1.0');
    expect(parsedYaml.openapi).toBe('3.1.0');
    expect(parsedJson.info.title).toBe(parsedYaml.info.title);
  });
});
