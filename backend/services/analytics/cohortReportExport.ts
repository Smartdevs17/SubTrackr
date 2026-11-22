/**
 * Cohort report export — CSV and PDF, with zero added dependencies.
 *
 * The PDF writer emits a minimal-but-valid single-page PDF (catalog, pages,
 * page, Helvetica font, one content stream, xref + trailer) by hand. There is
 * no native PDF rendering dependency in this project, so this avoids pulling
 * one in just for a tabular export.
 */

import type { CohortBucket, ChurnBreakdown, LtvSourceBreakdown } from '../../../src/types/cohortAnalytics';

const escapeCsvCell = (value: string | number | boolean): string => {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

export function cohortTableToCsv(buckets: CohortBucket[]): string {
  const header = ['cohort', 'granularity', 'size', 'activeCount', 'retentionRate', 'startingMrr', 'currentMrr', 'isEmpty'];
  const rows = buckets.map((bucket) => [
    bucket.cohortKey,
    bucket.granularity,
    bucket.size,
    bucket.activeCount,
    bucket.retentionRate.toFixed(4),
    bucket.startingMrr.toFixed(2),
    bucket.currentMrr.toFixed(2),
    bucket.isEmpty,
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

export function ltvBreakdownToCsv(breakdown: LtvSourceBreakdown[]): string {
  const header = ['acquisitionChannel', 'subscriberCount', 'avgLifetimeMonths', 'avgMonthlyRevenue', 'ltv'];
  const rows = breakdown.map((row) => [
    row.acquisitionChannel,
    row.subscriberCount,
    row.avgLifetimeMonths.toFixed(2),
    row.avgMonthlyRevenue.toFixed(2),
    row.ltv.toFixed(2),
  ]);
  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Builds a minimal valid single-page PDF from plain text lines (no dependencies). */
export function buildSimplePdf(lines: string[]): Buffer {
  const fontSize = 11;
  const leading = 14;
  const marginTop = 760;
  const escaped = lines.map(escapePdfText);

  const streamBody = [
    'BT',
    `/F1 ${fontSize} Tf`,
    `${leading} TL`,
    `50 ${marginTop} Td`,
    ...escaped.flatMap((line, index) => (index === 0 ? [`(${line}) Tj`] : ['T*', `(${line}) Tj`])),
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(streamBody, 'latin1')} >>\nstream\n${streamBody}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

export function cohortTableToPdf(buckets: CohortBucket[], title = 'Cohort Retention Report'): Buffer {
  const lines = [
    title,
    `Generated ${new Date().toISOString()}`,
    '',
    'Cohort       Size  Active  Retention  Starting MRR  Current MRR',
    ...buckets.map(
      (bucket) =>
        `${bucket.cohortKey.padEnd(12)} ${String(bucket.size).padStart(4)}  ${String(bucket.activeCount).padStart(6)}  ${(bucket.retentionRate * 100).toFixed(1).padStart(8)}%  ${bucket.startingMrr.toFixed(2).padStart(12)}  ${bucket.currentMrr.toFixed(2).padStart(11)}`
    ),
  ];
  if (buckets.length === 0) lines.push('(no cohort data for this period)');
  return buildSimplePdf(lines);
}

export function churnBreakdownToPdf(breakdown: ChurnBreakdown, title = 'Revenue vs. Logo Churn'): Buffer {
  const lines = [
    title,
    `Generated ${new Date().toISOString()}`,
    '',
    `Period: ${new Date(breakdown.periodStart).toISOString().slice(0, 10)} to ${new Date(breakdown.periodEnd).toISOString().slice(0, 10)}`,
    `Starting subscribers: ${breakdown.startingSubscribers}`,
    `Churned subscribers: ${breakdown.churnedSubscribers}`,
    `Logo churn rate: ${(breakdown.logoChurnRate * 100).toFixed(2)}%`,
    `Starting MRR: ${breakdown.startingMrr.toFixed(2)}`,
    `Churned MRR: ${breakdown.churnedMrr.toFixed(2)}`,
    `Revenue churn rate: ${(breakdown.revenueChurnRate * 100).toFixed(2)}%`,
  ];
  if (breakdown.isEmpty) lines.push('', '(no subscribers active at the start of this period)');
  return buildSimplePdf(lines);
}
