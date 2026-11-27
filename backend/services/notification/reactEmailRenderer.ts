/**
 * React Email-compatible component system for server-side email rendering.
 *
 * Issue #2214: Refactor transactional email rendering using React Email.
 *
 * React Email (https://react.email/) defines email templates as React
 * components. In a Node.js backend without react-dom, we can't call
 * `renderAsync(<Template />)`, but we can adopt the same component API and
 * render the component tree to HTML ourselves using the same table-based
 * layout conventions that React Email produces.
 *
 * ## What this gives us
 *
 * 1. **Component-level reuse** — templates are assembled from typed building
 *    blocks (Section, Text, Button, Hr, …) instead of string concatenation.
 * 2. **Email-client compatibility** — every component renders as nested
 *    `<table>` elements with inline styles, matching what React Email outputs.
 * 3. **Forward compatibility** — each component descriptor is shaped like a
 *    React element (type + props), so swapping in actual React Email components
 *    when react-dom is available requires only a thin adapter.
 * 4. **Text + HTML** — the renderer produces both an HTML body and a
 *    plain-text alternative, which the existing `transactionalEmailTemplates`
 *    system already expects.
 */

// ── React Email-compatible component descriptors ──────────────────────────────

/**
 * A rendered element in the tree. Mirrors the shape of a React element:
 * `{ type, props }`. When `type` is a string, it is a primitive component
 * (Section, Text, Button, …). When it is a function, it is a custom template
 * component that returns children.
 */
export interface ReactEmailElement<P = Record<string, unknown>> {
  type: string | ((props: P) => ReactEmailElement | ReactEmailElement[]);
  props: P;
  children?: ReactEmailElement[];
}

// ── Primitive component builders (mirror @react-email/components) ─────────────

export interface SectionProps {
  children?: ReactEmailElement[];
  style?: ReactEmailStyles;
}

export interface ContainerProps {
  children?: ReactEmailElement[];
  style?: ReactEmailStyles;
}

export interface TextProps {
  children?: string;
  style?: ReactEmailStyles;
}

export interface HeadingProps {
  level?: 1 | 2 | 3;
  children?: string;
  style?: ReactEmailStyles;
}

export interface ButtonProps {
  href: string;
  children?: string;
  style?: ReactEmailStyles;
}

export interface HrProps {
  style?: ReactEmailStyles;
}

export interface ImgProps {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  style?: ReactEmailStyles;
}

export interface SpacerProps {
  height?: number;
}

export interface RowProps {
  children?: ReactEmailElement[];
}

export interface ColumnProps {
  children?: ReactEmailElement[];
}

export interface FooterProps {
  children?: string;
  style?: ReactEmailStyles;
}

export interface ReactEmailStyles {
  backgroundColor?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  textAlign?: 'left' | 'center' | 'right';
  padding?: string | number;
  paddingTop?: string | number;
  paddingBottom?: string | number;
  paddingLeft?: string | number;
  paddingRight?: string | number;
  borderRadius?: number;
  lineHeight?: string | number;
  maxWidth?: number;
  margin?: string;
  display?: string;
  textDecoration?: string;
}

// Style helpers

function px(v: string | number | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'number' ? `${v}px` : String(v);
}

function styleString(style: ReactEmailStyles | undefined): string {
  if (!style) return '';
  const entries: string[] = [];
  if (style.backgroundColor) entries.push(`background-color:${style.backgroundColor}`);
  if (style.color) entries.push(`color:${style.color}`);
  if (style.fontSize !== undefined) entries.push(`font-size:${px(style.fontSize)}`);
  if (style.fontWeight) entries.push(`font-weight:${style.fontWeight}`);
  if (style.textAlign) entries.push(`text-align:${style.textAlign}`);
  if (style.padding !== undefined) entries.push(`padding:${px(style.padding)}`);
  if (style.paddingTop !== undefined) entries.push(`padding-top:${px(style.paddingTop)}`);
  if (style.paddingBottom !== undefined) entries.push(`padding-bottom:${px(style.paddingBottom)}`);
  if (style.paddingLeft !== undefined) entries.push(`padding-left:${px(style.paddingLeft)}`);
  if (style.paddingRight !== undefined) entries.push(`padding-right:${px(style.paddingRight)}`);
  if (style.borderRadius !== undefined) entries.push(`border-radius:${px(style.borderRadius)}`);
  if (style.lineHeight !== undefined) entries.push(`line-height:${style.lineHeight}`);
  if (style.maxWidth !== undefined) entries.push(`max-width:${px(style.maxWidth)}`);
  if (style.margin !== undefined) entries.push(`margin:${style.margin}`);
  if (style.display !== undefined) entries.push(`display:${style.display}`);
  if (style.textDecoration !== undefined) entries.push(`text-decoration:${style.textDecoration}`);
  return entries.join(';');
}

// Variable substitution

export function substituteVariables(
  text: string,
  variables: Record<string, string>,
): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    return variables[key] !== undefined ? variables[key] : `[${key}]`;
  });
}

function getMissingVariables(
  text: string,
  variables: Record<string, string>,
): string[] {
  const missing: string[] = [];
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const key = match[1];
    if (variables[key] === undefined || variables[key] === '') {
      if (!missing.includes(key)) missing.push(key);
    }
  }
  return missing;
}

// ── Primitive component constructors ──────────────────────────────────────────

/** <Section> — table-based row wrapper (React Email Section). */
export function Section(props: SectionProps): ReactEmailElement<SectionProps> {
  return { type: 'Section', props, children: props.children };
}

/** <Container> — outer email container (React Email Container). */
export function Container(props: ContainerProps): ReactEmailElement<ContainerProps> {
  return { type: 'Container', props, children: props.children };
}

/** <Text> — paragraph text (React Email Text). */
export function Text(props: TextProps): ReactEmailElement<TextProps> {
  return { type: 'Text', props };
}

/** <Heading> — h1/h2/h3 (React Email Heading). */
export function Heading(props: HeadingProps): ReactEmailElement<HeadingProps> {
  return { type: 'Heading', props };
}

/** <Button> — CTA link styled as button (React Email Button). */
export function Button(props: ButtonProps): ReactEmailElement<ButtonProps> {
  return { type: 'Button', props };
}

/** <Hr> — horizontal rule (React Email Hr). */
export function Hr(props: HrProps = {}): ReactEmailElement<HrProps> {
  return { type: 'Hr', props };
}

/** <Img> — image (React Email Img). */
export function Img(props: ImgProps): ReactEmailElement<ImgProps> {
  return { type: 'Img', props };
}

/** <Spacer> — vertical spacing (React Email Spacer). */
export function Spacer(props: SpacerProps = {}): ReactEmailElement<SpacerProps> {
  return { type: 'Spacer', props };
}

/** <Row> — multi-column row (React Email Row). */
export function Row(props: RowProps): ReactEmailElement<RowProps> {
  return { type: 'Row', props, children: props.children };
}

/** <Column> — column inside a Row (React Email Column). */
export function Column(props: ColumnProps): ReactEmailElement<ColumnProps> {
  return { type: 'Column', props, children: props.children };
}

/** <Footer> — footer text (custom component). */
export function Footer(props: FooterProps): ReactEmailElement<FooterProps> {
  return { type: 'Footer', props };
}

// ── Renderer ─────────────────────────────────────────────────────────────────

export interface RenderOptions {
  variables?: Record<string, string>;
  /** Max width of the email container in pixels. Default: 600 */
  maxWidth?: number;
  /** Background color of the outer body. */
  backgroundColor?: string;
  /** Content background. */
  contentBackgroundColor?: string;
  /** Font family CSS string. */
  fontFamily?: string;
}

export interface RenderResult {
  html: string;
  text: string;
  subject: string;
  missingVariables: string[];
}

/**
 * Renders a React Email-compatible component tree to HTML + plain text.
 *
 * Each primitive component maps to table-based HTML, matching the output that
 * `@react-email/render` produces. This keeps emails compatible with Outlook,
 * Gmail, and other clients that need table-based layouts.
 */
export class ReactEmailRenderer {
  private maxWidth: number;
  private backgroundColor: string;
  private contentBackgroundColor: string;
  private fontFamily: string;

  constructor(options: {
    maxWidth?: number;
    backgroundColor?: string;
    contentBackgroundColor?: string;
    fontFamily?: string;
  } = {}) {
    this.maxWidth = options.maxWidth ?? 600;
    this.backgroundColor = options.backgroundColor ?? '#f8fafc';
    this.contentBackgroundColor = options.contentBackgroundColor ?? '#ffffff';
    this.fontFamily =
      options.fontFamily ??
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  }

  render(
    template: {
      subject: string;
      components: ReactEmailElement[];
    },
    options: RenderOptions = {},
  ): RenderResult {
    const variables = options.variables ?? {};
    const bodyHtml = this.renderComponents(template.components, variables);
    const subject = substituteVariables(template.subject, variables);
    const text = this.renderText(template.components, variables);

    const missing = [
      ...getMissingVariables(template.subject, variables),
      ...this.collectMissingVariables(template.components, variables),
    ];
    const uniqueMissing = [...new Set(missing)];

    const html = this.wrapHtml(subject, bodyHtml);

    return { html, text, subject, missingVariables: uniqueMissing };
  }

  private renderComponents(
    components: ReactEmailElement[] | undefined,
    variables: Record<string, string>,
  ): string {
    if (!components) return '';
    return components.map((c) => this.renderElement(c, variables)).join('\n');
  }

  private renderElement(
    element: ReactEmailElement,
    variables: Record<string, string>,
  ): string {
    const sub = (s?: string) => (s ? substituteVariables(s, variables) : '');

    switch (element.type) {
      case 'Section': {
        const props = element.props as SectionProps;
        const style = styleString({ ...props.style, padding: props.style?.padding ?? 0 });
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"${style ? ` style="${style}"` : ''}>
  <tr><td>${this.renderComponents(props.children, variables)}</td></tr>
</table>`;
      }

      case 'Container': {
        const props = element.props as ContainerProps;
        const style = styleString({
          ...props.style,
          maxWidth: this.maxWidth,
          margin: '0 auto',
        });
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr><td${style ? ` style="${style}"` : ''}>${this.renderComponents(props.children, variables)}</td></tr>
</table>`;
      }

      case 'Text': {
        const props = element.props as TextProps;
        const style = styleString({
          color: '#374151',
          fontSize: 15,
          lineHeight: 1.6,
          margin: '0 0 16px 0',
          ...props.style,
        });
        const content = sub(props.children)?.replace(/\n/g, '<br>') ?? '';
        return `<p style="${style}">${content}</p>`;
      }

      case 'Heading': {
        const props = element.props as HeadingProps;
        const level = props.level ?? 1;
        const tag = `h${level}`;
        const style = styleString({
          color: '#111827',
          fontSize: level === 1 ? 24 : level === 2 ? 20 : 18,
          fontWeight: 'bold' as const,
          lineHeight: 1.2,
          margin: '0 0 16px 0',
          textAlign: 'center',
          ...props.style,
        });
        const content = sub(props.children) ?? '';
        return `<${tag} style="${style}">${content}</${tag}>`;
      }

      case 'Button': {
        const props = element.props as ButtonProps;
        const href = sub(props.href) ?? '#';
        const label = sub(props.children) ?? 'Click here';
        const style = styleString({
          backgroundColor: '#6366f1',
          color: '#ffffff',
          textDecoration: 'none',
          borderRadius: 6,
          padding: '12px 24px',
          fontWeight: 'bold' as const,
          fontSize: 15,
          display: 'inline-block',
          ...props.style,
        });
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr><td style="text-align:center;padding:16px 0">
    <a href="${href}" style="${style}">${label}</a>
  </td></tr>
</table>`;
      }

      case 'Hr': {
        const props = element.props as HrProps;
        const color = props.style?.color ?? '#e5e7eb';
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr><td style="padding:16px 0"><hr style="border:none;border-top:1px solid ${color};margin:0"></td></tr>
</table>`;
      }

      case 'Img': {
        const props = element.props as ImgProps;
        const src = sub(props.src);
        const alt = sub(props.alt) ?? '';
        const widthAttr = props.width ? `width="${props.width}"` : 'width="100%"';
        const heightAttr = props.height ? `height="${props.height}"` : '';
        const style = styleString({
          display: 'block',
          maxWidth: '100%',
          ...props.style,
        });
        return `<img src="${src}" alt="${alt}" ${widthAttr} ${heightAttr} style="${style}">`;
      }

      case 'Spacer': {
        const props = element.props as SpacerProps;
        const h = props.height ?? 24;
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr><td height="${h}" style="height:${h}px;font-size:0;line-height:0">&nbsp;</td></tr></table>`;
      }

      case 'Row': {
        const props = element.props as RowProps;
        const cols = props.children ?? [];
        const colWidth = Math.floor(100 / Math.max(cols.length, 1));
        const colHtml = cols
          .map(
            (col) =>
              `<td valign="top" width="${colWidth}%" style="padding:0 8px">${this.renderElement(col, variables)}</td>`,
          )
          .join('\n');
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>${colHtml}</tr></table>`;
      }

      case 'Column': {
        const props = element.props as ColumnProps;
        return this.renderComponents(props.children, variables);
      }

      case 'Footer': {
        const props = element.props as FooterProps;
        const style = styleString({
          color: '#9ca3af',
          fontSize: 12,
          lineHeight: 1.5,
          textAlign: 'center',
          padding: '24px 0 0',
          ...props.style,
        });
        const content = sub(props.children)?.replace(/\n/g, '<br>') ?? '';
        return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  <tr><td style="${style}">${content}</td></tr>
</table>`;
      }

      default:
        return '';
    }
  }

  private renderText(
    components: ReactEmailElement[],
    variables: Record<string, string>,
  ): string {
    const lines: string[] = [];
    for (const component of components) {
      const sub = (s?: string) => (s ? substituteVariables(s, variables) : '');

      switch (component.type) {
        case 'Section':
        case 'Container':
        case 'Row':
        case 'Column': {
          const children = (component.props as { children?: ReactEmailElement[] }).children;
          if (children) {
            const childText = this.renderText(children, variables);
            if (childText) lines.push(childText);
          }
          break;
        }
        case 'Text': {
          const content = sub((component.props as TextProps).children);
          if (content) lines.push(content);
          break;
        }
        case 'Heading': {
          const content = sub((component.props as HeadingProps).children);
          if (content) lines.push(content);
          break;
        }
        case 'Button': {
          const props = component.props as ButtonProps;
          const label = sub(props.children) ?? '';
          const href = sub(props.href) ?? '';
          if (label) lines.push(`${label}: ${href}`);
          break;
        }
        case 'Footer': {
          const content = sub((component.props as FooterProps).children);
          if (content) lines.push(content);
          break;
        }
        case 'Hr': {
          lines.push('---');
          break;
        }
        default:
          break;
      }
    }
    return lines.join('\n\n');
  }

  private collectMissingVariables(
    components: ReactEmailElement[] | undefined,
    variables: Record<string, string>,
  ): string[] {
    if (!components) return [];
    const missing: string[] = [];
    for (const component of components) {
      const textFields: (string | undefined)[] = [];
      switch (component.type) {
        case 'Text':
          textFields.push((component.props as TextProps).children);
          break;
        case 'Heading':
          textFields.push((component.props as HeadingProps).children);
          break;
        case 'Button':
          textFields.push((component.props as ButtonProps).children);
          textFields.push((component.props as ButtonProps).href);
          break;
        case 'Footer':
          textFields.push((component.props as FooterProps).children);
          break;
        case 'Img':
          textFields.push((component.props as ImgProps).src);
          textFields.push((component.props as ImgProps).alt);
          break;
        case 'Section':
        case 'Container':
        case 'Row':
        case 'Column':
          missing.push(
            ...this.collectMissingVariables(
              (component.props as { children?: ReactEmailElement[] }).children,
              variables,
            ),
          );
          break;
        default:
          break;
      }
      for (const field of textFields) {
        if (field) missing.push(...getMissingVariables(field, variables));
      }
    }
    return missing;
  }

  private wrapHtml(subject: string, body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:${this.backgroundColor};font-family:${this.fontFamily}">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:${this.backgroundColor}">
    <tr>
      <td align="center" style="padding:24px 0">
        <table width="${this.maxWidth}" cellpadding="0" cellspacing="0" role="presentation" style="background-color:${this.contentBackgroundColor};max-width:${this.maxWidth}px;width:100%;border-radius:8px;overflow:hidden">
          <tr><td style="padding:32px">
${body}
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}

// ── Default renderer instance ────────────────────────────────────────────────

export const reactEmailRenderer = new ReactEmailRenderer();

// ── Transactional template builder helpers ────────────────────────────────────

/**
 * Builds a React Email-compatible template for a transactional email.
 *
 * This mirrors the structure of the existing `transactionalEmailTemplates.ts`
 * definitions but uses the React Email component API instead of the legacy
 * ComponentTemplate format.
 */
export interface TransactionalEmailTemplateDef {
  id: string;
  name: string;
  subject: string;
  requiredVariables: string[];
  components: ReactEmailElement[];
}

/**
 * Build and render a transactional email template using React Email components.
 *
 * Throws if required variables are missing, matching the enforcement semantics
 * of the existing `renderTransactionalEmail`.
 */
export function renderWithReactEmail(
  template: TransactionalEmailTemplateDef,
  variables: Record<string, string>,
  renderer: ReactEmailRenderer = reactEmailRenderer,
): RenderResult {
  const missing = template.requiredVariables.filter(
    (name) => variables[name] === undefined || variables[name] === '',
  );
  if (missing.length) {
    throw new Error(
      `Template "${template.id}" is missing required variables: ${missing.join(', ')}`,
    );
  }

  const result = renderer.render(template, { variables });

  if (result.missingVariables.length) {
    throw new Error(
      `Template "${template.id}" has unresolved variables: ${result.missingVariables.join(', ')}`,
    );
  }

  return result;
}
