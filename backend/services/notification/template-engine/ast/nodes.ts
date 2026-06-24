export type ASTNode =
  | TextNode
  | VariableNode
  | IfNode
  | ForNode
  | FilterNode
  | PartialNode;

export interface TextNode {
  type: 'Text';
  value: string;
  line: number;
}

export interface VariableNode {
  type: 'Variable';
  path: string[];
  filters: FilterExpression[];
  line: number;
}

export interface IfNode {
  type: 'If';
  condition: ConditionExpression;
  consequent: ASTNode[];
  alternate: ASTNode[];
  line: number;
}

export interface ForNode {
  type: 'For';
  item: string;
  iterable: string[];
  body: ASTNode[];
  line: number;
}

export interface FilterNode {
  type: 'Filter';
  input: string[];
  name: string;
  args: string[];
  line: number;
}

export interface PartialNode {
  type: 'Partial';
  name: string;
  params: Record<string, string>;
  line: number;
}

export interface FilterExpression {
  name: string;
  args: string[];
}

export type ConditionOperator = '==' | '!=' | '>' | '<' | '>=' | '<=' | '&&' | '||';

export interface ConditionExpression {
  left: string;
  operator: ConditionOperator;
  right: string;
}

export interface TemplateAST {
  nodes: ASTNode[];
}

export interface TemplateError extends Error {
  message: string;
  line: number;
  expectedToken?: string;
  foundToken?: string;
}
