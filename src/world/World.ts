import { CHUNK_SIZE, CHUNK_SIZE_BITS, CHUNK_SIZE_MASK, WORLD_HEIGHT } from '../core/constants';
import { Block } from './blocks/types';
import { Chunk, ChunkState, chunkKey, localIndex } from './Chunk';

// ---------------------------------------------------------------------------
// The World is the authoritative store of block + light data on the main thread.
// It exposes fast global accessors (world coordinates) and tracks which chunks
// need re-lighting or re-meshing after edits.
// ---------------------------------------------------------------------------

export class World {
  readonly seed: number;
  readonly chunks = new Map<number, Chunk>();

  /** Chunks whose mesh is out of date. */
  readonly dirtyMesh = new Set<Chunk>();
  /** Chunks whose light is out of date. */
  readonly dirtyLight = new Set<Chunk>();

  constructor(seed: number) {
    this.seed = seed;
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  getOrCreateChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      c = new Chunk(cx, cz);
      this.chunks.set(key, c);
    }
    return c;
  }

  removeChunk(cx: number, cz: number): Chunk | undefined {
    const key = chunkKey(cx, cz);
    const c = this.chunks.get(key);
    if (c) {
      this.chunks.delete(key);
      this.dirtyMesh.delete(c);
      this.dirtyLight.delete(c);
    }
    return c;
  }

  hasBlocks(cx: number, cz: number): boolean {
    const c = this.getChunk(cx, cz);
    return !!c && c.state >= ChunkState.Generated;
  }

  // --- Global block access (world coordinates) ------------------------------

  getBlock(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= WORLD_HEIGHT) return Block.Air;
    const cx = wx >> CHUNK_SIZE_BITS;
    const cz = wz >> CHUNK_SIZE_BITS;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return Block.Air;
    return c.blocks[localIndex(wx & CHUNK_SIZE_MASK, wy, wz & CHUNK_SIZE_MASK)];
  }

  /** Like getBlock but returns a sentinel for ungenerated chunks so meshing can defer. */
  getBlockOrUnknown(wx: number, wy: number, wz: number): number {
    if (wy < 0) return Block.Stone; // solid void below world → cull bottom faces
    if (wy >= WORLD_HEIGHT) return Block.Air;
    const cx = wx >> CHUNK_SIZE_BITS;
    const cz = wz >> CHUNK_SIZE_BITS;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || c.state < ChunkState.Generated) return Block.Air;
    return c.blocks[localIndex(wx & CHUNK_SIZE_MASK, wy, wz & CHUNK_SIZE_MASK)];
  }

  getSky(wx: number, wy: number, wz: number): number {
    if (wy < 0) return 0;
    if (wy >= WORLD_HEIGHT) return 15;
    const c = this.chunks.get(chunkKey(wx >> CHUNK_SIZE_BITS, wz >> CHUNK_SIZE_BITS));
    if (!c) return 15;
    return c.light[localIndex(wx & CHUNK_SIZE_MASK, wy, wz & CHUNK_SIZE_MASK)] >> 4;
  }

  getBlockLight(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= WORLD_HEIGHT) return 0;
    const c = this.chunks.get(chunkKey(wx >> CHUNK_SIZE_BITS, wz >> CHUNK_SIZE_BITS));
    if (!c) return 0;
    return c.light[localIndex(wx & CHUNK_SIZE_MASK, wy, wz & CHUNK_SIZE_MASK)] & 0xf;
  }

  /**
   * Set a block in world coordinates. Marks the owning chunk (and any neighbour
   * chunk sharing the affected border) dirty for re-mesh + re-light.
   * Returns false if the target chunk is not loaded.
   */
  setBlock(wx: number, wy: number, wz: number, id: number): boolean {
    if (wy < 0 || wy >= WORLD_HEIGHT) return false;
    const cx = wx >> CHUNK_SIZE_BITS;
    const cz = wz >> CHUNK_SIZE_BITS;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return false;
    const lx = wx & CHUNK_SIZE_MASK;
    const lz = wz & CHUNK_SIZE_MASK;
    c.blocks[localIndex(lx, wy, wz & CHUNK_SIZE_MASK)] = id;

    this.markDirty(c);
    // Border neighbours need re-meshing so their culled faces update.
    if (lx === 0) this.markDirtyChunk(cx - 1, cz);
    else if (lx === CHUNK_SIZE - 1) this.markDirtyChunk(cx + 1, cz);
    if (lz === 0) this.markDirtyChunk(cx, cz - 1);
    else if (lz === CHUNK_SIZE - 1) this.markDirtyChunk(cx, cz + 1);
    // Diagonal neighbours (AO at corners).
    if ((lx === 0 || lx === CHUNK_SIZE - 1) && (lz === 0 || lz === CHUNK_SIZE - 1)) {
      this.markDirtyChunk(cx + (lx === 0 ? -1 : 1), cz + (lz === 0 ? -1 : 1));
    }
    return true;
  }

  markDirty(c: Chunk): void {
    c.dirty = true;
    c.lightDirty = true;
    this.dirtyMesh.add(c);
    this.dirtyLight.add(c);
  }

  markDirtyChunk(cx: number, cz: number): void {
    const c = this.getChunk(cx, cz);
    if (c && c.state >= ChunkState.Generated) {
      c.dirty = true;
      this.dirtyMesh.add(c);
    }
  }
}
