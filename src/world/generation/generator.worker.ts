import { TerrainGenerator } from './TerrainGenerator';

// ---------------------------------------------------------------------------
// Terrain generation worker. Holds a generator for the world seed and produces
// chunk block arrays on demand, transferring the buffer back to the main thread.
// ---------------------------------------------------------------------------

let gen: TerrainGenerator | null = null;

interface InitMsg { type: 'init'; seed: number; }
interface GenMsg { type: 'gen'; cx: number; cz: number; }
type InMsg = InitMsg | GenMsg;

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    gen = new TerrainGenerator(msg.seed);
    return;
  }
  if (msg.type === 'gen') {
    if (!gen) return;
    const { blocks, nonEmpty } = gen.generate(msg.cx, msg.cz);
    (self as unknown as Worker).postMessage(
      { type: 'gen', cx: msg.cx, cz: msg.cz, blocks: blocks.buffer, nonEmpty },
      [blocks.buffer],
    );
  }
};
