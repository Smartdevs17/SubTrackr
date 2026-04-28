import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  FlatList,
} from 'react-native';

interface DocSection {
  id: string;
  title: string;
  icon: string;
  content: string;
}

interface QuickStartGuide {
  id: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: string;
}

const DOC_SECTIONS: DocSection[] = [
  {
    id: 'authentication',
    title: 'Authentication',
    icon: '🔐',
    content: `All API requests require authentication using an API key. Include your key in the Authorization header:

Authorization: Bearer sk_test_your_api_key_here

Sandbox keys start with sk_test_ and production keys start with sk_live_.`,
  },
  {
    id: 'base-url',
    title: 'Base URL',
    icon: '🌐',
    content: `Sandbox: https://sandbox.api.subtrackr.io/v1
Production: https://api.subtrackr.io/v1

Always use the sandbox URL during development and testing.`,
  },
  {
    id: 'rate-limits',
    title: 'Rate Limits',
    icon: '⚡',
    content: `Free tier: 30 requests/minute, 5,000/day
Pro tier: 120 requests/minute, 50,000/day
Enterprise: 300 requests/minute, 200,000/day

Rate limit headers are included in every response:
- X-RateLimit-Remaining
- X-RateLimit-Reset`,
  },
  {
    id: 'errors',
    title: 'Error Handling',
    icon: '⚠️',
    content: `Error responses follow this format:
{
  "error": {
    "code": "invalid_request",
    "message": "The request body is invalid",
    "details": { "field": "price" }
  }
}

Common error codes:
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 429: Rate Limited
- 500: Server Error`,
  },
  {
    id: 'pagination',
    title: 'Pagination',
    icon: '📄',
    content: `List endpoints support pagination:

GET /subscriptions?page=1&limit=20

Response includes pagination metadata:
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "hasMore": true
  }
}`,
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    icon: '🔔',
    content: `Webhooks notify you of events in real-time:

Events:
- subscription.created
- subscription.updated
- subscription.cancelled
- payment.succeeded
- payment.failed

Verify webhook signatures using HMAC-SHA256.`,
  },
];

const QUICK_START_GUIDES: QuickStartGuide[] = [
  {
    id: 'quickstart-node',
    title: 'Node.js Quickstart',
    description: 'Get started with SubTrackr API in Node.js',
    difficulty: 'beginner',
    estimatedTime: '15 min',
  },
  {
    id: 'quickstart-python',
    title: 'Python Quickstart',
    description: 'Get started with SubTrackr API in Python',
    difficulty: 'beginner',
    estimatedTime: '15 min',
  },
  {
    id: 'webhook-integration',
    title: 'Webhook Integration',
    description: 'Learn how to receive and handle webhooks',
    difficulty: 'intermediate',
    estimatedTime: '30 min',
  },
  {
    id: 'crypto-payments',
    title: 'Crypto Payments',
    description: 'Integrate cryptocurrency payments',
    difficulty: 'advanced',
    estimatedTime: '1 hour',
  },
];

export const DocumentationPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSection, setSelectedSection] = useState<DocSection | null>(
    null
  );

  const filteredSections = DOC_SECTIONS.filter(
    (section) =>
      section.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      section.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getDifficultyColor = (difficulty: string): string => {
    switch (difficulty) {
      case 'beginner':
        return '#22C55E';
      case 'intermediate':
        return '#F59E0B';
      case 'advanced':
        return '#EF4444';
      default:
        return '#6B7280';
    }
  };

  const renderSection = ({ item }: { item: DocSection }) => (
    <TouchableOpacity
      style={[
        styles.sectionCard,
        selectedSection?.id === item.id && styles.sectionCardSelected,
      ]}
      onPress={() =>
        setSelectedSection(
          selectedSection?.id === item.id ? null : item
        )
      }
    >
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionIcon}>{item.icon}</Text>
        <Text style={styles.sectionTitle}>{item.title}</Text>
        <Text style={styles.expandIcon}>
          {selectedSection?.id === item.id ? '▼' : '▶'}
        </Text>
      </View>
      {selectedSection?.id === item.id && (
        <Text style={styles.sectionContent}>{item.content}</Text>
      )}
    </TouchableOpacity>
  );

  const renderGuide = ({ item }: { item: QuickStartGuide }) => (
    <TouchableOpacity style={styles.guideCard}>
      <View style={styles.guideHeader}>
        <Text style={styles.guideTitle}>{item.title}</Text>
        <View
          style={[
            styles.difficultyBadge,
            { backgroundColor: getDifficultyColor(item.difficulty) + '20' },
          ]}
        >
          <Text
            style={[
              styles.difficultyText,
              { color: getDifficultyColor(item.difficulty) },
            ]}
          >
            {item.difficulty}
          </Text>
        </View>
      </View>
      <Text style={styles.guideDescription}>{item.description}</Text>
      <Text style={styles.guideTime}>{item.estimatedTime}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Documentation</Text>
        <Text style={styles.subtitle}>
          Everything you need to integrate with SubTrackr
        </Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search documentation..."
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionGroupTitle}>Quick Start Guides</Text>
        <FlatList
          data={QUICK_START_GUIDES}
          renderItem={renderGuide}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionGroupTitle}>API Reference</Text>
        <FlatList
          data={filteredSections}
          renderItem={renderSection}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
        />
      </View>

      <View style={styles.helpSection}>
        <Text style={styles.helpTitle}>Need Help?</Text>
        <Text style={styles.helpText}>
          Can't find what you're looking for? Contact our developer support
          team.
        </Text>
        <TouchableOpacity style={styles.helpButton}>
          <Text style={styles.helpButtonText}>Contact Support</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  header: {
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    lineHeight: 24,
  },
  searchContainer: {
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  searchInput: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  section: {
    marginTop: 16,
    paddingHorizontal: 16,
  },
  sectionGroupTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionCardSelected: {
    borderColor: '#3B82F6',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sectionIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  expandIcon: {
    fontSize: 12,
    color: '#6B7280',
  },
  sectionContent: {
    marginTop: 12,
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  guideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  guideHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  guideTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  difficultyBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  difficultyText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  guideDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 8,
  },
  guideTime: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  helpSection: {
    backgroundColor: '#FFFFFF',
    marginTop: 24,
    margin: 16,
    padding: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  helpTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
  },
  helpText: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 16,
  },
  helpButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  helpButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
});

export default DocumentationPage;
