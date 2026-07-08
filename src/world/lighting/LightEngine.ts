import { CHUNK_SIZE, WORLD_HEIGHT } from '../../core/constants';
import { Block } from '../blocks/types';
import { BLOCKS } from '../blocks/registry';
import { localIndex, type Chunk } from '../Chunk';
import type { World } from '../World';

// ---------------------------------------------------------------------------
// Voxel lighting: sky light (sun) and block light (torches/glowstone).
// Computed per chunk over a padded volume seeded from neighbour chunks so light
// bleeds across chunk borders. Converges over a few frames as neighbours update.
// ---------------------------------------------------------------------------

const PADX = CHUNK_SIZE + 2;
const PADZ = CHUNK_SIZE + 2;
const PADY = WORLD_HEIGHT;
const PADVOL = PADX * PADY * PADZ;

const padBlocks = new Uint8Array(PADVOL);
const padSky = new Uint8Array(PADVOL);
const padBlk = new Uint8Array(PADVOL);
const queue = new Int32Array(PADVOL);

function pidx(px: number, py: number, pz: number): number {
  return (py * PADZ + pz) * PADX + px;
}

export function computeChunkLight(world: World, chunk: Chunk): void {
  const neighbors: (Chunk | undefined)[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      neighbors.push(world.getChunk(chunk.cx + dx, chunk.cz + dz));
    }
  }

  // Fill padded block volume and seed border light from neighbour computed light.
  for (let py = 0; py < PADY; py++) {
    for (let pz = 0; pz < PADZ; pz++) {
      const lzw = pz - 1;
      let dz = 0, lz = lzw;
      if (lzw < 0) { dz = -1; lz = CHUNK_SIZE - 1; } else if (lzw >= CHUNK_SIZE) { dz = 1; lz = 0; }
      for (let px = 0; px < PADX; px++) {
        const lxw = px - 1;
        let dx = 0, lx = lxw;
        if (lxw < 0) { dx = -1; lx = CHUNK_SIZE - 1; } else if (lxw >= CHUNK_SIZE) { dx = 1; lx = 0; }
        const nc = neighbors[(dz + 1) * 3 + (dx + 1)];
        const i = pidx(px, py, pz);
        const border = px === 0 || px === PADX - 1 || pz === 0 || pz === PADZ - 1;
        if (nc && nc.nonEmpty) {
          const li = localIndex(lx, py, lz);
          padBlocks[i] = nc.blocks[li];
          if (border) {
            const l = nc.light[li];
            padSky[i] = l >> 4;
            padBlk[i] = l & 0xf;
          } else {
            padSky[i] = 0;
            padBlk[i] = 0;
          }
        } else {
          padBlocks[i] = Block.Air;
          padSky[i] = border ? 15 : 0;
          padBlk[i] = 0;
        }
      }
    }
  }

  computeSky(neighbors);
  computeBlock();

  // Write interior back into the chunk.
  for (let py = 0; py < PADY; py++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = pidx(lx + 1, py, lz + 1);
        chunk.light[localIndex(lx, py, lz)] = (padSky[i] << 4) | padBlk[i];
      }
    }
  }
  chunk.lightDirty = false;
}

function computeSky(neighbors: (Chunk | undefined)[]): void {
  // Column init for interior columns (borders keep their neighbour seed values).
  for (let pz = 1; pz < PADZ - 1; pz++) {
    for (let px = 1; px < PADX - 1; px++) {
      let sky = 15;
      for (let py = PADY - 1; py >= 0; py--) {
        const i = pidx(px, py, pz);
        const def = BLOCKS[padBlocks[i]];
        if (def.opaque) sky = 0;
        else sky = Math.max(0, sky - def.lightFilter);
        padSky[i] = sky;
      }
    }
  }

  // BFS spread (horizontal + downward).
  let head = 0, tail = 0;
  for (let i = 0; i < PADVOL; i++) {
    if (padSky[i] > 1) queue[tail++] = i;
  }
  bfs(padSky, queue, head, tail, true);
  void neighbors;
}

function computeBlock(): void {
  let head = 0, tail = 0;
  for (let py = 0; py < PADY; py++) {
    for (let pz = 0; pz < PADZ; pz++) {
      for (let px = 0; px < PADX; px++) {
        const i = pidx(px, py, pz);
        const lum = BLOCKS[padBlocks[i]].luminance;
        if (lum > padBlk[i]) padBlk[i] = lum;
        if (padBlk[i] > 1) {
          if (tail < PADVOL) queue[tail++] = i;
        }
      }
    }
  }
  bfs(padBlk, queue, head, tail, false);
}

/** Generic flood fill. `sky` enables no-decrement straight-down propagation. */
function bfs(light: Uint8Array, q: Int32Array, head: number, tail: number, sky: boolean): void {
  // Use a growable fallback if the fixed queue overflows.
  const overflow: number[] = [];
  const push = (v: number) => {
    if (tail < q.length) q[tail++] = v;
    else overflow.push(v);
  };

  const step = (i: number) => {
    const level = light[i];
    if (level <= 1) return;
    const py = (i / (PADX * PADZ)) | 0;
    const rem = i - py * PADX * PADZ;
    const pz = (rem / PADX) | 0;
    const px = rem - pz * PADX;

    tryNeighbor(px + 1, py, pz, level - 1);
    tryNeighbor(px - 1, py, pz, level - 1);
    tryNeighbor(px, py, pz + 1, level - 1);
    tryNeighbor(px, py, pz - 1, level - 1);
    tryNeighbor(px, py + 1, pz, level - 1);
    // Straight down: skylight passes without distance loss.
    tryNeighbor(px, py - 1, pz, sky ? level : level - 1);
  };

  const tryNeighbor = (px: number, py: number, pz: number, incoming: number) => {
    if (px < 0 || px >= PADX || pz < 0 || pz >= PADZ || py < 0 || py >= PADY) return;
    const ni = pidx(px, py, pz);
    const def = BLOCKS[padBlocks[ni]];
    if (def.opaque) return;
    const target = Math.max(0, incoming - def.lightFilter);
    if (target > light[ni]) {
      light[ni] = target;
      if (target > 1) push(ni);
    }
  };

  while (head < tail || overflow.length > 0) {
    let i: number;
    if (head < tail) i = q[head++];
    else i = overflow.pop()!;
    step(i);
  }
}
