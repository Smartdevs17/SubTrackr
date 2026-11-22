import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  CustomCategory,
  CustomCategoryFormData,
  Subscription,
} from '../types/subscription';
import {
  DEFAULT_CATEGORIES,
  MAX_CUSTOM_CATEGORIES,
} from '../utils/constants/categories';
import { errorHandler, AppError } from '../services/errorHandler';

const STORAGE_KEY = 'subtrackr-categories';
const STORE_VERSION = 1;

const generateCategoryId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `custom-${timestamp}-${random}`;
};

const normalizeCategory = (raw: Partial<CustomCategory>): CustomCategory => ({
  id: raw.id ?? generateCategoryId(),
  name: raw.name ?? 'Untitled',
  icon: raw.icon ?? 'more-horizontal',
  color: raw.color ?? '#757575',
  isDefault: raw.isDefault ?? false,
  createdAt: raw.createdAt ? new Date(raw.createdAt) : new Date(),
  updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : new Date(),
});

interface CategoryState {
  customCategories: CustomCategory[];
  isLoading: boolean;
  error: AppError | null;

  addCategory: (data: CustomCategoryFormData) => void;
  updateCategory: (id: string, data: Partial<CustomCategoryFormData>) => void;
  deleteCategory: (id: string, subscriptions: Subscription[]) => void;
  getAllCategories: () => CustomCategory[];
  getCategoryById: (id: string) => CustomCategory | undefined;
  canDeleteCategory: (id: string, subscriptions: Subscription[]) => { canDelete: boolean; reason?: string };
  resetToDefaults: () => void;
}

export const useCategoryStore = create<CategoryState>()(
  persist(
    (set, get) => ({
      customCategories: [],
      isLoading: false,
      error: null,

      addCategory: (data: CustomCategoryFormData) => {
        set({ isLoading: true, error: null });
        try {
          const current = get().customCategories;

          if (current.length >= MAX_CUSTOM_CATEGORIES) {
            throw new Error(
              `Maximum of ${MAX_CUSTOM_CATEGORIES} custom categories reached.`
            );
          }

          const allCategories = get().getAllCategories();
          const nameExists = allCategories.some(
            (cat) => cat.name.toLowerCase().trim() === data.name.toLowerCase().trim()
          );
          if (nameExists) {
            throw new Error(`A category named "${data.name}" already exists.`);
          }

          const newCategory: CustomCategory = {
            id: generateCategoryId(),
            name: data.name.trim(),
            icon: data.icon,
            color: data.color,
            isDefault: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          set((state) => ({
            customCategories: [...state.customCategories, newCategory],
            isLoading: false,
          }));
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'addCategory',
            metadata: { formData: data },
          });
          set({ error: appError, isLoading: false });
        }
      },

      updateCategory: (id: string, data: Partial<CustomCategoryFormData>) => {
        set({ isLoading: true, error: null });
        try {
          const category = get().customCategories.find((cat) => cat.id === id);
          if (!category) {
            throw new Error('Category not found');
          }
          if (category.isDefault) {
            throw new Error('Default categories cannot be edited');
          }

          if (data.name) {
            const allCategories = get().getAllCategories();
            const nameExists = allCategories.some(
              (cat) =>
                cat.id !== id &&
                cat.name.toLowerCase().trim() === data.name.toLowerCase().trim()
            );
            if (nameExists) {
              throw new Error(`A category named "${data.name}" already exists.`);
            }
          }

          set((state) => ({
            customCategories: state.customCategories.map((cat) =>
              cat.id === id
                ? {
                    ...cat,
                    ...(data.name !== undefined && { name: data.name.trim() }),
                    ...(data.icon !== undefined && { icon: data.icon }),
                    ...(data.color !== undefined && { color: data.color }),
                    updatedAt: new Date(),
                  }
                : cat
            ),
            isLoading: false,
          }));
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'updateCategory',
            categoryId: id,
            metadata: { updateData: data },
          });
          set({ error: appError, isLoading: false });
        }
      },

      deleteCategory: (id: string, subscriptions: Subscription[]) => {
        set({ isLoading: true, error: null });
        try {
          const category = get().customCategories.find((cat) => cat.id === id);
          if (!category) {
            throw new Error('Category not found');
          }
          if (category.isDefault) {
            throw new Error('Default categories cannot be deleted');
          }

          const inUse = subscriptions.some((sub) => sub.category === id);
          if (inUse) {
            throw new Error(
              'Cannot delete: category is assigned to subscriptions. Reassign them first.'
            );
          }

          set((state) => ({
            customCategories: state.customCategories.filter((cat) => cat.id !== id),
            isLoading: false,
          }));
        } catch (error) {
          const appError = errorHandler.handleError(error as Error, {
            action: 'deleteCategory',
            categoryId: id,
          });
          set({ error: appError, isLoading: false });
        }
      },

      getAllCategories: () => {
        return [...DEFAULT_CATEGORIES, ...get().customCategories];
      },

      getCategoryById: (id: string) => {
        return get().getAllCategories().find((cat) => cat.id === id);
      },

      canDeleteCategory: (id: string, subscriptions: Subscription[]) => {
        const category = get().customCategories.find((cat) => cat.id === id);
        if (!category) {
          return { canDelete: false, reason: 'Category not found' };
        }
        if (category.isDefault) {
          return { canDelete: false, reason: 'Default categories cannot be deleted' };
        }
        const inUse = subscriptions.some((sub) => sub.category === id);
        if (inUse) {
          return {
            canDelete: false,
            reason: 'Category is assigned to subscriptions',
          };
        }
        return { canDelete: true };
      },

      resetToDefaults: () => {
        set({ customCategories: [], error: null });
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ customCategories: state.customCategories }),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          useCategoryStore.setState({
            customCategories: [],
            isLoading: false,
            error: errorHandler.createError(
              new Error('Stored category data is corrupted. Loaded defaults.'),
              { action: 'rehydrateCategories' },
              true
            ),
          });
          return;
        }
        useCategoryStore.setState({ isLoading: false });
      },
    }
  )
);