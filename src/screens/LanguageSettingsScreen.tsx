import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { languageService } from '../services/i18n';

const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
];

const LanguageSettingsScreen = () => {
  const { t, i18n } = useTranslation();
  const currentLanguage = i18n.language;

  const handleLanguageChange = async (code: string) => {
    if (code === currentLanguage) return;

    const success = await languageService.changeLanguage(code);
    if (success) {
      if (code === 'ar' || currentLanguage === 'ar') {
        Alert.alert(t('common.success'), t('settings.language_restart_notice'), [
          { text: t('common.ok') },
        ]);
      }
    } else {
      Alert.alert(t('common.error'), t('settings.language_failed'));
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('settings.language')}</Text>
        <Text style={styles.subtitle}>{t('settings.language_subtitle')}</Text>
      </View>

      <View style={styles.list}>
        {LANGUAGES.map((lang) => (
          <TouchableOpacity
            key={lang.code}
            style={[styles.item, currentLanguage === lang.code && styles.activeItem]}
            onPress={() => handleLanguageChange(lang.code)}
            accessibilityRole="radio"
            accessibilityLabel={`${lang.name}, ${lang.nativeName}`}
            accessibilityState={{ checked: currentLanguage === lang.code }}>
            <View>
              <Text style={[styles.nativeName, currentLanguage === lang.code && styles.activeText]}>
                {lang.nativeName}
              </Text>
              <Text style={styles.englishName}>{lang.name}</Text>
            </View>
            {currentLanguage === lang.code && <Text style={styles.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{t('settings.language_footer')}</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  header: {
    padding: 20,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EEE',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 5,
  },
  list: {
    padding: 15,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#FFF',
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EEE',
  },
  activeItem: {
    borderColor: '#007AFF',
    backgroundColor: '#F0F7FF',
  },
  nativeName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  englishName: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  activeText: {
    color: '#007AFF',
  },
  checkmark: {
    fontSize: 20,
    color: '#007AFF',
    fontWeight: 'bold',
  },
  footer: {
    padding: 30,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#BBB',
    textAlign: 'center',
    lineHeight: 18,
  },
});

export default LanguageSettingsScreen;
