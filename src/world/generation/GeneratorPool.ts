import GeneratorWorker from './generator.worker?worker&inline';
import { TerrainGenerator } from './TerrainGenerator';

// ---------------------------------------------------------------------------
// Pool of terrain-generation workers with a robust main-thread fallback.
// If workers can't be created, error out, or never respond (e.g. some browsers
// block blob/module workers on file://), generation transparently falls back to
// the main thread so the game always loads.
// ---------------------------------------------------------------------------

interface Pending {
  resolve: (r: { blocks: Uint8Array; nonEmpty: boolean }) => void;
}

export class GeneratorPool {
  private workers: Worker[] = [];
  private pending = new Map<string, Pending>();
  private next = 0;
  private seed: number;
  private useWorkers = false;
  private producedAny = false;
  private mainGen: TerrainGenerator | null = null;

  constructor(seed: number, count = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1))) {
    this.seed = seed >>> 0;
    try {
      for (let i = 0; i < count; i++) {
        const w = new GeneratorWorker();
        w.postMessage({ type: 'init', seed });
        w.onmessage = (e: MessageEvent) => this.onMessage(e);
        w.onerror = () => this.fallback();
        this.workers.push(w);
      }
      this.useWorkers = this.workers.length > 0;
    } catch {
      this.useWorkers = false;
    }

    if (!this.useWorkers) {
      this.enableMain();
    } else {
      // Watchdog: if no worker has produced a chunk shortly after startup,
      // assume workers are non-functional in this environment and fall back.
      setTimeout(() => {
        if (!this.producedAny && this.pending.size > 0) this.fallback();
      }, 1500);
    }
  }

  private enableMain(): void {
    if (!this.mainGen) this.mainGen = new TerrainGenerator(this.seed);
  }

  private fallback(): void {
    if (!this.useWorkers && this.mainGen) return; // already fallen back
    this.useWorkers = false;
    for (const w of this.workers) { try { w.terminate(); } catch { /* ignore */ } }
    this.workers.length = 0;
    this.enableMain();
    // Re-issue everything still pending on the main thread.
    for (const [key, p] of [...this.pending.entries()]) this.runMain(key, p);
  }

  private key(cx: number, cz: number): string {
    return cx + ',' + cz;
  }

  private onMessage(e: MessageEvent): void {
    this.producedAny = true;
    const { cx, cz, blocks, nonEmpty } = e.data;
    const k = this.key(cx, cz);
    const p = this.pending.get(k);
    if (p) {
      this.pending.delete(k);
      p.resolve({ blocks: new Uint8Array(blocks), nonEmpty });
    }
  }

  private runMain(key: string, p: Pending): void {
    const comma = key.indexOf(',');
    const cx = parseInt(key.slice(0, comma), 10);
    const cz = parseInt(key.slice(comma + 1), 10);
    // Defer so a burst of requests spreads across tasks instead of freezing.
    setTimeout(() => {
      if (!this.pending.has(key)) return;
      this.pending.delete(key);
      const r = this.mainGen!.generate(cx, cz);
      p.resolve({ blocks: r.blocks, nonEmpty: r.nonEmpty });
    }, 0);
  }

  generate(cx: number, cz: number): Promise<{ blocks: Uint8Array; nonEmpty: boolean }> {
    const k = this.key(cx, cz);
    const existing = this.pending.get(k);
    if (existing) {
      return new Promise((resolve) => { existing.resolve = resolve; });
    }
    return new Promise((resolve) => {
      const p: Pending = { resolve };
      this.pending.set(k, p);
      if (this.useWorkers) {
        const w = this.workers[this.next];
        this.next = (this.next + 1) % this.workers.length;
        w.postMessage({ type: 'gen', cx, cz });
      } else {
        this.runMain(k, p);
      }
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
