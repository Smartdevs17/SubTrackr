#!/usr/bin/env node

/**
 * Equivalent Mutant Analyzer
 * 
 * Helps identify potential equivalent mutants (mutants that don't change behavior)
 * and provides suggestions for ignoring them or improving tests.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND_REPORT = 'mutation-reports/frontend/mutation-report.json';
const BACKEND_REPORT = 'mutation-reports/backend/mutation-report.json';

/**
 * Load mutation report
 */
function loadReport(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Identify potential equivalent mutants using heuristics
 */
function findEquivalentMutants(report) {
  const equivalents = [];

  if (!report || !report.files) return equivalents;

  for (const filePath in report.files) {
    const fileData = report.files[filePath];
    if (!fileData.mutants) continue;

    for (const mutant of fileData.mutants) {
      if (mutant.status !== 'Survived') continue;

      const reasons = [];

      // Heuristic 1: Logical expression that's always evaluated the same way
      if (
        mutant.mutatorName === 'ConditionalExpression' &&
        (mutant.replacement === 'true' || mutant.replacement === 'false')
      ) {
        reasons.push('Conditional expression may be equivalent (always evaluates same way)');
      }

      // Heuristic 2: String literal changes in error messages
      if (mutant.mutatorName === 'StringLiteral' && mutant.original?.includes('Error')) {
        reasons.push('String literal in error message (may not affect behavior)');
      }

      // Heuristic 3: Default parameter values
      if (mutant.mutatorName === 'AssignmentExpression' && mutant.original?.includes('=')) {
        reasons.push('Assignment expression (may be default value)');
      }

      // Heuristic 4: Arithmetic operators in formatting/display code
      if (
        (mutant.mutatorName === 'ArithmeticOperator' || mutant.mutatorName === 'UpdateExpression') &&
        (filePath.includes('component') || filePath.includes('screen') || filePath.includes('ui'))
      ) {
        reasons.push('Arithmetic in UI code (may be display-only logic)');
      }

      // Heuristic 5: Array/Object method calls that produce same result
      if (mutant.mutatorName === 'MethodExpression') {
        if (
          mutant.replacement === 'filter' ||
          mutant.replacement === 'map' ||
          mutant.replacement === 'forEach'
        ) {
          reasons.push('Array method change (may produce equivalent result)');
        }
      }

      // Heuristic 6: Conditional boundary in logging
      if (mutant.mutatorName === 'EqualityOperator' && filePath.includes('log')) {
        reasons.push('Equality in logging code (may not affect behavior)');
      }

      if (reasons.length > 0) {
        equivalents.push({
          file: filePath,
          mutator: mutant.mutatorName,
          location: mutant.location,
          original: mutant.original,
          replacement: mutant.replacement,
          reasons,
          confidence: reasons.length > 1 ? 'HIGH' : 'MEDIUM'
        });
      }
    }
  }

  return equivalents;
}

/**
 * Generate ignore pattern suggestions
 */
function generateIgnoreSuggestions(equivalents) {
  const suggestions = [];

  // Group by file
  const byFile = {};
  for (const eq of equivalents) {
    if (!byFile[eq.file]) byFile[eq.file] = [];
    byFile[eq.file].push(eq);
  }

  for (const file in byFile) {
    const mutants = byFile[file];
    if (mutants.length >= 3) {
      suggestions.push({
        type: 'FILE_EXCLUSION',
        pattern: file,
        reason: `File has ${mutants.length} potential equivalent mutants`,
        config: `Add to stryker config: "!${file}"`
      });
    } else {
      for (const mutant of mutants) {
        suggestions.push({
          type: 'INLINE_IGNORE',
          file: file,
          line: mutant.location.start.line,
          reason: mutant.reasons.join(', '),
          config: `Add comment above line ${mutant.location.start.line}: // Stryker disable next-line ${mutant.mutator}`
        });
      }
    }
  }

  return suggestions;
}

/**
 * Print analysis report
 */
function printReport(scope, equivalents, suggestions) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`${scope.toUpperCase()} - Equivalent Mutant Analysis`);
  console.log(`${'='.repeat(80)}\n`);

  if (equivalents.length === 0) {
    console.log('✅ No potential equivalent mutants found.\n');
    return;
  }

  console.log(`Found ${equivalents.length} potential equivalent mutants:\n`);

  // Group by confidence
  const highConfidence = equivalents.filter(eq => eq.confidence === 'HIGH');
  const mediumConfidence = equivalents.filter(eq => eq.confidence === 'MEDIUM');

  if (highConfidence.length > 0) {
    console.log(`🔴 HIGH CONFIDENCE (${highConfidence.length}):\n`);
    highConfidence.forEach((eq, i) => {
      console.log(`${i + 1}. ${eq.file}:${eq.location.start.line}`);
      console.log(`   Mutator: ${eq.mutator}`);
      console.log(`   Reasons: ${eq.reasons.join('; ')}`);
      console.log();
    });
  }

  if (mediumConfidence.length > 0) {
    console.log(`🟡 MEDIUM CONFIDENCE (${mediumConfidence.length}):\n`);
    mediumConfidence.forEach((eq, i) => {
      console.log(`${i + 1}. ${eq.file}:${eq.location.start.line}`);
      console.log(`   Mutator: ${eq.mutator}`);
      console.log(`   Reasons: ${eq.reasons.join('; ')}`);
      console.log();
    });
  }

  console.log(`\n${'─'.repeat(80)}`);
  console.log('SUGGESTIONS:\n');

  suggestions.forEach((suggestion, i) => {
    console.log(`${i + 1}. ${suggestion.type}: ${suggestion.reason}`);
    console.log(`   Config: ${suggestion.config}`);
    console.log();
  });

  console.log(`${'─'.repeat(80)}\n`);
}

/**
 * Main execution
 */
function main() {
  console.log('\n🔍 Analyzing mutation reports for equivalent mutants...\n');

  const frontendReport = loadReport(FRONTEND_REPORT);
  const backendReport = loadReport(BACKEND_REPORT);

  if (!frontendReport && !backendReport) {
    console.error('❌ No mutation reports found!');
    console.error('Run mutation tests first: npm run mutation:test\n');
    process.exit(1);
  }

  if (frontendReport) {
    const equivalents = findEquivalentMutants(frontendReport);
    const suggestions = generateIgnoreSuggestions(equivalents);
    printReport('Frontend', equivalents, suggestions);
  }

  if (backendReport) {
    const equivalents = findEquivalentMutants(backendReport);
    const suggestions = generateIgnoreSuggestions(equivalents);
    printReport('Backend', equivalents, suggestions);
  }

  console.log('\n💡 Next Steps:\n');
  console.log('1. Review each potential equivalent mutant manually');
  console.log('2. For true equivalents, add ignore patterns to Stryker config');
  console.log('3. For false positives, improve test assertions to kill the mutant');
  console.log('4. Document your decisions in PR comments\n');
}

main();
