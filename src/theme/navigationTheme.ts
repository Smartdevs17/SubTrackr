import { DarkTheme, DefaultTheme, Theme } from '@react-navigation/native';
import { darkColors, lightColors } from './colors';

export const lightNavigationTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: lightColors.background.primary,
    card: lightColors.navigation.header,
    text: lightColors.navigation.headerText,
    border: lightColors.navigation.tabBarBorder,
    primary: lightColors.brand.primary,
    notification: lightColors.status.error,
  },
};

export const darkNavigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: darkColors.background.primary,
    card: darkColors.navigation.header,
    text: darkColors.navigation.headerText,
    border: darkColors.navigation.tabBarBorder,
    primary: darkColors.brand.primary,
    notification: darkColors.status.error,
  },
};
