import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Switch,
} from 'react-native';
import { useThemeColors } from '../hooks/useThemeColors';
import { useEmailTemplateStore } from '../store/emailTemplateStore';
import { emailTemplateService } from '../services/emailTemplateService';
import type { BlockType, TemplateBlock } from '../types/emailTemplate';
import { injectVariables, TEMPLATE_VARIABLES } from '../types/emailTemplate';

const BLOCK_ICONS: Record<BlockType, string> = {
  header: '🏷️',
  body: '📝',
  cta_button: '🔘',
  footer: '📄',
  divider: '➖',
  image: '🖼️',
};

const MERCHANT_ID = 'merchant-demo';

const EmailTemplateEditorScreen = () => {
  const colors = useThemeColors();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const {
    templates,
    activeTemplate,
    previewHtml,
    loadTemplates,
    selectTemplate,
    createTemplate,
    updateBlocks,
    updateCustomCss,
    publishTemplate,
    rollbackTemplate,
    refreshPreview,
  } = useEmailTemplateStore();

  const [activeTab, setActiveTab] = useState<'blocks' | 'preview' | 'abtest' | 'versions'>(
    'blocks'
  );
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [customCss, setCustomCss] = useState('');
  const [newTemplateName, setNewTemplateName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    loadTemplates(MERCHANT_ID);
    // Create demo template if none exist
    if (emailTemplateService.list(MERCHANT_ID).length === 0) {
      createTemplate(MERCHANT_ID, 'Payment Failed', 'payment_failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blocks = activeTemplate?.locales[0]?.blocks ?? [];

  const handleEditBlock = (block: TemplateBlock) => {
    setEditingBlockId(block.id);
    setEditContent(block.content);
  };

  const handleSaveBlock = () => {
    if (!activeTemplate || editingBlockId === null) return;
    const updated = blocks.map((b) =>
      b.id === editingBlockId ? { ...b, content: editContent } : b
    );
    updateBlocks(activeTemplate.id, updated);
    setEditingBlockId(null);
  };

  const handleMoveBlock = (blockId: string, direction: 'up' | 'down') => {
    if (!activeTemplate) return;
    const sorted = [...blocks].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((b) => b.id === blockId);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;
    const reordered = sorted.map((b, i) => {
      if (i === idx) return { ...b, order: sorted[swapIdx].order };
      if (i === swapIdx) return { ...b, order: sorted[idx].order };
      return b;
    });
    updateBlocks(activeTemplate.id, reordered);
  };

  const handlePublish = () => {
    if (!activeTemplate) return;
    Alert.alert('Publish template?', 'This will make the template live for all subscribers.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Publish',
        onPress: () => {
          publishTemplate(activeTemplate.id);
          Alert.alert('Published', `v${activeTemplate.version + 1} is now live.`);
        },
      },
    ]);
  };

  const versions = activeTemplate ? emailTemplateService.getVersionHistory(activeTemplate.id) : [];

  return (
    <View style={styles.container}>
      {/* Template selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.templateBar}>
        {templates.map((t) => (
          <TouchableOpacity
            key={t.id}
            style={[styles.templateChip, activeTemplate?.id === t.id && styles.templateChipActive]}
            onPress={() => selectTemplate(t.id)}
            accessibilityRole="button"
            accessibilityLabel={`Select template ${t.name}`}
            accessibilityState={{ selected: activeTemplate?.id === t.id }}>
            <Text
              style={[
                styles.templateChipText,
                activeTemplate?.id === t.id && styles.templateChipTextActive,
              ]}>
              {t.name}
            </Text>
            <Text style={styles.templateStatus}>{t.status}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={styles.addTemplateBtn}
          onPress={() => setShowCreate(true)}
          accessibilityRole="button"
          accessibilityLabel="Create new template">
          <Text style={styles.addTemplateBtnText}>+ New</Text>
        </TouchableOpacity>
      </ScrollView>

      {showCreate && (
        <View style={styles.createRow}>
          <TextInput
            style={styles.createInput}
            placeholder="Template name"
            placeholderTextColor={colors.textSecondary}
            value={newTemplateName}
            onChangeText={setNewTemplateName}
            accessibilityLabel="New template name"
          />
          <TouchableOpacity
            style={styles.createBtn}
            onPress={() => {
              if (newTemplateName.trim()) {
                createTemplate(MERCHANT_ID, newTemplateName.trim(), 'custom');
                setNewTemplateName('');
                setShowCreate(false);
              }
            }}>
            <Text style={styles.createBtnText}>Create</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(['blocks', 'preview', 'abtest', 'versions'] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => {
              setActiveTab(tab);
              if (tab === 'preview' && activeTemplate) refreshPreview(activeTemplate.id);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'abtest' ? 'A/B Test' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentPad}>
        {!activeTemplate ? (
          <Text style={styles.emptyText}>Select or create a template to get started.</Text>
        ) : (
          <>
            {/* Blocks editor */}
            {activeTab === 'blocks' && (
              <>
                <Text style={styles.sectionTitle}>
                  {activeTemplate.name} — v{activeTemplate.version} ({activeTemplate.status})
                </Text>
                {[...blocks]
                  .sort((a, b) => a.order - b.order)
                  .map((block) => (
                    <View key={block.id} style={styles.blockCard}>
                      <View style={styles.blockHeader}>
                        <Text style={styles.blockType}>
                          {BLOCK_ICONS[block.type]} {block.type.replace('_', ' ')}
                        </Text>
                        <View style={styles.blockActions}>
                          <TouchableOpacity
                            onPress={() => handleMoveBlock(block.id, 'up')}
                            style={styles.iconBtn}
                            accessibilityRole="button"
                            accessibilityLabel="Move block up">
                            <Text>↑</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleMoveBlock(block.id, 'down')}
                            style={styles.iconBtn}
                            accessibilityRole="button"
                            accessibilityLabel="Move block down">
                            <Text>↓</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleEditBlock(block)}
                            style={styles.editBtn}
                            accessibilityRole="button"
                            accessibilityLabel="Edit block content">
                            <Text style={styles.editBtnText}>Edit</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      {editingBlockId === block.id ? (
                        <View>
                          <TextInput
                            style={styles.blockInput}
                            value={editContent}
                            onChangeText={setEditContent}
                            multiline
                            accessibilityLabel="Block content editor"
                          />
                          <Text style={styles.variableHint}>
                            Available variables:{' '}
                            {Object.keys(TEMPLATE_VARIABLES)
                              .map((v) => `{{${v}}}`)
                              .join(', ')}
                          </Text>
                          <Text style={styles.previewText}>
                            Preview: {injectVariables(editContent)}
                          </Text>
                          <View style={styles.saveRow}>
                            <TouchableOpacity
                              style={styles.saveBtn}
                              onPress={handleSaveBlock}
                              accessibilityRole="button">
                              <Text style={styles.saveBtnText}>Save</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={styles.cancelBtn}
                              onPress={() => setEditingBlockId(null)}
                              accessibilityRole="button">
                              <Text style={styles.cancelBtnText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <Text style={styles.blockContent} numberOfLines={2}>
                          {injectVariables(block.content)}
                        </Text>
                      )}
                    </View>
                  ))}

                {/* Custom CSS */}
                <Text style={styles.sectionTitle}>Custom CSS</Text>
                <TextInput
                  style={[styles.blockInput, styles.cssInput]}
                  value={customCss || activeTemplate.customCss || ''}
                  onChangeText={setCustomCss}
                  placeholder="/* e.g. body { font-family: Arial; } */"
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  accessibilityLabel="Custom CSS injection"
                />
                <TouchableOpacity
                  style={styles.saveBtn}
                  onPress={() => updateCustomCss(activeTemplate.id, customCss)}
                  accessibilityRole="button"
                  accessibilityLabel="Save custom CSS">
                  <Text style={styles.saveBtnText}>Apply CSS</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.publishBtn}
                  onPress={handlePublish}
                  accessibilityRole="button"
                  accessibilityLabel="Publish template">
                  <Text style={styles.publishBtnText}>🚀 Publish Template</Text>
                </TouchableOpacity>
              </>
            )}

            {/* HTML Preview */}
            {activeTab === 'preview' && (
              <>
                <Text style={styles.sectionTitle}>Rendered Preview</Text>
                <View style={styles.previewBox}>
                  <Text style={styles.previewHtml} selectable>
                    {previewHtml}
                  </Text>
                </View>
              </>
            )}

            {/* A/B Test config */}
            {activeTab === 'abtest' && (
              <>
                <Text style={styles.sectionTitle}>A/B Test Configuration</Text>
                <View style={styles.card}>
                  <View style={styles.rowSpaceBetween}>
                    <Text style={styles.label}>Enable A/B test</Text>
                    <Switch
                      value={activeTemplate.abTest?.enabled ?? false}
                      onValueChange={(val) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        useEmailTemplateStore.getState().updateABTest(activeTemplate.id, {
                          enabled: val,
                          variantA: activeTemplate.abTest?.variantA ?? {
                            subject: activeTemplate.locales[0]?.subject ?? '',
                            sendTimeHour: 9,
                          },
                          variantB: activeTemplate.abTest?.variantB ?? {
                            subject: activeTemplate.locales[0]?.subject ?? ' ✨',
                            sendTimeHour: 14,
                          },
                          splitPercent: activeTemplate.abTest?.splitPercent ?? 50,
                        });
                      }}
                      accessibilityRole="switch"
                      accessibilityLabel="Enable A/B test"
                      accessibilityState={{ checked: activeTemplate.abTest?.enabled ?? false }}
                    />
                  </View>
                  {activeTemplate.abTest?.enabled && (
                    <>
                      <Text style={styles.desc}>
                        Variant A subject: {activeTemplate.abTest.variantA.subject}
                      </Text>
                      <Text style={styles.desc}>
                        Variant B subject: {activeTemplate.abTest.variantB.subject}
                      </Text>
                      <Text style={styles.desc}>
                        Split: {activeTemplate.abTest.splitPercent}% → A,{' '}
                        {100 - activeTemplate.abTest.splitPercent}% → B
                      </Text>
                      <Text style={styles.desc}>
                        Send time A: {activeTemplate.abTest.variantA.sendTimeHour}:00 UTC
                      </Text>
                      <Text style={styles.desc}>
                        Send time B: {activeTemplate.abTest.variantB.sendTimeHour}:00 UTC
                      </Text>
                    </>
                  )}
                </View>
              </>
            )}

            {/* Version history */}
            {activeTab === 'versions' && (
              <>
                <Text style={styles.sectionTitle}>Version History</Text>
                {versions.length === 0 ? (
                  <Text style={styles.emptyText}>No versions saved yet.</Text>
                ) : (
                  [...versions].reverse().map((v) => (
                    <View key={v.version} style={styles.versionRow}>
                      <View style={styles.rowText}>
                        <Text style={styles.label}>v{v.version}</Text>
                        <Text style={styles.desc}>
                          Saved {new Date(v.savedAt).toLocaleString()} by {v.savedBy}
                        </Text>
                      </View>
                      {v.version !== activeTemplate.version && (
                        <TouchableOpacity
                          style={styles.rollbackBtn}
                          onPress={() => {
                            Alert.alert(
                              'Rollback',
                              `Restore to v${v.version}? Current changes will be saved as a new version.`,
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Rollback',
                                  onPress: () => rollbackTemplate(activeTemplate.id, v.version),
                                },
                              ]
                            );
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Rollback to version ${v.version}`}>
                          <Text style={styles.rollbackBtnText}>Restore</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
};

function createStyles(colors: ReturnType<typeof useThemeColors>) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background.primary },
    templateBar: { maxHeight: 64, paddingHorizontal: 8, paddingVertical: 8 },
    templateChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border.default,
      marginRight: 8,
      alignItems: 'center',
    },
    templateChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    templateChipText: { fontSize: 13, color: colors.text.primary, fontWeight: '600' },
    templateChipTextActive: { color: colors.onPrimary },
    templateStatus: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
    addTemplateBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.primary,
      justifyContent: 'center',
    },
    addTemplateBtnText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
    createRow: { flexDirection: 'row', padding: 8, gap: 8 },
    createInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: 8,
      padding: 8,
      color: colors.text.primary,
      backgroundColor: colors.background.card,
    },
    createBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      borderRadius: 8,
      justifyContent: 'center',
    },
    createBtnText: { color: colors.onPrimary, fontWeight: '600' },
    tabBar: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
    tabActive: { borderBottomWidth: 2, borderBottomColor: colors.primary },
    tabText: { fontSize: 13, color: colors.textSecondary },
    tabTextActive: { color: colors.primary, fontWeight: '600' },
    content: { flex: 1 },
    contentPad: { padding: 16, paddingBottom: 40 },
    emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 40 },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text.primary,
      marginBottom: 12,
      marginTop: 8,
    },
    blockCard: {
      backgroundColor: colors.background.card,
      borderRadius: 10,
      padding: 12,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    blockHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    blockType: { fontSize: 13, fontWeight: '600', color: colors.text.primary },
    blockActions: { flexDirection: 'row', gap: 8 },
    iconBtn: { padding: 4 },
    editBtn: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 6,
      backgroundColor: colors.primary + '22',
    },
    editBtnText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
    blockContent: { fontSize: 13, color: colors.textSecondary },
    blockInput: {
      borderWidth: 1,
      borderColor: colors.border.default,
      borderRadius: 8,
      padding: 10,
      color: colors.text.primary,
      backgroundColor: colors.background.card,
      minHeight: 60,
    },
    cssInput: { minHeight: 80, fontFamily: 'monospace', fontSize: 12 },
    variableHint: { fontSize: 11, color: colors.textSecondary, marginTop: 6, lineHeight: 16 },
    previewText: { fontSize: 12, color: colors.primary, marginTop: 4, fontStyle: 'italic' },
    saveRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
    saveBtn: {
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
      alignItems: 'center',
    },
    saveBtnText: { color: colors.onPrimary, fontWeight: '600' },
    cancelBtn: {
      borderWidth: 1,
      borderColor: colors.border.default,
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 8,
    },
    cancelBtnText: { color: colors.textSecondary },
    publishBtn: {
      backgroundColor: '#22c55e',
      padding: 14,
      borderRadius: 10,
      alignItems: 'center',
      marginTop: 20,
    },
    publishBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    previewBox: {
      backgroundColor: colors.background.card,
      borderRadius: 10,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    previewHtml: { fontSize: 11, color: colors.text.primary, fontFamily: 'monospace' },
    card: {
      backgroundColor: colors.background.card,
      borderRadius: 10,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border.default,
    },
    rowSpaceBetween: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    label: { fontSize: 15, fontWeight: '600', color: colors.text.primary },
    desc: { fontSize: 13, color: colors.textSecondary, marginTop: 6 },
    rowText: { flex: 1 },
    versionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border.default,
    },
    rollbackBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    rollbackBtnText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  });
}

export default EmailTemplateEditorScreen;
