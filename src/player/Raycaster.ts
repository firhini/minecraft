import { BLOCKS } from '../world/blocks/registry';
import { Block } from '../world/blocks/types';
import type { World } from '../world/World';

// ---------------------------------------------------------------------------
// Voxel ray cast (Amanatides & Woo grid traversal) for block targeting.
// Returns the first targetable block and the face normal that was entered
// (used to place the next block against it).
// ---------------------------------------------------------------------------

export interface RayHit {
  x: number; y: number; z: number;       // targeted block
  nx: number; ny: number; nz: number;    // face normal
  px: number; py: number; pz: number;    // adjacent block (for placement)
}

export function raycastVoxels(
  world: World,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDist: number,
): RayHit | null {
  // Normalize direction.
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len; dy /= len; dz /= len;

  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = Math.sign(dx), stepY = Math.sign(dy), stepZ = Math.sign(dz);

  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

  const nextBoundary = (o: number, cell: number, step: number) =>
    step > 0 ? (cell + 1 - o) : (o - cell);

  let tMaxX = dx !== 0 ? nextBoundary(ox, x, stepX) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? nextBoundary(oy, y, stepY) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? nextBoundary(oz, z, stepZ) * tDeltaZ : Infinity;

  let nx = 0, ny = 0, nz = 0;
  let t = 0;

  while (t <= maxDist) {
    const b = world.getBlock(x, y, z);
    if (b !== Block.Air && !BLOCKS[b].liquid) {
      return { x, y, z, nx, ny, nz, px: x + nx, py: y + ny, pz: z + nz };
    }
    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
    }
  }
  return null;
}
