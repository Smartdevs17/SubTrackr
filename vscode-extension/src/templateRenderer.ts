import * as vscode from 'vscode';
import {
  applyDiagnostics as _applyDiagnostics,
  lintTemplate,
  TemplateDiagnostic,
} from './validation';

export interface RenderResult {
  html: string;
  errors: RenderError[];
  /** Index up to which rendering succeeded (for partial preview on error) */
  partialUpTo?: number;
}

export interface RenderError {
  line: number;
  col: number;
  message: string;
}

/** Render a template with injected mock variables. */
export async function renderTemplate(
  source: string,
  languageId: string,
  variables: Record<string, unknown>
): Promise<RenderResult> {
  switch (languageId) {
    case 'mjml':
      return renderMjml(source, variables);
    case 'handlebars':
    case 'hbs':
      return renderHandlebars(source, variables);
    default:
      return renderHandlebars(source, variables); // fallback: treat as Handlebars/custom
  }
}

async function renderMjml(
  source: string,
  variables: Record<string, unknown>
): Promise<RenderResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mjml = require('mjml');
    // Inject variables by substituting {{varName}} patterns before MJML compilation
    const interpolated = injectVariables(source, variables);
    const result = mjml(interpolated, { validationLevel: 'soft' });

    const errors: RenderError[] = (result.errors ?? []).map(
      (e: { line: number; message: string }) => ({
        line: e.line ?? 0,
        col: 0,
        message: e.message,
      })
    );

    return { html: result.html ?? '', errors };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const lineMatch = msg.match(/line\s+(\d+)/i);
    const line = lineMatch ? parseInt(lineMatch[1], 10) : 1;
    const partialHtml = buildPartialHtml(source, line, variables);
    return {
      html: partialHtml,
      errors: [{ line, col: 0, message: msg }],
      partialUpTo: line,
    };
  }
}

async function renderHandlebars(
  source: string,
  variables: Record<string, unknown>
): Promise<RenderResult> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Handlebars = require('handlebars');
    const template = Handlebars.compile(source, { strict: false });
    const html = template(variables);
    return { html, errors: [] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const lineMatch = msg.match(/line\s+(\d+)/i);
    const line = lineMatch ? parseInt(lineMatch[1], 10) : 1;
    const partialHtml = buildPartialHtml(source, line, variables);
    return {
      html: partialHtml,
      errors: [{ line, col: 0, message: msg }],
      partialUpTo: line,
    };
  }
}

/** Inject {{var}} patterns for languages that don't natively support them */
function injectVariables(source: string, vars: Record<string, unknown>): string {
  return source.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`
  );
}

/**
 * Build a partial HTML preview from lines 1..errorLine-1.
 * Lets developers see what rendered correctly up to the error location.
 */
function buildPartialHtml(
  source: string,
  errorLine: number,
  vars: Record<string, unknown>
): string {
  const lines = source.split('\n');
  const safeSource = lines.slice(0, Math.max(errorLine - 1, 1)).join('\n');
  const interpolated = injectVariables(safeSource, vars);
  return `<div style="opacity:0.7">${interpolated}</div>
<hr style="border-color:red"/>
<p style="color:red;font-family:monospace">⚠ Rendering stopped at line ${errorLine} due to a syntax error.</p>`;
}

/** Apply inline error diagnostics (red squiggly underlines) — delegates to validation module */
export function applyDiagnostics(
  doc: vscode.TextDocument,
  errors: RenderError[],
  collection: vscode.DiagnosticCollection
): void {
  // Merge render errors with static lint diagnostics
  const lintDiags = lintTemplate(doc.getText(), doc.languageId);
  const renderDiags: TemplateDiagnostic[] = errors.map((e) => ({
    ...e,
    severity: 'error' as const,
  }));
  _applyDiagnostics(doc, [...lintDiags, ...renderDiags], collection);
}
