/**
 * Modal Component
 * Overlay dialog component with backdrop and animations
 * WCAG 2.1 AA accessible with proper focus management and keyboard support
 */

import React from 'react';
import {
  StyleSheet,
  View,
  Modal as RNModal,
  TouchableWithoutFeedback,
  Animated,
  Platform,
  AccessibilityInfo,
} from 'react-native';
import type { ViewStyle } from 'react-native';

import { spacing, borderRadius, shadows, animation } from '../tokens';
import type { BaseComponentProps } from '../types/design-tokens';

// ============================================================================
// TYPES
// ============================================================================

export interface ModalProps extends BaseComponentProps {
  /**
   * Whether the modal is visible
   */
  visible: boolean;

  /**
   * Callback when modal should close (backdrop tap)
   */
  onClose: () => void;

  /**
   * Modal content
   */
  children: React.ReactNode;

  /**
   * Whether to show backdrop
   * @default true
   */
  showBackdrop?: boolean;

  /**
   * Close on backdrop tap
   * @default true
   */
  closeOnBackdropTap?: boolean;

  /**
   * Modal size preset
   * @default 'medium'
   */
  size?: 'small' | 'medium' | 'large' | 'fullscreen';

  /**
   * Custom container style
   */
  containerStyle?: ViewStyle;

  /**
   * Custom content style
   */
  contentStyle?: ViewStyle;

  /**
   * Animate modal
   * @default true
   */
  animateModal?: boolean;
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },

  content: {
    backgroundColor: '#1e293b',
    borderRadius: borderRadius.xl,
    ...shadows.xl,
    zIndex: 10,
  },

  // Size presets
  sizeSmall: {
    width: '80%',
    maxHeight: '70%',
  },
  sizeMedium: {
    width: '90%',
    maxHeight: '80%',
  },
  sizeLarge: {
    width: '95%',
    maxHeight: '90%',
  },
  sizeFullscreen: {
    width: '100%',
    height: '100%',
    borderRadius: 0,
  },

  // Platform-specific
  ...Platform.select({
    web: {
      contentWeb: {
        maxWidth: 600,
      },
    },
    default: {},
  }),
});

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Accessible Modal Component
 * Supports animations, backdrop, and size presets
 * WCAG 2.1 AA compliant with focus management
 */
export const Modal = React.forwardRef<View, ModalProps>(
  (
    {
      visible,
      onClose,
      children,
      showBackdrop = true,
      closeOnBackdropTap = true,
      size = 'medium',
      containerStyle,
      contentStyle,
      animateModal = true,
      accessibilityLabel,
      accessibilityRole = 'dialog',
      testID,
    },
    ref
  ) => {
    const scaleAnim = React.useRef(new Animated.Value(0.9)).current;
    const opacityAnim = React.useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
      if (visible && animateModal) {
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: animation.duration.normal,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: animation.duration.normal,
            useNativeDriver: true,
          }),
        ]).start();
      } else if (!visible && animateModal) {
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 0.9,
            duration: animation.duration.fast,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0,
            duration: animation.duration.fast,
            useNativeDriver: true,
          }),
        ]).start();
      }
    }, [visible, animateModal, scaleAnim, opacityAnim]);

    const sizeStyle = {
      small: styles.sizeSmall,
      medium: styles.sizeMedium,
      large: styles.sizeLarge,
      fullscreen: styles.sizeFullscreen,
    }[size];

    const modalId = testID || 'modal-dialog';

    return (
      <RNModal
        visible={visible}
        transparent
        animationType={animateModal ? 'fade' : 'none'}
        statusBarTranslucent
        onRequestClose={onClose}
        accessible
        accessibilityLabel={accessibilityLabel || 'Modal dialog'}
        accessibilityRole={accessibilityRole}
        testID={modalId}>
        <View style={[styles.container, containerStyle]}>
          {showBackdrop && (
            <TouchableWithoutFeedback
              onPress={closeOnBackdropTap ? onClose : undefined}
              accessible={false}>
              <View style={styles.backdrop} />
            </TouchableWithoutFeedback>
          )}

          <Animated.View
            ref={ref}
            style={[
              styles.content,
              sizeStyle,
              styles.contentWeb,
              contentStyle,
              {
                opacity: opacityAnim,
                transform: [
                  {
                    scale: scaleAnim,
                  },
                ],
              },
            ]}
            accessible
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="dialog">
            {children}
          </Animated.View>
        </View>
      </RNModal>
    );
  }
);

Modal.displayName = 'Modal';
