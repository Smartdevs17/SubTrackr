import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './locales/en.json';
import hi from './locales/hi.json';
import ar from './locales/ar.json';
import he from './locales/he.json';
import fa from './locales/fa.json';

export const RTL_LANGUAGES = ['ar', 'he', 'fa'];

export const isRTLLanguage = (lang: string): boolean => {
  return RTL_LANGUAGES.includes(lang);
};

const RESOURCES = {
  en: { translation: en },
  hi: { translation: hi },
  ar: { translation: ar },
  he: { translation: he },
  fa: { translation: fa },
};

const LANGUAGE_KEY = '@subtrackr_language';

export const initI18n = async () => {
  let savedLanguage = await AsyncStorage.getItem(LANGUAGE_KEY);

  if (!savedLanguage) {
    savedLanguage = 'en';
  }

  await i18n.use(initReactI18next).init({
    resources: RESOURCES,
    lng: savedLanguage,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

  // Handle RTL for Arabic, Hebrew, and Persian
  const isRTL = isRTLLanguage(savedLanguage);
  if (I18nManager.isRTL !== isRTL) {
    I18nManager.allowRTL(isRTL);
    I18nManager.forceRTL(isRTL);
    // Note: On mobile, a restart is often required after forceRTL
  }
};

export default i18n;
