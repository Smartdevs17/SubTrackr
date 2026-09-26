import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { languageService } from '../services/i18n';
import { useThemeColors } from '../hooks/useThemeColors';

const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
];

const LanguageSettingsScreen = () => {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
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

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background.primary,
    },
    header: {
      padding: 20,
      backgroundColor: colors.background.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    title: {
      fontSize: 24,
      fontWeight: '700',
      color: colors.text.primary,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textSecondary,
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
      backgroundColor: colors.background.card,
      borderRadius: 12,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    activeItem: {
      borderColor: colors.primary,
      backgroundColor: colors.background.secondary,
    },
    nativeName: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.text.primary,
    },
    englishName: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    activeText: {
      color: colors.primary,
    },
    checkmark: {
      fontSize: 20,
      color: colors.primary,
      fontWeight: 'bold',
    },
    footer: {
      padding: 30,
      alignItems: 'center',
    },
    footerText: {
      fontSize: 12,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
  });
}

export default LanguageSettingsScreen;
