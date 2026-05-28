/**
 * Input Component
 * Text input field with labels, error states, and accessibility
 * WCAG 2.1 AA compliant with proper labels and validation messages
 */

import React from 'react';
import {
  StyleSheet,
  View,
  TextInput as RNTextInput,
  Text,
  Platform,
} from 'react-native';
import type { ViewStyle, TextStyle, TextInputProps as RNTextInputProps } from 'react-native';

import { spacing, borderRadius, typography } from '../tokens';
import type { AccessibilityProps } from '../types/design-tokens';

// ============================================================================
// TYPES
// ============================================================================

export type InputVariant = 'default' | 'outline' | 'filled';

export interface InputProps
  extends Omit<RNTextInputProps, 'onChangeText' | 'onFocus' | 'onBlur'>,
    AccessibilityProps {
  /**
   * Input label text
   */
  label?: string;

  /**
   * Input placeholder text
   */
  placeholder?: string;

  /**
   * Current input value
   */
  value: string;

  /**
   * Callback when text changes
   */
  onChangeText: (text: string) => void;

  /**
   * Callback when input gains focus
   */
  onFocus?: () => void;

  /**
   * Callback when input loses focus
   */
  onBlur?: () => void;

  /**
   * Error message to display
   */
  error?: string;

  /**
   * Helper/hint text
   */
  helperText?: string;

  /**
   * Whether the field is required
   * @default false
   */
  required?: boolean;

  /**
   * Input variant style
   * @default 'outline'
   */
  variant?: InputVariant;

  /**
   * Whether the input is disabled
   * @default false
   */
  disabled?: boolean;

  /**
   * Left icon/element
   */
  leftIcon?: React.ReactNode;

  /**
   * Right icon/element
   */
  rightIcon?: React.ReactNode;

  /**
   * Custom container style
   */
  containerStyle?: ViewStyle;

  /**
   * Custom input style
   */
  inputStyle?: TextStyle;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },

  labelRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
    alignItems: 'center',
  },

  label: {
    ...typography.label,
    marginRight: spacing.sm,
  },

  required: {
    color: '#ef4444',
    marginLeft: spacing.xs,
  },

  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44, // WCAG 2.1 AA minimum touch target
  },

  inputContainerOutline: {
    borderWidth: 1,
  },

  inputContainerFilled: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },

  inputContainerFocused: {
    borderWidth: 2,
  },

  input: {
    flex: 1,
    ...typography.body,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },

  iconContainer: {
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },

  helperRow: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },

  helperText: {
    ...typography.bodySmall,
    flex: 1,
  },

  errorText: {
    ...typography.bodySmall,
    marginTop: spacing.sm,
  },
});

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Accessible Text Input Component
 * Supports labels, validation, helper text, and icons
 * WCAG 2.1 AA compliant with proper labeling and error messaging
 */
export const Input = React.forwardRef<RNTextInput, InputProps>(
  (
    {
      label,
      placeholder,
      value,
      onChangeText,
      onFocus,
      onBlur,
      error,
      helperText,
      required = false,
      variant = 'outline',
      disabled = false,
      leftIcon,
      rightIcon,
      containerStyle,
      inputStyle,
      accessibilityLabel,
      accessibilityHint,
      accessibilityRole = 'search',
      testID,
      ...restProps
    },
    ref
  ) => {
    // Mock theme
    const theme = {
      colors: {
        primary: '#6366f1',
        border: '#334155',
        borderLight: '#475569',
        text: '#f8fafc',
        textSecondary: '#cbd5e1',
        textDisabled: '#64748b',
        error: '#ef4444',
        errorLight: '#fca5a5',
        errorBackground: 'rgba(239, 68, 68, 0.16)',
        surface: '#1e293b',
      },
    };

    const [isFocused, setIsFocused] = React.useState(false);

    const handleFocus = () => {
      setIsFocused(true);
      onFocus?.();
    };

    const handleBlur = () => {
      setIsFocused(false);
      onBlur?.();
    };

    // Determine border color based on state
    const borderColor = error
      ? theme.colors.error
      : isFocused
        ? theme.colors.primary
        : theme.colors.border;

    const inputContainerStyle: ViewStyle = {
      borderColor,
      backgroundColor:
        variant === 'filled'
          ? theme.colors.surface
          : error
            ? theme.colors.errorBackground
            : 'transparent',
    };

    const inputTextStyle: TextStyle = {
      color: disabled ? theme.colors.textDisabled : theme.colors.text,
    };

    const labelStyle: TextStyle = {
      color: disabled ? theme.colors.textDisabled : theme.colors.text,
    };

    const helperStyle: TextStyle = {
      color: error ? theme.colors.error : theme.colors.textSecondary,
    };

    const inputId = testID || `input-${label?.toLowerCase().replace(/\s+/g, '-')}`;

    return (
      <View style={[styles.container, containerStyle]}>
        {label && (
          <View style={styles.labelRow}>
            <Text
              style={[styles.label, labelStyle]}
              nativeID={`${inputId}-label`}
            >
              {label}
            </Text>
            {required && <Text style={styles.required}>*</Text>}
          </View>
        )}

        <View
          style={[
            styles.inputContainer,
            variant === 'outline' && styles.inputContainerOutline,
            variant === 'filled' && styles.inputContainerFilled,
            isFocused && styles.inputContainerFocused,
            inputContainerStyle,
          ]}
        >
          {leftIcon && <View style={styles.iconContainer}>{leftIcon}</View>}

          <RNTextInput
            ref={ref}
            style={[styles.input, inputTextStyle, inputStyle]}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.textSecondary}
            value={value}
            onChangeText={onChangeText}
            onFocus={handleFocus}
            onBlur={handleBlur}
            editable={!disabled}
            selectTextOnFocus={!disabled}
            accessibilityLabel={accessibilityLabel || label}
            accessibilityHint={
              accessibilityHint ||
              (error ? `Error: ${error}` : helperText)
            }
            accessibilityRole={accessibilityRole}
            accessibilityState={{
              disabled,
            }}
            labelledBy={label ? `${inputId}-label` : undefined}
            testID={inputId}
            allowFontScaling
            maxFontSizeMultiplier={1.2}
            {...restProps}
          />

          {rightIcon && <View style={styles.iconContainer}>{rightIcon}</View>}
        </View>

        {(error || helperText) && (
          <Text
            style={[styles.errorText, helperStyle]}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            {error || helperText}
          </Text>
        )}
      </View>
    );
  }
);

Input.displayName = 'Input';
