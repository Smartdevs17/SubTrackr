/**
 * GraphQL Query Complexity Limiter
 *
 * Acceptance criteria:
 *   - max depth 5
 *   - max nodes 100 per query
 *   - cost-based estimation (each field costs 1; list multiplied by page size)
 *
 * Framework-agnostic: works as a validation rule that can be passed to
 * graphql-js's `validate()` or Apollo Server's `validationRules`.
 */

// ── Minimal GraphQL AST interfaces ────────────────────────────────────────────
// Avoids a hard import of graphql at the type level so this file compiles in
// environments where graphql is a devDependency.

interface FieldNode {
  kind: 'Field';
  name: { value: string };
  arguments?: ArgumentNode[];
  selectionSet?: SelectionSetNode;
}

interface ArgumentNode {
  name: { value: string };
  value: { kind: string; value?: string };
}

interface SelectionSetNode {
  selections: Array<FieldNode | { kind: string }>;
}

interface DocumentNode {
  definitions: Array<{ selectionSet?: SelectionSetNode }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const DEFAULT_MAX_DEPTH = 5;
export const DEFAULT_MAX_NODES = 100;
export const DEFAULT_MAX_COST = 500;

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface ComplexityAnalysis {
  depth: number;
  nodeCount: number;
  estimatedCost: number;
  violations: string[];
}

function getPageSize(field: FieldNode): number {
  const firstArg = field.arguments?.find((a) => a.name.value === 'first');
  if (firstArg?.value.kind === 'IntValue' && firstArg.value.value) {
    return Math.min(parseInt(firstArg.value.value, 10), 100);
  }
  return 20; // default assumed page size
}

function analyzeSelectionSet(
  selectionSet: SelectionSetNode | undefined,
  depth: number,
  maxDepth: number,
  costMultiplier: number,
): { nodes: number; cost: number; maxDepth: number } {
  if (!selectionSet) return { nodes: 0, cost: 0, maxDepth: depth };

  let nodes = 0;
  let cost = 0;
  let reachedDepth = depth;

  for (const selection of selectionSet.selections) {
    if (selection.kind !== 'Field') continue;
    const field = selection as FieldNode;

    nodes += 1;
    cost += costMultiplier;

    const isList =
      field.name.value.endsWith('s') ||
      field.name.value === 'edges' ||
      field.name.value === 'nodes';
    const childMultiplier = isList ? costMultiplier * getPageSize(field) : costMultiplier;

    if (field.selectionSet) {
      const child = analyzeSelectionSet(
        field.selectionSet,
        depth + 1,
        maxDepth,
        childMultiplier,
      );
      nodes += child.nodes;
      cost += child.cost;
      reachedDepth = Math.max(reachedDepth, child.maxDepth);
    }
  }

  return { nodes, cost, maxDepth: reachedDepth };
}

export function analyzeComplexity(
  document: DocumentNode,
  options: {
    maxDepth?: number;
    maxNodes?: number;
    maxCost?: number;
  } = {},
): ComplexityAnalysis {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const maxCost = options.maxCost ?? DEFAULT_MAX_COST;

  let totalNodes = 0;
  let totalCost = 0;
  let totalDepth = 0;

  for (const def of document.definitions) {
    if (!def.selectionSet) continue;
    const analysis = analyzeSelectionSet(def.selectionSet, 1, maxDepth, 1);
    totalNodes += analysis.nodes;
    totalCost += analysis.cost;
    totalDepth = Math.max(totalDepth, analysis.maxDepth);
  }

  const violations: string[] = [];
  if (totalDepth > maxDepth) {
    violations.push(`Query depth ${totalDepth} exceeds maximum allowed depth of ${maxDepth}`);
  }
  if (totalNodes > maxNodes) {
    violations.push(`Query selects ${totalNodes} nodes, exceeding the limit of ${maxNodes}`);
  }
  if (totalCost > maxCost) {
    violations.push(`Estimated query cost ${totalCost} exceeds limit of ${maxCost}`);
  }

  return {
    depth: totalDepth,
    nodeCount: totalNodes,
    estimatedCost: totalCost,
    violations,
  };
}

/**
 * Middleware factory for graphql-http or Apollo Server.
 *
 * Usage with graphql-http:
 *   createHandler({ schema, context, onOperation: complexityMiddleware() })
 *
 * Returns a function that throws if complexity limits are exceeded.
 */
export function createComplexityMiddleware(options: {
  maxDepth?: number;
  maxNodes?: number;
  maxCost?: number;
} = {}) {
  return function checkComplexity(document: DocumentNode): void {
    const analysis = analyzeComplexity(document, options);
    if (analysis.violations.length > 0) {
      throw new Error(analysis.violations.join('; '));
    }
  };
}
