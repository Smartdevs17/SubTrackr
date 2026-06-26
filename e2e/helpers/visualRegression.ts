import * as fs from 'fs';
import * as path from 'path';

/**
 * Tolerance-based visual regression.
 *
 * The previous implementation hashed the screenshot bytes (sha256) and required
 * an *exact* match. That is hopelessly brittle: a one-pixel anti-aliasing
 * difference between machines, OS versions, or GPU drivers flips the hash and
 * fails the test. Here we compare PNGs pixel-by-pixel with `pixelmatch` and pass
 * when the fraction of differing pixels is within a configurable tolerance.
 *
 * Defaults are env-overridable so the same baseline can be compared strictly in
 * one environment and loosely in another:
 *   - VISUAL_PIXEL_THRESHOLD: per-pixel color sensitivity (0..1, default 0.1)
 *   - VISUAL_MAX_DIFF_RATIO:  max fraction of differing pixels (0..1, default 0.01)
 */

interface BaselineMeta {
  width: number;
  height: number;
  /** Per-pixel color matching sensitivity (0 strict … 1 loose). */
  pixelThreshold: number;
  /** Max allowed fraction of mismatched pixels before the test fails. */
  maxDiffRatio: number;
}

type BaselineMap = Record<string, BaselineMeta>;

const fixturesDir = path.resolve(__dirname, '../fixtures');
const baselineImagesDir = path.join(fixturesDir, 'baselines');
const baselineMetaFile = path.join(fixturesDir, 'visual-baselines.json');
const diffOutputDir = path.resolve(__dirname, '../../artifacts/visual-diffs');

const num = (value: string | undefined, fallback: number): number => {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DEFAULT_PIXEL_THRESHOLD = num(process.env.VISUAL_PIXEL_THRESHOLD, 0.1);
const DEFAULT_MAX_DIFF_RATIO = num(process.env.VISUAL_MAX_DIFF_RATIO, 0.01);

const readMeta = (): BaselineMap => {
  if (!fs.existsSync(baselineMetaFile)) return {};
  const raw = fs.readFileSync(baselineMetaFile, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as BaselineMap;
};

const writeMeta = (meta: BaselineMap): void => {
  fs.mkdirSync(path.dirname(baselineMetaFile), { recursive: true });
  fs.writeFileSync(baselineMetaFile, `${JSON.stringify(meta, null, 2)}\n`);
};

// Lazy, optional deps. The suite still runs if they're not installed — it just
// records baselines and warns instead of doing a pixel comparison.
type PngModule = typeof import('pngjs').PNG;
let pngLib: PngModule | null = null;
let pixelmatchLib: ((...args: unknown[]) => number) | null = null;

const loadImagingLibs = (): boolean => {
  if (pngLib && pixelmatchLib) return true;
  try {
    /* eslint-disable @typescript-eslint/no-var-requires */
    pngLib = require('pngjs').PNG as PngModule;
    const pm = require('pixelmatch');
    pixelmatchLib = (pm.default ?? pm) as (...args: unknown[]) => number;
    /* eslint-enable @typescript-eslint/no-var-requires */
    return true;
  } catch {
    return false;
  }
};

export interface VisualSnapshotOptions {
  pixelThreshold?: number;
  maxDiffRatio?: number;
}

const baselinePathFor = (name: string): string => path.join(baselineImagesDir, `${name}.png`);

const saveBaseline = (
  name: string,
  screenshotPath: string,
  options: VisualSnapshotOptions
): void => {
  fs.mkdirSync(baselineImagesDir, { recursive: true });
  fs.copyFileSync(screenshotPath, baselinePathFor(name));

  let width = 0;
  let height = 0;
  if (loadImagingLibs() && pngLib) {
    const img = pngLib.sync.read(fs.readFileSync(screenshotPath));
    width = img.width;
    height = img.height;
  }

  const meta = readMeta();
  meta[name] = {
    width,
    height,
    pixelThreshold: options.pixelThreshold ?? DEFAULT_PIXEL_THRESHOLD,
    maxDiffRatio: options.maxDiffRatio ?? DEFAULT_MAX_DIFF_RATIO,
  };
  writeMeta(meta);
};

/**
 * Compare a screenshot against its stored baseline within tolerance.
 *
 * In update mode (`UPDATE_VISUAL_BASELINE=true`) or when no baseline exists yet,
 * the screenshot becomes the new baseline and the assertion is skipped.
 */
export const assertVisualSnapshot = (
  name: string,
  screenshotPath: string,
  options: VisualSnapshotOptions = {}
): void => {
  const updateBaselines = process.env.UPDATE_VISUAL_BASELINE === 'true';
  const baselinePath = baselinePathFor(name);

  if (updateBaselines || !fs.existsSync(baselinePath)) {
    saveBaseline(name, screenshotPath, options);
    return;
  }

  if (!loadImagingLibs() || !pngLib || !pixelmatchLib) {
    // eslint-disable-next-line no-console
    console.warn(
      `[visual] pixelmatch/pngjs not installed — skipping tolerance comparison for "${name}". ` +
        'Install devDependencies to enable visual regression.'
    );
    return;
  }

  const meta = readMeta()[name];
  const pixelThreshold = options.pixelThreshold ?? meta?.pixelThreshold ?? DEFAULT_PIXEL_THRESHOLD;
  const maxDiffRatio = options.maxDiffRatio ?? meta?.maxDiffRatio ?? DEFAULT_MAX_DIFF_RATIO;

  const baseline = pngLib.sync.read(fs.readFileSync(baselinePath));
  const current = pngLib.sync.read(fs.readFileSync(screenshotPath));

  if (baseline.width !== current.width || baseline.height !== current.height) {
    throw new Error(
      `[visual] "${name}" dimension mismatch: baseline ${baseline.width}x${baseline.height} ` +
        `vs current ${current.width}x${current.height}. Re-record the baseline if the layout changed.`
    );
  }

  const { width, height } = baseline;
  const diff = new pngLib({ width, height });
  const diffPixels = pixelmatchLib(baseline.data, current.data, diff.data, width, height, {
    threshold: pixelThreshold,
  });

  const totalPixels = width * height;
  const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels;

  if (diffRatio > maxDiffRatio) {
    fs.mkdirSync(diffOutputDir, { recursive: true });
    const diffPath = path.join(diffOutputDir, `${name}.diff.png`);
    fs.writeFileSync(diffPath, pngLib.sync.write(diff));
    throw new Error(
      `[visual] "${name}" exceeded tolerance: ${(diffRatio * 100).toFixed(3)}% of pixels ` +
        `differ (max ${(maxDiffRatio * 100).toFixed(3)}%). Diff written to ${diffPath}.`
    );
  }
};
