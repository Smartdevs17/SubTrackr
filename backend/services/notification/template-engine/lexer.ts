export type TokenType =
  | 'TEXT'
  | 'VAR_OPEN'
  | 'VAR_CLOSE'
  | 'IF_OPEN'
  | 'ELSE'
  | 'ENDIF'
  | 'FOR_OPEN'
  | 'ENDFOR'
  | 'FILTER_PIPE'
  | 'PARTIAL_OPEN'
  | 'PARTIAL_CLOSE'
  | 'IDENTIFIER'
  | 'STRING'
  | 'NUMBER'
  | 'OPERATOR'
  | 'DOT'
  | 'LPAREN'
  | 'RPAREN'
  | 'EQUALS'
  | 'COMMA'
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const KEYWORDS: Record<string, TokenType> = {
  if: 'IF_OPEN',
  else: 'ELSE',
  endif: 'ENDIF',
  endfor: 'ENDFOR',
  for: 'FOR_OPEN',
  end: 'EOF',
};

const OPERATORS = new Set(['==', '!=', '>=', '<=', '>', '<', '&&', '||']);

export function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  const lines = template.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNumber = lineIdx + 1;
    let col = 0;

    while (col < line.length) {
      const ch = line[col];

      if (ch === '{' && line[col + 1] === '{') {
        col += 2;
        let varContent = '';
        let braceDepth = 1;
        while (col < line.length && braceDepth > 0) {
          if (line[col] === '{' && line[col + 1] === '{') {
            braceDepth++;
            varContent += '{{';
            col += 2;
            continue;
          }
          if (line[col] === '}' && line[col + 1] === '}') {
            braceDepth--;
            if (braceDepth === 0) {
              col += 2;
              break;
            }
            varContent += '}}';
            col += 2;
            continue;
          }
          varContent += line[col];
          col++;
        }

        if (braceDepth !== 0) {
          throw makeError(
            `Unclosed variable tag: expected }}`,
            lineNumber,
            '}}',
            'EOF'
          );
        }

        const trimmed = varContent.trim();

        if (trimmed.startsWith('%')) {
          tokens.push({ type: 'PARTIAL_OPEN', value: '%', line: lineNumber, column: col });
          const rest = trimmed.slice(1).trim();
          if (rest) {
            tokens.push({ type: 'IDENTIFIER', value: rest, line: lineNumber, column: col });
          }
          tokens.push({ type: 'PARTIAL_CLOSE', value: '%', line: lineNumber, column: col });
          continue;
        }

        if (trimmed.startsWith('#') && trimmed.endsWith('#')) {
          const keyword = trimmed.slice(1, -1).trim();
          const lower = keyword.toLowerCase();

          if (lower === 'else') {
            tokens.push({ type: 'ELSE', value: 'else', line: lineNumber, column: col });
            continue;
          }

          if (lower === '/if' || lower === 'endif') {
            tokens.push({ type: 'ENDIF', value: 'endif', line: lineNumber, column: col });
            continue;
          }

          if (lower === '/for' || lower === 'endfor') {
            tokens.push({ type: 'ENDFOR', value: 'endfor', line: lineNumber, column: col });
            continue;
          }

          if (lower.startsWith('for ')) {
            tokens.push({ type: 'FOR_OPEN', value: 'for', line: lineNumber, column: col });
            const parts = lower.slice(4).trim().split(/\s+in\s+/);
            if (parts.length === 2) {
              tokens.push({ type: 'IDENTIFIER', value: parts[0].trim(), line: lineNumber, column: col });
              tokens.push({ type: 'IDENTIFIER', value: parts[1].trim(), line: lineNumber, column: col });
            }
            continue;
          }

          if (lower.startsWith('if ')) {
            tokens.push({ type: 'IF_OPEN', value: 'if', line: lineNumber, column: col });
            const cond = lower.slice(3).trim();
            tokens.push(...tokenizeCondition(cond, lineNumber, col));
            continue;
          }

          tokens.push({ type: 'IDENTIFIER', value: keyword, line: lineNumber, column: col });
          continue;
        }

        const parts = trimmed.split('|');
        const varPart = parts[0].trim();
        if (varPart) {
          tokens.push({ type: 'VAR_OPEN', value: '{{', line: lineNumber, column: col });
          const varTokens = tokenizeVariable(varPart, lineNumber, col);
          tokens.push(...varTokens);
          tokens.push({ type: 'VAR_CLOSE', value: '}}', line: lineNumber, column: col });
        }

        for (let f = 1; f < parts.length; f++) {
          const filterExpr = parts[f].trim();
          tokens.push({ type: 'FILTER_PIPE', value: '|', line: lineNumber, column: col });
          const filterTokens = tokenizeFilter(filterExpr, lineNumber, col);
          tokens.push(...filterTokens);
        }
        continue;
      }

      let text = '';
      while (col < line.length && !(line[col] === '{' && line[col + 1] === '{')) {
        text += line[col];
        col++;
      }
      if (text.length > 0) {
        tokens.push({ type: 'TEXT', value: text, line: lineNumber, column: col - text.length });
      }
    }
  }

  tokens.push({ type: 'EOF', value: '', line: lines.length, column: 0 });
  return tokens;
}

function tokenizeVariable(expr: string, line: number, col: number): Token[] {
  const tokens: Token[] = [];
  const parts = expr.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      tokens.push({ type: 'DOT', value: '.', line, column: col });
    }
    tokens.push({ type: 'IDENTIFIER', value: parts[i].trim(), line, column: col });
  }
  return tokens;
}

function tokenizeFilter(expr: string, line: number, col: number): Token[] {
  const tokens: Token[] = [];
  const parenIdx = expr.indexOf('(');
  if (parenIdx >= 0) {
    const name = expr.slice(0, parenIdx).trim();
    tokens.push({ type: 'IDENTIFIER', value: name, line, column: col });
    tokens.push({ type: 'LPAREN', value: '(', line, column: col });
    const argsStr = expr.slice(parenIdx + 1, expr.lastIndexOf(')')).trim();
    if (argsStr) {
      const args = argsStr.split(',').map((a) => a.trim().replace(/^["']|["']$/g, ''));
      for (let i = 0; i < args.length; i++) {
        if (i > 0) tokens.push({ type: 'COMMA', value: ',', line, column: col });
        tokens.push({ type: 'STRING', value: args[i], line, column: col });
      }
    }
    tokens.push({ type: 'RPAREN', value: ')', line, column: col });
  } else {
    tokens.push({ type: 'IDENTIFIER', value: expr, line, column: col });
  }
  return tokens;
}

function tokenizeCondition(cond: string, line: number, col: number): Token[] {
  const tokens: Token[] = [];
  const operatorMatch = OPERATORS.values();
  let foundOp = '';
  for (const op of OPERATORS) {
    if (cond.includes(op)) {
      foundOp = op;
      break;
    }
  }
  operatorMatch: void 0;

  if (foundOp) {
    const parts = cond.split(foundOp);
    const left = parts[0].trim();
    const right = parts.slice(1).join(foundOp).trim();

    if (left) {
      tokens.push({ type: 'IDENTIFIER', value: left, line, column: col });
    } else {
      const numMatch = left.match(/^\d+/);
      if (numMatch) tokens.push({ type: 'NUMBER', value: numMatch[0], line, column: col });
      else tokens.push({ type: 'STRING', value: left.replace(/^["']|["']$/g, ''), line, column: col });
    }
    tokens.push({ type: 'OPERATOR', value: foundOp, line, column: col });
    if (right) {
      const trimmedRight = right.trim();
      if (/^\d+$/.test(trimmedRight)) {
        tokens.push({ type: 'NUMBER', value: trimmedRight, line, column: col });
      } else if (/^["'].*["']$/.test(trimmedRight)) {
        tokens.push({ type: 'STRING', value: trimmedRight.replace(/^["']|["']$/g, ''), line, column: col });
      } else {
        tokens.push({ type: 'IDENTIFIER', value: trimmedRight, line, column: col });
      }
    }
  } else {
    tokens.push({ type: 'IDENTIFIER', value: cond, line, column: col });
  }
  return tokens;
}

export function makeError(
  message: string,
  line: number,
  expected?: string,
  found?: string
): Error & { line: number; expectedToken?: string; foundToken?: string } {
  const err = new Error(
    `Template error at line ${line}: ${message}${expected ? ` (expected ${expected})` : ''}${found ? ` (found ${found})` : ''}`
  ) as Error & { line: number; expectedToken?: string; foundToken?: string };
  err.line = line;
  err.expectedToken = expected;
  err.foundToken = found;
  return err;
}
