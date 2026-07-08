import GeneratorWorker from './generator.worker?worker';

// ---------------------------------------------------------------------------
// Pool of terrain-generation workers. Round-robins requests and resolves the
// promise for each chunk when its worker responds.
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (r: { blocks: Uint8Array; nonEmpty: boolean }) => void;
}

export class GeneratorPool {
  private workers: Worker[] = [];
  private pending = new Map<string, Pending>();
  private next = 0;

  constructor(seed: number, count = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1))) {
    for (let i = 0; i < count; i++) {
      const w = new GeneratorWorker();
      w.postMessage({ type: 'init', seed });
      w.onmessage = (e: MessageEvent) => this.onMessage(e);
      this.workers.push(w);
    }
  }

  private key(cx: number, cz: number): string {
    return cx + ',' + cz;
  }

  private onMessage(e: MessageEvent): void {
    const { cx, cz, blocks, nonEmpty } = e.data;
    const k = this.key(cx, cz);
    const p = this.pending.get(k);
    if (p) {
      this.pending.delete(k);
      p.resolve({ blocks: new Uint8Array(blocks), nonEmpty });
    }
  }

  generate(cx: number, cz: number): Promise<{ blocks: Uint8Array; nonEmpty: boolean }> {
    const k = this.key(cx, cz);
    const existing = this.pending.get(k);
    if (existing) {
      return new Promise((resolve) => { existing.resolve = resolve; });
    }
    return new Promise((resolve) => {
      this.pending.set(k, { resolve });
      const w = this.workers[this.next];
      this.next = (this.next + 1) % this.workers.length;
      w.postMessage({ type: 'gen', cx, cz });
    });
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
    this.pending.clear();
  }
}
