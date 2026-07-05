/**
 * ConflictResolutionScreen
 *
 * Displays a diff for each CRDT conflict that could not be automatically
 * resolved (concurrent writes on the same scalar field with ambiguous
 * causality).  The user picks which value to keep; the choice is fed back
 * to the CRDT service which re-queues a definitive write.
 *
 * Shown automatically when useCRDTSyncStore().conflicts is non-empty.
 */

import React, { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CRDTConflict } from '../../../../shared/types/crdt';
import { useCRDTSyncStore } from '../stores/crdtSyncStore';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '(empty)';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

// ── Single conflict diff card ─────────────────────────────────────────────────

interface ConflictCardProps {
  conflict: CRDTConflict;
  mutationId: string;
  onResolve: (mutationId: string, value: unknown) => void;
}

const ConflictCard: React.FC<ConflictCardProps> = ({ conflict, mutationId, onResolve }) => {
  const [selected, setSelected] = useState<'local' | 'remote' | null>(null);

  const handleConfirm = () => {
    if (!selected) return;
    const value = selected === 'local' ? conflict.localValue : conflict.remoteValue;
    onResolve(mutationId, value);
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.entityLabel}>
          {conflict.entityId} · <Text style={styles.fieldLabel}>{conflict.field}</Text>
        </Text>
        <View style={styles.autoResolveBadge}>
          <Text style={styles.autoResolveBadgeText}>
            Auto-resolved: {formatValue(conflict.resolvedValue)}
          </Text>
        </View>
      </View>

      <Text style={styles.instruction}>
        Two concurrent edits occurred. Choose which value to keep:
      </Text>

      {/* Local value */}
      <TouchableOpacity
        style={[styles.option, selected === 'local' && styles.optionSelected]}
        onPress={() => setSelected('local')}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === 'local' }}
        accessibilityLabel={`Keep local value: ${formatValue(conflict.localValue)}`}>
        <View style={styles.optionHeader}>
          <Text style={styles.optionTitle}>Local (this device)</Text>
          <Text style={styles.optionTimestamp}>{formatTimestamp(conflict.localTimestamp)}</Text>
        </View>
        <Text style={styles.optionValue}>{formatValue(conflict.localValue)}</Text>
      </TouchableOpacity>

      {/* Remote value */}
      <TouchableOpacity
        style={[styles.option, selected === 'remote' && styles.optionSelected]}
        onPress={() => setSelected('remote')}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected === 'remote' }}
        accessibilityLabel={`Keep remote value: ${formatValue(conflict.remoteValue)}`}>
        <View style={styles.optionHeader}>
          <Text style={styles.optionTitle}>Remote (server / other device)</Text>
          <Text style={styles.optionTimestamp}>{formatTimestamp(conflict.remoteTimestamp)}</Text>
        </View>
        <Text style={styles.optionValue}>{formatValue(conflict.remoteValue)}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.confirmButton, !selected && styles.confirmButtonDisabled]}
        disabled={!selected}
        onPress={handleConfirm}
        accessibilityRole="button"
        accessibilityLabel="Confirm resolution">
        <Text style={styles.confirmButtonText}>Confirm</Text>
      </TouchableOpacity>
    </View>
  );
};

// ── Screen ────────────────────────────────────────────────────────────────────

const ConflictResolutionScreen: React.FC = () => {
  const { conflicts, mutations, resolveConflict } = useCRDTSyncStore();

  if (conflicts.length === 0) {
    return (
      <SafeAreaView style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No conflicts to resolve.</Text>
      </SafeAreaView>
    );
  }

  // Map conflict.entityId → mutationId for resolution routing
  const conflictedMutations = mutations.filter((m) => m.status === 'conflict');

  const getMutationId = (conflict: CRDTConflict): string => {
    return (
      conflictedMutations.find((m) => m.entityId === conflict.entityId)?.id ??
      conflict.entityId
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Sync Conflicts</Text>
        <Text style={styles.subtitle}>
          {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''} need your input. These
          arose from concurrent offline edits that could not be merged automatically.
        </Text>

        {conflicts.map((conflict, idx) => (
          <ConflictCard
            key={`${conflict.entityId}-${conflict.field}-${idx}`}
            conflict={conflict}
            mutationId={getMutationId(conflict)}
            onResolve={resolveConflict}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
  },
  emptyText: {
    color: '#8E8E93',
    fontSize: 15,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
    lineHeight: 20,
  },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  cardHeader: {
    gap: 6,
  },
  entityLabel: {
    fontSize: 13,
    color: '#8E8E93',
    fontFamily: 'monospace',
  },
  fieldLabel: {
    color: '#0A84FF',
    fontWeight: '600',
  },
  autoResolveBadge: {
    backgroundColor: '#2C2C2E',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  autoResolveBadgeText: {
    fontSize: 11,
    color: '#8E8E93',
  },
  instruction: {
    fontSize: 14,
    color: '#EBEBF5',
    lineHeight: 20,
  },
  option: {
    borderWidth: 1.5,
    borderColor: '#2C2C2E',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  optionSelected: {
    borderColor: '#0A84FF',
    backgroundColor: 'rgba(10,132,255,0.08)',
  },
  optionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  optionTimestamp: {
    fontSize: 11,
    color: '#8E8E93',
  },
  optionValue: {
    fontSize: 14,
    color: '#EBEBF5',
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  confirmButton: {
    backgroundColor: '#0A84FF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    backgroundColor: '#2C2C2E',
  },
  confirmButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default ConflictResolutionScreen;
