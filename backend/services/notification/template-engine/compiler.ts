import { ASTNode, TemplateAST } from './ast/nodes';
import { resolveFilter, FilterContext } from './filters/index';

export interface CompiledTemplate {
  render: (data: Record<string, unknown>, context?: FilterContext) => string;
}

interface RenderContext {
  data: Record<string, unknown>;
  filterCtx?: FilterContext;
  partials: Record<string, (params: Record<string, string>) => string>;
  loopCount: number;
  recursionDepth: number;
}

const MAX_LOOP_ITERATIONS = 100;
const MAX_RECURSION_DEPTH = 10;
const MAX_CACHE_SIZE = 100;

class LRUCache<K, V> {
  private map = new Map<K, V>();

  constructor(private maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }
}

const compilationCache = new LRUCache<string, CompiledTemplate>(MAX_CACHE_SIZE);

export function compile(
  template: string,
  partials: Record<string, string> = {}
): CompiledTemplate {
  const cacheKey = template;
  const cached = compilationCache.get(cacheKey);
  if (cached) return cached;

  const compiledPartials: Record<string, (params: Record<string, string>) => string> = {};
  for (const [name, partialTemplate] of Object.entries(partials)) {
    compiledPartials[name] = (params: Record<string, string>) => {
      let result = partialTemplate;
      for (const [key, value] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
      }
      return result;
    };
  }

  const renderFn = (data: Record<string, unknown>, filterCtx?: FilterContext): string => {
    const ctx: RenderContext = {
      data,
      filterCtx,
      partials: compiledPartials,
      loopCount: 0,
      recursionDepth: 0,
    };
    return '';
  };

  const compiled: CompiledTemplate = { render: renderFn };
  compilationCache.set(cacheKey, compiled);
  return compiled;
}

export function renderAST(
  ast: ASTNode[],
  data: Record<string, unknown>,
  filterCtx?: FilterContext,
  partials: Record<string, (params: Record<string, string>) => string> = {}
): string {
  const ctx: RenderContext = {
    data,
    filterCtx,
    partials,
    loopCount: 0,
    recursionDepth: 0,
  };
  return renderNodes(ast, ctx);
}

function renderNodes(nodes: ASTNode[], ctx: RenderContext): string {
  ctx.recursionDepth++;
  if (ctx.recursionDepth > MAX_RECURSION_DEPTH) {
    throw new Error(`Template render error: max recursion depth (${MAX_RECURSION_DEPTH}) exceeded`);
  }

  try {
    let output = '';
    for (const node of nodes) {
      output += renderNode(node, ctx);
    }
    return output;
  } finally {
    ctx.recursionDepth--;
  }
}

function renderNode(node: ASTNode, ctx: RenderContext): string {
  switch (node.type) {
    case 'Text':
      return node.value;

    case 'Variable':
      return renderVariable(node.path, node.filters, ctx);

    case 'If':
      return renderIf(node, ctx);

    case 'For':
      return renderFor(node, ctx);

    case 'Filter':
      return renderStandaloneFilter(node, ctx);

    case 'Partial':
      return renderPartial(node, ctx);

    default:
      return '';
  }
}

function renderVariable(
  path: string[],
  filters: { name: string; args: string[] }[],
  ctx: RenderContext
): string {
  let value: unknown = ctx.data;
  for (const segment of path) {
    if (value === null || value === undefined) break;
    value = (value as Record<string, unknown>)[segment];
  }

  let result = value === null || value === undefined ? '' : String(value);

  for (const filter of filters) {
    const fn = resolveFilter(filter.name);
    if (fn) {
      result = fn(result, filter.args, ctx.filterCtx);
    }
  }

  return result;
}

function renderIf(node: ASTNode & { type: 'If' }, ctx: RenderContext): string {
  const condition = evaluateCondition(node.condition, ctx);
  if (condition) {
    return renderNodes(node.consequent, ctx);
  }
  return renderNodes(node.alternate, ctx);
}

function evaluateCondition(
  cond: { left: string; operator: string; right: string },
  ctx: RenderContext
): boolean {
  const left = resolveValue(cond.left, ctx);
  const right = resolveValue(cond.right, ctx);

  switch (cond.operator) {
    case '==': return left == right;
    case '!=': return left != right;
    case '>': return Number(left) > Number(right);
    case '<': return Number(left) < Number(right);
    case '>=': return Number(left) >= Number(right);
    case '<=': return Number(left) <= Number(right);
    case '&&': return Boolean(left) && Boolean(right);
    case '||': return Boolean(left) || Boolean(right);
    default: return false;
  }
}

function resolveValue(expr: string, ctx: RenderContext): unknown {
  if (/^\d+$/.test(expr)) return Number(expr);
  if (/^["'].*["']$/.test(expr)) return expr.replace(/^["']|["']$/g, '');
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  if (expr === 'null') return null;
  if (expr === 'undefined') return undefined;

  const parts = expr.split('.');
  let value: unknown = ctx.data;
  for (const segment of parts) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function renderFor(
  node: ASTNode & { type: 'For' },
  ctx: RenderContext
): string {
  const iterablePath = node.iterable.join('.');
  const source = resolveValue(iterablePath, ctx);
  const items: unknown[] = Array.isArray(source) ? source : [];

  let output = '';
  const itemName = node.item;

  for (let i = 0; i < items.length; i++) {
    ctx.loopCount++;
    if (ctx.loopCount > MAX_LOOP_ITERATIONS) {
      throw new Error('Template render error: max loop iterations (100) exceeded');
    }

    const innerData = { ...ctx.data, [itemName]: items[i] };
    const innerCtx: RenderContext = {
      ...ctx,
      data: innerData,
    };
    output += renderNodes(node.body, innerCtx);
  }

  return output;
}

function renderStandaloneFilter(
  node: ASTNode & { type: 'Filter' },
  ctx: RenderContext
): string {
  let value: unknown = node.input.length > 0 ? resolveValue(node.input.join('.'), ctx) : '';
  const fn = resolveFilter(node.name);
  if (fn) {
    return fn(value, node.args, ctx.filterCtx);
  }
  return String(value ?? '');
}

function renderPartial(
  node: ASTNode & { type: 'Partial' },
  ctx: RenderContext
): string {
  const partialFn = ctx.partials[node.name];
  if (!partialFn) {
    return `<!-- partial "${node.name}" not found -->`;
  }
  return partialFn(node.params);
}

export { LRUCache, compilationCache, MAX_CACHE_SIZE };
