/**
 * backend/src/services/search.ts
 *
 * Composable subscription-search filter DSL (issue #2257).
 *
 * This module turns a small, structured query language into a typed expression
 * tree and then into a pure predicate that can be applied to subscription
 * records. It is a zero-dependency, side-effect-free core: no I/O, no clock of
 * its own (an injectable `nowMs` is used for timing), and no ambient state.
 * The same expression tree can therefore be built in code, parsed from the
 * mobile search box, compiled once and reused for any number of records.
 *
 * DSL grammar (case-insensitive `AND` / `OR` / `NOT`):
 *
 *   query      := orExpr
 *   orExpr     := andExpr ( 'OR' andExpr )*
 *   andExpr    := notExpr ( ('AND' | implicit) notExpr )*
 *   notExpr    := 'NOT' notExpr | '(' orExpr ')' | predicate
 *   predicate  := field op value | field ('IN' | 'NOTIN') '[' value (',' value)* ']'
 *   op         := ':' | '=' | '==' | '!=' | '>' | '>=' | '<' | '<=' | '~' | '^'
 *   value      := bare word | 'quoted string'
 *
 * Examples:
 *   status:active AND amount>100
 *   (provider~"Netflix" OR category=streaming) AND NOT cancelled:true
 *   status in [active, trialing] AND amount>=9.99
 *
 * Design rules:
 *  - Pure data in, pure data out; the same input and config always produce the
 *    same expression, evaluator and search result.
 *  - Every rejection is a typed `SearchError` with a stable `code`.
 *  - Fields are typed through a config registry, which both rejects unknown
 *    fields and coerces query literals deterministically (including Unicode
 *    text and ISO dates).
 *  - Metrics and logger hooks are optional; no-op defaults are provided.
 */

// ---------------------------------------------------------------------------
// Error surface
// ---------------------------------------------------------------------------

/** Stable machine-readable codes emitted by this module. */
export const SearchErrorCode = {
  INVALID_CONFIG: 'SEARCH_INVALID_CONFIG',
  INVALID_INPUT: 'SEARCH_INVALID_INPUT',
  EMPTY_QUERY: 'SEARCH_EMPTY_QUERY',
  SYNTAX_ERROR: 'SEARCH_SYNTAX_ERROR',
  UNKNOWN_FIELD: 'SEARCH_UNKNOWN_FIELD',
  UNKNOWN_OPERATOR: 'SEARCH_UNKNOWN_OPERATOR',
  INVALID_VALUE: 'SEARCH_INVALID_VALUE',
  TYPE_MISMATCH: 'SEARCH_TYPE_MISMATCH',
  LIMIT_EXCEEDED: 'SEARCH_LIMIT_EXCEEDED',
} as const;

/** Union of every stable error code emitted by this module. */
export type SearchErrorCode = (typeof SearchErrorCode)[keyof typeof SearchErrorCode];

/** Typed error thrown for malformed queries, invalid expressions and bad config. */
export class SearchError extends Error {
  readonly code: SearchErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: SearchErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {}
  ) {
    super(message);
    this.name = 'SearchError';
    this.code = code;
    this.details = details;
  }

  /** Build an `INVALID_INPUT` error with contextual details. */
  static invalidInput(message: string, details: Readonly<Record<string, unknown>> = {}): SearchError {
    return new SearchError(SearchErrorCode.INVALID_INPUT, message, details);
  }

  /** Build a `SYNTAX_ERROR` error pointing at a character offset. */
  static syntax(message: string, pos: number): SearchError {
    return new SearchError(SearchErrorCode.SYNTAX_ERROR, message, { pos });
  }
}

/** Alias kept for callers that name their errors after the DSL module. */
export const FilterDslErrorCode = SearchErrorCode;
/** Alias type for {@link SearchErrorCode}. */
export type FilterDslErrorCode = SearchErrorCode;
/** Alias class for {@link SearchError}; identical constructor and `code` field. */
export { SearchError as FilterDslError };

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Value kinds understood by the DSL's type-coercion layer. */
export const FieldKind = {
  STRING: 'string',
  NUMBER: 'number',
  BOOLEAN: 'boolean',
  DATE: 'date',
} as const;

/** Union of the supported field kinds. */
export type FieldKind = (typeof FieldKind)[keyof typeof FieldKind];

/** Every supported field kind, in declaration order. */
export const FIELD_KINDS: readonly FieldKind[] = Object.freeze([
  FieldKind.STRING,
  FieldKind.NUMBER,
  FieldKind.BOOLEAN,
  FieldKind.DATE,
]);

/** Supported comparison and membership operators. */
export const FilterOp = {
  EQ: 'eq',
  NEQ: 'neq',
  GT: 'gt',
  GTE: 'gte',
  LT: 'lt',
  LTE: 'lte',
  CONTAINS: 'contains',
  STARTS_WITH: 'startsWith',
  IN: 'in',
  NOT_IN: 'notIn',
} as const;

/** Union of the supported filter operators. */
export type FilterOp = (typeof FilterOp)[keyof typeof FilterOp];

/** Every supported operator, in declaration order. */
export const FILTER_OPS: readonly FilterOp[] = Object.freeze([
  FilterOp.EQ,
  FilterOp.NEQ,
  FilterOp.GT,
  FilterOp.GTE,
  FilterOp.LT,
  FilterOp.LTE,
  FilterOp.CONTAINS,
  FilterOp.STARTS_WITH,
  FilterOp.IN,
  FilterOp.NOT_IN,
]);

/** A scalar query literal. Dates are represented as epoch milliseconds. */
export type ScalarValue = string | number | boolean | null;

/** Predicate value: one scalar (most ops) or a list (`in` / `notIn`). */
export type FilterValue = ScalarValue | readonly ScalarValue[];

/** A single field/operator/value assertion. */
export interface FilterPredicate {
  readonly field: string;
  readonly op: FilterOp;
  readonly value: FilterValue;
}

/** Conjunction; an empty list is deterministically `true`. */
export interface FilterAnd {
  readonly and: readonly FilterExpr[];
}

/** Disjunction; an empty list is deterministically `false`. */
export interface FilterOr {
  readonly or: readonly FilterExpr[];
}

/** Negation of a nested expression. */
export interface FilterNot {
  readonly not: FilterExpr;
}

/** A composable filter expression tree. */
export type FilterExpr = FilterPredicate | FilterAnd | FilterOr | FilterNot;

/** A subscription-like record. Any object with named fields is accepted. */
export type SearchRecord = Readonly<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Configuration and observability
// ---------------------------------------------------------------------------

/** Fully resolved search configuration. Callers normally pass a `Partial`. */
export interface SearchConfig {
  /** Field name -> value kind. Drives validation and literal coercion. */
  readonly fields: Readonly<Record<string, FieldKind>>;
  /** Case-sensitive string comparison. Defaults to `false` (Unicode lower-casing). */
  readonly caseSensitive: boolean;
  /** Maximum nesting depth of boolean groups. */
  readonly maxDepth: number;
  /** Maximum number of predicates in one expression. */
  readonly maxPredicates: number;
  /** Stable sort field, or `null` to keep input order. */
  readonly sortField: string | null;
  /** Sort direction when `sortField` is set. */
  readonly sortDirection: 'asc' | 'desc';
  /** Injectable clock used only to measure search duration. */
  readonly nowMs: () => number;
}

/** Default fields for a typical subscription record. */
export const DEFAULT_SEARCH_FIELDS: Readonly<Record<string, FieldKind>> = Object.freeze({
  id: FieldKind.STRING,
  name: FieldKind.STRING,
  provider: FieldKind.STRING,
  category: FieldKind.STRING,
  status: FieldKind.STRING,
  currency: FieldKind.STRING,
  cycle: FieldKind.STRING,
  tags: FieldKind.STRING,
  notes: FieldKind.STRING,
  amount: FieldKind.NUMBER,
  active: FieldKind.BOOLEAN,
  cancelled: FieldKind.BOOLEAN,
  nextBilling: FieldKind.DATE,
  createdAt: FieldKind.DATE,
  'billing.amount': FieldKind.NUMBER,
  'billing.currency': FieldKind.STRING,
});

/** Default configuration; see {@link validateSearchConfig}. */
export const DEFAULT_SEARCH_CONFIG: SearchConfig = Object.freeze({
  fields: DEFAULT_SEARCH_FIELDS,
  caseSensitive: false,
  maxDepth: 32,
  maxPredicates: 1000,
  sortField: 'createdAt',
  sortDirection: 'desc',
  nowMs: Date.now,
});

/** Optional metrics sink for parsing, searching and rejections. */
export interface SearchMetrics {
  recordParse(inputLength: number, predicateCount: number): void;
  recordSearch(recordCount: number, matchedCount: number, durationMs: number): void;
  recordEmptyResult(recordCount: number): void;
  recordRejected(code: SearchErrorCode, phase: string): void;
}

/** Optional logging hook for user-visible search events and rejections. */
export interface SearchLogger {
  info(message: string, details: Record<string, unknown>): void;
  warn(message: string, details: Record<string, unknown>): void;
}

/** No-op metrics implementation, safe in tests and development. */
export const noopSearchMetrics: SearchMetrics = Object.freeze({
  recordParse: () => {},
  recordSearch: () => {},
  recordEmptyResult: () => {},
  recordRejected: () => {},
});

/** No-op logger implementation. */
export const noopSearchLogger: SearchLogger = Object.freeze({
  info: () => {},
  warn: () => {},
});

/**
 * Validate and resolve a partial configuration into a complete, frozen
 * `SearchConfig`. Throws `SearchError(INVALID_CONFIG)` on bad values.
 */
export function validateSearchConfig(config: Partial<SearchConfig> = {}): SearchConfig {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new SearchError(SearchErrorCode.INVALID_CONFIG, 'config must be an object', { config });
  }

  const fieldsInput = config.fields ?? DEFAULT_SEARCH_FIELDS;
  if (fieldsInput === null || typeof fieldsInput !== 'object' || Array.isArray(fieldsInput)) {
    throw new SearchError(SearchErrorCode.INVALID_CONFIG, 'fields must be an object', {
      fields: fieldsInput,
    });
  }
  const fields: Record<string, FieldKind> = {};
  for (const [name, kind] of Object.entries(fieldsInput)) {
    if (name.length === 0 || !FIELD_KINDS.includes(kind as FieldKind)) {
      throw new SearchError(SearchErrorCode.INVALID_CONFIG, 'invalid field registry entry', {
        field: name,
        kind,
      });
    }
    fields[name] = kind as FieldKind;
  }

  const caseSensitive = config.caseSensitive ?? DEFAULT_SEARCH_CONFIG.caseSensitive;
  if (typeof caseSensitive !== 'boolean') {
    throw new SearchError(SearchErrorCode.INVALID_CONFIG, 'caseSensitive must be a boolean', {
      caseSensitive,
    });
  }

  const maxDepth = config.maxDepth ?? DEFAULT_SEARCH_CONFIG.maxDepth;
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 64) {
    throw new SearchError(SearchErrorCode.INVALID_CONFIG, 'maxDepth must be 1..64', { maxDepth });
  }

  const maxPredicates = config.maxPredicates ?? DEFAULT_SEARCH_CONFIG.maxPredicates;
  if (!Number.isInteger(maxPredicates) || maxPredicates < 1 || maxPredicates > 100000) {
    throw new SearchError(SearchErrorCode.INVALID_CONFIG, 'maxPredicates must be 1..100000', {
      maxPredicates,
    });
  }

  const sortField = config.sortField === undefined ? DEFAULT_SEARCH_CONFIG.sortField : config.sortField;
  if (sortField !== null && (typeof sortField !== 'string' || !(sortField in fields))) {
    throw new SearchError(SearchErrorCode.INVALID_CONFIG, 'sortField must be null or a known field', {
      sortField,
    });
  }

  const sortDirection = config.sortDirection ?? DEFAULT_SEARCH_CONFIG.sortDirection;
  if (sortDirection !== 'asc' && sortDirection !== 'desc') {
    throw new SearchError(SearchErrorCode.INVALID_CONFIG, "sortDirection must be 'asc' or 'desc'", {
      sortDirection,
    });
  }

  const nowMs = typeof config.nowMs === 'function' ? config.nowMs : DEFAULT_SEARCH_CONFIG.nowMs;

  return Object.freeze({
    fields: Object.freeze(fields),
    caseSensitive,
    maxDepth,
    maxPredicates,
    sortField,
    sortDirection,
    nowMs,
  });
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenKind = 'word' | 'quoted' | 'op' | 'lparen' | 'rparen' | 'lbracket' | 'rbracket' | 'comma' | 'eof';

interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly pos: number;
}

/** Public alias for a lexer token, useful for custom front-ends. */
export type FilterToken = Token;

/** Word-form operators accepted alongside symbolic operators. */
const WORD_OP: Readonly<Record<string, FilterOp>> = Object.freeze({
  eq: FilterOp.EQ,
  neq: FilterOp.NEQ,
  gt: FilterOp.GT,
  gte: FilterOp.GTE,
  lt: FilterOp.LT,
  lte: FilterOp.LTE,
  contains: FilterOp.CONTAINS,
  startswith: FilterOp.STARTS_WITH,
  in: FilterOp.IN,
  notin: FilterOp.NOT_IN,
});

/** Map DSL symbols onto typed operators. */
const OP_BY_SYMBOL: Readonly<Record<string, FilterOp>> = Object.freeze({
  ':': FilterOp.EQ,
  '=': FilterOp.EQ,
  '==': FilterOp.EQ,
  '!=': FilterOp.NEQ,
  '>': FilterOp.GT,
  '>=': FilterOp.GTE,
  '<': FilterOp.LT,
  '<=': FilterOp.LTE,
  '~': FilterOp.CONTAINS,
  '^': FilterOp.STARTS_WITH,
});

/** Inverse map used by {@link stringifyFilter}. */
const SYMBOL_BY_OP: Readonly<Record<FilterOp, string>> = Object.freeze({
  [FilterOp.EQ]: ':',
  [FilterOp.NEQ]: '!=',
  [FilterOp.GT]: '>',
  [FilterOp.GTE]: '>=',
  [FilterOp.LT]: '<',
  [FilterOp.LTE]: '<=',
  [FilterOp.CONTAINS]: '~',
  [FilterOp.STARTS_WITH]: '^',
  [FilterOp.IN]: 'in',
  [FilterOp.NOT_IN]: 'notin',
});

/** Characters that terminate a bare word. */
const WORD_BREAK = /[\s()\[\],:<>=!~^"']/;

/** Tokenize a DSL string. Quoted values keep their exact Unicode content. */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === ',') {
      const kind: TokenKind =
        ch === '(' ? 'lparen' : ch === ')' ? 'rparen' : ch === '[' ? 'lbracket' : ch === ']' ? 'rbracket' : 'comma';
      tokens.push({ kind, text: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i;
      const quote = ch;
      i += 1;
      let text = '';
      let closed = false;
      while (i < input.length) {
        const c = input[i]!;
        if (c === '\\') {
          i += 1;
          if (i >= input.length) break;
          const escaped = input[i]!;
          text += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped === 'r' ? '\r' : escaped;
          i += 1;
          continue;
        }
        if (c === quote) {
          closed = true;
          i += 1;
          break;
        }
        text += c;
        i += 1;
      }
      if (!closed) throw SearchError.syntax('unterminated quoted value', start);
      tokens.push({ kind: 'quoted', text, pos: start });
      continue;
    }
    const pair = input.slice(i, i + 2);
    if (pair === '>=' || pair === '<=' || pair === '!=' || pair === '==') {
      tokens.push({ kind: 'op', text: pair, pos: i });
      i += 2;
      continue;
    }
    if ('><=:~^'.includes(ch)) {
      tokens.push({ kind: 'op', text: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === '!') throw SearchError.syntax("'!' is only valid as part of '!='", i);

    const start = i;
    while (i < input.length && !WORD_BREAK.test(input[i]!)) i += 1;
    if (i === start) throw SearchError.syntax(`unexpected character '${ch}'`, i);
    tokens.push({ kind: 'word', text: input.slice(start, i), pos: start });
  }

  tokens.push({ kind: 'eof', text: '', pos: input.length });
  return tokens;
}

// ---------------------------------------------------------------------------
// Literal coercion
// ---------------------------------------------------------------------------

/** Coerce one literal token into the configured kind of its field. */
function coerceLiteral(
  token: Token,
  kind: FieldKind,
  field: string,
  config: SearchConfig
): ScalarValue {
  if (token.kind === 'word' && token.text.toLowerCase() === 'null') return null;

  if (kind === FieldKind.STRING) return token.text;
  if (kind === FieldKind.NUMBER) {
    const value = Number(token.text);
    if (token.text.trim().length === 0 || !Number.isFinite(value)) {
      throw new SearchError(SearchErrorCode.INVALID_VALUE, `invalid numeric value for '${field}'`, {
        field,
        value: token.text,
      });
    }
    return value;
  }
  if (kind === FieldKind.BOOLEAN) {
    const lowered = token.text.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lowered)) return true;
    if (['false', '0', 'no', 'off'].includes(lowered)) return false;
    throw new SearchError(SearchErrorCode.TYPE_MISMATCH, `invalid boolean value for '${field}'`, {
      field,
      value: token.text,
    });
  }
  const timestamp = Date.parse(token.text);
  if (!Number.isFinite(timestamp)) {
    throw new SearchError(SearchErrorCode.INVALID_VALUE, `invalid date value for '${field}'`, {
      field,
      value: token.text,
    });
  }
  return timestamp;
}

// ---------------------------------------------------------------------------
// Recursive-descent parser
// ---------------------------------------------------------------------------

interface ParserState {
  readonly tokens: readonly Token[];
  readonly config: SearchConfig;
  index: number;
  count: number;
}

/** Peek at the current token (EOF is sticky). */
function peek(state: ParserState): Token {
  return state.tokens[state.index] ?? state.tokens[state.tokens.length - 1]!;
}

/** Consume and return the current token unless it is EOF. */
function advance(state: ParserState): Token {
  const token = peek(state);
  if (token.kind !== 'eof') state.index += 1;
  return token;
}

/** True when `token` is the given case-insensitive keyword word. */
function isKeyword(token: Token, keyword: string): boolean {
  return token.kind === 'word' && token.text.toUpperCase() === keyword;
}

/** Consume a token of an expected kind or throw a syntax error. */
function expectKind(state: ParserState, kind: TokenKind, label: string): Token {
  const token = peek(state);
  if (token.kind !== kind) throw SearchError.syntax(`expected ${label}`, token.pos);
  return advance(state);
}

/** Look ahead to decide whether the current position starts a predicate. */
function isPredicateStart(state: ParserState): boolean {
  const token = peek(state);
  if (token.kind !== 'word' || isKeyword(token, 'AND') || isKeyword(token, 'OR')) return false;
  const nextToken = state.tokens[state.index + 1];
  if (!nextToken) return false;
  return (
    nextToken.kind === 'op' ||
    (nextToken.kind === 'word' && nextToken.text.toLowerCase() in WORD_OP)
  );
}

function parseOr(state: ParserState, depth: number): FilterExpr {
  let left = parseAnd(state, depth);
  while (isKeyword(peek(state), 'OR')) {
    advance(state);
    const right = parseAnd(state, depth);
    left = Object.freeze({ or: [left, right] });
  }
  return left;
}

function parseAnd(state: ParserState, depth: number): FilterExpr {
  let left = parseNot(state, depth);
  while (true) {
    const token = peek(state);
    if (isKeyword(token, 'AND')) {
      advance(state);
      left = Object.freeze({ and: [left, parseNot(state, depth)] });
      continue;
    }
    // Whitespace-separated predicates are an implicit AND.
    if (token.kind === 'lparen' || isKeyword(token, 'NOT') || isPredicateStart(state)) {
      left = Object.freeze({ and: [left, parseNot(state, depth)] });
      continue;
    }
    break;
  }
  return left;
}

function parseNot(state: ParserState, depth: number): FilterExpr {
  if (depth > state.config.maxDepth) {
    throw new SearchError(SearchErrorCode.LIMIT_EXCEEDED, 'filter nesting is too deep', {
      depth,
      max: state.config.maxDepth,
    });
  }
  if (isKeyword(peek(state), 'NOT')) {
    advance(state);
    return Object.freeze({ not: parseNot(state, depth + 1) });
  }
  const token = peek(state);
  if (token.kind === 'lparen') {
    advance(state);
    const inner = parseOr(state, depth + 1);
    expectKind(state, 'rparen', 'closing parenthesis');
    return inner;
  }
  if (isPredicateStart(state)) return parsePredicate(state);
  if (token.kind === 'eof') throw SearchError.syntax('expected a predicate', token.pos);
  if (isKeyword(token, 'AND') || isKeyword(token, 'OR')) {
    throw SearchError.syntax(`misplaced logical operator '${token.text}'`, token.pos);
  }
  throw SearchError.syntax(`unexpected token '${token.text}'`, token.pos);
}

/** Resolve a field name, allowing dotted paths registered in the config. */
function resolveFieldKind(field: string, config: SearchConfig): FieldKind | undefined {
  const direct = config.fields[field];
  if (direct !== undefined) return direct;
  // Dotted paths: try the longest registered prefix, then the full path's segments.
  const parts = field.split('.');
  for (let i = parts.length - 1; i > 0; i -= 1) {
    const candidate = parts.slice(0, i).join('.');
    if (config.fields[candidate] !== undefined) return config.fields[candidate];
  }
  return undefined;
}

/** Read a possibly-dotted field path from a record. */
function readFieldPath(record: SearchRecord, field: string): unknown {
  if (!field.includes('.')) return record[field];
  let current: unknown = record;
  for (const part of field.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function parsePredicate(state: ParserState): FilterPredicate {
  const fieldToken = advance(state);
  const kind = resolveFieldKind(fieldToken.text, state.config);
  if (kind === undefined) {
    throw new SearchError(SearchErrorCode.UNKNOWN_FIELD, `unknown field '${fieldToken.text}'`, {
      field: fieldToken.text,
    });
  }

  const token = peek(state);
  let op: FilterOp;
  let value: FilterValue;

  if (token.kind === 'op') {
    advance(state);
    const mapped = OP_BY_SYMBOL[token.text];
    if (mapped === undefined) {
      throw new SearchError(SearchErrorCode.UNKNOWN_OPERATOR, `unknown operator '${token.text}'`, {
        operator: token.text,
      });
    }
    op = mapped;
    const literal = peek(state);
    if (literal.kind !== 'word' && literal.kind !== 'quoted') {
      throw SearchError.syntax(`missing value for '${fieldToken.text}'`, literal.pos);
    }
    advance(state);
    value = coerceLiteral(literal, kind, fieldToken.text, state.config);
  } else if (token.kind === 'word' && token.text.toLowerCase() in WORD_OP) {
    advance(state);
    op = WORD_OP[token.text.toLowerCase()]!;
    if (op === FilterOp.IN || op === FilterOp.NOT_IN) {
      expectKind(state, 'lbracket', '[');
      const items: ScalarValue[] = [];
      while (peek(state).kind !== 'rbracket') {
        const literal = peek(state);
        if (literal.kind !== 'word' && literal.kind !== 'quoted') {
          throw SearchError.syntax('expected a value inside the list', literal.pos);
        }
        advance(state);
        items.push(coerceLiteral(literal, kind, fieldToken.text, state.config));
        const separator = peek(state);
        if (separator.kind === 'comma') {
          advance(state);
          continue;
        }
        if (separator.kind === 'rbracket') break;
        throw SearchError.syntax("expected ',' or ']' in value list", separator.pos);
      }
      expectKind(state, 'rbracket', ']');
      if (items.length === 0) throw SearchError.syntax('value list must not be empty', token.pos);
      value = Object.freeze(items);
    } else {
      const literal = peek(state);
      if (literal.kind !== 'word' && literal.kind !== 'quoted') {
        throw SearchError.syntax(`missing value for '${fieldToken.text}'`, literal.pos);
      }
      advance(state);
      value = coerceLiteral(literal, kind, fieldToken.text, state.config);
    }
  } else {
    throw SearchError.syntax(`expected a comparison operator after '${fieldToken.text}'`, token.pos);
  }

  state.count += 1;
  if (state.count > state.config.maxPredicates) {
    throw new SearchError(SearchErrorCode.LIMIT_EXCEEDED, 'too many predicates', {
      count: state.count,
      max: state.config.maxPredicates,
    });
  }
  return Object.freeze({ field: fieldToken.text, op, value });
}

/**
 * Parse a DSL string into a typed, deeply frozen {@link FilterExpr}.
 *
 * Throws `SearchError(EMPTY_QUERY)` for blank input, `SYNTAX_ERROR` for
 * malformed queries, `UNKNOWN_FIELD` / `UNKNOWN_OPERATOR` for unknown field or
 * operator tokens and `INVALID_VALUE` / `TYPE_MISMATCH` for bad literals.
 *
 * @param input DSL query text, e.g. `status:active AND amount>100`.
 * @param config Optional configuration override.
 */
export function parseFilterDsl(input: string, config: Partial<SearchConfig> = {}): FilterExpr {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new SearchError(SearchErrorCode.EMPTY_QUERY, 'query must be a non-empty string', { input });
  }
  const cfg = validateSearchConfig(config);
  const state: ParserState = { tokens: tokenize(input), config: cfg, index: 0, count: 0 };
  const expr = parseOr(state, 0);
  const last = peek(state);
  if (last.kind !== 'eof') throw SearchError.syntax(`unexpected trailing token '${last.text}'`, last.pos);
  return expr;
}

// ---------------------------------------------------------------------------
// Validation, compilation and evaluation
// ---------------------------------------------------------------------------

function normalizeExpected(value: ScalarValue, kind: FieldKind, config: SearchConfig): ScalarValue {
  if (typeof value === 'string' && kind === FieldKind.STRING && !config.caseSensitive) {
    return value.toLowerCase();
  }
  return value;
}

function assertScalar(value: unknown, kind: FieldKind, field: string): ScalarValue {
  if (value === null) return null;
  if (kind === FieldKind.STRING) {
    if (typeof value !== 'string') {
      throw new SearchError(SearchErrorCode.TYPE_MISMATCH, `field '${field}' expects a string`, {
        field,
        value,
      });
    }
    return value;
  }
  if (kind === FieldKind.NUMBER) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new SearchError(SearchErrorCode.TYPE_MISMATCH, `field '${field}' expects a finite number`, {
        field,
        value,
      });
    }
    return value;
  }
  if (kind === FieldKind.BOOLEAN) {
    if (typeof value !== 'boolean') {
      throw new SearchError(SearchErrorCode.TYPE_MISMATCH, `field '${field}' expects a boolean`, {
        field,
        value,
      });
    }
    return value;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SearchError(SearchErrorCode.TYPE_MISMATCH, `field '${field}' expects epoch milliseconds`, {
      field,
      value,
    });
  }
  return value;
}

interface ValidationState {
  count: number;
}

/** Recursively validate an expression and enforce depth/predicate limits. */
function validateExpr(
  expr: FilterExpr,
  config: SearchConfig,
  depth: number,
  state: ValidationState
): void {
  if (depth > config.maxDepth) {
    throw new SearchError(SearchErrorCode.LIMIT_EXCEEDED, 'filter nesting is too deep', {
      depth,
      max: config.maxDepth,
    });
  }
  if (expr === null || typeof expr !== 'object' || Array.isArray(expr)) {
    throw SearchError.invalidInput('filter expression must be an object', { expr });
  }

  const keys = Object.keys(expr);
  const composites = ['and', 'or', 'not'].filter((key) => key in expr);
  if ('field' in expr && composites.length > 0) {
    throw SearchError.invalidInput('expression cannot mix a predicate with a boolean group', { keys });
  }
  if (composites.length > 1) {
    throw SearchError.invalidInput('expression must contain exactly one boolean group', { keys });
  }

  if ('field' in expr) {
    const allowed = ['field', 'op', 'value'];
    if (keys.some((key) => !allowed.includes(key)) || keys.length !== allowed.length) {
      throw SearchError.invalidInput('predicate must have exactly field, op and value', { keys });
    }
    const predicate = expr as FilterPredicate;
    if (typeof predicate.field !== 'string' || predicate.field.length === 0) {
      throw SearchError.invalidInput('predicate field must be a non-empty string', {
        field: predicate.field,
      });
    }
    const kind = resolveFieldKind(predicate.field, config);
    if (kind === undefined) {
      throw new SearchError(SearchErrorCode.UNKNOWN_FIELD, `unknown field '${predicate.field}'`, {
        field: predicate.field,
      });
    }
    if (typeof predicate.op !== 'string' || !FILTER_OPS.includes(predicate.op)) {
      throw new SearchError(
        SearchErrorCode.UNKNOWN_OPERATOR,
        `unknown operator '${String(predicate.op)}'`,
        { operator: predicate.op }
      );
    }
    if (Array.isArray(predicate.value)) {
      if (predicate.value.length === 0) {
        throw SearchError.invalidInput('predicate value list must not be empty', {
          field: predicate.field,
        });
      }
      for (const item of predicate.value) {
        assertScalar(item, kind, predicate.field);
      }
    } else {
      assertScalar(predicate.value, kind, predicate.field);
    }
    state.count += 1;
    if (state.count > config.maxPredicates) {
      throw new SearchError(SearchErrorCode.LIMIT_EXCEEDED, 'too many predicates', {
        count: state.count,
        max: config.maxPredicates,
      });
    }
    return;
  }

  if (composites.length !== 1) {
    throw SearchError.invalidInput('expression must contain field, and, or or not', { keys });
  }
  const group = composites[0]!;
  const groupValue = (expr as unknown as Record<string, unknown>)[group];
  if (group === 'not') {
    if (keys.length !== 1) throw SearchError.invalidInput("'not' group must have one key", { keys });
    validateExpr(groupValue as FilterExpr, config, depth + 1, state);
    return;
  }
  if (keys.length !== 1) throw SearchError.invalidInput(`${group} group must have one key`, { keys });
  if (!Array.isArray(groupValue)) {
    throw SearchError.invalidInput(`${group} group must be an array`, { group });
  }
  for (const child of groupValue) {
    validateExpr(child as FilterExpr, config, depth + 1, state);
  }
}

/** Normalize a record value (including arrays and Dates) into scalar form. */
function normalizeScalar(value: unknown, kind: FieldKind, config: SearchConfig): ScalarValue {
  if (value === null || value === undefined) return null;
  if (kind === FieldKind.STRING) {
    const text = typeof value === 'string' ? value : String(value);
    return config.caseSensitive ? text : text.toLowerCase();
  }
  if (kind === FieldKind.NUMBER) {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  if (kind === FieldKind.BOOLEAN) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lowered = value.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(lowered)) return true;
      if (['false', '0', 'no', 'off'].includes(lowered)) return false;
    }
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
}

function normalizeActual(
  value: unknown,
  kind: FieldKind,
  config: SearchConfig
): ScalarValue | readonly ScalarValue[] {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => normalizeScalar(item, kind, config)));
  return normalizeScalar(value, kind, config);
}

function compareValues(a: ScalarValue, b: ScalarValue): number | null {
  if (a === null || b === null) return null;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  return null;
}

function evaluatePredicate(predicate: FilterPredicate, record: SearchRecord, config: SearchConfig): boolean {
  const kind = resolveFieldKind(predicate.field, config)!;
  const expectedList: readonly ScalarValue[] = Array.isArray(predicate.value)
    ? predicate.value.map((value) => normalizeExpected(value, kind, config))
    : [normalizeExpected(predicate.value, kind, config)];
  const raw = normalizeActual(readFieldPath(record, predicate.field), kind, config);
  const actualList: readonly ScalarValue[] = Array.isArray(raw) ? raw : [raw];

  switch (predicate.op) {
    case FilterOp.EQ:
    case FilterOp.IN:
      return actualList.some((actual) => expectedList.some((expected) => actual === expected));
    case FilterOp.NEQ:
    case FilterOp.NOT_IN:
      return !actualList.some((actual) => expectedList.some((expected) => actual === expected));
    case FilterOp.CONTAINS: {
      const needles = expectedList.filter((value) => value !== null).map(String);
      return needles.some((needle) =>
        actualList.some((actual) => actual !== null && String(actual).includes(needle))
      );
    }
    case FilterOp.STARTS_WITH: {
      const prefixes = expectedList.filter((value) => value !== null).map(String);
      return prefixes.some((prefix) =>
        actualList.some((actual) => actual !== null && String(actual).startsWith(prefix))
      );
    }
    case FilterOp.GT:
    case FilterOp.GTE:
    case FilterOp.LT:
    case FilterOp.LTE:
      return expectedList.some((expected) =>
        actualList.some((actual) => {
          const comparison = compareValues(actual, expected);
          if (comparison === null) return false;
          if (predicate.op === FilterOp.GT) return comparison > 0;
          if (predicate.op === FilterOp.GTE) return comparison >= 0;
          if (predicate.op === FilterOp.LT) return comparison < 0;
          return comparison <= 0;
        })
      );
    default:
      return false;
  }
}

/** Build the evaluator closure for a validated expression. */
function buildEvaluator(expr: FilterExpr, config: SearchConfig): (record: SearchRecord) => boolean {
  if ('field' in expr) {
    const predicate = expr as FilterPredicate;
    return (record: SearchRecord) => evaluatePredicate(predicate, record, config);
  }
  if ('not' in expr) {
    const child = buildEvaluator((expr as FilterNot).not, config);
    return (record: SearchRecord) => !child(record);
  }
  if ('and' in expr) {
    const children = (expr as FilterAnd).and.map((child) => buildEvaluator(child, config));
    return (record: SearchRecord) => children.every((child) => child(record));
  }
  const children = (expr as FilterOr).or.map((child) => buildEvaluator(child, config));
  return (record: SearchRecord) => children.some((child) => child(record));
}

/**
 * Compile a typed expression into a pure record predicate. The expression is
 * validated once; the returned function is deterministic and reusable.
 *
 * @param expr Filter expression tree.
 * @param config Optional configuration override.
 */
export function compileFilter(
  expr: FilterExpr,
  config: Partial<SearchConfig> = {}
): (record: SearchRecord) => boolean {
  const cfg = validateSearchConfig(config);
  const state: ValidationState = { count: 0 };
  validateExpr(expr, cfg, 0, state);
  return buildEvaluator(expr, cfg);
}

/**
 * Evaluate an expression against a single record. Convenience wrapper over
 * {@link compileFilter}; prefer compiling once when scanning many records.
 */
export function evaluateFilter(
  exprOrCompiled: FilterExpr | ((record: SearchRecord) => boolean),
  record: SearchRecord,
  config: Partial<SearchConfig> = {}
): boolean {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw SearchError.invalidInput('record must be an object', { record });
  }
  if (typeof exprOrCompiled === 'function') return exprOrCompiled(record);
  return compileFilter(exprOrCompiled, config)(record);
}

/** Count every predicate in an expression. */
export function countPredicates(expr: FilterExpr): number {
  if ('field' in expr) return 1;
  if ('not' in expr) return countPredicates((expr as FilterNot).not);
  if ('and' in expr) return (expr as FilterAnd).and.reduce((sum, child) => sum + countPredicates(child), 0);
  return (expr as FilterOr).or.reduce((sum, child) => sum + countPredicates(child), 0);
}

/** Render a value for {@link stringifyFilter}. */
function renderValue(value: ScalarValue): string {
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return /[\s()\[\],:<>=!~^"']/.test(value) || value.length === 0
    ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : value;
}

/** Serialize an expression back into canonical, re-parsable DSL text. */
export function stringifyFilter(expr: FilterExpr): string {
  if ('field' in expr) {
    const predicate = expr as FilterPredicate;
    if (Array.isArray(predicate.value)) {
      const list = predicate.value.map(renderValue).join(', ');
      return `${predicate.field} ${SYMBOL_BY_OP[predicate.op]} [${list}]`;
    }
    return `${predicate.field}${SYMBOL_BY_OP[predicate.op]}${renderValue(predicate.value)}`;
  }
  if ('not' in expr) return `NOT (${stringifyFilter((expr as FilterNot).not)})`;
  if ('and' in expr) {
    return `(${((expr as FilterAnd).and.map(stringifyFilter)).join(' AND ')})`;
  }
  return `(${((expr as FilterOr).or.map(stringifyFilter)).join(' OR ')})`;
}

// ---------------------------------------------------------------------------
// Search engine with observability hooks
// ---------------------------------------------------------------------------

/** Frozen result of a single search. */
export interface SearchResult<T extends SearchRecord = SearchRecord> {
  readonly records: readonly T[];
  readonly total: number;
  readonly matched: number;
  readonly durationMs: number;
  readonly predicateCount: number;
}

/** Stateful façade returned by {@link createSearchEngine}. */
export interface SearchEngine<T extends SearchRecord = SearchRecord> {
  /** Parse a DSL string into an expression, emitting parse metrics. */
  parse(input: string): FilterExpr;
  /** Compile an expression with this engine's configuration. */
  compile(expr: FilterExpr): (record: T) => boolean;
  /** Evaluate a compiled predicate or expression against a single record. */
  evaluate(exprOrCompiled: FilterExpr | string | ((record: T) => boolean), record: T): boolean;
  /** Filter and deterministically sort records by an expression or DSL string. */
  search(records: readonly T[], expr: FilterExpr | string): SearchResult<T>;
  /** The fully resolved, frozen configuration. */
  readonly config: SearchConfig;
}

/**
 * Create a search engine with optional metrics and logger hooks.
 *
 * Successful searches emit `recordSearch` plus an `info` log; empty results
 * additionally emit `recordEmptyResult` and a `warn` log. Every rejection
 * emits `recordRejected` and a `warn` log before the original `SearchError`
 * is rethrown.
 *
 * @param config Partial configuration; see {@link DEFAULT_SEARCH_CONFIG}.
 * @param metrics Optional metrics sink (partial implementations allowed).
 * @param logger Optional logging sink (partial implementations allowed).
 */
export function createSearchEngine<T extends SearchRecord = SearchRecord>(
  config: Partial<SearchConfig> = {},
  metrics: Partial<SearchMetrics> = {},
  logger: Partial<SearchLogger> = {}
): SearchEngine<T> {
  const cfg = validateSearchConfig(config);
  const m: SearchMetrics = { ...noopSearchMetrics, ...metrics };
  const l: SearchLogger = { ...noopSearchLogger, ...logger };

  function reject(code: SearchErrorCode, phase: string, error: unknown): never {
    m.recordRejected(code, phase);
    l.warn('subscription search rejected', {
      phase,
      code,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  function guard<R>(phase: string, fn: () => R): R {
    try {
      return fn();
    } catch (error) {
      return reject(error instanceof SearchError ? error.code : SearchErrorCode.INVALID_INPUT, phase, error);
    }
  }

  function parse(input: string): FilterExpr {
    return guard('parse', () => {
      const expr = parseFilterDsl(input, cfg);
      m.recordParse(input.length, countPredicates(expr));
      return expr;
    });
  }

  function compile(expr: FilterExpr): (record: T) => boolean {
    return guard('compile', () => compileFilter(expr, cfg) as (record: T) => boolean);
  }

  function evaluate(
    exprOrCompiled: FilterExpr | string | ((record: T) => boolean),
    record: T
  ): boolean {
    return guard('evaluate', () => {
      if (typeof exprOrCompiled === 'function') return exprOrCompiled(record);
      const expr = typeof exprOrCompiled === 'string' ? parseFilterDsl(exprOrCompiled, cfg) : exprOrCompiled;
      return compileFilter(expr, cfg)(record);
    });
  }

  function search(records: readonly T[], expr: FilterExpr | string): SearchResult<T> {
    const start = cfg.nowMs();
    let phase = 'search';
    try {
      if (!Array.isArray(records)) {
        throw SearchError.invalidInput('records must be an array', { records });
      }
      const ast = typeof expr === 'string' ? parseFilterDsl(expr, cfg) : expr;
      phase = 'compile';
      const evaluator = compileFilter(ast, cfg);
      phase = 'search';

      interface Candidate {
        readonly record: T;
        readonly index: number;
        readonly keep: boolean;
        sortValue: ScalarValue;
      }
      const candidates: Candidate[] = records.map((record, index) => {
        if (record === null || typeof record !== 'object' || Array.isArray(record)) {
          throw SearchError.invalidInput('each record must be an object', { index });
        }
        return { record, index, keep: evaluator(record), sortValue: null };
      });

      const kept = candidates.filter((candidate) => candidate.keep);
      if (cfg.sortField !== null) {
        const kind = resolveFieldKind(cfg.sortField, cfg)!;
        for (const candidate of kept) {
          candidate.sortValue = normalizeScalar(readFieldPath(candidate.record, cfg.sortField!), kind, cfg);
        }
        const direction = cfg.sortDirection === 'desc' ? -1 : 1;
        kept.sort((a, b) => {
          const comparison = compareValues(a.sortValue, b.sortValue);
          return (comparison === null ? 0 : comparison * direction) || a.index - b.index;
        });
      }

      const rawDuration = cfg.nowMs() - start;
      const durationMs = Number.isFinite(rawDuration) ? Math.max(0, rawDuration) : 0;
      const matchedRecords = Object.freeze(kept.map((candidate) => candidate.record));

      m.recordSearch(records.length, matchedRecords.length, durationMs);
      if (matchedRecords.length === 0) {
        m.recordEmptyResult(records.length);
        l.warn('subscription search returned no results', { total: records.length });
      }
      l.info('subscription search completed', {
        total: records.length,
        matched: matchedRecords.length,
        durationMs,
      });

      return Object.freeze({
        records: matchedRecords,
        total: records.length,
        matched: matchedRecords.length,
        durationMs,
        predicateCount: countPredicates(ast),
      });
    } catch (error) {
      return reject(
        error instanceof SearchError ? error.code : SearchErrorCode.INVALID_INPUT,
        phase,
        error
      );
    }
  }

  return Object.freeze({ parse, compile, evaluate, search, config: cfg });
}
