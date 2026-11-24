#!/usr/bin/env node
/**
 * ADR Validation Script
 * Validates Architecture Decision Records in docs/adr/
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ADR_DIR = path.join(__dirname, '..', 'docs', 'adr');
const VALID_STATUSES = ['Proposed', 'Accepted', 'Superseded', 'Deprecated'];
const FRONT_MATTER_REQUIRED = ['adr', 'title', 'status', 'date', 'authors'];

function extractFrontMatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const [key, ...valueParts] = line.split(':');
    if (key && valueParts.length > 0) {
      fm[key.trim()] = valueParts.join(':').trim();
    }
  }
  return fm;
}

function validateFilename(filename) {
  // Should match NNNN-title.md format
  const match = filename.match(/^(\d{4})-(.+)\.md$/);
  if (!match) {
    return { valid: false, error: `Filename "${filename}" does not match NNNN-title.md format` };
  }
  const num = parseInt(match[1], 10);
  if (num === 0) {
    return { valid: false, error: `ADR number cannot be 0000` };
  }
  return { valid: true, number: num, title: match[2] };
}

function validateFrontMatter(fm, filename, fileNumber) {
  const errors = [];

  // Check required fields
  for (const field of FRONT_MATTER_REQUIRED) {
    if (!fm[field]) {
      errors.push(`Missing required front matter field: ${field}`);
    }
  }

  // Validate adr number matches filename
  if (fm.adr) {
    const fmNum = parseInt(fm.adr, 10);
    if (fmNum !== fileNumber) {
      errors.push(`Front matter adr number (${fmNum}) does not match filename (${fileNumber})`);
    }
  }

  // Validate status
  if (fm.status && !VALID_STATUSES.includes(fm.status)) {
    errors.push(`Invalid status "${fm.status}". Must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // Validate date format (YYYY-MM-DD)
  if (fm.date && !/^\d{4}-\d{2}-\d{2}$/.test(fm.date)) {
    errors.push(`Invalid date format "${fm.date}". Must be YYYY-MM-DD`);
  }

  // Validate date is valid
  if (fm.date) {
    const date = new Date(fm.date);
    if (isNaN(date.getTime())) {
      errors.push(`Invalid date "${fm.date}"`);
    }
  }

  return errors;
}

function main() {
  console.log('🔍 Validating ADRs...\n');

  if (!fs.existsSync(ADR_DIR)) {
    console.error(`❌ ADR directory not found: ${ADR_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(ADR_DIR)
    .filter(f => f.endsWith('.md') && f !== 'template.md' && f !== 'index.md')
    .sort();

  if (files.length === 0) {
    console.log('ℹ️  No ADR files found (excluding template.md and index.md)');
    return;
  }

  let hasErrors = false;
  const adrNumbers = new Set();

  for (const file of files) {
    const filePath = path.join(ADR_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    console.log(`📄 Checking ${file}...`);

    // Validate filename
    const fileValidation = validateFilename(file);
    if (!fileValidation.valid) {
      console.error(`  ❌ ${fileValidation.error}`);
      hasErrors = true;
      continue;
    }

    // Extract and validate front matter
    const fm = extractFrontMatter(content);
    if (!fm) {
      console.error(`  ❌ No valid front matter found (expected --- front matter ---)`);
      hasErrors = true;
      continue;
    }

    // Check for duplicate numbers
    if (adrNumbers.has(fileValidation.number)) {
      console.error(`  ❌ Duplicate ADR number: ${fileValidation.number}`);
      hasErrors = true;
    }
    adrNumbers.add(fileValidation.number);

    // Validate front matter
    const fmErrors = validateFrontMatter(fm, file, fileValidation.number);
    if (fmErrors.length > 0) {
      for (const err of fmErrors) {
        console.error(`  ❌ ${err}`);
      }
      hasErrors = true;
    } else {
      console.log(`  ✅ Valid (ADR-${String(fileValidation.number).padStart(4, '0')}: ${fm.title})`);
    }
  }

  console.log(`\n${hasErrors ? '❌ Validation failed' : '✅ All ADRs valid'}`);
  process.exit(hasErrors ? 1 : 0);
}

main();