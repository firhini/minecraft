import { CHUNK_SIZE, WORLD_HEIGHT, CHUNK_VOLUME } from '../core/constants';
import { Block } from './blocks/types';

// ---------------------------------------------------------------------------
// A chunk column: CHUNK_SIZE x WORLD_HEIGHT x CHUNK_SIZE blocks.
// Blocks are stored in a flat Uint8Array. Light is packed one byte per block:
// high nibble = sky light (0-15), low nibble = block light (0-15).
// ---------------------------------------------------------------------------

export type ChunkKey = number;

/** Pack chunk coords into a single number key (works for |coord| < 2^15). */
export function chunkKey(cx: number, cz: number): ChunkKey {
  return ((cx + 32768) & 0xffff) * 0x10000 + ((cz + 32768) & 0xffff);
}

export function localIndex(x: number, y: number, z: number): number {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

export const enum ChunkState {
  Empty = 0,
  Generating = 1,
  Generated = 2, // block data ready
  Lit = 3,       // light computed
  Meshed = 4,    // has an up-to-date mesh
}

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  /** World-space origin. */
  readonly ox: number;
  readonly oz: number;

  blocks: Uint8Array;
  /** Packed light: (sky << 4) | block. */
  light: Uint8Array;

  state: ChunkState = ChunkState.Empty;
  /** Mesh needs rebuilding. */
  dirty = true;
  /** Light needs recomputing. */
  lightDirty = true;
  /** Whether the chunk contains anything other than air (skip meshing if empty). */
  nonEmpty = false;
  /** Whether it holds any translucent/liquid blocks (for render sorting hints). */
  hasFluid = false;

  /** Highest non-air block per (x,z) column — accelerates skylight. */
  heightMap: Uint8Array;

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.ox = cx * CHUNK_SIZE;
    this.oz = cz * CHUNK_SIZE;
    this.blocks = new Uint8Array(CHUNK_VOLUME);
    this.light = new Uint8Array(CHUNK_VOLUME);
    this.heightMap = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return Block.Air;
    return this.blocks[localIndex(x, y, z)];
  }

  setBlockLocal(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.blocks[localIndex(x, y, z)] = id;
  }

  getSky(x: number, y: number, z: number): number {
    if (y < 0) return 0;
    if (y >= WORLD_HEIGHT) return 15;
    return this.light[localIndex(x, y, z)] >> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.light[localIndex(x, y, z)] & 0xf;
  }

  setSky(idx: number, level: number): void {
    this.light[idx] = (this.light[idx] & 0x0f) | (level << 4);
  }

  setBlockLightAt(idx: number, level: number): void {
    this.light[idx] = (this.light[idx] & 0xf0) | (level & 0x0f);
  }

  /** Recompute the column height map and non-empty flag. */
  recomputeHeightMap(): void {
    const { blocks, heightMap } = this;
    let nonEmpty = false;
    let hasFluid = false;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        let h = 0;
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const b = blocks[localIndex(x, y, z)];
          if (b !== Block.Air) {
            if (h === 0) h = y + 1;
            nonEmpty = true;
            if (b === Block.Water || b === Block.Ice) hasFluid = true;
          }
        }
        heightMap[z * CHUNK_SIZE + x] = h > 255 ? 255 : h;
      }
    }
    this.nonEmpty = nonEmpty;
    this.hasFluid = hasFluid;
  }
}
