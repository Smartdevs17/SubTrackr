#!/usr/bin/env node
/**
 * ADR Index Validation Script
 * Validates that docs/adr/index.md is consistent with actual ADR files
 */

const fs = require('fs');
const path = require('path');

const ADR_DIR = path.join(__dirname, '..', 'docs', 'adr');
const INDEX_FILE = path.join(ADR_DIR, 'index.md');

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

function parseIndexTable(content) {
  // Extract the markdown table from index.md
  const tableMatch = content.match(/\| #.*?\n((?:\|.*\n)*)/);
  if (!tableMatch) return [];

  const rows = tableMatch[1].trim().split('\n').filter(r => r.includes('|'));
  const adrs = [];

  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2) {
      const numMatch = cells[0].match(/^(\d+)$/);
      if (numMatch) {
        const titleMatch = cells[1].match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (titleMatch) {
          adrs.push({
            number: parseInt(numMatch[1], 10),
            title: titleMatch[1],
            file: titleMatch[2].replace('./', ''),
          });
        }
      }
    }
  }
  return adrs;
}

function main() {
  console.log('🔍 Validating ADR Index...\n');

  if (!fs.existsSync(INDEX_FILE)) {
    console.error(`❌ Index file not found: ${INDEX_FILE}`);
    process.exit(1);
  }

  const indexContent = fs.readFileSync(INDEX_FILE, 'utf-8');
  const indexAdrs = parseIndexTable(indexContent);

  if (indexAdrs.length === 0) {
    console.log('ℹ️  No ADR entries found in index table (may be template)');
    return;
  }

  const files = fs.readdirSync(ADR_DIR)
    .filter(f => f.endsWith('.md') && f !== 'template.md' && f !== 'index.md')
    .sort();

  const fileAdrs = [];
  for (const file of files) {
    const filePath = path.join(ADR_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const fm = extractFrontMatter(content);

    if (fm && fm.adr) {
      const fileMatch = file.match(/^(\d{4})-(.+)\.md$/);
      if (fileMatch) {
        fileAdrs.push({
          number: parseInt(fileMatch[1], 10),
          title: fm.title || 'Untitled',
          file: file,
          status: fm.status || 'Unknown',
        });
      }
    }
  }

  let hasErrors = false;

  // Check index entries exist as files
  for (const idx of indexAdrs) {
    const match = fileAdrs.find(f => f.number === idx.number);
    if (!match) {
      console.error(`❌ Index entry ADR-${String(idx.number).padStart(4, '0')} "${idx.title}" has no corresponding file`);
      hasErrors = true;
    } else if (match.title !== idx.title) {
      console.warn(`⚠️  Title mismatch for ADR-${String(idx.number).padStart(4, '0')}: index="${idx.title}" file="${match.title}"`);
    }
  }

  // Check files have index entries
  for (const file of fileAdrs) {
    const match = indexAdrs.find(i => i.number === file.number);
    if (!match) {
      console.error(`❌ File ${file.file} (ADR-${String(file.number).padStart(4, '0')}: "${file.title}") missing from index`);
      hasErrors = true;
    }
  }

  // Check for duplicate numbers in index
  const indexNums = indexAdrs.map(a => a.number);
  const dupIndex = indexNums.filter((n, i) => indexNums.indexOf(n) !== i);
  if (dupIndex.length > 0) {
    console.error(`❌ Duplicate ADR numbers in index: ${dupIndex.join(', ')}`);
    hasErrors = true;
  }

  console.log(`\n📋 Index entries: ${indexAdrs.length}`);
  console.log(`📄 ADR files: ${fileAdrs.length}`);
  console.log(`${hasErrors ? '❌ Index validation failed' : '✅ Index consistent'}`);
  process.exit(hasErrors ? 1 : 0);
}

main();