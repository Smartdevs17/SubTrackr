import { create } from 'zustand';
import type { EmailTemplate, TemplateBlock, ABTestConfig } from '../types/emailTemplate';
import { emailTemplateService } from '../services/emailTemplateService';

interface EmailTemplateState {
  templates: EmailTemplate[];
  activeTemplate: EmailTemplate | null;
  previewHtml: string;
  isLoading: boolean;
  error: string | null;

  loadTemplates: (merchantId: string) => void;
  selectTemplate: (id: string) => void;
  createTemplate: (merchantId: string, name: string, trigger: string) => void;
  updateBlocks: (templateId: string, blocks: TemplateBlock[]) => void;
  updateCustomCss: (templateId: string, css: string) => void;
  updateABTest: (templateId: string, config: ABTestConfig) => void;
  publishTemplate: (id: string) => void;
  rollbackTemplate: (id: string, version: number) => void;
  refreshPreview: (id: string, locale?: string) => void;
}

export const useEmailTemplateStore = create<EmailTemplateState>((set, get) => ({
  templates: [],
  activeTemplate: null,
  previewHtml: '',
  isLoading: false,
  error: null,

  loadTemplates: (merchantId) => {
    const templates = emailTemplateService.list(merchantId);
    set({ templates });
  },

  selectTemplate: (id) => {
    const template = emailTemplateService.get(id) ?? null;
    set({ activeTemplate: template });
    if (template) get().refreshPreview(id);
  },

  createTemplate: (merchantId, name, trigger) => {
    const template = emailTemplateService.create(merchantId, name, trigger);
    set((state) => ({ templates: [...state.templates, template], activeTemplate: template }));
    get().refreshPreview(template.id);
  },

  updateBlocks: (templateId, blocks) => {
    const defaultLocale = emailTemplateService.get(templateId)?.defaultLocale ?? 'en';
    const template = emailTemplateService.update(templateId, {
      locales: [{ locale: defaultLocale, subject: emailTemplateService.get(templateId)?.locales[0]?.subject ?? '', blocks }],
    });
    if (template) {
      set((state) => ({
        templates: state.templates.map((t) => (t.id === templateId ? template : t)),
        activeTemplate: template,
      }));
      get().refreshPreview(templateId);
    }
  },

  updateCustomCss: (templateId, css) => {
    const template = emailTemplateService.update(templateId, { customCss: css });
    if (template) {
      set((state) => ({
        templates: state.templates.map((t) => (t.id === templateId ? template : t)),
        activeTemplate: template,
      }));
      get().refreshPreview(templateId);
    }
  },

  updateABTest: (templateId, config) => {
    const template = emailTemplateService.update(templateId, { abTest: config });
    if (template) {
      set((state) => ({
        templates: state.templates.map((t) => (t.id === templateId ? template : t)),
        activeTemplate: template,
      }));
    }
  },

  publishTemplate: (id) => {
    const template = emailTemplateService.publish(id);
    if (template) {
      set((state) => ({
        templates: state.templates.map((t) => (t.id === id ? template : t)),
        activeTemplate: template,
      }));
    }
  },

  rollbackTemplate: (id, version) => {
    const template = emailTemplateService.rollback(id, version);
    if (template) {
      set((state) => ({
        templates: state.templates.map((t) => (t.id === id ? template : t)),
        activeTemplate: template,
      }));
      get().refreshPreview(id);
    }
  },

  refreshPreview: (id, locale = 'en') => {
    const result = emailTemplateService.preview(id, locale);
    set({ previewHtml: result?.html ?? '' });
  },
}));
