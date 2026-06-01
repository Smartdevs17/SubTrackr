#!/usr/bin/env node

/**
 * Mutation Testing Report Generator
 * 
 * Aggregates mutation testing results from frontend and backend,
 * generates summary reports, and tracks historical data.
 */

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = 'mutation-reports';
const FRONTEND_REPORT = path.join(REPORTS_DIR, 'frontend', 'mutation-report.json');
const BACKEND_REPORT = path.join(REPORTS_DIR, 'backend', 'mutation-report.json');
const HISTORY_FILE = path.join(REPORTS_DIR, 'mutation-history.json');
const SUMMARY_FILE = path.join(REPORTS_DIR, 'mutation-summary.md');

/**
 * Load JSON report safely
 */
function loadReport(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      console.warn(`Warning: Report not found at ${filePath}`);
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error loading report ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Calculate mutation score from report
 */
function calculateScore(report) {
  if (!report || !report.files) return 0;

  let totalMutants = 0;
  let killedMutants = 0;

  for (const file in report.files) {
    const fileData = report.files[file];
    if (fileData.mutants) {
      for (const mutant of fileData.mutants) {
        totalMutants++;
        if (mutant.status === 'Killed' || mutant.status === 'Timeout') {
          killedMutants++;
        }
      }
    }
  }

  return totalMutants > 0 ? (killedMutants / totalMutants) * 100 : 0;
}

/**
 * Get mutant statistics
 */
function getMutantStats(report) {
  if (!report || !report.files) {
    return {
      total: 0,
      killed: 0,
      survived: 0,
      timeout: 0,
      noCoverage: 0,
      ignored: 0,
      runtimeError: 0,
      compileError: 0
    };
  }

  const stats = {
    total: 0,
    killed: 0,
    survived: 0,
    timeout: 0,
    noCoverage: 0,
    ignored: 0,
    runtimeError: 0,
    compileError: 0
  };

  for (const file in report.files) {
    const fileData = report.files[file];
    if (fileData.mutants) {
      for (const mutant of fileData.mutants) {
        stats.total++;
        const status = mutant.status;
        if (status === 'Killed') stats.killed++;
        else if (status === 'Survived') stats.survived++;
        else if (status === 'Timeout') stats.timeout++;
        else if (status === 'NoCoverage') stats.noCoverage++;
        else if (status === 'Ignored') stats.ignored++;
        else if (status === 'RuntimeError') stats.runtimeError++;
        else if (status === 'CompileError') stats.compileError++;
      }
    }
  }

  return stats;
}

/**
 * Find survived mutants for analysis
 */
function getSurvivedMutants(report) {
  const survived = [];

  if (!report || !report.files) return survived;

  for (const filePath in report.files) {
    const fileData = report.files[filePath];
    if (fileData.mutants) {
      for (const mutant of fileData.mutants) {
        if (mutant.status === 'Survived') {
          survived.push({
            file: filePath,
            mutatorName: mutant.mutatorName,
            location: mutant.location,
            replacement: mutant.replacement,
            original: mutant.mutatorName
          });
        }
      }
    }
  }

  return survived;
}

/**
 * Generate markdown summary
 */
function generateMarkdownSummary(frontendReport, backendReport, previousScore) {
  const frontendStats = getMutantStats(frontendReport);
  const backendStats = getMutantStats(backendReport);
  const frontendScore = calculateScore(frontendReport);
  const backendScore = calculateScore(backendReport);
  
  const totalMutants = frontendStats.total + backendStats.total;
  const totalKilled = frontendStats.killed + backendStats.killed;
  const overallScore = totalMutants > 0 ? (totalKilled / totalMutants) * 100 : 0;

  const scoreDelta = previousScore ? (overallScore - previousScore.overall).toFixed(2) : 'N/A';
  const trend = scoreDelta > 0 ? '📈' : scoreDelta < 0 ? '📉' : '➡️';

  let markdown = `# 🧬 Mutation Testing Report\n\n`;
  markdown += `**Generated:** ${new Date().toISOString()}\n\n`;

  markdown += `## 📊 Overall Summary\n\n`;
  markdown += `| Metric | Value |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| **Overall Mutation Score** | **${overallScore.toFixed(2)}%** ${trend} |\n`;
  markdown += `| Total Mutants | ${totalMutants} |\n`;
  markdown += `| Killed | ${totalKilled} ✅ |\n`;
  markdown += `| Survived | ${frontendStats.survived + backendStats.survived} ⚠️ |\n`;
  markdown += `| No Coverage | ${frontendStats.noCoverage + backendStats.noCoverage} |\n`;
  markdown += `| Timeout | ${frontendStats.timeout + backendStats.timeout} |\n\n`;

  if (scoreDelta !== 'N/A') {
    markdown += `**Score Change:** ${scoreDelta > 0 ? '+' : ''}${scoreDelta}%\n\n`;
  }

  markdown += `## 🎯 Frontend (React Native)\n\n`;
  markdown += `| Metric | Value |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| **Mutation Score** | **${frontendScore.toFixed(2)}%** |\n`;
  markdown += `| Total Mutants | ${frontendStats.total} |\n`;
  markdown += `| Killed | ${frontendStats.killed} |\n`;
  markdown += `| Survived | ${frontendStats.survived} |\n`;
  markdown += `| No Coverage | ${frontendStats.noCoverage} |\n\n`;

  markdown += `## 🔧 Backend (Node.js)\n\n`;
  markdown += `| Metric | Value |\n`;
  markdown += `|--------|-------|\n`;
  markdown += `| **Mutation Score** | **${backendScore.toFixed(2)}%** |\n`;
  markdown += `| Total Mutants | ${backendStats.total} |\n`;
  markdown += `| Killed | ${backendStats.killed} |\n`;
  markdown += `| Survived | ${backendStats.survived} |\n`;
  markdown += `| No Coverage | ${backendStats.noCoverage} |\n\n`;

  // Threshold check
  const THRESHOLD = 75;
  markdown += `## ✅ Quality Gate\n\n`;
  if (overallScore >= THRESHOLD) {
    markdown += `**Status:** PASSED ✅\n\n`;
    markdown += `Mutation score (${overallScore.toFixed(2)}%) meets the threshold of ${THRESHOLD}%.\n\n`;
  } else {
    markdown += `**Status:** FAILED ❌\n\n`;
    markdown += `Mutation score (${overallScore.toFixed(2)}%) is below the threshold of ${THRESHOLD}%.\n`;
    markdown += `**Required improvement:** ${(THRESHOLD - overallScore).toFixed(2)}%\n\n`;
  }

  // Survived mutants analysis
  const survivedFrontend = getSurvivedMutants(frontendReport);
  const survivedBackend = getSurvivedMutants(backendReport);

  if (survivedFrontend.length > 0 || survivedBackend.length > 0) {
    markdown += `## ⚠️ Survived Mutants Analysis\n\n`;
    markdown += `These mutants survived and indicate missing test coverage or weak assertions:\n\n`;

    if (survivedFrontend.length > 0) {
      markdown += `### Frontend (${survivedFrontend.length} survived)\n\n`;
      survivedFrontend.slice(0, 10).forEach(mutant => {
        markdown += `- **${mutant.file}** (${mutant.mutatorName})\n`;
      });
      if (survivedFrontend.length > 10) {
        markdown += `\n_...and ${survivedFrontend.length - 10} more_\n`;
      }
      markdown += `\n`;
    }

    if (survivedBackend.length > 0) {
      markdown += `### Backend (${survivedBackend.length} survived)\n\n`;
      survivedBackend.slice(0, 10).forEach(mutant => {
        markdown += `- **${mutant.file}** (${mutant.mutatorName})\n`;
      });
      if (survivedBackend.length > 10) {
        markdown += `\n_...and ${survivedBackend.length - 10} more_\n`;
      }
      markdown += `\n`;
    }
  }

  markdown += `## 📈 Recommendations\n\n`;
  if (frontendStats.survived > 0 || backendStats.survived > 0) {
    markdown += `- Review survived mutants and add test cases to kill them\n`;
  }
  if (frontendStats.noCoverage > 0 || backendStats.noCoverage > 0) {
    markdown += `- Increase code coverage for uncovered mutants\n`;
  }
  if (overallScore < THRESHOLD) {
    markdown += `- Focus on improving test assertions and edge cases\n`;
  }
  markdown += `- View detailed HTML reports in \`mutation-reports/\` directory\n\n`;

  markdown += `---\n\n`;
  markdown += `*For detailed analysis, view the HTML reports at:*\n`;
  markdown += `- Frontend: [mutation-reports/frontend/index.html](mutation-reports/frontend/index.html)\n`;
  markdown += `- Backend: [mutation-reports/backend/index.html](mutation-reports/backend/index.html)\n`;

  return markdown;
}

/**
 * Update historical data
 */
function updateHistory(frontendReport, backendReport) {
  let history = [];
  
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
      history = JSON.parse(content);
    } catch (error) {
      console.error('Error reading history file:', error.message);
    }
  }

  const entry = {
    timestamp: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || 'local',
    branch: process.env.GITHUB_REF_NAME || 'local',
    scores: {
      frontend: calculateScore(frontendReport),
      backend: calculateScore(backendReport),
      overall: 0
    },
    stats: {
      frontend: getMutantStats(frontendReport),
      backend: getMutantStats(backendReport)
    }
  };

  const totalMutants = entry.stats.frontend.total + entry.stats.backend.total;
  const totalKilled = entry.stats.frontend.killed + entry.stats.backend.killed;
  entry.scores.overall = totalMutants > 0 ? (totalKilled / totalMutants) * 100 : 0;

  history.push(entry);

  // Keep only last 100 entries
  if (history.length > 100) {
    history = history.slice(-100);
  }

  // Ensure directory exists
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  return entry.scores;
}

/**
 * Get previous score from history
 */
function getPreviousScore() {
  if (!fs.existsSync(HISTORY_FILE)) return null;

  try {
    const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const history = JSON.parse(content);
    if (history.length < 2) return null;
    return history[history.length - 2].scores;
  } catch (error) {
    return null;
  }
}

/**
 * Main execution
 */
function main() {
  console.log('📊 Generating mutation testing reports...\n');

  const frontendReport = loadReport(FRONTEND_REPORT);
  const backendReport = loadReport(BACKEND_REPORT);

  if (!frontendReport && !backendReport) {
    console.error('❌ No mutation reports found!');
    process.exit(1);
  }

  const previousScore = getPreviousScore();
  const currentScore = updateHistory(frontendReport, backendReport);

  const markdown = generateMarkdownSummary(frontendReport, backendReport, previousScore);

  // Write summary
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_FILE, markdown);

  console.log('✅ Reports generated successfully!');
  console.log(`   - Summary: ${SUMMARY_FILE}`);
  console.log(`   - History: ${HISTORY_FILE}`);
  console.log(`   - Overall Score: ${currentScore.overall.toFixed(2)}%\n`);

  // Print summary to console
  console.log(markdown);

  // Exit with error if below threshold
  const THRESHOLD = 75;
  if (currentScore.overall < THRESHOLD) {
    console.error(`\n❌ Mutation score ${currentScore.overall.toFixed(2)}% is below threshold ${THRESHOLD}%`);
    process.exit(1);
  }
}

main();
