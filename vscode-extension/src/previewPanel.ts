import * as vscode from 'vscode';
import { renderTemplate, applyDiagnostics } from './templateRenderer';
import { MockDataManager } from './mockDataManager';
import { AstTreeProvider } from './astTreeProvider';

const TEMPLATE_EXTENSIONS = new Set(['.mjml', '.hbs', '.html', '.handlebars']);

export class TemplatePreviewPanel {
  private static current: TemplatePreviewPanel | undefined;
  private static diagnostics = vscode.languages.createDiagnosticCollection('subtrackr-template');

  private readonly panel: vscode.WebviewPanel;
  private doc: vscode.TextDocument;
  private mockData: MockDataManager;
  private astProvider: AstTreeProvider;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    extensionUri: vscode.Uri,
    doc: vscode.TextDocument,
    mockData: MockDataManager,
    astProvider: AstTreeProvider
  ) {
    this.doc = doc;
    this.mockData = mockData;
    this.astProvider = astProvider;

    this.panel = vscode.window.createWebviewPanel(
      'subtrackrTemplatePreview',
      `Preview: ${vscode.workspace.asRelativePath(doc.uri)}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [extensionUri] }
    );

    this.render();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === this.doc.uri.toString()) {
          this.doc = e.document;
          this.render();
        }
      })
    );
  }

  static createOrShow(
    extensionUri: vscode.Uri,
    doc: vscode.TextDocument,
    mockData: MockDataManager,
    astProvider: AstTreeProvider
  ): void {
    if (TemplatePreviewPanel.current) {
      TemplatePreviewPanel.current.doc = doc;
      TemplatePreviewPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      TemplatePreviewPanel.current.render();
      return;
    }
    TemplatePreviewPanel.current = new TemplatePreviewPanel(
      extensionUri,
      doc,
      mockData,
      astProvider
    );
  }

  static refresh(): void {
    TemplatePreviewPanel.current?.render();
  }

  static dispose(): void {
    TemplatePreviewPanel.current?.dispose();
  }

  static isTemplateDocument(doc: vscode.TextDocument): boolean {
    const ext = doc.uri.fsPath.slice(doc.uri.fsPath.lastIndexOf('.'));
    return TEMPLATE_EXTENSIONS.has(ext);
  }

  static renderPartial(
    extensionUri: vscode.Uri,
    partialName: string,
    mockData: MockDataManager
  ): void {
    const panel = vscode.window.createWebviewPanel(
      'subtrackrPartialPreview',
      `Partial: ${partialName}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    const vars = mockData.getAll();
    // Load partial source from workspace
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.length) return;

    const partialUri = vscode.Uri.joinPath(
      workspaceFolders[0].uri,
      'templates',
      'partials',
      `${partialName}.hbs`
    );

    vscode.workspace.fs.readFile(partialUri).then(
      (bytes) => {
        const source = Buffer.from(bytes).toString('utf8');
        renderTemplate(source, 'handlebars', vars).then(({ html, errors }) => {
          panel.webview.html = buildWebviewHtml(html, errors);
        });
      },
      () => {
        panel.webview.html = buildWebviewHtml(`<p>Partial "${partialName}" not found.</p>`, []);
      }
    );
  }

  private render(): void {
    const source = this.doc.getText();
    const langId = this.doc.languageId;
    const vars = this.mockData.getAll();

    // Update AST tree view in parallel
    this.astProvider.update(source, langId);
    vscode.commands.executeCommand('setContext', 'subtrackr.templateOpen', true);

    renderTemplate(source, langId, vars).then(({ html, errors }) => {
      // Apply inline diagnostics (red squiggly)
      applyDiagnostics(this.doc, errors, TemplatePreviewPanel.diagnostics);
      this.panel.webview.html = buildWebviewHtml(html, errors);
    });
  }

  private dispose(): void {
    TemplatePreviewPanel.current = undefined;
    TemplatePreviewPanel.diagnostics.clear();
    this.panel.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

function buildWebviewHtml(html: string, errors: Array<{ line: number; message: string }>): string {
  const errorBanner =
    errors.length > 0
      ? `<div style="background:#fee2e2;color:#991b1b;padding:8px 12px;font-family:monospace;font-size:12px;border-bottom:1px solid #fca5a5">
          ${errors.map((e) => `⚠ Line ${e.line}: ${escapeHtml(e.message)}`).join('<br>')}
         </div>`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
  <style>body{margin:0;padding:0;}</style>
</head>
<body>
  ${errorBanner}
  ${html}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
