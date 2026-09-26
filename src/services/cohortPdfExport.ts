/**
 * Frontend-safe minimal PDF builder for the cohort report "Export PDF" action.
 *
 * Mirrors backend/services/analytics/cohortReportExport.ts's buildSimplePdf,
 * but works off plain JS string lengths instead of Node's Buffer (React
 * Native/Hermes has no Buffer global without a polyfill, and this project
 * doesn't ship one). Safe because every line we emit is plain ASCII, so
 * string length and byte length are identical.
 */

import type { CohortBucket } from '../types/cohortAnalytics';

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

export function buildSimplePdfText(lines: string[]): string {
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
    `<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

export function cohortTableToPdfText(
  buckets: CohortBucket[],
  title = 'Cohort Retention Report'
): string {
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
  return buildSimplePdfText(lines);
}
