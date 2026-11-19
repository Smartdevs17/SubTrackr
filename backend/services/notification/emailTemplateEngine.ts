/**
 * Re-export shim. See ./emailProvider.ts for why this indirection exists.
 */
export {
  BUILTIN_TEMPLATES,
  ComponentRenderer,
  createDefaultTemplate,
  emailTemplateEngine,
  EmailTemplateEngine,
  PRESET_COMPONENTS,
  substituteVariables,
} from '@subtrackr/notification-providers';
export type {
  ComponentProps,
  ComponentTemplate,
  ComponentType,
  EngineRenderOptions,
  EmailComponent,
  LayoutConfig,
  LayoutName,
  RenderResult,
} from '@subtrackr/notification-providers';
