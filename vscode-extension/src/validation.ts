import * as vscode from 'vscode';

export interface TemplateDiagnostic {
  line: number;
  col: number;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Apply template diagnostics as VS Code inline decorations (red/yellow squiggles).
 * Clears previous diagnostics for the document before setting new ones.
 */
export function applyDiagnostics(
  doc: vscode.TextDocument,
  diagnostics: TemplateDiagnostic[],
  collection: vscode.DiagnosticCollection
): void {
  const vsDiagnostics: vscode.Diagnostic[] = diagnostics.map((d) => {
    const line = Math.max(d.line - 1, 0);
    const lineText = doc.lineAt(Math.min(line, doc.lineCount - 1));
    const range = lineText.range;
    const sev =
      d.severity === 'warning'
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error;
    const diag = new vscode.Diagnostic(range, d.message, sev);
    diag.source = 'SubTrackr Template Preview';
    return diag;
  });
  collection.set(doc.uri, vsDiagnostics);
}

/**
 * Lint a template source for common structural issues before rendering.
 * Returns a list of diagnostics (does not require a live renderer).
 */
export function lintTemplate(source: string, languageId: string): TemplateDiagnostic[] {
  const diagnostics: TemplateDiagnostic[] = [];

  if (languageId === 'handlebars' || languageId === 'hbs') {
    lintHandlebars(source, diagnostics);
  } else if (languageId === 'mjml') {
    lintMjml(source, diagnostics);
  }

  return diagnostics;
}

function lintHandlebars(source: string, out: TemplateDiagnostic[]): void {
  const lines = source.split('\n');

  // Detect unclosed block helpers: {{#name}} without {{/name}}
  const openBlocks: Map<string, number> = new Map();
  lines.forEach((line, idx) => {
    const openMatch = line.match(/\{\{#(\w+)/);
    const closeMatch = line.match(/\{\{\/(\w+)/);
    if (openMatch) openBlocks.set(openMatch[1], idx + 1);
    if (closeMatch) openBlocks.delete(closeMatch[1]);
  });
  for (const [name, lineNo] of openBlocks) {
    out.push({
      line: lineNo,
      col: 0,
      message: `Unclosed block helper "{{#${name}}}". Add a matching "{{/${name}}}" to close it.`,
      severity: 'error',
    });
  }

  // Warn on expressions referencing likely-undefined variables (not in DEFAULT_VARS)
  const DEFAULT_VARS = new Set([
    'userName',
    'userEmail',
    'subscriptionPlan',
    'billingAmount',
    'billingCurrency',
    'nextBillingDate',
    'companyName',
    'unsubscribeUrl',
    'walletAddress',
    'stellarNetwork',
  ]);
  lines.forEach((line, idx) => {
    const re = /\{\{(?![#/!>])(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const varName = m[1];
      if (!DEFAULT_VARS.has(varName)) {
        out.push({
          line: idx + 1,
          col: m.index,
          message: `Variable "{{${varName}}}" has no default mock value. Add it to .mock.json.`,
          severity: 'warning',
        });
      }
    }
  });
}

function lintMjml(source: string, out: TemplateDiagnostic[]): void {
  const lines = source.split('\n');

  // Warn if <mj-text> contains raw HTML that MJML will strip
  lines.forEach((line, idx) => {
    if (/<script\b/i.test(line)) {
      out.push({
        line: idx + 1,
        col: 0,
        message: '<script> tags are not allowed in MJML templates and will be stripped.',
        severity: 'warning',
      });
    }
  });

  // Error if root element is not <mjml>
  const firstTag = source.match(/<(\w[\w-]*)/);
  if (firstTag && firstTag[1].toLowerCase() !== 'mjml') {
    out.push({
      line: 1,
      col: 0,
      message: `MJML templates must start with <mjml>. Found <${firstTag[1]}> instead.`,
      severity: 'error',
    });
  }
}
