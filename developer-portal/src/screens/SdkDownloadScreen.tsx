import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  Linking,
  Alert,
} from 'react-native';

const SDK_PACKAGES = [
  {
    name: 'Node.js / TypeScript',
    icon: '📦',
    package: '@subtrackr/sdk',
    version: '2.1.0',
    install: 'npm install @subtrackr/sdk',
    docs: 'https://docs.subtrackr.com/sdk/nodejs',
    github: 'https://github.com/subtrackr/sdk-nodejs',
    features: ['TypeScript support', 'Promise-based API', 'Automatic retries', 'Type definitions'],
  },
  {
    name: 'Python',
    icon: '🐍',
    package: 'subtrackr',
    version: '1.8.2',
    install: 'pip install subtrackr',
    docs: 'https://docs.subtrackr.com/sdk/python',
    github: 'https://github.com/subtrackr/sdk-python',
    features: ['Async support', 'Type hints', 'Pydantic models', 'CLI tools'],
  },
  {
    name: 'Ruby',
    icon: '💎',
    package: 'subtrackr',
    version: '1.5.0',
    install: 'gem install subtrackr',
    docs: 'https://docs.subtrackr.com/sdk/ruby',
    github: 'https://github.com/subtrackr/sdk-ruby',
    features: ['Rails integration', 'ActiveRecord support', 'Idiomatic Ruby', 'RSpec helpers'],
  },
  {
    name: 'PHP',
    icon: '🐘',
    package: 'subtrackr/sdk',
    version: '1.6.1',
    install: 'composer require subtrackr/sdk',
    docs: 'https://docs.subtrackr.com/sdk/php',
    github: 'https://github.com/subtrackr/sdk-php',
    features: ['PSR-7 support', 'Laravel integration', 'Symfony bundle', 'PHP 8+ support'],
  },
  {
    name: 'Go',
    icon: '🔷',
    package: 'github.com/subtrackr/sdk-go',
    version: '0.9.0',
    install: 'go get github.com/subtrackr/sdk-go',
    docs: 'https://docs.subtrackr.com/sdk/go',
    github: 'https://github.com/subtrackr/sdk-go',
    features: ['Context support', 'Goroutine-safe', 'Minimal dependencies', 'Idiomatic Go'],
  },
  {
    name: 'Java',
    icon: '☕',
    package: 'com.subtrackr:sdk',
    version: '1.4.0',
    install: 'implementation "com.subtrackr:sdk:1.4.0"',
    docs: 'https://docs.subtrackr.com/sdk/java',
    github: 'https://github.com/subtrackr/sdk-java',
    features: ['Spring Boot support', 'Reactive streams', 'Builder pattern', 'Java 11+'],
  },
];

const QUICKSTART_EXAMPLES = [
  {
    language: 'TypeScript',
    code: `import { SubTrackr } from '@subtrackr/sdk';

const client = new SubTrackr({
  apiKey: process.env.SUBTRACKR_API_KEY,
});

// List subscriptions
const subscriptions = await client.subscriptions.list();

// Create a subscription
const subscription = await client.subscriptions.create({
  name: 'Netflix',
  price: 15.99,
  currency: 'USD',
  billingCycle: 'monthly',
});`,
  },
  {
    language: 'Python',
    code: `from subtrackr import SubTrackr

client = SubTrackr(api_key=os.environ["SUBTRACKR_API_KEY"])

# List subscriptions
subscriptions = client.subscriptions.list()

# Create a subscription
subscription = client.subscriptions.create(
    name="Netflix",
    price=15.99,
    currency="USD",
    billing_cycle="monthly",
)`,
  },
];

const SdkDownloadScreen: React.FC = () => {
  const handleCopyInstall = (_installCommand: string) => {
    // Copy to clipboard logic
    Alert.alert('Copied', 'Install command copied to clipboard');
  };

  const handleOpenLink = async (url: string) => {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Error', `Cannot open URL: ${url}`);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>SDK Downloads</Text>
          <Text style={styles.subtitle}>
            Official client libraries for your favorite programming languages
          </Text>
        </View>

        {/* SDK Packages */}
        {SDK_PACKAGES.map((sdk) => (
          <View key={sdk.package} style={styles.sdkCard}>
            <View style={styles.sdkHeader}>
              <Text style={styles.sdkIcon}>{sdk.icon}</Text>
              <View style={styles.sdkInfo}>
                <Text style={styles.sdkName}>{sdk.name}</Text>
                <Text style={styles.sdkPackage}>{sdk.package}</Text>
              </View>
              <View style={styles.versionBadge}>
                <Text style={styles.versionText}>v{sdk.version}</Text>
              </View>
            </View>

            <View style={styles.installSection}>
              <Text style={styles.installLabel}>Install</Text>
              <View style={styles.installRow}>
                <Text style={styles.installCommand}>{sdk.install}</Text>
                <TouchableOpacity
                  style={styles.copyButton}
                  onPress={() => handleCopyInstall(sdk.install)}>
                  <Text style={styles.copyIcon}>📋</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.featuresSection}>
              <Text style={styles.featuresLabel}>Features</Text>
              <View style={styles.featuresList}>
                {sdk.features.map((feature) => (
                  <View key={feature} style={styles.featureItem}>
                    <Text style={styles.featureBullet}>•</Text>
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.sdkActions}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleOpenLink(sdk.docs)}>
                <Text style={styles.actionButtonText}>📖 Documentation</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleOpenLink(sdk.github)}>
                <Text style={styles.actionButtonText}>⭐ GitHub</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}

        {/* Quickstart Examples */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quickstart Examples</Text>
          {QUICKSTART_EXAMPLES.map((example) => (
            <View key={example.language} style={styles.exampleCard}>
              <View style={styles.exampleHeader}>
                <Text style={styles.exampleLanguage}>{example.language}</Text>
                <TouchableOpacity onPress={() => handleCopyInstall(example.code)}>
                  <Text style={styles.copyIcon}>📋</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal style={styles.codeScroll}>
                <Text style={styles.codeText} selectable>
                  {example.code}
                </Text>
              </ScrollView>
            </View>
          ))}
        </View>

        {/* Community SDKs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Community SDKs</Text>
          <View style={styles.infoCard}>
            <Text style={styles.infoIcon}>💡</Text>
            <View style={styles.infoContent}>
              <Text style={styles.infoTitle}>Don't see your language?</Text>
              <Text style={styles.infoText}>
                Check out our REST API documentation to build your own integration, or contribute a
                community SDK on GitHub.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => handleOpenLink('https://docs.subtrackr.com/api')}>
            <Text style={styles.primaryButtonText}>View API Documentation</Text>
          </TouchableOpacity>
        </View>

        {/* Support */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Need Help?</Text>
          <View style={styles.supportCard}>
            <Text style={styles.supportIcon}>💬</Text>
            <View style={styles.supportContent}>
              <Text style={styles.supportTitle}>Developer Support</Text>
              <Text style={styles.supportText}>
                Join our Discord community or reach out to our developer support team for help with
                SDK integration.
              </Text>
            </View>
          </View>
          <View style={styles.supportActions}>
            <TouchableOpacity
              style={styles.supportButton}
              onPress={() => handleOpenLink('https://discord.gg/subtrackr')}>
              <Text style={styles.supportButtonText}>Join Discord</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.supportButton}
              onPress={() => handleOpenLink('mailto:support@subtrackr.com')}>
              <Text style={styles.supportButtonText}>Email Support</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F7',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  sdkCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  sdkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sdkIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  sdkInfo: {
    flex: 1,
  },
  sdkName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 2,
  },
  sdkPackage: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#666',
  },
  versionBadge: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  versionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1976D2',
  },
  installSection: {
    marginBottom: 16,
  },
  installLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  installRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F7',
    padding: 12,
    borderRadius: 8,
  },
  installCommand: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#000',
  },
  copyButton: {
    padding: 4,
  },
  copyIcon: {
    fontSize: 16,
  },
  featuresSection: {
    marginBottom: 16,
  },
  featuresLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 8,
  },
  featuresList: {
    gap: 4,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  featureBullet: {
    fontSize: 14,
    color: '#007AFF',
    marginRight: 8,
  },
  featureText: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  sdkActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    marginBottom: 12,
  },
  exampleCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  exampleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  exampleLanguage: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  codeScroll: {
    maxHeight: 200,
  },
  codeText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#000',
    lineHeight: 18,
  },
  infoCard: {
    backgroundColor: '#E3F2FD',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    marginBottom: 12,
  },
  infoIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  infoContent: {
    flex: 1,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976D2',
    marginBottom: 4,
  },
  infoText: {
    fontSize: 14,
    color: '#1976D2',
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  supportCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    flexDirection: 'row',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  supportIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  supportContent: {
    flex: 1,
  },
  supportTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  supportText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  supportActions: {
    flexDirection: 'row',
    gap: 8,
  },
  supportButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#007AFF',
    alignItems: 'center',
  },
  supportButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
  },
});

export default SdkDownloadScreen;
