import { HashChainService } from './HashChainService';

export interface AnchorRecord {
  chainHeadHash: string;
  chainLength: number;
  stellarTxHash: string;
  anchoredAt: number;
}

const ANCHOR_INTERVAL_ENTRIES = 1000;
const ANCHOR_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class BlockchainAnchor {
  private anchors: AnchorRecord[] = [];
  private chain: HashChainService;
  private anchorIntervalEntries: number;
  private anchorIntervalMs: number;

  constructor(
    chain: HashChainService,
    opts?: { anchorIntervalEntries?: number; anchorIntervalMs?: number },
  ) {
    this.chain = chain;
    this.anchorIntervalEntries = opts?.anchorIntervalEntries ?? ANCHOR_INTERVAL_ENTRIES;
    this.anchorIntervalMs = opts?.anchorIntervalMs ?? ANCHOR_INTERVAL_MS;
  }

  shouldAnchor(): boolean {
    if (this.anchors.length === 0) return this.chain.getChainLength() > 0;
    const last = this.anchors[this.anchors.length - 1];
    const elapsed = Date.now() - last.anchoredAt;
    const entriesSinceAnchor = this.chain.getChainLength() - last.chainLength;
    return elapsed >= this.anchorIntervalMs || entriesSinceAnchor >= this.anchorIntervalEntries;
  }

  async anchor(headHash: string, stellarTxHash: string): Promise<AnchorRecord> {
    const record: AnchorRecord = {
      chainHeadHash: headHash,
      chainLength: this.chain.getChainLength(),
      stellarTxHash,
      anchoredAt: Date.now(),
    };
    this.anchors.push(record);
    return record;
  }

  getAnchors(): readonly AnchorRecord[] {
    return this.anchors;
  }

  getLastAnchor(): AnchorRecord | null {
    return this.anchors.length > 0 ? this.anchors[this.anchors.length - 1] : null;
  }

  getAnchorCount(): number {
    return this.anchors.length;
  }
}
