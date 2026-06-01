/**
 * SubscriptionIcon — optimized image component for subscription icons.
 *
 * Features:
 *   - expo-image for hardware-accelerated rendering and disk caching
 *   - Blur hash placeholder while the image loads
 *   - Emoji/text fallback when no iconUrl is provided or image fails to load
 *   - Offline fallback: shows cached image or emoji when network is unavailable
 */

import React, { useEffect, useState } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { borderRadius, colors } from '../../utils/constants';
import { imageCache } from '../../utils/imageCache';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SubscriptionIconProps {
  /** Remote URL for the subscription icon */
  iconUrl?: string;
  /** Emoji or text fallback when no image is available */
  fallbackIcon: string;
  /** Width and height of the icon container */
  size?: number;
  /** Blur hash string for the placeholder (optional) */
  blurhash?: string;
  /** Accessible label for the icon */
  accessibilityLabel?: string;
}

// ── Default blur hash ─────────────────────────────────────────────────────────

/** Generic purple-toned placeholder matching the app's primary color */
const DEFAULT_BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

// ── Component ─────────────────────────────────────────────────────────────────

export const SubscriptionIcon: React.FC<SubscriptionIconProps> = React.memo(
  ({ iconUrl, fallbackIcon, size = 48, blurhash = DEFAULT_BLURHASH, accessibilityLabel }) => {
    const [imageError, setImageError] = useState(false);

    // Register URL in cache index when it changes
    useEffect(() => {
      if (iconUrl) {
        imageCache.register(iconUrl).catch(() => {
          // non-fatal
        });
      }
    }, [iconUrl]);

    const showImage = !!iconUrl && !imageError;
    const containerSize = { width: size, height: size, borderRadius: size * 0.25 };

    if (showImage) {
      return (
        <Image
          source={{ uri: iconUrl }}
          style={[styles.image, containerSize]}
          placeholder={{ blurhash }}
          contentFit="cover"
          transition={200}
          cachePolicy="disk"
          onError={() => setImageError(true)}
          accessible={true}
          accessibilityLabel={accessibilityLabel ?? 'Subscription icon'}
        />
      );
    }

    return (
      <View
        style={[styles.fallbackContainer, containerSize]}
        accessible={true}
        accessibilityLabel={accessibilityLabel ?? 'Subscription icon'}>
        <Text style={[styles.fallbackText, { fontSize: size * 0.5 }]}>{fallbackIcon}</Text>
      </View>
    );
  }
);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  image: {
    backgroundColor: colors.surfaceVariant,
  },
  fallbackContainer: {
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    lineHeight: undefined,
  },
});
