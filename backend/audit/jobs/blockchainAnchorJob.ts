import { BlockchainAnchor } from '../domain/BlockchainAnchor';
import { HashChainService } from '../domain/HashChainService';

export class BlockchainAnchorJob {
  private anchor: BlockchainAnchor;
  private chain: HashChainService;
  private anchorStellar: (headHash: string) => Promise<string>;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    anchor: BlockchainAnchor,
    chain: HashChainService,
    anchorStellar: (headHash: string) => Promise<string>,
  ) {
    this.anchor = anchor;
    this.chain = chain;
    this.anchorStellar = anchorStellar;
  }

  start(intervalMs: number = 86_400_000): void {
    if (this.timer) return;
    void this.tryAnchor();
    this.timer = setInterval(() => void this.tryAnchor(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tryAnchor(): Promise<void> {
    if (!this.anchor.shouldAnchor()) return;

    try {
      const head = this.chain.getChainHead();
      if (!head) return;
      const stellarTxHash = await this.anchorStellar(head.hash);
      await this.anchor.anchor(head.hash, stellarTxHash);
      console.info(
        `[BlockchainAnchorJob] Anchored chain head ${head.hash.slice(0, 16)}... to Stellar tx ${stellarTxHash}`,
      );
    } catch (err) {
      console.error('[BlockchainAnchorJob] Anchoring failed:', err);
    }
  }
}
