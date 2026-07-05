import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/** Default fixture values used when no .mock.json is present */
const DEFAULT_FIXTURES: Record<string, unknown> = {
  userName: 'Jane Doe',
  userEmail: 'jane@example.com',
  subscriptionPlan: 'Pro',
  billingAmount: '29.99',
  billingCurrency: 'USD',
  nextBillingDate: '2026-08-01',
  companyName: 'SubTrackr',
  unsubscribeUrl: 'https://app.subtrackr.io/unsubscribe',
};

export class MockDataManager {
  private overrides: Record<string, unknown> = {};
  private fromFile: Record<string, unknown> = {};

  constructor(private context: vscode.ExtensionContext) {
    this.loadFromFile();
  }

  /** Load variables from workspace .mock.json (or configured path) */
  loadFromFile(): void {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return;

    const config = vscode.workspace.getConfiguration('subtrackr-template-preview');
    const mockFile = config.get<string>('mockDataFile', '.mock.json');
    const filePath = path.join(folders[0].uri.fsPath, mockFile);

    if (fs.existsSync(filePath)) {
      try {
        this.fromFile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        vscode.window.showWarningMessage(`SubTrackr: Failed to parse ${mockFile}`);
        this.fromFile = {};
      }
    }
  }

  set(key: string, value: unknown): void {
    this.overrides[key] = value;
  }

  getAll(): Record<string, unknown> {
    // Priority: runtime overrides > file > defaults
    return { ...DEFAULT_FIXTURES, ...this.fromFile, ...this.overrides };
  }
}
