import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../components/common/Button';
import { Card } from '../components/common/Card';
import { ListScreen } from '../components/common/ScreenTemplates';
import { useEntityStore } from '../store/entityStore';
import { Entity, EntityRole, EntityStatus } from '../types/entity';
import { colors, spacing, typography } from '../utils/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusColor = (status: EntityStatus): string => {
  switch (status) {
    case EntityStatus.ACTIVE:
      return colors.success;
    case EntityStatus.INACTIVE:
      return colors.warning;
    case EntityStatus.ACQUIRED:
    case EntityStatus.DIVESTED:
      return colors.textSecondary;
    default:
      return colors.textSecondary;
  }
};

const roleBadge = (role: EntityRole): string => {
  switch (role) {
    case EntityRole.GLOBAL_ADMIN:
      return 'Global Admin';
    case EntityRole.ENTITY_ADMIN:
      return 'Admin';
    default:
      return 'Viewer';
  }
};

// ---------------------------------------------------------------------------
// AddEntityModal – inline form (no external modal dependency)
// ---------------------------------------------------------------------------

interface AddEntityFormProps {
  parentId: string | null;
  existingCount: number;
  onAdd: (name: string, currency: string, parentId: string | null) => void;
  onCancel: () => void;
}

const AddEntityForm: React.FC<AddEntityFormProps> = ({
  parentId,
  existingCount,
  onAdd,
  onCancel,
}) => {
  const [name, setName] = useState(`Entity ${existingCount + 1}`);
  const [currency, setCurrency] = useState('USD');

  return (
    <Card style={styles.formCard}>
      <Text style={styles.formTitle}>{parentId ? 'Add Subsidiary' : 'Add Holding Entity'}</Text>
      <Text style={styles.label}>Display Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Acme Corp"
        placeholderTextColor={colors.textSecondary}
        accessibilityLabel="Entity name"
      />
      <Text style={styles.label}>Currency (ISO 4217)</Text>
      <TextInput
        style={styles.input}
        value={currency}
        onChangeText={setCurrency}
        placeholder="USD"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="characters"
        maxLength={3}
        accessibilityLabel="Currency code"
      />
      <View style={styles.formActions}>
        <Button title="Cancel" variant="outline" size="small" onPress={onCancel} />
        <Button
          title="Add"
          size="small"
          onPress={() => {
            if (!name.trim()) return;
            onAdd(name.trim(), currency.trim() || 'USD', parentId);
          }}
        />
      </View>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Entity card
// ---------------------------------------------------------------------------

interface EntityCardProps {
  entity: Entity;
  allEntities: Entity[];
  onAddChild: (parentId: string) => void;
  onRemove: (id: string) => void;
  onDivest: (id: string) => void;
}

const EntityCard: React.FC<EntityCardProps> = ({
  entity,
  allEntities,
  onAddChild,
  onRemove,
  onDivest,
}) => {
  const parent = entity.parentId ? allEntities.find((e) => e.id === entity.parentId) : null;
  const children = allEntities.filter((e) => entity.childIds.includes(e.id));

  return (
    <Card style={styles.card}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cardTitle} accessibilityRole="header">
            {entity.name}
          </Text>
          {entity.legalName ? <Text style={styles.meta}>Legal: {entity.legalName}</Text> : null}
        </View>
        <Text style={[styles.statusBadge, { color: statusColor(entity.status) }]}>
          {entity.status}
        </Text>
      </View>

      <Text style={styles.meta}>Currency: {entity.currency}</Text>
      {entity.taxJurisdiction ? (
        <Text style={styles.meta}>Jurisdiction: {entity.taxJurisdiction}</Text>
      ) : null}
      {parent ? <Text style={styles.meta}>Parent: {parent.name}</Text> : null}
      {children.length > 0 ? (
        <Text style={styles.meta}>Subsidiaries: {children.map((c) => c.name).join(', ')}</Text>
      ) : null}
      <Text style={styles.meta}>
        Billing: {entity.consolidatedBilling ? 'Consolidated (parent pays)' : 'Independent'}
      </Text>
      <Text style={styles.meta}>Members: {entity.members.length}</Text>
      {entity.members.length > 0 ? (
        <View style={styles.memberList}>
          {entity.members.map((m) => (
            <Text key={m.userId} style={styles.memberRow}>
              {m.email} — {roleBadge(m.role)}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          title="+ Subsidiary"
          size="small"
          variant="outline"
          onPress={() => onAddChild(entity.id)}
          accessibilityLabel={`Add subsidiary to ${entity.name}`}
        />
        {entity.parentId ? (
          <Button
            title="Divest"
            size="small"
            variant="outline"
            onPress={() => onDivest(entity.id)}
            accessibilityLabel={`Divest ${entity.name} from parent`}
          />
        ) : null}
        <Button
          title="Remove"
          size="small"
          variant="outline"
          onPress={() => onRemove(entity.id)}
          accessibilityLabel={`Remove entity ${entity.name}`}
        />
      </View>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const EntityManagementScreen: React.FC = () => {
  const { entities, addEntity, removeEntity, mergeEntities, divestitureEntity, error } =
    useEntityStore();

  const [addingForParent, setAddingForParent] = useState<string | null | undefined>(undefined);

  // Show only root-level entities at top, sorted by name
  const rootEntities = useMemo(
    () => [...entities.filter((e) => !e.parentId)].sort((a, b) => a.name.localeCompare(b.name)),
    [entities]
  );

  const handleAddRoot = () => setAddingForParent(null);

  const handleAddChild = (parentId: string) => setAddingForParent(parentId);

  const handleConfirmAdd = (name: string, currency: string, parentId: string | null) => {
    addEntity(name, currency, parentId);
    setAddingForParent(undefined);
  };

  const handleRemove = (id: string) => {
    const entity = entities.find((e) => e.id === id);
    if (!entity) return;
    Alert.alert('Remove Entity', `Remove "${entity.name}"? This action cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeEntity(id),
      },
    ]);
  };

  const handleDivest = (id: string) => {
    const entity = entities.find((e) => e.id === id);
    if (!entity) return;
    Alert.alert(
      'Divest Entity',
      `Detach "${entity.name}" from its parent? It will become a standalone entity.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Divest',
          style: 'destructive',
          onPress: () => {
            try {
              divestitureEntity(id);
            } catch (e) {
              Alert.alert('Error', (e as Error).message);
            }
          },
        },
      ]
    );
  };

  const handleMerge = () => {
    if (entities.length < 2) {
      Alert.alert('Merge', 'You need at least 2 entities to merge.');
      return;
    }
    // Show first two as an example; production UI would use a picker
    const [first, second] = entities;
    Alert.alert('Merge Entities (Acquisition)', `Merge "${second.name}" into "${first.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Merge',
        style: 'destructive',
        onPress: () => {
          try {
            mergeEntities(first.id, second.id);
          } catch (e) {
            Alert.alert('Error', (e as Error).message);
          }
        },
      },
    ]);
  };

  // Prepend the inline form as a list item when active
  const listData: (Entity | 'ADD_FORM')[] = useMemo(
    () => (addingForParent !== undefined ? ['ADD_FORM', ...rootEntities] : rootEntities),
    [addingForParent, rootEntities]
  );

  const renderItem = (item: Entity | 'ADD_FORM') => {
    if (item === 'ADD_FORM') {
      return (
        <AddEntityForm
          parentId={addingForParent ?? null}
          existingCount={entities.length}
          onAdd={handleConfirmAdd}
          onCancel={() => setAddingForParent(undefined)}
        />
      );
    }
    return (
      <EntityCard
        entity={item}
        allEntities={entities}
        onAddChild={handleAddChild}
        onRemove={handleRemove}
        onDivest={handleDivest}
      />
    );
  };

  return (
    <ListScreen
      title="Entities"
      subtitle="Holding companies and subsidiaries with consolidated billing"
      analyticsName="EntityManagement"
      data={listData}
      renderItem={renderItem}
      keyExtractor={(item) => (item === 'ADD_FORM' ? 'add-form' : item.id)}
      emptyTitle="No entities yet"
      emptyMessage="Add a holding entity to manage subsidiaries, consolidated invoicing, and cross-entity analytics."
      emptyActionText="Add entity"
      onEmptyAction={handleAddRoot}
      error={error}
      rightAction={
        <View style={styles.headerActions}>
          {entities.length >= 2 ? (
            <Button title="Merge" size="small" variant="outline" onPress={handleMerge} />
          ) : null}
          <Button title="+ Entity" size="small" onPress={handleAddRoot} />
        </View>
      }
      testID="entity-management-screen"
    />
  );
};

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  card: {
    marginBottom: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  cardTitle: {
    ...typography.h3,
    color: colors.text,
  },
  statusBadge: {
    ...typography.small,
    textTransform: 'capitalize',
    fontWeight: '600',
  },
  meta: {
    ...typography.body2,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  memberList: {
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  memberRow: {
    ...typography.small,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  formCard: {
    marginBottom: spacing.lg,
    borderColor: colors.primary,
    borderWidth: 1,
  },
  formTitle: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    marginBottom: spacing.md,
    ...typography.body,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});

export default EntityManagementScreen;
