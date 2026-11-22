/**
 * AssetIcon – displays an on-chain asset's icon, falling back gracefully to a
 * coloured circle with initials when no logo is available (Issue #1721).
 *
 * Built on top of useAssetMetadata and SubscriptionIcon:
 *   - Known assets render their logo via expo-image (disk cache, blurhash)
 *   - Unknown assets render a deterministic coloured initials badge
 *   - While resolving (isLoading) a skeleton placeholder is shown
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useAssetMetadata } from '../../hooks/useAssetMetadata';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssetIconProps {
  /**
   * Token ticker symbol (case-insensitive).
   * e.g. "XLM", "usdc", "MATIC"
   */
  symbol: string;
  /** Width and height in logical pixels. Default: 40. */
  size?: number;
  /**
   * Override the logoURI resolved from the registry.
   * Useful when the caller already has a URL from `TokenBalance.logoURI`.
   */
  logoURIOverride?: string;
  /** Accessible label. Defaults to "<SYMBOL> icon". */
  accessibilityLabel?: string;
  /** Passed to the container view for layout flexibility. */
  style?: object;
  /** Whether to show the text initials badge when no image is available. Default: true */
  showInitialsFallback?: boolean;
}

// ─── Blurhash placeholder ─────────────────────────────────────────────────────

/** Generic neutral placeholder while the real image loads. */
const DEFAULT_BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

// ─── Component ────────────────────────────────────────────────────────────────

export const AssetIcon: React.FC<AssetIconProps> = React.memo(
  ({
    symbol,
    size = 40,
    logoURIOverride,
    accessibilityLabel,
    style,
    showInitialsFallback = true,
  }) => {
    const { metadata, isLoading } = useAssetMetadata(symbol);

    const a11yLabel =
      accessibilityLabel ?? `${metadata.symbol} icon`;
    const containerStyle = [
      styles.container,
      { width: size, height: size, borderRadius: size * 0.25 },
      style,
    ];

    // Skeleton while async cache lookup is in-flight
    if (isLoading) {
      return (
        <View
          style={[containerStyle, styles.skeleton]}
          accessible={false}
          accessibilityElementsHidden
        />
      );
    }

    const logoURI = logoURIOverride ?? metadata.logoURI;

    if (logoURI) {
      return (
        <LogoImage
          uri={logoURI}
          size={size}
          containerStyle={containerStyle}
          fallbackColor={metadata.fallbackColor}
          initials={metadata.initials}
          a11yLabel={a11yLabel}
          showInitialsFallback={showInitialsFallback}
        />
      );
    }

    if (showInitialsFallback) {
      return (
        <InitialsBadge
          initials={metadata.initials}
          color={metadata.fallbackColor}
          size={size}
          containerStyle={containerStyle}
          a11yLabel={a11yLabel}
        />
      );
    }

    // No image and fallback disabled: render an empty placeholder
    return <View style={[containerStyle, { backgroundColor: metadata.fallbackColor }]} />;
  },
);

AssetIcon.displayName = 'AssetIcon';

// ─── Sub-components ───────────────────────────────────────────────────────────

interface LogoImageProps {
  uri: string;
  size: number;
  containerStyle: object[];
  fallbackColor: string;
  initials: string;
  a11yLabel: string;
  showInitialsFallback: boolean;
}

const LogoImage: React.FC<LogoImageProps> = React.memo(
  ({ uri, size, containerStyle, fallbackColor, initials, a11yLabel, showInitialsFallback }) => {
    const [imageError, setImageError] = React.useState(false);

    if (imageError && showInitialsFallback) {
      return (
        <InitialsBadge
          initials={initials}
          color={fallbackColor}
          size={size}
          containerStyle={containerStyle}
          a11yLabel={a11yLabel}
        />
      );
    }

    return (
      <Image
        source={{ uri }}
        style={[containerStyle, styles.image]}
        placeholder={{ blurhash: DEFAULT_BLURHASH }}
        contentFit="contain"
        transition={200}
        cachePolicy="disk"
        onError={() => setImageError(true)}
        accessible={true}
        accessibilityLabel={a11yLabel}
      />
    );
  },
);

LogoImage.displayName = 'AssetIcon.LogoImage';

interface InitialsBadgeProps {
  initials: string;
  color: string;
  size: number;
  containerStyle: object[];
  a11yLabel: string;
}

const InitialsBadge: React.FC<InitialsBadgeProps> = React.memo(
  ({ initials, color, size, containerStyle, a11yLabel }) => (
    <View
      style={[containerStyle, styles.initialsContainer, { backgroundColor: color }]}
      accessible={true}
      accessibilityLabel={a11yLabel}>
      <Text
        style={[styles.initialsText, { fontSize: size * 0.35 }]}
        numberOfLines={1}
        adjustsFontSizeToFit>
        {initials}
      </Text>
    </View>
  ),
);

InitialsBadge.displayName = 'AssetIcon.InitialsBadge';

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  image: {
    backgroundColor: 'transparent',
  },
  skeleton: {
    backgroundColor: '#E0E0E0',
  },
  initialsContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
