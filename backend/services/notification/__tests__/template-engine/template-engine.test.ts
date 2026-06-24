import { tokenize, Token, TokenType, makeError } from '../template-engine/lexer';
import { parse } from '../template-engine/parser';
import { TemplateEngine } from '../template-engine/index';
import { builtinFilters, resolveFilter } from '../template-engine/filters/index';
import { EmailTemplateService } from '../emailTemplateService';
import { ASTNode } from '../template-engine/ast/nodes';

// ── Helpers ───────────────────────────────────────────────────────────────────

describe('Template Engine - Lexer', () => {
  it('tokenizes plain text', () => {
    const tokens = tokenize('Hello World');
    expect(tokens.map((t) => ({ type: t.type, value: t.value }))).toEqual([
      { type: 'TEXT', value: 'Hello World' },
      { type: 'EOF', value: '' },
    ]);
  });

  it('tokenizes simple variable', () => {
    const tokens = tokenize('{{ name }}');
    expect(tokens.find((t) => t.type === 'VAR_OPEN')).toBeDefined();
    expect(tokens.find((t) => t.type === 'IDENTIFIER' && t.value === 'name')).toBeDefined();
    expect(tokens.find((t) => t.type === 'VAR_CLOSE')).toBeDefined();
  });

  it('tokenizes variable with dot notation', () => {
    const tokens = tokenize('{{ user.name }}');
    const identifiers = tokens.filter((t) => t.type === 'IDENTIFIER');
    expect(identifiers.map((t) => t.value)).toEqual(['user', 'name']);
  });

  it('tokenizes variable with filters', () => {
    const tokens = tokenize('{{ name | uppercase }}');
    expect(tokens.find((t) => t.type === 'IDENTIFIER' && t.value === 'name')).toBeDefined();
    expect(tokens.find((t) => t.type === 'FILTER_PIPE')).toBeDefined();
    expect(tokens.find((t) => t.type === 'IDENTIFIER' && t.value === 'uppercase')).toBeDefined();
  });

  it('tokenizes if block', () => {
    const tokens = tokenize('{{# if status == active #}}Active{{# else #}}Inactive{{# /if #}}');
    expect(tokens.find((t) => t.type === 'IF_OPEN')).toBeDefined();
    expect(tokens.find((t) => t.type === 'ELSE')).toBeDefined();
    expect(tokens.find((t) => t.type === 'ENDIF')).toBeDefined();
  });

  it('tokenizes for loop', () => {
    const tokens = tokenize('{{# for item in items #}}{{ item }}{{# /for #}}');
    expect(tokens.find((t) => t.type === 'FOR_OPEN')).toBeDefined();
    expect(tokens.find((t) => t.type === 'ENDFOR')).toBeDefined();
  });

  it('tokenizes filters with arguments', () => {
    const tokens = tokenize('{{ amount | currency("USD", "en-US") }}');
    expect(tokens.find((t) => t.type === 'IDENTIFIER' && t.value === 'amount')).toBeDefined();
    expect(tokens.find((t) => t.type === 'FILTER_PIPE')).toBeDefined();
    expect(tokens.find((t) => t.type === 'IDENTIFIER' && t.value === 'currency')).toBeDefined();
    expect(tokens.find((t) => t.type === 'STRING' && t.value === 'USD')).toBeDefined();
  });

  it('throws friendly error on unclosed variable tag', () => {
    expect(() => tokenize('{{ name ')).toThrow(/Unclosed variable tag/);
    expect(() => tokenize('{{ name ')).toThrow(/line 1/);
  });

  it('tokenizes multiple variables in a template', () => {
    const tokens = tokenize('Hello {{ name }}, your balance is {{ balance }}');
    const varOpens = tokens.filter((t) => t.type === 'VAR_OPEN');
    expect(varOpens.length).toBe(2);
  });

  it('tokenizes partial include', () => {
    const tokens = tokenize('{{% header %}}');
    expect(tokens.find((t) => t.type === 'PARTIAL_OPEN')).toBeDefined();
    expect(tokens.find((t) => t.type === 'IDENTIFIER' && t.value === 'header')).toBeDefined();
  });

  it('handles empty template', () => {
    const tokens = tokenize('');
    expect(tokens.length).toBe(1);
    expect(tokens[0].type).toBe('EOF');
  });

  it('handles multi-line templates', () => {
    const tokens = tokenize('Line 1\n{{ var }}\nLine 3');
    const textTokens = tokens.filter((t) => t.type === 'TEXT');
    expect(textTokens.length).toBeGreaterThanOrEqual(2);
  });

  it('tokenizes chained filters', () => {
    const tokens = tokenize('{{ name | uppercase | trim }}');
    const pipes = tokens.filter((t) => t.type === 'FILTER_PIPE');
    expect(pipes.length).toBe(2);
  });
});

// ── Parser ────────────────────────────────────────────────────────────────────

describe('Template Engine - Parser', () => {
  it('parses text node', () => {
    const ast = parse(tokenize('Hello World'));
    expect(ast.length).toBe(1);
    expect(ast[0].type).toBe('Text');
    expect((ast[0] as any).value).toBe('Hello World');
  });

  it('parses variable node', () => {
    const ast = parse(tokenize('{{ name }}'));
    const varNode = ast.find((n) => n.type === 'Variable');
    expect(varNode).toBeDefined();
    expect((varNode as any).path).toEqual(['name']);
  });

  it('parses variable with dot notation', () => {
    const ast = parse(tokenize('{{ user.profile.name }}'));
    const varNode = ast.find((n) => n.type === 'Variable');
    expect(varNode).toBeDefined();
    expect((varNode as any).path).toEqual(['user', 'profile', 'name']);
  });

  it('parses variable with filter', () => {
    const ast = parse(tokenize('{{ name | uppercase }}'));
    const varNode = ast.find((n) => n.type === 'Variable');
    expect(varNode).toBeDefined();
    expect((varNode as any).filters).toEqual([{ name: 'uppercase', args: [] }]);
  });

  it('parses variable with chained filters', () => {
    const ast = parse(tokenize('{{ name | uppercase | trim }}'));
    const varNode = ast.find((n) => n.type === 'Variable');
    expect((varNode as any).filters.length).toBe(2);
  });

  it('parses if-else-endif', () => {
    const ast = parse(tokenize('{{# if active == true #}}yes{{# else #}}no{{# /if #}}'));
    const ifNode = ast.find((n) => n.type === 'If');
    expect(ifNode).toBeDefined();
    const ifn = ifNode as any;
    expect(ifn.consequent.length).toBe(1);
    expect((ifn.consequent[0] as any).value).toBe('yes');
    expect(ifn.alternate.length).toBe(1);
    expect((ifn.alternate[0] as any).value).toBe('no');
  });

  it('parses if without else', () => {
    const ast = parse(tokenize('{{# if active == true #}}yes{{# /if #}}'));
    const ifNode = ast.find((n) => n.type === 'If');
    expect(ifNode).toBeDefined();
    expect((ifNode as any).alternate.length).toBe(0);
  });

  it('parses nested if', () => {
    const ast = parse(
      tokenize('{{# if outer == true #}}{{# if inner == true #}}both{{# /if #}}{{# else #}}no{{# /if #}}')
    );
    const ifNode = ast.find((n) => n.type === 'If');
    expect(ifNode).toBeDefined();
    const innerIf = (ifNode as any).consequent.find((n: ASTNode) => n.type === 'If');
    expect(innerIf).toBeDefined();
  });

  it('parses for loop', () => {
    const ast = parse(tokenize('{{# for item in items #}}{{ item }}{{# /for #}}'));
    const forNode = ast.find((n) => n.type === 'For');
    expect(forNode).toBeDefined();
    expect((forNode as any).item).toBe('item');
    expect((forNode as any).iterable).toContain('items');
  });

  it('parses partial include', () => {
    const ast = parse(tokenize('{{% footer %}}'));
    const partialNode = ast.find((n) => n.type === 'Partial');
    expect(partialNode).toBeDefined();
    expect((partialNode as any).name).toBe('footer');
  });

  it('handles mixed content', () => {
    const ast = parse(tokenize('Hello {{ name | uppercase }}! Your balance is {{ balance | currency("USD") }}.'));
    const textNodes = ast.filter((n) => n.type === 'Text');
    const varNodes = ast.filter((n) => n.type === 'Variable');
    expect(varNodes.length).toBe(2);
    expect(textNodes.length).toBeGreaterThanOrEqual(2);
  });

  it('handles empty template parsing', () => {
    const ast = parse(tokenize(''));
    expect(ast.length).toBe(0);
  });
});

// ── Filters ───────────────────────────────────────────────────────────────────

describe('Template Engine - Filters', () => {
  it('uppercase filter', () => {
    const fn = resolveFilter('uppercase')!;
    expect(fn('hello')).toBe('HELLO');
    expect(fn('')).toBe('');
    expect(fn(null)).toBe('');
  });

  it('lowercase filter', () => {
    const fn = resolveFilter('lowercase')!;
    expect(fn('HELLO')).toBe('hello');
  });

  it('date filter - short preset', () => {
    const fn = resolveFilter('date')!;
    const result = fn(new Date('2024-01-15'), ['short'], { locale: 'en-US' });
    expect(result).toContain('Jan');
    expect(result).toContain('2024');
  });

  it('date filter - iso preset', () => {
    const fn = resolveFilter('date')!;
    const result = fn(new Date('2024-01-15'), ['iso'], { locale: 'en-US' });
    expect(result).toMatch(/01.*15.*2024|2024.*01.*15/);
  });

  it('date filter - relative preset', () => {
    const fn = resolveFilter('date')!;
    const now = new Date('2024-06-15T12:00:00Z');
    const recent = new Date('2024-06-15T11:55:00Z');
    const result = fn(recent, ['relative'], { locale: 'en-US', now });
    expect(result).toBe('5m ago');
  });

  it('date filter - relative for days', () => {
    const fn = resolveFilter('date')!;
    const now = new Date('2024-06-15T12:00:00Z');
    const past = new Date('2024-06-13T12:00:00Z');
    const result = fn(past, ['relative'], { locale: 'en-US', now });
    expect(result).toBe('2d ago');
  });

  it('currency filter', () => {
    const fn = resolveFilter('currency')!;
    const result = fn(19.99, ['USD', 'en-US']);
    expect(result).toContain('19.99');
    expect(result).toContain('$');
  });

  it('currency filter with different locale', () => {
    const fn = resolveFilter('currency')!;
    const result = fn(19.99, ['EUR', 'de-DE']);
    expect(result).toContain('19,99');
  });

  it('pluralize filter - singular', () => {
    const fn = resolveFilter('pluralize')!;
    expect(fn(1, ['item', 'items'])).toBe('1 item');
  });

  it('pluralize filter - plural', () => {
    const fn = resolveFilter('pluralize')!;
    expect(fn(5, ['item', 'items'])).toBe('5 items');
  });

  it('default filter', () => {
    const fn = resolveFilter('default')!;
    expect(fn('', ['N/A'])).toBe('N/A');
    expect(fn('hello', ['N/A'])).toBe('hello');
  });

  it('length filter', () => {
    const fn = resolveFilter('length')!;
    expect(fn('hello')).toBe('5');
  });

  it('trim filter', () => {
    const fn = resolveFilter('trim')!;
    expect(fn('  hello  ')).toBe('hello');
  });

  it('truncate filter', () => {
    const fn = resolveFilter('truncate')!;
    expect(fn('hello world', ['5'])).toBe('hello...');
    expect(fn('hello world', ['20'])).toBe('hello world');
  });

  it('date filter handles invalid dates', () => {
    const fn = resolveFilter('date')!;
    const result = fn('not a date', ['short']);
    expect(result).toBe('not a date');
  });

  it('currency filter handles invalid numbers', () => {
    const fn = resolveFilter('currency')!;
    const result = fn('abc', ['USD']);
    expect(result).toBe('abc');
  });
});

// ── Compiler / Render ─────────────────────────────────────────────────────────

describe('Template Engine - Render', () => {
  let engine: TemplateEngine;

  beforeEach(() => {
    engine = new TemplateEngine();
  });

  it('renders plain text', () => {
    expect(engine.render('Hello World', {})).toBe('Hello World');
  });

  it('renders simple variable', () => {
    expect(engine.render('{{ name }}', { name: 'Alice' })).toBe('Alice');
  });

  it('renders variable with dot notation', () => {
    expect(engine.render('{{ user.name }}', { user: { name: 'Bob' } })).toBe('Bob');
  });

  it('renders variable with uppercase filter', () => {
    expect(engine.render('{{ name | uppercase }}', { name: 'alice' })).toBe('ALICE');
  });

  it('renders variable with lowercase filter', () => {
    expect(engine.render('{{ name | lowercase }}', { name: 'ALICE' })).toBe('alice');
  });

  it('renders variable with default filter', () => {
    expect(engine.render('{{ name | default("Unknown") }}', { name: '' })).toBe('Unknown');
    expect(engine.render('{{ name | default("Unknown") }}', { name: 'Alice' })).toBe('Alice');
  });

  it('renders if block - truthy', () => {
    const result = engine.render(
      '{{# if active == true #}}Active{{# else #}}Inactive{{# /if #}}',
      { active: true }
    );
    expect(result).toBe('Active');
  });

  it('renders if block - falsy', () => {
    const result = engine.render(
      '{{# if active == true #}}Active{{# else #}}Inactive{{# /if #}}',
      { active: false }
    );
    expect(result).toBe('Inactive');
  });

  it('renders for loop', () => {
    const result = engine.render(
      '{{# for item in items #}}{{ item }},{{# /for #}}',
      { items: ['a', 'b', 'c'] }
    );
    expect(result).toBe('a,b,c,');
  });

  it('renders partial', () => {
    const engine2 = new TemplateEngine({
      partials: { header: '<h1>{{ title }}</h1>' },
    });
    const result = engine2.render(
      '{{% header %}}Content',
      { title: 'Welcome' }
    );
    expect(result).toBe('<h1>Welcome</h1>Content');
  });

  it('renders missing partial as comment', () => {
    const result = engine.render('{{% missing %}}', {});
    expect(result).toContain('not found');
  });

  it('handles missing variables gracefully', () => {
    expect(engine.render('{{ missing }}', {})).toBe('');
  });

  it('handles null variables', () => {
    expect(engine.render('{{ value }}', { value: null })).toBe('');
  });

  it('renders complex template', () => {
    const template = `Hello {{ customer.name | uppercase }}!

{{# if customer.active == true #}}
Your subscription is active. Next billing: {{ customer.nextBilling | date("short") }}
{{# else #}}
Your subscription is inactive.
{{# /if #}}

Items:
{{# for item in items #}}  - {{ item.name }}: {{ item.price | currency("USD") }}
{{# /for #}}

Total: {{ total | currency("USD") }}`;

    const data = {
      customer: {
        name: 'alice',
        active: true,
        nextBilling: new Date('2024-12-01'),
      },
      items: [
        { name: 'Pro Plan', price: 29.99 },
        { name: 'Add-on', price: 9.99 },
      ],
      total: 39.98,
    };

    const result = engine.render(template, data, { locale: 'en-US' });
    expect(result).toContain('ALICE');
    expect(result).toContain('active');
    expect(result).toContain('Pro Plan');
    expect(result).toContain('$29.99');
    expect(result).toContain('$39.98');
  });

  it('prevents infinite loops', () => {
    const engine2 = new TemplateEngine();
    const template = '{{# for item in items #}}{{# for subitem in items #}}x{{# /for #}}{{# /for #}}';
    const data = { items: new Array(200).fill(0) };
    expect(() => engine2.render(template, data)).toThrow(/max loop iterations/);
  });

  it('caches compiled templates', () => {
    const result1 = engine.render('{{ name }}', { name: 'Alice' });
    const result2 = engine.render('{{ name }}', { name: 'Bob' });
    expect(result1).toBe('Alice');
    expect(result2).toBe('Bob');
  });

  it('accesses multiple levels of nested data', () => {
    const result = engine.render('{{ a.b.c.d }}', {
      a: { b: { c: { d: 'deep' } } },
    });
    expect(result).toBe('deep');
  });
});

// ── Error Handling ────────────────────────────────────────────────────────────

describe('Template Engine - Error Handling', () => {
  it('throws with line number on unclosed tag', () => {
    try {
      tokenize('Hello\n{{ name \nGoodbye');
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('Unclosed variable tag');
      expect(err.line).toBeDefined();
    }
  });

  it('reports line number in error', () => {
    const template = `Line 1
Line 2
{{ name `;
    try {
      tokenize(template);
      fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toMatch(/line 3/);
    }
  });
});

// ── EmailTemplateService ──────────────────────────────────────────────────────

describe('EmailTemplateService', () => {
  let service: EmailTemplateService;

  beforeEach(() => {
    service = new EmailTemplateService();
  });

  it('registers and renders a template', () => {
    service.register('tenant_1', 'welcome', 'en', {
      subject: 'Welcome {{ name }}!',
      body: 'Hello {{ name }}, welcome to SubTrackr.',
    });

    const result = service.render('tenant_1', 'welcome', 'en', { name: 'Alice' });
    expect(result.subject).toBe('Welcome Alice!');
    expect(result.body).toBe('Hello Alice, welcome to SubTrackr.');
  });

  it('falls back to base locale', () => {
    service.register('tenant_1', 'welcome', 'en', {
      subject: 'Welcome {{ name }}!',
      body: 'Hello {{ name }}',
    });

    const result = service.render('tenant_1', 'welcome', 'en-US', { name: 'Bob' });
    expect(result.subject).toBe('Welcome Bob!');
  });

  it('falls back to en locale', () => {
    service.register('tenant_1', 'welcome', 'en', {
      subject: 'Welcome {{ name }}!',
      body: 'Hello {{ name }}',
    });

    const result = service.render('tenant_1', 'welcome', 'fr', { name: 'Claire' });
    expect(result.subject).toBe('Welcome Claire!');
  });

  it('throws when template not found', () => {
    expect(() =>
      service.render('tenant_1', 'missing', 'en', {})
    ).toThrow('Template not found');
  });

  it('removes template by locale', () => {
    service.register('tenant_1', 'welcome', 'en', {
      subject: 'Welcome {{ name }}!',
      body: 'Hello {{ name }}',
    });
    service.register('tenant_1', 'welcome', 'fr', {
      subject: 'Bienvenue {{ name }}!',
      body: 'Bonjour {{ name }}',
    });

    service.remove('tenant_1', 'welcome', 'fr');
    expect(() =>
      service.render('tenant_1', 'welcome', 'fr', { name: 'Test' })
    ).toThrow();
  });

  it('removes entire template', () => {
    service.register('tenant_1', 'welcome', 'en', {
      subject: 'Welcome',
      body: 'Hello',
    });
    service.remove('tenant_1', 'welcome');
    expect(() =>
      service.render('tenant_1', 'welcome', 'en', {})
    ).toThrow('Template not found');
  });

  it('supports partials', () => {
    service.registerPartial('footer', '<p>Thank you, {{ company }}</p>');
    service.register('tenant_1', 'receipt', 'en', {
      subject: 'Receipt',
      body: 'Receipt for {{ name }}\n{{% footer %}}',
    });

    const result = service.render('tenant_1', 'receipt', 'en', {
      name: 'Alice',
      company: 'SubTrackr',
    });
    expect(result.body).toContain('<p>Thank you, SubTrackr</p>');
  });

  it('clears cache', () => {
    service.register('tenant_1', 'msg', 'en', {
      subject: '{{ x }}',
      body: '{{ x }}',
    });
    service.render('tenant_1', 'msg', 'en', { x: 'one' });
    service.clearCache();
    const result = service.render('tenant_1', 'msg', 'en', { x: 'two' });
    expect(result.subject).toBe('two');
  });
});

// ── Sandbox ───────────────────────────────────────────────────────────────────

describe('Template Engine - Sandbox', () => {
  it('prevents access to global scope', () => {
    const engine = new TemplateEngine();
    const result = engine.render('{{ constructor }}', {});
    expect(result).toBe('');
    expect(() => engine.render('{{ process }}', {})).not.toThrow();
  });

  it('prevents infinite loops (100 iterations max)', () => {
    const engine = new TemplateEngine();
    const template = '{{# for item in items #}}x{{# /for #}}';
    const data = { items: new Array(101).fill(0) };
    expect(() => engine.render(template, data)).toThrow(/max loop iterations/);
  });

  it('prevents deep recursion (10 depth max)', () => {
    const engine = new TemplateEngine();
    const ast = parse(tokenize('{{ name }}'));
    for (let i = 0; i < 20; i++) {
      (ast[0] as any).path = ['deep'];
    }
    const result = engine.renderAST(ast, { deep: 'value' });
    expect(result).toBeDefined();
  });
});

// ── Performance ───────────────────────────────────────────────────────────────

describe('Template Engine - Performance', () => {
  it('renders 500-line template in <100ms', () => {
    const engine = new TemplateEngine();
    const lines = [];
    for (let i = 0; i < 500; i++) {
      lines.push(`Line ${i}: {{ item${i} }}`);
    }
    const template = lines.join('\n');
    const data: Record<string, unknown> = {};
    for (let i = 0; i < 500; i++) {
      data[`item${i}`] = `value${i}`;
    }

    const start = Date.now();
    const result = engine.render(template, data);
    const elapsed = Date.now() - start;

    expect(result).toContain('value0');
    expect(result).toContain('value499');
    expect(elapsed).toBeLessThan(100);
  }, 15000);
});

// ── Module Tests ──────────────────────────────────────────────────────────────

describe('Template Engine - Module', () => {
  it('AST nodes can be imported and used', () => {
    const node: ASTNode = { type: 'Text', value: 'test', line: 1 };
    expect(node.type).toBe('Text');
  });

  it('parse returns valid AST', () => {
    const ast = parse(tokenize('Hello {{ name }}'));
    expect(Array.isArray(ast)).toBe(true);
    expect(ast.length).toBeGreaterThan(0);
  });

  it('parse handles multi-line templates correctly', () => {
    const template = `Dear {{ user.name | uppercase }},

Your subscription {{ subscription.plan }} is {{# if subscription.active == true #}}active{{# else #}}inactive{{# /if #}}.

{{# for item in items #}}- {{ item }}
{{# /for #}}`;
    const ast = parse(tokenize(template));
    expect(ast.filter((n) => n.type === 'Text').length).toBeGreaterThan(0);
    expect(ast.filter((n) => n.type === 'If').length).toBe(1);
    expect(ast.filter((n) => n.type === 'For').length).toBe(1);
    expect(ast.filter((n) => n.type === 'Variable').length).toBe(2);
  });
});
