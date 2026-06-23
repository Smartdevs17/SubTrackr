import { Token, TokenType } from './lexer';
import {
  ASTNode,
  ConditionExpression,
  ConditionOperator,
  FilterExpression,
  IfNode,
} from './ast/nodes';

const OPERATOR_MAP: Record<string, ConditionOperator> = {
  '==': '==',
  '!=': '!=',
  '>': '>',
  '<': '<',
  '>=': '>=',
  '<=': '<=',
  '&&': '&&',
  '||': '||',
};

export function parse(tokens: Token[]): ASTNode[] {
  return parseNodes(tokens, 0).nodes;
}

interface ParseResult {
  nodes: ASTNode[];
  pos: number;
}

function parseNodes(tokens: Token[], start: number): ParseResult {
  const nodes: ASTNode[] = [];
  let pos = start;

  while (pos < tokens.length) {
    const token = tokens[pos];

    switch (token.type) {
      case 'TEXT':
        nodes.push({
          type: 'Text',
          value: token.value,
          line: token.line,
        });
        pos++;
        break;

      case 'VAR_OPEN':
        pos++;
        const varResult = parseVariable(tokens, pos, token.line);
        nodes.push(...varResult.nodes);
        pos = varResult.pos + 1;
        break;

      case 'FILTER_PIPE':
        pos++;
        const filter = parseSingleFilter(tokens, pos, token.line);
        nodes.push(filter.node);
        pos = filter.pos;
        break;

      case 'PARTIAL_OPEN':
        pos++;
        const partial = parsePartial(tokens, pos, token.line);
        nodes.push(partial.node);
        pos = partial.pos + 1;
        break;

      case 'IF_OPEN':
        const ifResult = parseIf(tokens, pos, token.line);
        nodes.push(ifResult.node);
        pos = ifResult.pos;
        break;

      case 'FOR_OPEN':
        pos++;
        const forResult = parseFor(tokens, pos, token.line);
        nodes.push(forResult.node);
        pos = forResult.pos;
        break;

      case 'ELSE':
      case 'ENDIF':
      case 'ENDFOR':
      case 'EOF':
        return { nodes, pos };

      default:
        throw makeParseError(
          `Unexpected token: ${token.type} (${token.value})`,
          token.line,
          'expression',
          token.type
        );
    }
  }

  return { nodes, pos };
}

function parseVariable(
  tokens: Token[],
  start: number,
  line: number
): ParseResult {
  const path: string[] = [];
  const filters: FilterExpression[] = [];
  let pos = start;

  while (pos < tokens.length) {
    const token = tokens[pos];

    if (token.type === 'IDENTIFIER') {
      path.push(token.value);
      pos++;
    } else if (token.type === 'DOT') {
      pos++;
    } else if (token.type === 'FILTER_PIPE') {
      pos++;
      const fResult = parseFilterExpression(tokens, pos, token.line);
      filters.push(...fResult.filters);
      pos = fResult.pos;
    } else if (token.type === 'VAR_CLOSE') {
      break;
    } else {
      throw makeParseError(
        `Unexpected token in variable: ${token.type}`,
        token.line,
        'IDENTIFIER or FILTER',
        token.type
      );
    }
  }

  const node: ASTNode = path.length > 0
    ? { type: 'Variable', path, filters, line }
    : { type: 'Text', value: '', line };

  return { nodes: [node], pos };
}

function parseFilterExpression(
  tokens: Token[],
  start: number,
  line: number
): { filters: FilterExpression[]; pos: number } {
  const filters: FilterExpression[] = [];
  let pos = start;

  while (pos < tokens.length) {
    const token = tokens[pos];
    if (token.type === 'IDENTIFIER') {
      const name = token.value;
      pos++;
      const args: string[] = [];

      if (pos < tokens.length && tokens[pos].type === 'LPAREN') {
        pos++;
        while (pos < tokens.length && tokens[pos].type !== 'RPAREN') {
          if (tokens[pos].type === 'STRING' || tokens[pos].type === 'NUMBER') {
            args.push(tokens[pos].value);
          }
          pos++;
        }
        pos++;
      }

      filters.push({ name, args });
    } else {
      break;
    }

    if (pos < tokens.length && tokens[pos].type === 'FILTER_PIPE') {
      pos++;
    } else {
      break;
    }
  }

  return { filters, pos };
}

function parseSingleFilter(
  tokens: Token[],
  start: number,
  line: number
): { node: ASTNode; pos: number } {
  const name = tokens[start].type === 'IDENTIFIER' ? tokens[start].value : '';
  let pos = start + 1;
  const args: string[] = [];

  if (pos < tokens.length && tokens[pos].type === 'LPAREN') {
    pos++;
    while (pos < tokens.length && tokens[pos].type !== 'RPAREN') {
      if (tokens[pos].type === 'STRING' || tokens[pos].type === 'NUMBER') {
        args.push(tokens[pos].value);
      }
      pos++;
    }
    pos++;
  }

  return {
    node: { type: 'Filter', input: [], name, args, line },
    pos,
  };
}

function parsePartial(
  tokens: Token[],
  start: number,
  line: number
): { node: ASTNode; pos: number } {
  let pos = start;
  let name = '';
  const params: Record<string, string> = {};

  while (pos < tokens.length && tokens[pos].type !== 'PARTIAL_CLOSE') {
    const token = tokens[pos];
    if (token.type === 'IDENTIFIER') {
      if (!name) {
        name = token.value;
      } else {
        const key = token.value;
        pos++;
        if (pos < tokens.length && tokens[pos].type === 'EQUALS') {
          pos++;
          if (pos < tokens.length && (tokens[pos].type === 'STRING' || tokens[pos].type === 'IDENTIFIER')) {
            params[key] = tokens[pos].value;
          }
        }
      }
    }
    pos++;
  }

  return {
    node: { type: 'Partial', name, params, line },
    pos,
  };
}

function parseIf(
  tokens: Token[],
  start: number,
  line: number
): { node: ASTNode; pos: number } {
  let pos = start + 1;
  const condition = parseCondition(tokens, pos, line);
  pos = condition.pos;

  const consequentResult = parseNodes(tokens, pos);
  const consequentNodes = consequentResult.nodes;
  pos = consequentResult.pos;

  const alternateNodes: ASTNode[] = [];

  if (pos < tokens.length && tokens[pos].type === 'ELSE') {
    pos++;
    const altResult = parseNodes(tokens, pos);
    alternateNodes.push(...altResult.nodes);
    pos = altResult.pos;
  }

  if (pos < tokens.length && tokens[pos].type === 'ENDIF') {
    pos++;
  }

  return {
    node: {
      type: 'If',
      condition,
      consequent: consequentNodes,
      alternate: alternateNodes,
      line,
    },
    pos,
  };
}

function parseCondition(
  tokens: Token[],
  start: number,
  line: number
): { condition: ConditionExpression; pos: number } {
  let pos = start;
  let left = '';
  let operator: ConditionOperator = '==';
  let right = '';

  while (pos < tokens.length) {
    const token = tokens[pos];

    if (token.type === 'VAR_CLOSE' || token.type === 'EOF' ||
        token.type === 'TEXT' || token.type === 'ELSE' ||
        token.type === 'ENDIF' || token.type === 'ENDFOR') {
      break;
    }

    if (token.type === 'IDENTIFIER' || token.type === 'STRING' || token.type === 'NUMBER') {
      if (!left) {
        left = token.value;
        pos++;
      } else if (operator && !right) {
        right = token.value;
        pos++;
      } else {
        pos++;
      }
    } else if (token.type === 'OPERATOR') {
      operator = OPERATOR_MAP[token.value] || '==';
      pos++;
    } else {
      pos++;
    }
  }

  return { condition: { left, operator, right }, pos };
}

function parseFor(
  tokens: Token[],
  start: number,
  line: number
): { node: ASTNode; pos: number } {
  let pos = start;

  let item = '';
  const iterable: string[] = [];

  while (pos < tokens.length) {
    const token = tokens[pos];

    if (token.type === 'ENDFOR' || token.type === 'EOF') {
      break;
    }

    if (token.type === 'IDENTIFIER') {
      if (!item) {
        item = token.value;
      } else {
        iterable.push(token.value);
      }
    }

    pos++;
    if (pos >= tokens.length) break;

    if (tokens[pos].type === 'ENDIF' || tokens[pos].type === 'EOF' ||
        tokens[pos].type === 'ENDFOR') {
      break;
    }

    if (item && iterable.length > 0) {
      break;
    }
  }

  const bodyResult = parseNodes(tokens, pos);
  const bodyNodes = bodyResult.nodes;
  pos = bodyResult.pos;

  if (pos < tokens.length && tokens[pos].type === 'ENDFOR') {
    pos++;
  }

  return {
    node: {
      type: 'For',
      item,
      iterable,
      body: bodyNodes,
      line,
    },
    pos,
  };
}

import { makeError } from './lexer';

function makeParseError(
  message: string,
  line: number,
  expected?: string,
  found?: string
): Error & { line: number; expectedToken?: string; foundToken?: string } {
  return makeError(`Parse error: ${message}`, line, expected, found);
}
