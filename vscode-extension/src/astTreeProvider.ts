import * as vscode from 'vscode';

export interface AstNode {
  type: string;
  value?: string;
  children?: AstNode[];
}

export class AstTreeProvider implements vscode.TreeDataProvider<AstTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AstTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private root: AstNode[] = [];

  update(source: string, languageId: string): void {
    this.root = parseToAst(source, languageId);
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: AstTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AstTreeItem): AstTreeItem[] {
    const nodes = element ? (element.node.children ?? []) : this.root;
    return nodes.map((n) => new AstTreeItem(n));
  }
}

class AstTreeItem extends vscode.TreeItem {
  constructor(public readonly node: AstNode) {
    const hasChildren = (node.children?.length ?? 0) > 0;
    super(
      node.value ? `${node.type}: ${node.value}` : node.type,
      hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    this.tooltip = node.value ?? node.type;
    this.iconPath = new vscode.ThemeIcon(iconForType(node.type));
  }
}

function iconForType(type: string): string {
  switch (type) {
    case 'document':
      return 'file-code';
    case 'element':
    case 'tag':
      return 'symbol-class';
    case 'expression':
    case 'variable':
      return 'symbol-variable';
    case 'partial':
      return 'symbol-module';
    case 'block':
      return 'symbol-namespace';
    case 'text':
      return 'symbol-string';
    default:
      return 'symbol-misc';
  }
}

/**
 * Minimal AST parser — produces a human-readable tree for MJML and Handlebars.
 * Replace with a proper parser (e.g. @handlebars/parser, fast-xml-parser) in production.
 */
function parseToAst(source: string, languageId: string): AstNode[] {
  if (languageId === 'handlebars' || languageId === 'hbs') {
    return parseHandlebarsAst(source);
  }
  // Default: XML/MJML tag-based parse
  return parseXmlAst(source);
}

function parseHandlebarsAst(source: string): AstNode[] {
  const nodes: AstNode[] = [{ type: 'document', children: [] }];
  const root = nodes[0];

  // Extract expressions {{...}}, blocks {{#...}}...{{/...}}, partials {{>...}}
  const re = /(\{\{[#/]?(\w+)[^}]*\}\})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const raw = match[1];
    const name = match[2];
    if (raw.startsWith('{{#')) {
      root.children!.push({ type: 'block', value: name, children: [] });
    } else if (raw.startsWith('{{>')) {
      root.children!.push({ type: 'partial', value: name });
    } else if (!raw.startsWith('{{/')) {
      root.children!.push({ type: 'variable', value: name });
    }
  }

  if (root.children!.length === 0) {
    root.children!.push({ type: 'text', value: '(no expressions found)' });
  }

  return nodes;
}

function parseXmlAst(source: string): AstNode[] {
  const nodes: AstNode[] = [];
  const re = /<(\/?[\w-]+)[^>]*>/g;
  const stack: AstNode[] = [];
  let match: RegExpExecArray | null;

  while ((match = re.exec(source)) !== null) {
    const raw = match[1];
    if (raw.startsWith('/')) {
      stack.pop();
      continue;
    }
    const node: AstNode = { type: 'element', value: raw, children: [] };
    if (stack.length > 0) {
      stack[stack.length - 1].children!.push(node);
    } else {
      nodes.push(node);
    }
    if (!match[0].endsWith('/>')) {
      stack.push(node);
    }
  }

  return nodes.length > 0 ? nodes : [{ type: 'document', value: '(empty)', children: [] }];
}
