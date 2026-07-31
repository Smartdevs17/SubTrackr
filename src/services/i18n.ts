import i18n from '../i18n/config';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { I18nManager } from 'react-native';

const LANGUAGE_KEY = '@subtrackr_language';

export const languageService = {
  /**
   * Change app language and persist preference
   */
  async changeLanguage(lang: string) {
    try {
      await i18n.changeLanguage(lang);
      await AsyncStorage.setItem(LANGUAGE_KEY, lang);

      const isRTL = lang === 'ar';
      if (I18nManager.isRTL !== isRTL) {
        I18nManager.allowRTL(isRTL);
        I18nManager.forceRTL(isRTL);

        // Reloading app is required for RTL changes to take full effect
        // if (RNRestart) RNRestart.Restart();
      }

      return true;
    } catch (error) {
      console.error('Failed to change language', error);
      return false;
    }
  },

  /**
   * Get currently active language code
   */
  getCurrentLanguage() {
    return i18n.language || 'en';
  },

  /**
   * Format currency based on locale
   */
  formatCurrency(amount: number, currency: string = 'USD') {
    const lang = this.getCurrentLanguage();
    const locale = lang === 'hi' ? 'en-IN' : lang === 'ar' ? 'ar-SA' : 'en-US';

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
    }).format(amount);
  },

  /**
   * Format date based on locale
   */
  formatDate(date: Date | string | number) {
    const lang = this.getCurrentLanguage();
    const d = new Date(date);

    return new Intl.DateTimeFormat(lang).format(d);
  },
};
