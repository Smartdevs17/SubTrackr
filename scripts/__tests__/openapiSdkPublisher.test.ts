import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateOpenApiSpec, isOpenApi31, OPENAPI_VERSION } from '../generate-openapi';

const publisher = require('../publish-sdks.js');

const spec = {
  openapi: OPENAPI_VERSION,
  info: { title: 'SubTrackr API', version: '1.0.0' },
  paths: { '/plans': { get: {} }, '/subscriptions': { post: {} } },
};

describe('OpenAPI 3.1 schema validation', () => {
  it('accepts the generated specification', () => {
    expect(isOpenApi31(generateOpenApiSpec())).toBe(true);
  });

  it('rejects older or incomplete documents', () => {
    expect(isOpenApi31({ ...spec, openapi: '3.0.3' })).toBe(false);
    expect(isOpenApi31({ ...spec, paths: {} })).toBe(false);
    expect(isOpenApi31(null)).toBe(false);
  });

  it('rejects a non-3.1 spec in the publisher', () => {
    expect(() => publisher.assertOpenApi31({ ...spec, openapi: '3.0.3' })).toThrow(
      'Expected OpenAPI 3.1.0'
    );
  });
});

describe('SDK publish plan', () => {
  it('derives one target per SDK from a version tag', () => {
    const plan = publisher.buildPublishPlan(spec, 'sdk-v1.2.3');

    expect(plan).toMatchObject({
      tag: 'sdk-v1.2.3',
      version: '1.2.3',
      specVersion: OPENAPI_VERSION,
      endpointCount: 2,
    });
    expect(plan.targets.map((target: { language: string }) => target.language)).toEqual([
      'javascript',
      'python',
      'go',
    ]);
  });

  it('honours an explicit target list', () => {
    const plan = publisher.buildPublishPlan(spec, 'sdk-v2.0.0', ['python']);
    expect(plan.targets).toEqual([
      { language: 'python', package: 'subtrackr-sdk', registry: 'pypi', version: '2.0.0' },
    ]);
  });

  it('rejects invalid tags and unknown targets', () => {
    expect(() => publisher.buildPublishPlan(spec, 'v1.2.3')).toThrow('Invalid version tag');
    expect(() => publisher.buildPublishPlan(spec, 'sdk-v1.2.3', [])).toThrow('No SDK targets');
    expect(() => publisher.buildPublishPlan(spec, 'sdk-v1.2.3', ['ruby'])).toThrow(
      'Unknown SDK target'
    );
  });

  it('writes a publish manifest', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtrackr-sdk-'));
    const target = path.join(dir, 'publish-manifest.json');
    const plan = publisher.buildPublishPlan(spec, 'sdk-v1.0.0');

    expect(publisher.writePublishManifest(plan, target)).toBe(target);
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual(plan);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('parses CLI arguments', () => {
    expect(publisher.parseArgs(['--version', 'sdk-v3.1.4', '--publish'])).toEqual({
      tag: 'sdk-v3.1.4',
      publish: true,
    });
  });
});
