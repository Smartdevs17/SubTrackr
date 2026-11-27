/**
 * mobile/src/features/search/index.ts
 *
 * Issue #2257: shared, self-contained filter-DSL helpers for the React Native
 * search screen. Mirrors the backend DSL vocabulary (`field/op/value` and
 * `and`/`or`/`not`) so a query built on the device can be sent straight to the
 * API, and so local (offline) filtering behaves identically.
 *
 * Zero dependencies, no I/O, no React imports — safe to unit-test in Node.
 */

/** Operators supported by the mobile/backend DSL. */
export const SearchOperator = {
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

export type SearchOperator = (typeof SearchOperator)[keyof typeof SearchOperator];

/** A single field/operator/value predicate. */
export interface SearchPredicate {
  readonly field: string;
  readonly op: SearchOperator;
  readonly value: string | number | boolean | null | readonly (string | number | boolean)[];
}

/** A composable search expression tree (mutually exclusive shapes). */
export type SearchExpression =
  | SearchPredicate
  | { readonly and: readonly SearchExpression[] }
  | { readonly or: readonly SearchExpression[] }
  | { readonly not: SearchExpression };

/** Symbol used when rendering each operator back into DSL text. */
const OPERATOR_SYMBOL: Readonly<Record<SearchOperator, string>> = Object.freeze({
  [SearchOperator.EQ]: ':',
  [SearchOperator.NEQ]: '!=',
  [SearchOperator.GT]: '>',
  [SearchOperator.GTE]: '>=',
  [SearchOperator.LT]: '<',
  [SearchOperator.LTE]: '<=',
  [SearchOperator.CONTAINS]: '~',
  [SearchOperator.STARTS_WITH]: '^',
  [SearchOperator.IN]: 'in',
  [SearchOperator.NOT_IN]: 'notin',
});

function renderValue(value: SearchPredicate['value']): string {
  if (Array.isArray(value)) return `[${value.map(renderValue).join(', ')}]`;
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return /[\s()\[\],:<>=!~^"']/.test(value) || value.length === 0
    ? `"${value.replace(/"/g, '\\"')}"`
    : value;
}

/**
 * Build a typed predicate from a field, operator and value.
 *
 * @param field Field name, optionally a dotted path (e.g. `billing.amount`).
 * @param op One of {@link SearchOperator}.
 * @param value Scalar or list value (lists are used with `in`/`notIn`).
 */
export function buildSearchQuery(
  field: string,
  op: SearchOperator,
  value: SearchPredicate['value']
): SearchPredicate {
  if (typeof field !== 'string' || field.trim().length === 0) {
    throw new Error('field must be a non-empty string');
  }
  if (!Object.values(SearchOperator).includes(op)) {
    throw new Error(`unsupported operator: ${String(op)}`);
  }
  if (Array.isArray(value) && value.length === 0) {
    throw new Error('value list must not be empty');
  }
  return Object.freeze({ field: field.trim(), op, value });
}

/** Conjoin expressions into a frozen `and` group. */
export function and(...expressions: readonly SearchExpression[]): SearchExpression {
  if (expressions.length === 0) return Object.freeze({ and: [] });
  return Object.freeze({ and: Object.freeze([...expressions]) });
}

/** Disjoin expressions into a frozen `or` group. */
export function or(...expressions: readonly SearchExpression[]): SearchExpression {
  if (expressions.length === 0) return Object.freeze({ or: [] });
  return Object.freeze({ or: Object.freeze([...expressions]) });
}

/** Negate an expression. */
export function not(expression: SearchExpression): SearchExpression {
  return Object.freeze({ not: expression });
}

/**
 * Serialize an expression into canonical DSL text understood by the backend
 * `parseFilterDsl` function. Round-trip stable for all supported operators.
 */
export function formatFilterDsl(expression: SearchExpression): string {
  if ('field' in expression) {
    const predicate = expression as SearchPredicate;
    const symbol = OPERATOR_SYMBOL[predicate.op];
    if (Array.isArray(predicate.value)) {
      return `${predicate.field} ${symbol} ${renderValue(predicate.value)}`;
    }
    return `${predicate.field}${symbol}${renderValue(predicate.value)}`;
  }
  if ('not' in expression) return `NOT (${formatFilterDsl((expression as { not: SearchExpression }).not)})`;
  if ('and' in expression) {
    return `(${(expression as { and: readonly SearchExpression[] }).and
      .map(formatFilterDsl)
      .join(' AND ')})`;
  }
  return `(${(expression as { or: readonly SearchExpression[] }).or
    .map(formatFilterDsl)
    .join(' OR ')})`;
}
