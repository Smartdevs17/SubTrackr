import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, TouchableOpacity } from 'react-native';
import { Card } from '../components/common/Card';
import { colors, spacing, typography, borderRadius } from '../utils/constants';

interface DocSection {
  id: string;
  title: string;
  icon: string;
  content: string;
  subsections: { title: string; content: string }[];
}

const DOC_SECTIONS: DocSection[] = [
  {
    id: 'overview',
    title: 'API Overview',
    icon: '📖',
    content:
      'The SubTrackr API provides programmatic access to subscription management, payment processing, and analytics. All endpoints return JSON responses and use standard HTTP status codes.',
    subsections: [
      {
        title: 'Base URL',
        content:
          'Sandbox: https://api.sandbox.subtrackr.dev/v1\nProduction: https://api.subtrackr.dev/v1',
      },
      {
        title: 'Authentication',
        content:
          'All API requests require an API key passed in the Authorization header:\n\nAuthorization: Bearer sk_sandbox_your_key_here',
      },
      {
        title: 'Rate Limits',
        content: 'Sandbox: 60 requests/minute, 10,000 requests/day\nProduction: Varies by plan',
      },
    ],
  },
  {
    id: 'subscriptions',
    title: 'Subscriptions',
    icon: '🔄',
    content: 'Create, read, update, and delete subscription records.',
    subsections: [
      {
        title: 'GET /subscriptions',
        content:
          'List all subscriptions with optional filtering and pagination.\n\nQuery params: status, category, page, limit',
      },
      {
        title: 'POST /subscriptions',
        content:
          'Create a new subscription.\n\nRequired fields: name, price, currency, billingCycle\nOptional: category, description, notificationsEnabled',
      },
      {
        title: 'GET /subscriptions/:id',
        content: 'Retrieve a single subscription by ID.',
      },
      {
        title: 'PUT /subscriptions/:id',
        content: 'Update an existing subscription. Only provided fields will be updated.',
      },
      {
        title: 'DELETE /subscriptions/:id',
        content: 'Delete a subscription. This action is irreversible.',
      },
    ],
  },
  {
    id: 'payments',
    title: 'Payments',
    icon: '💳',
    content: 'Process payments and manage billing for subscriptions.',
    subsections: [
      {
        title: 'POST /payments',
        content:
          'Process a payment for a subscription.\n\nRequired: subscriptionId, amount, currency\nOptional: network (stellar, ethereum, polygon)',
      },
      {
        title: 'GET /payments/:id',
        content: 'Retrieve payment details and status.',
      },
      {
        title: 'POST /payments/:id/refund',
        content: 'Initiate a refund for a payment.',
      },
    ],
  },
  {
    id: 'webhooks',
    title: 'Webhooks',
    icon: '🔔',
    content: 'Receive real-time notifications for subscription events.',
    subsections: [
      {
        title: 'POST /webhooks',
        content:
          'Register a webhook endpoint.\n\nRequired: url, events\nOptional: secret (for signature verification)',
      },
      {
        title: 'GET /webhooks',
        content: 'List all registered webhooks.',
      },
      {
        title: 'DELETE /webhooks/:id',
        content: 'Remove a webhook endpoint.',
      },
      {
        title: 'Event Types',
        content:
          'subscription.created, subscription.updated, subscription.cancelled, subscription.paused, subscription.resumed, payment.completed, payment.failed, invoice.generated',
      },
    ],
  },
  {
    id: 'analytics',
    title: 'Analytics',
    icon: '📊',
    content: 'Access subscription analytics and generate reports.',
    subsections: [
      {
        title: 'GET /analytics/overview',
        content: 'Get high-level subscription metrics: total active, MRR, churn rate.',
      },
      {
        title: 'GET /analytics/revenue',
        content: 'Revenue breakdown by period, category, and payment method.',
      },
      {
        title: 'GET /analytics/export',
        content: 'Export analytics data as CSV or JSON.',
      },
    ],
  },
  {
    id: 'errors',
    title: 'Error Handling',
    icon: '⚠️',
    content: 'Understand API error responses and how to handle them.',
    subsections: [
      {
        title: 'Error Format',
        content:
          'All errors return: { "error": { "code": "string", "message": "string", "details": {} } }',
      },
      {
        title: 'Common Error Codes',
        content:
          "400 - Bad Request: Invalid parameters\n401 - Unauthorized: Invalid or missing API key\n403 - Forbidden: Insufficient permissions\n404 - Not Found: Resource doesn't exist\n429 - Rate Limited: Too many requests\n500 - Server Error: Internal error",
      },
    ],
  },
];

const DocumentationPortalScreen: React.FC = () => {
  const [expandedSection, setExpandedSection] = useState<string | null>('overview');
  const [expandedSubsection, setExpandedSubsection] = useState<string | null>(null);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>API Documentation</Text>
          <Text style={styles.subtitle}>Complete reference for the SubTrackr API</Text>
        </View>

        <Card style={styles.searchCard}>
          <Text style={styles.searchPlaceholder}>Search documentation...</Text>
        </Card>

        <View style={styles.tocCard}>
          <Text style={styles.tocTitle}>Contents</Text>
          {DOC_SECTIONS.map((section) => (
            <TouchableOpacity
              key={section.id}
              style={[styles.tocItem, expandedSection === section.id && styles.tocItemActive]}
              onPress={() =>
                setExpandedSection(expandedSection === section.id ? null : section.id)
              }>
              <Text style={styles.tocIcon}>{section.icon}</Text>
              <Text
                style={[styles.tocText, expandedSection === section.id && styles.tocTextActive]}>
                {section.title}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {DOC_SECTIONS.map((section) => (
          <Card key={section.id} style={styles.section}>
            <TouchableOpacity
              style={styles.sectionHeader}
              onPress={() =>
                setExpandedSection(expandedSection === section.id ? null : section.id)
              }>
              <View style={styles.sectionTitleRow}>
                <Text style={styles.sectionIcon}>{section.icon}</Text>
                <Text style={styles.sectionTitle}>{section.title}</Text>
              </View>
              <Text style={styles.expandIcon}>{expandedSection === section.id ? '▼' : '▶'}</Text>
            </TouchableOpacity>

            {expandedSection === section.id && (
              <>
                <Text style={styles.sectionContent}>{section.content}</Text>
                {section.subsections.map((sub, index) => (
                  <View key={index} style={styles.subsection}>
                    <TouchableOpacity
                      style={styles.subsectionHeader}
                      onPress={() =>
                        setExpandedSubsection(
                          expandedSubsection === `${section.id}-${index}`
                            ? null
                            : `${section.id}-${index}`
                        )
                      }>
                      <Text style={styles.subsectionTitle}>{sub.title}</Text>
                      <Text style={styles.expandIcon}>
                        {expandedSubsection === `${section.id}-${index}` ? '▼' : '▶'}
                      </Text>
                    </TouchableOpacity>
                    {expandedSubsection === `${section.id}-${index}` && (
                      <Text style={styles.subsectionContent}>{sub.content}</Text>
                    )}
                  </View>
                ))}
              </>
            )}
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  header: {
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h1,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  searchCard: {
    padding: spacing.md,
  },
  searchPlaceholder: {
    ...typography.body,
    color: colors.textSecondary,
  },
  tocCard: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tocTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  tocItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tocItemActive: {
    backgroundColor: `${colors.primary}10`,
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
  },
  tocIcon: {
    fontSize: 16,
  },
  tocText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  tocTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  section: {
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionIcon: {
    fontSize: 20,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.text,
  },
  expandIcon: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  sectionContent: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  subsection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  subsectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  subsectionTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  subsectionContent: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
    fontFamily: 'monospace',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
});

export default DocumentationPortalScreen;
