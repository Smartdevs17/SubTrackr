#!/usr/bin/env node

/**
 * Incremental Mutation Testing Script
 * 
 * Runs mutation testing only on changed files to improve CI performance.
 * Uses git diff to detect changes and runs Stryker incrementally.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FRONTEND_CONFIG = 'stryker.conf.json';
const BACKEND_CONFIG = 'stryker.backend.conf.json';

/**
 * Get list of changed files from git
 */
function getChangedFiles() {
  try {
    // Get changed files between current branch and base branch (main)
    const baseBranch = process.env.GITHUB_BASE_REF || 'main';
    const gitCommand = process.env.GITHUB_ACTIONS
      ? `git diff --name-only origin/${baseBranch}...HEAD`
      : `git diff --name-only ${baseBranch}...HEAD`;

    const output = execSync(gitCommand, { encoding: 'utf-8' });
    return output.split('\n').filter(Boolean);
  } catch (error) {
    console.error('Error getting changed files:', error.message);
    console.log('Running full mutation testing...');
    return null;
  }
}

/**
 * Categorize changed files into frontend and backend
 */
function categorizeFiles(files) {
  const frontend = [];
  const backend = [];

  for (const file of files) {
    if (file.match(/^(src|app)\/.*\.(ts|tsx)$/)) {
      frontend.push(file);
    } else if (file.match(/^backend\/.*\.ts$/)) {
      backend.push(file);
    }
  }

  return { frontend, backend };
}

/**
 * Run Stryker with file list
 */
function runStryker(config, files, scope) {
  if (files.length === 0) {
    console.log(`No ${scope} files changed. Skipping ${scope} mutation testing.`);
    return true;
  }

  console.log(`\n🧬 Running ${scope} mutation testing on ${files.length} changed files...`);
  console.log(`Files: ${files.join(', ')}`);

  try {
    // Use mutate option to specify files
    const mutateFiles = files.join(',');
    const command = `npx stryker run --configFile ${config} --mutate "${mutateFiles}"`;
    
    console.log(`Executing: ${command}\n`);
    execSync(command, { stdio: 'inherit' });
    return true;
  } catch (error) {
    console.error(`\n❌ ${scope} mutation testing failed!`);
    return false;
  }
}

/**
 * Main execution
 */
function main() {
  console.log('🚀 Starting incremental mutation testing...\n');

  const changedFiles = getChangedFiles();

  // If we can't get changed files, run full mutation testing
  if (!changedFiles) {
    console.log('Running full mutation testing suite...');
    try {
      execSync('npm run mutation:test:frontend', { stdio: 'inherit' });
      execSync('npm run mutation:test:backend', { stdio: 'inherit' });
      return;
    } catch (error) {
      process.exit(1);
    }
  }

  const { frontend, backend } = categorizeFiles(changedFiles);

  console.log(`📊 Changed files summary:`);
  console.log(`   Frontend: ${frontend.length} files`);
  console.log(`   Backend: ${backend.length} files\n`);

  // Run mutation tests for each category
  let frontendSuccess = true;
  let backendSuccess = true;

  if (frontend.length > 0) {
    frontendSuccess = runStryker(FRONTEND_CONFIG, frontend, 'Frontend');
  }

  if (backend.length > 0) {
    backendSuccess = runStryker(BACKEND_CONFIG, backend, 'Backend');
  }

  // Exit with error if any test failed
  if (!frontendSuccess || !backendSuccess) {
    console.error('\n❌ Mutation testing failed!');
    process.exit(1);
  }

  console.log('\n✅ Incremental mutation testing completed successfully!');
}

// Run the script
main();
