#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const jsonPath = path.join(root, 'developer-portal/docs/openapi.json');
const yamlPath = path.join(root, 'spec/openapi.yaml');
const outputDir = path.join(root, 'sdks/generated');
const outputPath = path.join(outputDir, 'endpoints.json');

let specObj = null;
let specSource = '';

if (fs.existsSync(jsonPath)) {
  const content = fs.readFileSync(jsonPath, 'utf8');
  specObj = JSON.parse(content);
  specSource = 'developer-portal/docs/openapi.json';
}

const endpoints = [];

if (specObj && specObj.paths) {
  for (const [pathKey, pathItem] of Object.entries(specObj.paths)) {
    const httpMethods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'];
    for (const method of httpMethods) {
      if (pathItem[method]) {
        const op = pathItem[method];
        const operationId =
          op.operationId ||
          `${method}${pathKey.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_')}`;
        endpoints.push({
          path: pathKey,
          method: method.toUpperCase(),
          operation: operationId,
          summary: op.summary || '',
        });
      }
    }
  }
} else if (fs.existsSync(yamlPath)) {
  const spec = fs.readFileSync(yamlPath, 'utf8');
  specSource = 'spec/openapi.yaml';
  const matches = [...spec.matchAll(/^  \/(.+):$/gm)];
  for (const match of matches) {
    const pathName = `/${match[1]}`;
    const methodName = match[1].replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    endpoints.push({
      path: pathName,
      method: 'POST',
      operation: methodName,
    });
  }
}

if (!endpoints.length) {
  throw new Error(`No endpoints found in OpenAPI specifications`);
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      openapiVersion: specObj ? specObj.openapi : '3.1.0',
      source: specSource,
      generatedBy: 'scripts/generate-sdks.js',
      endpoints,
    },
    null,
    2
  )}\n`
);

console.log(`Generated ${endpoints.length} SDK endpoint definitions at ${outputPath}`);
