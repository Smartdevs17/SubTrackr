#!/usr/bin/env node
// Validate ADR files and the index under docs/adr/.
// No dependencies: usable from local shells and CI with only Node.js installed.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argDir = process.argv.indexOf('--dir');
const ADR_DIR = argDir !== -1 && process.argv[argDir + 1]
  ? process.argv[argDir + 1]
  : join(ROOT, 'docs', 'adr');
const TEMPLATE = '0000-template.md';
const INDEX = 'README.md';
const METADATA = ['Status', 'Date'];
const SECTIONS = ['Context', 'Decision', 'Consequences'];
const errors = [];

if (!existsSync(ADR_DIR)) {
  console.error('docs/adr/ does not exist');
  process.exit(1);
}

const files = readdirSync(ADR_DIR).filter((f) => f.endsWith('.md')).sort();
const seed = files.find((f) => /^\d{4}-/.test(f));
if (seed === undefined) {
  console.error('No numbered ADR found');
  process.exit(1);
}

const seen = new Set();
const records = [];
for (const file of files) {
  const text = readFileSync(join(ADR_DIR, file), 'utf8');
  if (file === TEMPLATE || file === INDEX) continue;
  const match = /^(\d{4})-[a-z0-9-]+\.md$/.exec(file);
  if (!match) {
    errors.push(`${file}: expected NNNN-lowercase-slug.md`);
    continue;
  }
  const number = match[1];
  if (seen.has(number)) errors.push(`${file}: duplicate ADR number ${number}`);
  seen.add(number);

  const heading = /^#\s*(\d{4}):\s*(.+)$/m.exec(text);
  if (!heading) errors.push(`${file}: missing '# NNNN: Title' heading`);
  else if (heading[1] !== number) errors.push(`${file}: heading number ${heading[1]} != filename ${number}`);
  else if (!heading[2].trim()) errors.push(`${file}: empty title`);

  for (const field of METADATA) {
    const re = new RegExp(`^[-*]\\s*${field}:\\s*(\\S.*)$`, 'im');
    const found = re.exec(text);
    if (!found) errors.push(`${file}: missing '- ${field}: ...'`);
    else if (/^(TBD|YYYY-MM-DD|undefined)$/i.test(found[1].trim())) errors.push(`${file}: ${field} is still a placeholder`);
  }
  for (const section of SECTIONS) {
    if (!new RegExp(`^##\\s+${section}\\s*$`, 'im').test(text)) {
      errors.push(`${file}: missing '## ${section}'`);
    }
  }
  records.push({ number, file });
}

const index = readFileSync(join(ADR_DIR, INDEX), 'utf8');
for (const { number, file } of records) {
  if (!index.includes(file)) errors.push(`README.md: missing index entry for ${file} (ADR ${number})`);
}

if (errors.length) {
  console.error(`ADR validation failed with ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`ADR validation passed: ${records.length} record(s)`);
