import { chunkKey, localIndex, type Chunk } from '../world/Chunk';
import { CHUNK_SIZE_BITS, CHUNK_SIZE_MASK } from '../core/constants';

// ---------------------------------------------------------------------------
// Local persistence via IndexedDB. Stores world meta (seed, player, inventory,
// survival, time) plus a compact set of player block edits that are re-applied
// on top of freshly generated terrain so worlds reload exactly.
// ---------------------------------------------------------------------------

export interface SaveMeta {
  seed: number;
  version: number;
  time: number;
  player: { x: number; y: number; z: number; yaw: number; pitch: number };
  survival: { health: number; hunger: number; saturation: number; air: number };
  inventory: unknown;
  selected: number;
  creative: boolean;
}

const DB_NAME = 'voxelcraft';
const STORE = 'worlds';
const WORLD_ID = 'default';

export class SaveManager {
  private db: IDBDatabase | null = null;
  /** chunkKey → (localIndex → blockId). */
  private edits = new Map<number, Map<number, number>>();
  private dirty = false;

  async open(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore {
    return this.db!.transaction(STORE, mode).objectStore(STORE);
  }

  /** Load a saved world; returns null if none exists. */
  async load(): Promise<{ meta: SaveMeta } | null> {
    if (!this.db) return null;
    const record = await new Promise<any>((resolve) => {
      const req = this.tx('readonly').get(WORLD_ID);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!record) return null;
    this.edits.clear();
    if (Array.isArray(record.edits)) {
      for (const [ck, list] of record.edits as [number, [number, number][]][]) {
        const m = new Map<number, number>();
        for (const [idx, id] of list) m.set(idx, id);
        this.edits.set(ck, m);
      }
    }
    return { meta: record.meta as SaveMeta };
  }

  hasSave(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.db) return resolve(false);
      const req = this.tx('readonly').getKey(WORLD_ID);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => resolve(false);
    });
  }

  /** Record a single block edit in world coordinates. */
  recordEdit(wx: number, wy: number, wz: number, id: number): void {
    const cx = wx >> CHUNK_SIZE_BITS;
    const cz = wz >> CHUNK_SIZE_BITS;
    const ck = chunkKey(cx, cz);
    let m = this.edits.get(ck);
    if (!m) { m = new Map(); this.edits.set(ck, m); }
    m.set(localIndex(wx & CHUNK_SIZE_MASK, wy, wz & CHUNK_SIZE_MASK), id);
    this.dirty = true;
  }

  /** Apply stored edits to a freshly generated chunk. */
  applyEdits(chunk: Chunk): void {
    const m = this.edits.get(chunkKey(chunk.cx, chunk.cz));
    if (!m) return;
    for (const [idx, id] of m) chunk.blocks[idx] = id;
  }

  async persist(meta: SaveMeta): Promise<void> {
    if (!this.db) return;
    const editsArr: [number, [number, number][]][] = [];
    for (const [ck, m] of this.edits) {
      const list: [number, number][] = [];
      for (const [idx, id] of m) list.push([idx, id]);
      editsArr.push([ck, list]);
    }
    const record = { meta, edits: editsArr };
    await new Promise<void>((resolve) => {
      const req = this.tx('readwrite').put(record, WORLD_ID);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
    this.dirty = false;
  }

  get isDirty(): boolean { return this.dirty; }
  markDirty(): void { this.dirty = true; }

  async deleteWorld(): Promise<void> {
    this.edits.clear();
    if (!this.db) return;
    await new Promise<void>((resolve) => {
      const req = this.tx('readwrite').delete(WORLD_ID);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  }
}
