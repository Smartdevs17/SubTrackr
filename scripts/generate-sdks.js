#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const openApiPath = path.join(root, 'docs/openapi.yaml');
const outputDir = path.join(root, 'sdks/generated');
const outputPath = path.join(outputDir, 'endpoints.json');

const spec = fs.readFileSync(openApiPath, 'utf8');
const endpoints = [...spec.matchAll(/^  \/(.+):$/gm)].map((match) => {
  const pathName = `/${match[1]}`;
  const methodName = match[1].replace(/_([a-z])/g, (_, char) => char.toUpperCase());
  return {
    path: pathName,
    method: 'POST',
    operation: methodName,
  };
});

if (!endpoints.length) {
  throw new Error(`No endpoints found in ${openApiPath}`);
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      source: 'docs/openapi.yaml',
      generatedBy: 'scripts/generate-sdks.js',
      endpoints,
    },
    null,
    2
  )}\n`
);

console.log(`Generated ${endpoints.length} SDK endpoint definitions at ${outputPath}`);
