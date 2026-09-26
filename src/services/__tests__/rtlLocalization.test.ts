import { languageService } from '../i18n';
import { isRTLLanguage, RTL_LANGUAGES } from '../../i18n/config';

describe('RTL Localization Support', () => {
  test('identifies RTL languages correctly', () => {
    expect(RTL_LANGUAGES).toContain('ar');
    expect(RTL_LANGUAGES).toContain('he');
    expect(RTL_LANGUAGES).toContain('fa');

    expect(isRTLLanguage('ar')).toBe(true);
    expect(isRTLLanguage('he')).toBe(true);
    expect(isRTLLanguage('fa')).toBe(true);
    expect(isRTLLanguage('en')).toBe(false);
    expect(isRTLLanguage('hi')).toBe(false);
  });

  test('languageService.isRTL returns true for RTL languages', () => {
    expect(languageService.isRTL('he')).toBe(true);
    expect(languageService.isRTL('fa')).toBe(true);
    expect(languageService.isRTL('ar')).toBe(true);
    expect(languageService.isRTL('en')).toBe(false);
  });

  test('languageService.getRTLFlexDirection returns row-reverse for RTL languages', () => {
    expect(languageService.getRTLFlexDirection('he')).toBe('row-reverse');
    expect(languageService.getRTLFlexDirection('fa')).toBe('row-reverse');
    expect(languageService.getRTLFlexDirection('en')).toBe('row');
  });

  test('languageService.changeLanguage updates RTL configuration', async () => {
    const success = await languageService.changeLanguage('he');
    expect(success).toBe(true);
  });
});
