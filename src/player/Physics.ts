import { BLOCKS } from '../world/blocks/registry';
import type { World } from '../world/World';

// ---------------------------------------------------------------------------
// Axis-separated swept-AABB collision against the voxel grid. The player box is
// resolved one axis at a time so sliding along walls & floors feels smooth.
// ---------------------------------------------------------------------------

const EPS = 1e-4;

export interface Box {
  x: number; y: number; z: number; // feet centre (x,z) and bottom (y)
  hw: number; // half width (x/z)
  h: number;  // height
}

function isSolid(world: World, x: number, y: number, z: number): boolean {
  const b = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return BLOCKS[b].solid;
}

/** Resolve motion along a single axis, returning the (possibly clamped) delta. */
function resolveAxis(world: World, box: Box, axis: 0 | 1 | 2, disp: number): { delta: number; hit: boolean } {
  if (disp === 0) return { delta: 0, hit: false };

  const minX = box.x - box.hw, maxX = box.x + box.hw;
  const minY = box.y, maxY = box.y + box.h;
  const minZ = box.z - box.hw, maxZ = box.z + box.hw;

  let newDisp = disp;
  let hit = false;

  if (axis === 0) {
    const nMinX = minX + disp, nMaxX = maxX + disp;
    const y0 = Math.floor(minY + EPS), y1 = Math.floor(maxY - EPS);
    const z0 = Math.floor(minZ + EPS), z1 = Math.floor(maxZ - EPS);
    if (disp > 0) {
      const x0 = Math.floor(maxX - EPS), x1 = Math.floor(nMaxX + EPS);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++)
            if (isSolid(world, x, y, z)) { newDisp = Math.min(newDisp, x - maxX - EPS); hit = true; }
    } else {
      const x0 = Math.floor(nMinX - EPS), x1 = Math.floor(minX + EPS);
      for (let x = x1; x >= x0; x--)
        for (let y = y0; y <= y1; y++)
          for (let z = z0; z <= z1; z++)
            if (isSolid(world, x, y, z)) { newDisp = Math.max(newDisp, x + 1 - minX + EPS); hit = true; }
    }
  } else if (axis === 1) {
    const nMinY = minY + disp, nMaxY = maxY + disp;
    const x0 = Math.floor(minX + EPS), x1 = Math.floor(maxX - EPS);
    const z0 = Math.floor(minZ + EPS), z1 = Math.floor(maxZ - EPS);
    if (disp > 0) {
      const y0 = Math.floor(maxY - EPS), y1 = Math.floor(nMaxY + EPS);
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++)
            if (isSolid(world, x, y, z)) { newDisp = Math.min(newDisp, y - maxY - EPS); hit = true; }
    } else {
      const y0 = Math.floor(nMinY - EPS), y1 = Math.floor(minY + EPS);
      for (let y = y1; y >= y0; y--)
        for (let x = x0; x <= x1; x++)
          for (let z = z0; z <= z1; z++)
            if (isSolid(world, x, y, z)) { newDisp = Math.max(newDisp, y + 1 - minY + EPS); hit = true; }
    }
  } else {
    const nMinZ = minZ + disp, nMaxZ = maxZ + disp;
    const x0 = Math.floor(minX + EPS), x1 = Math.floor(maxX - EPS);
    const y0 = Math.floor(minY + EPS), y1 = Math.floor(maxY - EPS);
    if (disp > 0) {
      const z0 = Math.floor(maxZ - EPS), z1 = Math.floor(nMaxZ + EPS);
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++)
            if (isSolid(world, x, y, z)) { newDisp = Math.min(newDisp, z - maxZ - EPS); hit = true; }
    } else {
      const z0 = Math.floor(nMinZ - EPS), z1 = Math.floor(minZ + EPS);
      for (let z = z1; z >= z0; z--)
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++)
            if (isSolid(world, x, y, z)) { newDisp = Math.max(newDisp, z + 1 - minZ + EPS); hit = true; }
    }
  }

  return { delta: newDisp, hit };
}

export interface MoveResult {
  onGround: boolean;
  hitWallX: boolean;
  hitWallZ: boolean;
  hitCeiling: boolean;
}

/** Move the box by (vx,vy,vz), resolving collisions. Mutates box position. */
export function moveWithCollision(world: World, box: Box, vx: number, vy: number, vz: number): MoveResult {
  const res: MoveResult = { onGround: false, hitWallX: false, hitWallZ: false, hitCeiling: false };

  // Y first for reliable ground detection.
  const ry = resolveAxis(world, box, 1, vy);
  box.y += ry.delta;
  if (ry.hit) {
    if (vy < 0) res.onGround = true;
    else res.hitCeiling = true;
  }

  const rx = resolveAxis(world, box, 0, vx);
  box.x += rx.delta;
  res.hitWallX = rx.hit;

  const rz = resolveAxis(world, box, 2, vz);
  box.z += rz.delta;
  res.hitWallZ = rz.hit;

  return res;
}

/** True if the player's body intersects any liquid block. */
export function isInLiquid(world: World, box: Box): boolean {
  const x0 = Math.floor(box.x - box.hw + EPS), x1 = Math.floor(box.x + box.hw - EPS);
  const y0 = Math.floor(box.y + EPS), y1 = Math.floor(box.y + box.h - EPS);
  const z0 = Math.floor(box.z - box.hw + EPS), z1 = Math.floor(box.z + box.hw - EPS);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        if (BLOCKS[world.getBlock(x, y, z)].liquid) return true;
  return false;
}

/** True if the player's head (top 0.4) is submerged — for swimming/breath. */
export function isHeadInLiquid(world: World, box: Box): boolean {
  const y = box.y + box.h - 0.2;
  const b = world.getBlock(Math.floor(box.x), Math.floor(y), Math.floor(box.z));
  return BLOCKS[b].liquid;
}

/** True if standing on solid ground (small probe below feet). */
export function isOnGround(world: World, box: Box): boolean {
  const y = box.y - 0.05;
  const x0 = Math.floor(box.x - box.hw + EPS), x1 = Math.floor(box.x + box.hw - EPS);
  const z0 = Math.floor(box.z - box.hw + EPS), z1 = Math.floor(box.z + box.hw - EPS);
  for (let x = x0; x <= x1; x++)
    for (let z = z0; z <= z1; z++)
      if (isSolid(world, x, Math.floor(y), z)) return true;
  return false;
}
