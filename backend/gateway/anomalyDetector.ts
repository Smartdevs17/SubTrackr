/**
 * Anomaly detector: feature extraction + Isolation Forest scoring (#615).
 *
 * Learns normal API usage from windows of historical requests and scores a new
 * window's anomaly level. Stateless w.r.t. requests beyond the fitted model, so
 * it's easy to retrain (see ml-service for the production training job).
 */

import {
  extractFeatures,
  toVector,
  type FeatureBreakdown,
  type RequestSample,
} from "./featureExtraction";
import { IsolationForest, type IsolationForestOptions } from "./isolationForest";

export interface AnomalyResult {
  score: number; // [0,1], higher = more anomalous
  features: FeatureBreakdown;
}

export class AnomalyDetector {
  private forest: IsolationForest;
  private fitted = false;

  constructor(options: IsolationForestOptions = {}) {
    this.forest = new IsolationForest(options);
  }

  /** Train on windows representing normal traffic (one vector per window). */
  fit(normalWindows: RequestSample[][]): this {
    const vectors = normalWindows.map((w) => toVector(extractFeatures(w)));
    this.forest.fit(vectors);
    this.fitted = true;
    return this;
  }

  isFitted(): boolean {
    return this.fitted;
  }

  /** Score a window of recent requests for a key/user. */
  scoreWindow(window: RequestSample[]): AnomalyResult {
    const features = extractFeatures(window);
    return { score: this.forest.score(toVector(features)), features };
  }
}
