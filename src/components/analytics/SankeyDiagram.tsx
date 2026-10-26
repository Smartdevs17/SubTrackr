import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';
import { spacing } from '../../utils/constants';
import { useThemeColors } from '../../hooks/useThemeColors';
import type { PlanMigrationFlow } from '../../types/cohortAnalytics';

const { width: screenWidth } = Dimensions.get('window');
const CHART_WIDTH = screenWidth - spacing.xl * 2 - spacing.lg * 2;
const CHART_HEIGHT = 220;
const NODE_WIDTH = 14;

interface Node {
  id: string;
  total: number;
  y: number;
  height: number;
}

function layoutColumn(
  ids: string[],
  totals: Map<string, number>,
  height: number
): Map<string, Node> {
  const grandTotal = ids.reduce((sum, id) => sum + (totals.get(id) ?? 0), 0) || 1;
  const gap = 6;
  const usableHeight = height - gap * Math.max(0, ids.length - 1);
  let cursor = 0;
  const nodes = new Map<string, Node>();
  for (const id of ids) {
    const total = totals.get(id) ?? 0;
    const nodeHeight = Math.max(8, (total / grandTotal) * usableHeight);
    nodes.set(id, { id, total, y: cursor, height: nodeHeight });
    cursor += nodeHeight + gap;
  }
  return nodes;
}

/** Simplified Sankey diagram for plan upgrade/downgrade/lateral migration flows. */
export const SankeyDiagram: React.FC<{ flows: PlanMigrationFlow[] }> = ({ flows }) => {
  const colors = useThemeColors();

  const { fromNodes, toNodes } = useMemo(() => {
    const fromTotals = new Map<string, number>();
    const toTotals = new Map<string, number>();
    for (const flow of flows) {
      fromTotals.set(flow.fromPlanId, (fromTotals.get(flow.fromPlanId) ?? 0) + flow.count);
      toTotals.set(flow.toPlanId, (toTotals.get(flow.toPlanId) ?? 0) + flow.count);
    }
    return {
      fromNodes: layoutColumn(Array.from(fromTotals.keys()), fromTotals, CHART_HEIGHT - 20),
      toNodes: layoutColumn(Array.from(toTotals.keys()), toTotals, CHART_HEIGHT - 20),
    };
  }, [flows]);

  if (flows.length === 0) {
    return (
      <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
        No plan changes recorded for this period yet.
      </Text>
    );
  }

  const leftX = NODE_WIDTH;
  const rightX = CHART_WIDTH - NODE_WIDTH;
  const flowColor = (direction: PlanMigrationFlow['direction']): string =>
    direction === 'upgrade'
      ? colors.status.success
      : direction === 'downgrade'
        ? colors.status.error
        : colors.textSecondary;

  // Track running offsets within each node so multiple flows sharing a node stack instead of overlapping.
  const fromCursor = new Map<string, number>();
  const toCursor = new Map<string, number>();

  return (
    <View>
      <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
        {flows.map((flow, index) => {
          const fromNode = fromNodes.get(flow.fromPlanId);
          const toNode = toNodes.get(flow.toPlanId);
          if (!fromNode || !toNode) return null;

          const fromTotal = fromNode.total || 1;
          const toTotal = toNode.total || 1;
          const fromOffset = fromCursor.get(flow.fromPlanId) ?? 0;
          const toOffset = toCursor.get(flow.toPlanId) ?? 0;
          const bandHeightFrom = (flow.count / fromTotal) * fromNode.height;
          const bandHeightTo = (flow.count / toTotal) * toNode.height;
          fromCursor.set(flow.fromPlanId, fromOffset + bandHeightFrom);
          toCursor.set(flow.toPlanId, toOffset + bandHeightTo);

          const y0 = 10 + fromNode.y + fromOffset + bandHeightFrom / 2;
          const y1 = 10 + toNode.y + toOffset + bandHeightTo / 2;
          const path = `M ${leftX} ${y0} C ${CHART_WIDTH / 2} ${y0}, ${CHART_WIDTH / 2} ${y1}, ${rightX} ${y1}`;

          return (
            <Path
              key={`${flow.fromPlanId}-${flow.toPlanId}-${index}`}
              d={path}
              stroke={flowColor(flow.direction)}
              strokeWidth={Math.max(2, Math.min(bandHeightFrom, bandHeightTo))}
              fill="none"
              opacity={0.6}
            />
          );
        })}

        {Array.from(fromNodes.values()).map((node) => (
          <React.Fragment key={`from-${node.id}`}>
            <Rect
              x={0}
              y={10 + node.y}
              width={NODE_WIDTH}
              height={node.height}
              fill={colors.brand.primary}
              rx={2}
            />
            <SvgText
              x={NODE_WIDTH + 4}
              y={10 + node.y + node.height / 2 + 3}
              fontSize={9}
              fill={colors.text.primary}>
              {node.id}
            </SvgText>
          </React.Fragment>
        ))}

        {Array.from(toNodes.values()).map((node) => (
          <React.Fragment key={`to-${node.id}`}>
            <Rect
              x={rightX}
              y={10 + node.y}
              width={NODE_WIDTH}
              height={node.height}
              fill={colors.brand.secondary}
              rx={2}
            />
            <SvgText
              x={rightX - 4}
              y={10 + node.y + node.height / 2 + 3}
              fontSize={9}
              fill={colors.text.primary}
              textAnchor="end">
              {node.id}
            </SvgText>
          </React.Fragment>
        ))}
      </Svg>
      <View style={styles.legendRow}>
        <Text style={[styles.legendItem, { color: colors.status.success }]}>● Upgrade</Text>
        <Text style={[styles.legendItem, { color: colors.status.error }]}>● Downgrade</Text>
        <Text style={[styles.legendItem, { color: colors.textSecondary }]}>● Lateral</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  emptyText: { textAlign: 'center', paddingVertical: spacing.md, fontSize: 13 },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  legendItem: { fontSize: 11 },
});

export default SankeyDiagram;
