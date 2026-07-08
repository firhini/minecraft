import { CHUNK_SIZE, WORLD_HEIGHT } from '../../core/constants';
import { Block } from '../blocks/types';
import { BLOCKS, occludes } from '../blocks/registry';
import type { Chunk } from '../Chunk';
import { localIndex } from '../Chunk';
import type { World } from '../World';
import type { TextureAtlas } from '../../render/TextureAtlas';

// ---------------------------------------------------------------------------
// Greedy voxel mesher with ambient occlusion and per-face voxel lighting.
//
// The mesh is built in chunk-local coordinates (origin at the chunk corner);
// the resulting geometry is positioned in the scene at the chunk origin.
//
// Output is split into three render layers so translucent water/ice and
// alpha-tested cutouts (leaves, glass, plants) can use dedicated materials.
// ---------------------------------------------------------------------------

export interface LayerGeometry {
  positions: Float32Array;
  uvs: Float32Array;
  layers: Float32Array;
  light: Uint8Array; // 4 per vertex: shade(0-255), sky(0-15), block(0-15), wave(0/1)
  indices: Uint32Array;
}

export interface MeshResult {
  opaque: LayerGeometry | null;
  cutout: LayerGeometry | null;
  translucent: LayerGeometry | null;
}

// Per-direction fixed shading to fake directional light. [E,W,Top,Bottom,S,N]
const DIR_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const AO_FACTOR = [0.4, 0.6, 0.8, 1.0];

// Padded volume dimensions (chunk + 1 block border on X/Z).
const PADX = CHUNK_SIZE + 2;
const PADZ = CHUNK_SIZE + 2;
const PADY = WORLD_HEIGHT;

// Reused scratch buffers (mesher is single-threaded & sequential).
const padBlocks = new Uint8Array(PADX * PADY * PADZ);
const padLight = new Uint8Array(PADX * PADY * PADZ);

function padIndex(px: number, py: number, pz: number): number {
  return (py * PADZ + pz) * PADX + px;
}

/** Growable accumulator for one render layer. */
class Accumulator {
  positions: number[] = [];
  uvs: number[] = [];
  layers: number[] = [];
  light: number[] = [];
  indices: number[] = [];
  vcount = 0;

  reset() {
    this.positions.length = 0;
    this.uvs.length = 0;
    this.layers.length = 0;
    this.light.length = 0;
    this.indices.length = 0;
    this.vcount = 0;
  }

  finish(): LayerGeometry | null {
    if (this.vcount === 0) return null;
    return {
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      layers: new Float32Array(this.layers),
      light: new Uint8Array(this.light),
      indices: new Uint32Array(this.indices),
    };
  }
}

const accOpaque = new Accumulator();
const accCutout = new Accumulator();
const accTranslucent = new Accumulator();

function vertexAO(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0;
  return 3 - ((side1 ? 1 : 0) + (side2 ? 1 : 0) + (corner ? 1 : 0));
}

function aoSolid(id: number): boolean {
  return BLOCKS[id].opaque;
}

/** Fill the padded block+light volume from the chunk and its 3x3 neighbourhood. */
function buildPadded(world: World, chunk: Chunk): void {
  const neighbors: (Chunk | undefined)[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      neighbors.push(world.getChunk(chunk.cx + dx, chunk.cz + dz));
    }
  }
  for (let py = 0; py < PADY; py++) {
    const wy = py;
    for (let pz = 0; pz < PADZ; pz++) {
      const lzWorld = pz - 1; // -1..16
      let dz = 0, lz = lzWorld;
      if (lzWorld < 0) { dz = -1; lz = CHUNK_SIZE - 1; }
      else if (lzWorld >= CHUNK_SIZE) { dz = 1; lz = 0; }
      for (let px = 0; px < PADX; px++) {
        const lxWorld = px - 1;
        let dx = 0, lx = lxWorld;
        if (lxWorld < 0) { dx = -1; lx = CHUNK_SIZE - 1; }
        else if (lxWorld >= CHUNK_SIZE) { dx = 1; lx = 0; }

        const nc = neighbors[(dz + 1) * 3 + (dx + 1)];
        const pIdx = padIndex(px, py, pz);
        if (nc && nc.nonEmpty) {
          const li = localIndex(lx, wy, lz);
          padBlocks[pIdx] = nc.blocks[li];
          padLight[pIdx] = nc.light[li];
        } else if (nc) {
          padBlocks[pIdx] = Block.Air;
          padLight[pIdx] = 0xf0; // full sky, no block light
        } else {
          // Ungenerated neighbour: treat as air with full sky so borders aren't dark.
          padBlocks[pIdx] = Block.Air;
          padLight[pIdx] = 0xf0;
        }
      }
    }
  }
}

function getPB(px: number, py: number, pz: number): number {
  if (py < 0) return Block.Stone;
  if (py >= WORLD_HEIGHT) return Block.Air;
  return padBlocks[padIndex(px, py, pz)];
}

function getPL(px: number, py: number, pz: number): number {
  if (py < 0) return 0;
  if (py >= WORLD_HEIGHT) return 0xf0;
  return padLight[padIndex(px, py, pz)];
}

// Mask scratch buffers sized to the largest slice plane.
const MASK_MAX = Math.max(CHUNK_SIZE * WORLD_HEIGHT, CHUNK_SIZE * CHUNK_SIZE);
const mBlock = new Int16Array(MASK_MAX);
const mLayer = new Int16Array(MASK_MAX);
const mLight = new Int16Array(MASK_MAX);
const mAO = new Int32Array(MASK_MAX);
const mLayerType = new Uint8Array(MASK_MAX); // 0 opaque,1 cutout,2 translucent

const DIMS = [CHUNK_SIZE, WORLD_HEIGHT, CHUNK_SIZE];

export function meshChunk(world: World, chunk: Chunk, atlas: TextureAtlas): MeshResult {
  buildPadded(world, chunk);
  accOpaque.reset();
  accCutout.reset();
  accTranslucent.reset();

  // Six directional sweeps (greedy per slice).
  for (let d = 0; d < 3; d++) {
    for (let s = 0; s < 2; s++) {
      const side = s === 0 ? 1 : -1;
      sweep(d, side, atlas);
    }
  }

  // Cross blocks (plants, torches) — emit X billboards.
  emitCrossBlocks(atlas);

  return {
    opaque: accOpaque.finish(),
    cutout: accCutout.finish(),
    translucent: accTranslucent.finish(),
  };
}

function accFor(type: number): Accumulator {
  return type === 0 ? accOpaque : type === 1 ? accCutout : accTranslucent;
}

function sweep(d: number, side: number, atlas: TextureAtlas): void {
  const u = (d + 1) % 3;
  const v = (d + 2) % 3;
  const du = DIMS[u];
  const dv = DIMS[v];
  const dd = DIMS[d];
  const dir = dirIndex(d, side);
  const faceShade = DIR_SHADE[dir];

  // Normal offset in padded coords (padded adds +1 on X and Z only).
  const nOff = [0, 0, 0];
  nOff[d] = side;

  const cell = [0, 0, 0];

  for (let k = 0; k < dd; k++) {
    // Build mask for this slice.
    let n = 0;
    for (let j = 0; j < dv; j++) {
      for (let i = 0; i < du; i++, n++) {
        cell[d] = k; cell[u] = i; cell[v] = j;
        const px = cell[0] + 1, py = cell[1], pz = cell[2] + 1;
        const a = getPB(px, py, pz);
        const da = BLOCKS[a];
        if (a === Block.Air || da.cross) { mBlock[n] = -1; continue; }

        const nbx = px + nOff[0], nby = py + nOff[1], nbz = pz + nOff[2];
        const b = getPB(nbx, nby, nbz);
        if (occludes(a, b)) { mBlock[n] = -1; continue; }

        // Layer / render type.
        const layer = atlas.blockFaceLayer[a * 6 + dir];
        const rtype = da.renderLayer === 'opaque' ? 0 : da.renderLayer === 'cutout' ? 1 : 2;

        // Light from the front neighbour cell.
        const lp = getPL(nbx, nby, nbz);
        const sky = lp >> 4;
        const blk = lp & 0xf;

        // Ambient occlusion — sample the four corners in the face plane.
        const ao = computeAO(px, py, pz, d, u, v, side);

        mBlock[n] = a;
        mLayer[n] = layer;
        mLayerType[n] = rtype;
        mLight[n] = sky | (blk << 4);
        mAO[n] = ao;
      }
    }

    // Greedy merge.
    for (let j = 0; j < dv; j++) {
      for (let i = 0; i < du;) {
        const idx = j * du + i;
        if (mBlock[idx] < 0) { i++; continue; }

        // Width.
        let w = 1;
        while (i + w < du && maskEqual(idx, j * du + i + w)) w++;
        // Height.
        let h = 1;
        outer: while (j + h < dv) {
          for (let m = 0; m < w; m++) {
            if (!maskEqual(idx, (j + h) * du + i + m)) break outer;
          }
          h++;
        }

        emitQuad(d, u, v, side, k, i, j, w, h, idx, faceShade);

        // Clear consumed mask cells.
        for (let l = 0; l < h; l++) {
          for (let m = 0; m < w; m++) mBlock[(j + l) * du + i + m] = -1;
        }
        i += w;
      }
    }
  }
}

function maskEqual(a: number, b: number): boolean {
  return (
    mBlock[a] === mBlock[b] &&
    mLayer[a] === mLayer[b] &&
    mLight[a] === mLight[b] &&
    mAO[a] === mAO[b]
  );
}

/** Compute packed AO (4 corners × 2 bits) for a face. */
function computeAO(px: number, py: number, pz: number, d: number, u: number, v: number, side: number): number {
  // Front cell (the empty side).
  const f = [px, py, pz];
  f[d] += side;
  // Unit steps along u and v in padded space (X/Z padded, Y not — but offsets are ±1 either way).
  const su = [0, 0, 0]; su[u] = 1;
  const sv = [0, 0, 0]; sv[v] = 1;

  let packed = 0;
  // Corner order: (0,0),(1,0),(1,1),(0,1) → cu,cv in {0,1}
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let c = 0; c < 4; c++) {
    const cu = corners[c][0] === 1 ? 1 : -1;
    const cv = corners[c][1] === 1 ? 1 : -1;
    const s1 = aoSolid(getPB(f[0] + su[0] * cu, f[1] + su[1] * cu, f[2] + su[2] * cu));
    const s2 = aoSolid(getPB(f[0] + sv[0] * cv, f[1] + sv[1] * cv, f[2] + sv[2] * cv));
    const co = aoSolid(getPB(
      f[0] + su[0] * cu + sv[0] * cv,
      f[1] + su[1] * cu + sv[1] * cv,
      f[2] + su[2] * cu + sv[2] * cv,
    ));
    packed |= vertexAO(s1, s2, co) << (c * 2);
  }
  return packed;
}

function dirIndex(d: number, side: number): number {
  // [E,W,Top,Bottom,S,N] = [+X,-X,+Y,-Y,+Z,-Z]
  if (d === 0) return side > 0 ? 0 : 1;
  if (d === 1) return side > 0 ? 2 : 3;
  return side > 0 ? 4 : 5;
}

const cornerPos = [0, 0, 0];

function emitQuad(
  d: number, u: number, v: number, side: number,
  k: number, i: number, j: number, w: number, h: number,
  maskIdx: number, faceShade: number,
): void {
  const block = mBlock[maskIdx];
  const layer = mLayer[maskIdx];
  const type = mLayerType[maskIdx];
  const light = mLight[maskIdx];
  const sky = light & 0xf;
  const blk = (light >> 4) & 0xf;
  const ao = mAO[maskIdx];
  const wave = BLOCKS[block].waving ? 1 : 0;

  const acc = accFor(type);
  const base = acc.vcount;

  // d-plane position (world block boundary).
  const dPlane = side > 0 ? k + 1 : k;

  // Corners in (u,v): order depends on side for correct CCW winding.
  // side +1: (i,j),(i+w,j),(i+w,j+h),(i,j+h)
  // side -1: (i,j),(i,j+h),(i+w,j+h),(i+w,j)
  const uv: number[][] = side > 0
    ? [[i, j], [i + w, j], [i + w, j + h], [i, j + h]]
    : [[i, j], [i, j + h], [i + w, j + h], [i + w, j]];
  // AO corner index per output vertex (matching corner (0,0),(1,0),(1,1),(0,1)).
  const aoIdx: number[] = side > 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];

  // Water top surface lowered slightly.
  const yLower = block === Block.Water && d === 1 && side > 0 ? 0.12 : 0;

  for (let c = 0; c < 4; c++) {
    const pu = uv[c][0];
    const pv = uv[c][1];
    cornerPos[d] = dPlane;
    cornerPos[u] = pu;
    cornerPos[v] = pv;
    acc.positions.push(cornerPos[0], cornerPos[1] - yLower, cornerPos[2]);

    // UV: tile per block. Keep vertical (Y) mapped to texture V on side faces.
    let tu: number, tv: number;
    if (d === 1) { tu = pu - i; tv = pv - j; }          // top/bottom
    else if (d === 0) { tu = pv - j; tv = pu - i; }      // east/west: v(Z)->U, u(Y)->V
    else { tu = pu - i; tv = pv - j; }                   // north/south: u(X)->U, v(Y)->V
    acc.uvs.push(tu, tv);

    acc.layers.push(layer);

    const aoLevel = (ao >> (aoIdx[c] * 2)) & 0x3;
    const shade = Math.round(Math.min(1, faceShade * AO_FACTOR[aoLevel]) * 255);
    acc.light.push(shade, sky, blk, wave);
  }

  // Flip quad diagonal to reduce AO interpolation artifacts.
  const a0 = (ao >> (aoIdx[0] * 2)) & 3;
  const a1 = (ao >> (aoIdx[1] * 2)) & 3;
  const a2 = (ao >> (aoIdx[2] * 2)) & 3;
  const a3 = (ao >> (aoIdx[3] * 2)) & 3;
  if (a0 + a2 > a1 + a3) {
    acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  } else {
    acc.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
  }
  acc.vcount += 4;
}

// --- Cross blocks (plants) ---------------------------------------------------

function emitCrossBlocks(atlas: TextureAtlas): void {
  const acc = accCutout;
  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const b = getPB(x + 1, y, z + 1);
        const def = BLOCKS[b];
        if (!def.cross) continue;
        const layer = atlas.blockFaceLayer[b * 6 + 2];
        const lp = getPL(x + 1, y, z + 1);
        const sky = lp >> 4;
        const blk = lp & 0xf;
        const wave = def.waving ? 1 : 0;
        const shade = Math.round(0.9 * 255);
        emitCross(acc, x, y, z, layer, shade, sky, blk, wave);
      }
    }
  }
}

const CROSS_INSET = 0.146;

function emitCross(
  acc: Accumulator, x: number, y: number, z: number,
  layer: number, shade: number, sky: number, blk: number, wave: number,
): void {
  const lo = CROSS_INSET;
  const hi = 1 - CROSS_INSET;
  // Two diagonal quads.
  const quads = [
    [[x + lo, y, z + lo], [x + hi, y, z + hi], [x + hi, y + 1, z + hi], [x + lo, y + 1, z + lo]],
    [[x + lo, y, z + hi], [x + hi, y, z + lo], [x + hi, y + 1, z + lo], [x + lo, y + 1, z + hi]],
  ];
  for (const q of quads) {
    const base = acc.vcount;
    const uvcorners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let c = 0; c < 4; c++) {
      acc.positions.push(q[c][0], q[c][1], q[c][2]);
      acc.uvs.push(uvcorners[c][0], uvcorners[c][1]);
      acc.layers.push(layer);
      // Only the top vertices (c >= 2) sway, so the plant stays rooted.
      acc.light.push(shade, sky, blk, c >= 2 ? wave : 0);
    }
    // Double-sided: emit both windings so plants show from every angle.
    acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    acc.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    acc.vcount += 4;
  }
}
