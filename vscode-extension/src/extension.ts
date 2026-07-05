import * as vscode from 'vscode';
import { TemplatePreviewPanel } from './previewPanel';
import { AstTreeProvider } from './astTreeProvider';
import { MockDataManager } from './mockDataManager';

export function activate(context: vscode.ExtensionContext): void {
  const mockData = new MockDataManager(context);
  const astProvider = new AstTreeProvider();

  // Register AST tree view
  vscode.window.registerTreeDataProvider('subtrackrAstTree', astProvider);

  // Open preview panel
  context.subscriptions.push(
    vscode.commands.registerCommand('subtrackr-template-preview.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Open a template file first.');
        return;
      }
      TemplatePreviewPanel.createOrShow(
        context.extensionUri,
        editor.document,
        mockData,
        astProvider
      );
    })
  );

  // Right-click: edit mock variable
  context.subscriptions.push(
    vscode.commands.registerCommand('subtrackr-template-preview.editMockVariable', async () => {
      const varName = await vscode.window.showInputBox({ prompt: 'Variable name to mock' });
      if (!varName) return;
      const value = await vscode.window.showInputBox({ prompt: `Value for {{${varName}}}` });
      if (value === undefined) return;
      mockData.set(varName, value);
      TemplatePreviewPanel.refresh();
    })
  );

  // Show AST tree command
  context.subscriptions.push(
    vscode.commands.registerCommand('subtrackr-template-preview.showAstTree', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      astProvider.update(editor.document.getText(), editor.document.languageId);
      vscode.commands.executeCommand('workbench.view.explorer');
    })
  );

  // Render partial standalone
  context.subscriptions.push(
    vscode.commands.registerCommand('subtrackr-template-preview.renderPartial', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const partialName = await vscode.window.showInputBox({ prompt: 'Partial name to render' });
      if (!partialName) return;
      TemplatePreviewPanel.renderPartial(context.extensionUri, partialName, mockData);
    })
  );

  // Auto-refresh on save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (TemplatePreviewPanel.isTemplateDocument(doc)) {
        TemplatePreviewPanel.refresh();
        astProvider.update(doc.getText(), doc.languageId);
      }
    })
  );
}

export function deactivate(): void {
  TemplatePreviewPanel.dispose();
}
