/**
 * Dependency-free Isolation Forest for unsupervised anomaly scoring (#615).
 *
 * Anomalies are "few and different", so they isolate with shorter random
 * partition paths. We build an ensemble of random isolation trees and score a
 * point by its average path length, normalized to a [0, 1] anomaly score
 * (Liu, Ting & Zhou, 2008). Implemented without numpy/sklearn so it runs in the
 * Node backend with no extra dependencies; the Python ml-service mirrors it.
 */

export type FeatureVector = number[];

interface ITreeNode {
  // Internal node
  splitFeature?: number;
  splitValue?: number;
  left?: ITreeNode;
  right?: ITreeNode;
  // External (leaf) node
  size?: number;
}

/** Deterministic, seedable PRNG (mulberry32) so training/scoring is testable. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Average path length of an unsuccessful BST search over n points (c(n)). */
function cFactor(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  const H = Math.log(n - 1) + 0.5772156649; // harmonic number approximation
  return 2 * H - (2 * (n - 1)) / n;
}

function buildTree(
  data: FeatureVector[],
  heightLimit: number,
  rng: () => number,
  depth = 0,
): ITreeNode {
  if (depth >= heightLimit || data.length <= 1) {
    return { size: data.length };
  }
  const dims = data[0].length;
  const feature = Math.floor(rng() * dims);
  let min = Infinity;
  let max = -Infinity;
  for (const row of data) {
    if (row[feature] < min) min = row[feature];
    if (row[feature] > max) max = row[feature];
  }
  if (min === max) return { size: data.length };

  const splitValue = min + rng() * (max - min);
  const left: FeatureVector[] = [];
  const right: FeatureVector[] = [];
  for (const row of data) (row[feature] < splitValue ? left : right).push(row);

  return {
    splitFeature: feature,
    splitValue,
    left: buildTree(left, heightLimit, rng, depth + 1),
    right: buildTree(right, heightLimit, rng, depth + 1),
  };
}

function pathLength(point: FeatureVector, node: ITreeNode, depth = 0): number {
  if (node.size !== undefined) {
    return depth + cFactor(node.size);
  }
  const goLeft = point[node.splitFeature!] < node.splitValue!;
  return pathLength(point, goLeft ? node.left! : node.right!, depth + 1);
}

export interface IsolationForestOptions {
  trees?: number; // ensemble size
  sampleSize?: number; // subsample per tree
  seed?: number;
}

export class IsolationForest {
  private trees: ITreeNode[] = [];
  private normFactor = 1;
  private readonly opts: Required<IsolationForestOptions>;

  constructor(options: IsolationForestOptions = {}) {
    this.opts = {
      trees: options.trees ?? 100,
      sampleSize: options.sampleSize ?? 256,
      seed: options.seed ?? 42,
    };
  }

  fit(data: FeatureVector[]): this {
    if (data.length === 0) throw new Error("cannot fit on empty data");
    const rng = makeRng(this.opts.seed);
    const sampleSize = Math.min(this.opts.sampleSize, data.length);
    const heightLimit = Math.ceil(Math.log2(Math.max(2, sampleSize)));
    this.normFactor = cFactor(sampleSize);
    this.trees = [];
    for (let i = 0; i < this.opts.trees; i++) {
      const sample: FeatureVector[] = [];
      for (let s = 0; s < sampleSize; s++) {
        sample.push(data[Math.floor(rng() * data.length)]);
      }
      this.trees.push(buildTree(sample, heightLimit, rng));
    }
    return this;
  }

  /** Anomaly score in [0, 1]; higher = more anomalous (≈0.5 is borderline). */
  score(point: FeatureVector): number {
    if (this.trees.length === 0) throw new Error("forest not fitted");
    let total = 0;
    for (const tree of this.trees) total += pathLength(point, tree);
    const avg = total / this.trees.length;
    return Math.pow(2, -avg / (this.normFactor || 1));
  }
}
