# SubTrackr Template Preview — VS Code Extension

Live-preview panel for SubTrackr email and notification templates directly inside VS Code.
No deployment required — changes render instantly as you type.

## Features

- **Live preview side panel** — rendered HTML updates on every save (auto-refresh)
- **Variable injection** — right-click any variable to set a mock value
- **AST tree view** — parsed template structure in the Explorer sidebar
- **Inline validation** — syntax errors highlighted with red squiggly underlines
- **Partial rendering** — render any partial template standalone
- **Mock data** — loaded from `.mock.json` in your workspace root, with built-in defaults

## Supported Formats

| Format | Language ID |
|---|---|
| MJML | `mjml` |
| Handlebars | `handlebars`, `hbs` |
| Custom AST-based | `html` (fallback) |

## Installation

### From the Marketplace

Search for **SubTrackr Template Preview** (`subtrackr-template-preview`) in the VS Code Extensions panel and click **Install**.

### From Source

```bash
cd vscode-extension
npm install
npm run compile
# Package and install locally:
npm run package   # produces subtrackr-template-preview-*.vsix
code --install-extension subtrackr-template-preview-*.vsix
```

## Usage

### Open the Preview Panel

1. Open a template file (`.mjml`, `.hbs`, `.html`).
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Run **SubTrackr: Open Template Preview**.

The preview panel opens to the side and auto-refreshes on every save.

### Edit a Mock Variable (Right-Click)

1. Right-click anywhere in the template editor.
2. Select **SubTrackr: Edit Mock Variable**.
3. Enter the variable name and the value to inject.

The preview refreshes immediately with the new value.

### AST Tree View

The **Template AST** panel appears in the Explorer sidebar when a template is open.
It shows the parsed structure: elements, expressions, blocks, partials, and variables.

Run **SubTrackr: Show AST Tree** from the Command Palette to manually refresh it.

### Render a Partial Standalone

1. Run **SubTrackr: Render Partial Standalone** from the Command Palette.
2. Enter the partial name (e.g. `header`).
3. A new panel opens with the partial rendered in isolation.

Partials are loaded from `templates/partials/<name>.hbs` in your workspace.

### Syntax Validation

Syntax errors are highlighted inline as red squiggly underlines with the error message.
The preview renders the template up to the error location so you can see what rendered correctly.

## Mock Data

Variables are resolved in this priority order:

1. **Runtime overrides** — set via the right-click menu during the session
2. **`.mock.json`** — file in your workspace root (or the path set in settings)
3. **Built-in defaults** — `userName`, `userEmail`, `subscriptionPlan`, `billingAmount`, etc.

### Example `.mock.json`

```json
{
  "userName": "Jane Doe",
  "userEmail": "jane@example.com",
  "subscriptionPlan": "Pro",
  "billingAmount": "29.99",
  "billingCurrency": "USD",
  "nextBillingDate": "2026-08-01",
  "companyName": "SubTrackr",
  "unsubscribeUrl": "https://app.subtrackr.io/unsubscribe"
}
```

## Configuration

| Setting | Default | Description |
|---|---|---|
| `subtrackr-template-preview.mockDataFile` | `.mock.json` | Path to mock data file, relative to workspace root |

## Edge Cases

- **Syntax errors** — the preview renders all content up to the error line; errors appear in the banner and as inline diagnostics.
- **Missing `.mock.json`** — built-in default fixtures are used automatically.
- **Partial not found** — the standalone partial panel shows a "not found" message.
- **Unknown language** — treated as Handlebars (variable substitution only).

## Extension Layout

```
vscode-extension/
├── src/
│   ├── extension.ts         # Activation entry point; registers commands & hooks
│   ├── previewPanel.ts      # WebviewPanel — renders template HTML in side panel
│   ├── templateRenderer.ts  # MJML + Handlebars rendering; partial preview on error
│   ├── astTreeProvider.ts   # TreeDataProvider for AST tree view in Explorer
│   └── mockDataManager.ts   # Mock variable store (file + runtime overrides)
├── .mock.json               # Default mock data for development
├── package.json             # Extension manifest, commands, contributes
└── tsconfig.json            # TypeScript config
```

## Development

```bash
cd vscode-extension
npm install
npm run watch        # incremental TypeScript compilation
# Press F5 in VS Code to launch Extension Development Host
```

Run tests:

```bash
npm test
```

## Publishing

```bash
npm run package      # produces .vsix file
# Then upload to VS Code Marketplace via https://marketplace.visualstudio.com/manage
```

Publisher ID: `subtrackr` — extension ID: `subtrackr-template-preview`
