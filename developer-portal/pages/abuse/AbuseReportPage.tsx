/**
 * developer-portal/pages/abuse/AbuseReportPage.tsx
 *
 * Abuse report intake form with automated triage label preview.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TextInput,
  TouchableOpacity,
  Picker,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { abuseReportService } from '../../services/abuseReportService';
import {
  AbuseCategory,
  AbuseSeverity,
  ReportSource,
  AbuseReport,
  ABUSE_CATEGORY_LABELS,
  ABUSE_SEVERITY_LABELS,
  ABUSE_STATUS_LABELS,
  TRIAGE_LABEL_DISPLAY,
} from '../../types/abuse';

interface AbuseReportPageProps {
  onNavigate?: (page: string) => void;
}

const CATEGORY_OPTIONS = abuseReportService.getCategoryOptions();
const SEVERITY_OPTIONS = abuseReportService.getSeverityOptions();
const SOURCE_OPTIONS = abuseReportService.getSourceOptions();

export const AbuseReportPage: React.FC<AbuseReportPageProps> = ({ onNavigate }) => {
  // Form state
  const [category, setCategory] = useState<AbuseCategory>('phishing');
  const [severity, setSeverity] = useState<AbuseSeverity>('high');
  const [source, setSource] = useState<ReportSource>('user');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [targetResource, setTargetResource] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState<string>('');
  const [metadata, setMetadata] = useState('{}');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [submittedReport, setSubmittedReport] = useState<AbuseReport | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [rateLimitStatus, setRateLimitStatus] = useState<{ allowed: boolean; remainingHourly: number; remainingDaily: number } | null>(null);
  const [idempotencyKey] = useState(() => abuseReportService.generateIdempotencyKey());

  // Computed triage labels preview
  const triageLabels = computeTriageLabels(category, severity, source, subject, description);

  // Fetch rate limit status on mount
  useEffect(() => {
    loadRateLimitStatus();
  }, []);

  const loadRateLimitStatus = async () => {
    try {
      const status = await abuseReportService.getRateLimitStatus();
      setRateLimitStatus(status);
    } catch (error) {
      console.warn('Failed to load rate limit status:', error);
    }
  };

  const handleSubmit = useCallback(async () => {
    if (!subject.trim()) {
      Alert.alert('Validation Error', 'Subject is required');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Validation Error', 'Description is required');
      return;
    }

    setSubmitting(true);
    try {
      const evidenceArray = evidenceUrls
        .split('\n')
        .map(u => u.trim())
        .filter(u => u.length > 0);

      let metadataObj: Record<string, unknown> = {};
      try {
        metadataObj = JSON.parse(metadata) as Record<string, unknown>;
      } catch {
        Alert.alert('Validation Error', 'Metadata must be valid JSON');
        setSubmitting(false);
        return;
      }

      const report = await abuseReportService.createReport({
        idempotencyKey,
        reporterId: 'current_user', // In real app, get from auth context
        reporterIp: 'auto', // Server will detect
        category,
        severity,
        source,
        subject: subject.trim(),
        description: description.trim(),
        targetResource: targetResource.trim() || undefined,
        evidenceUrls: evidenceArray.length > 0 ? evidenceArray : undefined,
        metadata: Object.keys(metadataObj).length > 0 ? metadataObj : undefined,
      });

      setSubmittedReport(report);
      setShowPreview(false);
      Alert.alert('Success', 'Abuse report submitted successfully', [
        { text: 'View Report', onPress: () => setShowPreview(true) },
        { text: 'OK', style: 'default' },
      ]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to submit report';
      if (message.includes('DUPLICATE_IDEMPOTENCY_KEY')) {
        Alert.alert('Duplicate Report', 'A report with this ID has already been submitted');
      } else if (message.includes('RATE_LIMIT_EXCEEDED')) {
        Alert.alert('Rate Limited', 'Too many reports. Please try again later.');
        loadRateLimitStatus();
      } else {
        Alert.alert('Error', message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [idempotencyKey, category, severity, source, subject, description, targetResource, evidenceUrls, metadata]);

  const handleNewReport = useCallback(() => {
    setSubject('');
    setDescription('');
    setTargetResource('');
    setEvidenceUrls('');
    setMetadata('{}');
    setSubmittedReport(null);
    setShowPreview(false);
    loadRateLimitStatus();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={submitting} onRefresh={loadRateLimitStatus} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Report Abuse</Text>
          <Text style={styles.subtitle}>
            Submit a structured abuse report with automated triage
          </Text>
        </View>

        {/* Rate Limit Status */}
        {rateLimitStatus && (
          <View style={styles.rateLimitBanner}>
            <Text style={styles.rateLimitText}>
              {rateLimitStatus.allowed ? '✓' : '✗'} Rate Limit: {rateLimitStatus.remainingHourly}/hr, {rateLimitStatus.remainingDaily}/day remaining
            </Text>
          </View>
        )}

        {/* Form Sections */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Classification</Text>

          <View style={styles.fieldRow}>
            <View style={styles.field}>
              <Text style={styles.label}>Category *</Text>
              <Picker
                selectedValue={category}
                onValueChange={(v: string) => setCategory(v as AbuseCategory)}
                style={styles.picker}
                mode="dropdown"
              >
                {CATEGORY_OPTIONS.map(opt => (
                  <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                ))}
              </Picker>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Severity *</Text>
              <Picker
                selectedValue={severity}
                onValueChange={(v: string) => setSeverity(v as AbuseSeverity)}
                style={styles.picker}
                mode="dropdown"
              >
                {SEVERITY_OPTIONS.map(opt => (
                  <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
                ))}
              </Picker>
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Source *</Text>
            <Picker
              selectedValue={source}
              onValueChange={(v: string) => setSource(v as ReportSource)}
              style={styles.picker}
              mode="dropdown"
            >
              {SOURCE_OPTIONS.map(opt => (
                <Picker.Item key={opt.value} label={opt.label} value={opt.value} />
              ))}
            </Picker>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Report Details</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Subject *</Text>
            <TextInput
              style={styles.input}
              value={subject}
              onChangeText={setSubject}
              placeholder="Brief summary of the abuse"
              maxLength={200}
              autoCapitalize="sentences"
            />
            <Text style={styles.charCount}>{subject.length}/200</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Description *</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Detailed description of the abuse, including steps to reproduce, impact, and any relevant context"
              multiline
              numberOfLines={6}
              maxLength={5000}
              autoCapitalize="sentences"
            />
            <Text style={styles.charCount}>{description.length}/5000</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Target Resource (Optional)</Text>
            <TextInput
              style={styles.input}
              value={targetResource}
              onChangeText={setTargetResource}
              placeholder="URL, user ID, or resource identifier"
              autoCapitalize="none"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Evidence URLs (Optional, one per line)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={evidenceUrls}
              onChangeText={setEvidenceUrls}
              placeholder="https://example.com/screenshot1.png\nhttps://example.com/log.txt"
              multiline
              numberOfLines={3}
              autoCapitalize="none"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Metadata (Optional, JSON)</Text>
            <TextInput
              style={[styles.input, styles.textArea, styles.monoFont]}
              value={metadata}
              onChangeText={setMetadata}
              placeholder='{ "userAgent": "Mozilla/5.0", "referrer": "email" }'
              multiline
              numberOfLines={3}
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* Idempotency Key (read-only) */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Idempotency</Text>
          <View style={styles.field}>
            <Text style={styles.label}>Idempotency Key (auto-generated)</Text>
            <Text style={styles.idempotencyKey} numberOfLines={1}>{idempotencyKey}</Text>
            <Text style={styles.helpText}>
              Used to prevent duplicate submissions. Safe to retry with the same key.
            </Text>
          </View>
        </View>

        {/* Triage Label Preview */}
        <View style={styles.section}>
          <View style={styles.previewHeader}>
            <Text style={styles.sectionTitle}>Automated Triage Labels</Text>
            <TouchableOpacity onPress={() => setShowPreview(!showPreview)}>
              <Text style={styles.toggleText}>
                {showPreview ? 'Hide' : 'Show'} Preview
              </Text>
            </TouchableOpacity>
          </View>

          {showPreview && triageLabels.length > 0 && (
            <View style={styles.labelsContainer}>
              {triageLabels.map(label => (
                <View key={label} style={styles.labelTag}>
                  <Text style={styles.labelTagText}>{TRIAGE_LABEL_DISPLAY[label] || label}</Text>
                </View>
              ))}
            </View>
          )}

          {showPreview && triageLabels.length === 0 && (
            <Text style={styles.emptyPreview}>No triage labels would be assigned</Text>
          )}
        </View>

        {/* Submit Button */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Text style={styles.submitButtonText}>Submit Abuse Report</Text>
            )}
          </TouchableOpacity>

          {submittedReport && (
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setShowPreview(true)}>
              <Text style={styles.secondaryButtonText}>View Submitted Report</Text>
            </TouchableOpacity>
          )}

          {submittedReport && (
            <TouchableOpacity style={styles.secondaryButton} onPress={handleNewReport}>
              <Text style={styles.secondaryButtonText}>Submit Another Report</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Submitted Report Preview */}
        {submittedReport && showPreview && (
          <View style={[styles.section, styles.reportPreview]}>
            <View style={styles.previewHeader}>
              <Text style={styles.sectionTitle}>Submitted Report</Text>
              <TouchableOpacity onPress={() => setShowPreview(false)}>
                <Text style={styles.toggleText}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.reportDetail}>
              <Text style={styles.detailLabel}>Report ID</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{submittedReport.id}</Text>
            </View>

            <View style={styles.reportDetail}>
              <Text style={styles.detailLabel}>Status</Text>
              <View style={styles.statusBadge}>
                <Text
                  style={[
                    styles.statusBadgeText,
                    { backgroundColor: ABUSE_STATUS_LABELS[submittedReport.status].color },
                  ]}
                >
                  {ABUSE_STATUS_LABELS[submittedReport.status].label}
                </Text>
              </View>
            </View>

            <View style={styles.reportDetail}>
              <Text style={styles.detailLabel}>Category</Text>
              <Text style={styles.detailValue}>{ABUSE_CATEGORY_LABELS[submittedReport.category]}</Text>
            </View>

            <View style={styles.reportDetail}>
              <Text style={styles.detailLabel}>Severity</Text>
              <View style={styles.statusBadge}>
                <Text
                  style={[
                    styles.statusBadgeText,
                    { backgroundColor: ABUSE_SEVERITY_LABELS[submittedReport.severity].color },
                  ]}
                >
                  {ABUSE_SEVERITY_LABELS[submittedReport.severity].label}
                </Text>
              </View>
            </View>

            <View style={styles.reportDetail}>
              <Text style={styles.detailLabel}>Triage Labels</Text>
              <View style={styles.labelsContainer}>
                {submittedReport.triageLabels.map(label => (
                  <View key={label} style={styles.labelTag}>
                    <Text style={styles.labelTagText}>{TRIAGE_LABEL_DISPLAY[label] || label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.reportDetail}>
              <Text style={styles.detailLabel}>Created At</Text>
              <Text style={styles.detailValue}>{new Date(submittedReport.createdAt).toLocaleString()}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

/**
 * Compute triage labels client-side for preview (mirrors server logic).
 */
function computeTriageLabels(
  category: AbuseCategory,
  severity: AbuseSeverity,
  source: ReportSource,
  subject: string,
  description: string
): (keyof typeof TRIAGE_LABEL_DISPLAY)[] {
  const labels: (keyof typeof TRIAGE_LABEL_DISPLAY)[] = [];
  const searchText = `${subject} ${description}`.toLowerCase();

  // Severity label
  labels.push(`severity:${severity}` as keyof typeof TRIAGE_LABEL_DISPLAY);

  // Category label
  labels.push(`category:${category}` as keyof typeof TRIAGE_LABEL_DISPLAY);

  // Source label
  labels.push(`source:${source}` as keyof typeof TRIAGE_LABEL_DISPLAY);

  // Keyword-based labels
  const keywordRules: Array<{ label: keyof typeof TRIAGE_LABEL_DISPLAY; keywords: string[] }> = [
    { label: 'category:phishing', keywords: ['phishing', 'credential harvest', 'fake login', 'spoofed', 'impersonation', 'social engineering'] },
    { label: 'category:malware', keywords: ['malware', 'virus', 'trojan', 'ransomware', 'malicious software', 'infected', 'payload', 'dropper'] },
    { label: 'category:fraud', keywords: ['fraud', 'scam', 'fake', 'deceptive', 'fraudulent', 'identity theft', 'financial fraud'] },
    { label: 'category:harassment', keywords: ['harassment', 'harass', 'threat', 'abuse', 'bullying', 'stalking', 'doxxing', 'hate speech'] },
    { label: 'category:copyright', keywords: ['copyright', 'dmca', 'piracy', 'infringement', 'unauthorized copy', 'stolen content'] },
    { label: 'category:illegal_content', keywords: ['illegal', 'criminal', 'child exploitation', 'csam', 'terrorism', 'drug trafficking'] },
    { label: 'category:platform_abuse', keywords: ['platform abuse', 'terms violation', 'tos violation', 'policy violation', 'fake account', 'bot network'] },
    { label: 'category:api_abuse', keywords: ['api abuse', 'rate limit bypass', 'credential stuffing', 'api scraping', 'automated abuse'] },
    { label: 'needs:escalation', keywords: ['urgent', 'emergency', 'critical', 'data breach', 'ransomware', 'active attack', 'immediate'] },
  ];

  for (const rule of keywordRules) {
    if (rule.keywords.some(kw => searchText.includes(kw.toLowerCase()))) {
      if (!labels.includes(rule.label)) {
        labels.push(rule.label);
      }
    }
  }

  // Default needs:review for non-critical
  if (severity !== 'critical' && severity !== 'high') {
    if (!labels.includes('needs:review')) {
      labels.push('needs:review');
    }
  } else if (!labels.includes('needs:escalation')) {
    // High/critical without escalation keywords still need review
    if (!labels.includes('needs:review')) {
      labels.push('needs:review');
    }
  }

  return labels;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 4,
  },
  rateLimitBanner: {
    backgroundColor: '#ECFDF5',
    borderLeftWidth: 4,
    borderLeftColor: '#22C55E',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  rateLimitText: {
    fontSize: 14,
    color: '#065F46',
    fontWeight: '500',
  },
  section: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 16,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleText: {
    fontSize: 14,
    color: '#3B82F6',
    fontWeight: '500',
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 12,
  },
  field: {
    flex: 1,
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#111827',
    backgroundColor: 'white',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  monoFont: {
    fontFamily: 'monospace',
  },
  picker: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    backgroundColor: 'white',
  },
  charCount: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'right',
    marginTop: 4,
  },
  helpText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  idempotencyKey: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#374151',
    backgroundColor: '#F3F4F6',
    padding: 8,
    borderRadius: 6,
    marginBottom: 4,
  },
  labelsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  labelTag: {
    backgroundColor: '#EEF2FF',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  labelTagText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#3730A3',
  },
  emptyPreview: {
    color: '#9CA3AF',
    fontStyle: 'italic',
    marginTop: 8,
  },
  submitButton: {
    backgroundColor: '#3B82F6',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#93C5FD',
  },
  submitButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    color: '#3B82F6',
    fontSize: 16,
    fontWeight: '600',
  },
  reportPreview: {
    borderWidth: 1,
    borderColor: '#3B82F6',
    backgroundColor: '#EFF6FF',
  },
  reportDetail: {
    marginBottom: 12,
  },
  detailLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#374151',
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 14,
    color: '#111827',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
  },
});