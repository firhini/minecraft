import * as THREE from 'three';
import { CHUNK_SIZE } from '../core/constants';
import { World } from './World';
import { Chunk, ChunkState, chunkKey } from './Chunk';
import { GeneratorPool } from './generation/GeneratorPool';
import { computeChunkLight } from './lighting/LightEngine';
import { meshChunk } from './meshing/ChunkMesher';
import { ChunkMesh } from '../render/ChunkMesh';
import type { TextureAtlas } from '../render/TextureAtlas';
import type { ChunkMaterials } from '../render/ChunkMaterial';
import type { SaveManager } from '../save/SaveManager';

// ---------------------------------------------------------------------------
// Streams chunks around the player: schedules generation (workers), lighting
// and meshing under per-frame budgets, and unloads distant chunks. Nearest
// chunks are always processed first.
// ---------------------------------------------------------------------------

export class ChunkManager {
  readonly world: World;
  private pool: GeneratorPool;
  private meshes = new Map<number, ChunkMesh>();
  private requested = new Set<number>();
  private offsets: { dx: number; dz: number }[] = [];

  viewDistance: number;
  private centerX = Infinity;
  private centerZ = Infinity;

  // Budgets.
  maxInFlight = 12;
  genRequestsPerFrame = 6;
  lightPerFrame = 4;
  meshTimeBudgetMs = 6;

  save: SaveManager | null = null;

  constructor(
    private scene: THREE.Scene,
    seed: number,
    private atlas: TextureAtlas,
    private materials: ChunkMaterials,
    viewDistance = 8,
  ) {
    this.world = new World(seed);
    this.pool = new GeneratorPool(seed);
    this.viewDistance = viewDistance;
    this.rebuildOffsets();
  }

  private rebuildOffsets(): void {
    const vd = this.viewDistance + 1;
    const arr: { dx: number; dz: number; d2: number }[] = [];
    for (let dz = -vd; dz <= vd; dz++) {
      for (let dx = -vd; dx <= vd; dx++) {
        arr.push({ dx, dz, d2: dx * dx + dz * dz });
      }
    }
    arr.sort((a, b) => a.d2 - b.d2);
    this.offsets = arr.map((o) => ({ dx: o.dx, dz: o.dz }));
  }

  setViewDistance(vd: number): void {
    this.viewDistance = vd;
    this.rebuildOffsets();
    this.centerX = Infinity; // force refresh
  }

  private onGenerated(cx: number, cz: number, blocks: Uint8Array, nonEmpty: boolean): void {
    const key = chunkKey(cx, cz);
    this.requested.delete(key);
    // Chunk may have been unloaded while generating.
    if (Math.max(Math.abs(cx - this.centerX), Math.abs(cz - this.centerZ)) > this.viewDistance + 2) {
      return;
    }
    const chunk = this.world.getOrCreateChunk(cx, cz);
    if (chunk.state >= ChunkState.Generated) return;
    chunk.blocks = blocks;
    chunk.nonEmpty = nonEmpty;
    chunk.state = ChunkState.Generated;

    // Apply any saved edits over the freshly generated terrain, then recompute.
    this.save?.applyEdits(chunk);
    chunk.recomputeHeightMap();

    this.world.dirtyLight.add(chunk);
    this.world.dirtyMesh.add(chunk);
    chunk.dirty = true;
    chunk.lightDirty = true;

    // Neighbours must re-mesh so their border faces & AO update.
    for (const [ddx, ddz] of NEIGHBORS8) {
      const n = this.world.getChunk(cx + ddx, cz + ddz);
      if (n && n.state >= ChunkState.Generated) {
        n.dirty = true;
        this.world.dirtyMesh.add(n);
        n.lightDirty = true;
        this.world.dirtyLight.add(n);
      }
    }
  }

  update(px: number, pz: number): void {
    const cx = Math.floor(px / CHUNK_SIZE);
    const cz = Math.floor(pz / CHUNK_SIZE);
    const centerChanged = cx !== this.centerX || cz !== this.centerZ;
    this.centerX = cx;
    this.centerZ = cz;

    // Request generation nearest-first.
    let requests = 0;
    for (const o of this.offsets) {
      if (requests >= this.genRequestsPerFrame) break;
      if (this.requested.size >= this.maxInFlight) break;
      const ccx = cx + o.dx;
      const ccz = cz + o.dz;
      if (Math.max(Math.abs(o.dx), Math.abs(o.dz)) > this.viewDistance) continue;
      const key = chunkKey(ccx, ccz);
      if (this.world.chunks.has(key) || this.requested.has(key)) continue;
      this.requested.add(key);
      requests++;
      this.pool.generate(ccx, ccz).then((r) => this.onGenerated(ccx, ccz, r.blocks, r.nonEmpty));
    }

    if (centerChanged) this.unloadDistant();

    this.processLighting();
    this.processMeshing();
  }

  private unloadDistant(): void {
    const limit = this.viewDistance + 2;
    for (const [key, chunk] of this.world.chunks) {
      if (Math.max(Math.abs(chunk.cx - this.centerX), Math.abs(chunk.cz - this.centerZ)) > limit) {
        const mesh = this.meshes.get(key);
        if (mesh) { mesh.dispose(); this.meshes.delete(key); }
        this.world.removeChunk(chunk.cx, chunk.cz);
      }
    }
  }

  private processLighting(): void {
    if (this.world.dirtyLight.size === 0) return;
    const list = [...this.world.dirtyLight];
    list.sort((a, b) => this.dist2(a) - this.dist2(b));
    let done = 0;
    for (const chunk of list) {
      if (done >= this.lightPerFrame) break;
      if (chunk.state < ChunkState.Generated) continue;
      computeChunkLight(this.world, chunk);
      this.world.dirtyLight.delete(chunk);
      chunk.state = Math.max(chunk.state, ChunkState.Lit) as ChunkState;
      chunk.dirty = true;
      this.world.dirtyMesh.add(chunk);
      // Already-meshed neighbours sampled this chunk's border light; refresh them
      // so late-arriving light doesn't bake in dark seams.
      for (const [ddx, ddz] of NEIGHBORS8) {
        const n = this.world.getChunk(chunk.cx + ddx, chunk.cz + ddz);
        if (n && n.state >= ChunkState.Meshed && !n.dirty) {
          n.dirty = true;
          this.world.dirtyMesh.add(n);
        }
      }
      done++;
    }
  }

  private processMeshing(): void {
    if (this.world.dirtyMesh.size === 0) return;
    const list = [...this.world.dirtyMesh];
    list.sort((a, b) => this.dist2(a) - this.dist2(b));
    const start = performance.now();
    for (const chunk of list) {
      if (performance.now() - start > this.meshTimeBudgetMs) break;
      if (chunk.state < ChunkState.Generated) continue;
      if (chunk.lightDirty && this.world.dirtyLight.has(chunk)) continue; // wait for lighting
      this.remeshChunk(chunk);
      this.world.dirtyMesh.delete(chunk);
      chunk.dirty = false;
    }
  }

  private remeshChunk(chunk: Chunk): void {
    const key = chunkKey(chunk.cx, chunk.cz);
    if (!chunk.nonEmpty) {
      const existing = this.meshes.get(key);
      if (existing) { existing.dispose(); this.meshes.delete(key); }
      chunk.state = Math.max(chunk.state, ChunkState.Meshed) as ChunkState;
      return;
    }
    const result = meshChunk(this.world, chunk, this.atlas);
    let mesh = this.meshes.get(key);
    if (!mesh) {
      mesh = new ChunkMesh(this.scene, this.materials, chunk.ox, chunk.oz);
      this.meshes.set(key, mesh);
    }
    mesh.update(result);
    chunk.state = Math.max(chunk.state, ChunkState.Meshed) as ChunkState;
  }

  /** Immediately re-light & re-mesh the chunk(s) affected by a single block edit. */
  editRemesh(wx: number, wz: number): void {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const coords: [number, number][] = [[cx, cz]];
    if (lx === 0) coords.push([cx - 1, cz]);
    else if (lx === CHUNK_SIZE - 1) coords.push([cx + 1, cz]);
    if (lz === 0) coords.push([cx, cz - 1]);
    else if (lz === CHUNK_SIZE - 1) coords.push([cx, cz + 1]);
    if ((lx === 0 || lx === CHUNK_SIZE - 1) && (lz === 0 || lz === CHUNK_SIZE - 1)) {
      coords.push([cx + (lx === 0 ? -1 : 1), cz + (lz === 0 ? -1 : 1)]);
    }
    // Re-light all affected first (so border light is consistent), then re-mesh.
    for (const [ccx, ccz] of coords) {
      const c = this.world.getChunk(ccx, ccz);
      if (c && c.state >= ChunkState.Generated) {
        computeChunkLight(this.world, c);
        this.world.dirtyLight.delete(c);
      }
    }
    for (const [ccx, ccz] of coords) {
      const c = this.world.getChunk(ccx, ccz);
      if (c && c.state >= ChunkState.Generated) {
        this.remeshChunk(c);
        this.world.dirtyMesh.delete(c);
        c.dirty = false;
      }
    }
  }

  /** Force an immediate re-light + re-mesh of a chunk (used right after edits). */
  forceRemesh(chunk: Chunk): void {
    if (chunk.state < ChunkState.Generated) return;
    if (chunk.lightDirty) {
      computeChunkLight(this.world, chunk);
      this.world.dirtyLight.delete(chunk);
    }
    this.remeshChunk(chunk);
    this.world.dirtyMesh.delete(chunk);
    chunk.dirty = false;
  }

  private dist2(chunk: Chunk): number {
    const dx = chunk.cx - this.centerX;
    const dz = chunk.cz - this.centerZ;
    return dx * dx + dz * dz;
  }

  /** Number of chunks within `radius` that have finished meshing. */
  readyCount(radius: number): number {
    let n = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const c = this.world.getChunk(this.centerX + dx, this.centerZ + dz);
        if (c && c.state >= ChunkState.Meshed) n++;
      }
    }
    return n;
  }

  get loadedChunks(): number {
    return this.world.chunks.size;
  }

  get pendingChunks(): number {
    return this.requested.size + this.world.dirtyMesh.size;
  }

  dispose(): void {
    for (const m of this.meshes.values()) m.dispose();
    this.meshes.clear();
    this.pool.dispose();
  }
}

const NEIGHBORS8: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
