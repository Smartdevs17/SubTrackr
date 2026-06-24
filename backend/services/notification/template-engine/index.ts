import { tokenize } from './lexer';
import { parse } from './parser';
import { compile, renderAST, CompiledTemplate } from './compiler';
import { FilterContext } from './filters/index';
import { ASTNode } from './ast/nodes';

export { ASTNode } from './ast/nodes';
export { tokenize } from './lexer';
export { parse } from './parser';
export { compile, renderAST, CompiledTemplate, compilationCache, MAX_CACHE_SIZE } from './compiler';
export { builtinFilters, resolveFilter, FilterContext, FilterFn } from './filters/index';

export interface TemplateEngineOptions {
  partials?: Record<string, string>;
  cacheSize?: number;
}

export class TemplateEngine {
  private compiledTemplates = new Map<string, CompiledTemplate>();
  private partials: Record<string, string>;

  constructor(options: TemplateEngineOptions = {}) {
    this.partials = options.partials || {};
  }

  parse(template: string): ASTNode[] {
    const tokens = tokenize(template);
    return parse(tokens);
  }

  compile(template: string): CompiledTemplate {
    const cached = this.compiledTemplates.get(template);
    if (cached) return cached;

    const compiled = compile(template, this.partials);
    this.compiledTemplates.set(template, compiled);
    return compiled;
  }

  render(template: string, data: Record<string, unknown>, context?: FilterContext): string {
    const compiled = this.compile(template);
    return compiled.render(data, context);
  }

  renderAST(ast: ASTNode[], data: Record<string, unknown>, context?: FilterContext): string {
    const partialFns: Record<string, (params: Record<string, string>) => string> = {};
    for (const [name, partialTemplate] of Object.entries(this.partials)) {
      partialFns[name] = (params: Record<string, string>) => {
        let result = partialTemplate;
        for (const [key, value] of Object.entries(params)) {
          result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
        }
        return result;
      };
    }
    return renderAST(ast, data, context, partialFns);
  }

  registerPartial(name: string, template: string): void {
    this.partials[name] = template;
    this.compiledTemplates.clear();
  }

  clearCache(): void {
    this.compiledTemplates.clear();
  }
}
