import { CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from '../../core/constants';
import { Block } from '../blocks/types';
import { Noise2D, Noise3D } from './noise';
import { hash2, hash3 } from '../../utils/rng';

// ---------------------------------------------------------------------------
// Procedural terrain generator. Pure & deterministic — safe to run in a worker.
// Produces a chunk's block array from world seed + chunk coordinates.
// ---------------------------------------------------------------------------

export const enum Biome {
  Ocean = 0,
  Beach = 1,
  Plains = 2,
  Forest = 3,
  Desert = 4,
  Mountains = 5,
  Snowy = 6,
  River = 7,
}

function idx(x: number, y: number, z: number): number {
  return (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

interface ColumnInfo {
  height: number;
  biome: Biome;
  temp: number;
  submerged: boolean;
}

export class TerrainGenerator {
  readonly seed: number;
  private continent: Noise2D;
  private detail: Noise2D;
  private mountain: Noise2D;
  private erosion: Noise2D;
  private temperature: Noise2D;
  private humidity: Noise2D;
  private river: Noise2D;
  private caveA: Noise3D;
  private caveB: Noise3D;
  private caveC: Noise3D;
  private ore: Noise3D;
  private bedrockN: Noise2D;
  private soil: Noise3D;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.continent = new Noise2D(seed, 1);
    this.detail = new Noise2D(seed, 2);
    this.mountain = new Noise2D(seed, 3);
    this.erosion = new Noise2D(seed, 4);
    this.temperature = new Noise2D(seed, 5);
    this.humidity = new Noise2D(seed, 6);
    this.river = new Noise2D(seed, 7);
    this.caveA = new Noise3D(seed, 8);
    this.caveB = new Noise3D(seed, 9);
    this.caveC = new Noise3D(seed, 10);
    this.ore = new Noise3D(seed, 11);
    this.bedrockN = new Noise2D(seed, 12);
    this.soil = new Noise3D(seed, 13);
  }

  // --- Elevation & biome -----------------------------------------------------

  column(x: number, z: number): ColumnInfo {
    const c = this.continent.fbm(x, z, 4, 0.0016);
    const h1 = this.detail.fbm(x, z, 5, 0.0065);
    const m = this.mountain.ridged(x, z, 5, 0.0026);
    const e = this.erosion.fbm(x, z, 3, 0.0009);
    const temp = this.temperature.fbm(x, z, 3, 0.0018);
    const humid = this.humidity.fbm(x, z, 3, 0.0021);

    let elevation = SEA_LEVEL + c * 20 + h1 * 6;
    const mountFactor = clamp((e - 0.05) * 2.2, 0, 1) * clamp(c + 0.25, 0, 1);
    elevation += Math.pow(m, 1.25) * 58 * mountFactor;

    // River carving.
    const r = Math.abs(this.river.fbm(x, z, 3, 0.0022));
    const riverDepth = smoothstep(0.05, 0.0, r);
    let isRiver = false;
    if (riverDepth > 0 && elevation > SEA_LEVEL - 6 && elevation < SEA_LEVEL + 22) {
      elevation -= riverDepth * 9;
      if (riverDepth > 0.5) isRiver = true;
    }

    let height = Math.floor(elevation);
    if (height < 1) height = 1;
    if (height >= WORLD_HEIGHT - 20) height = WORLD_HEIGHT - 20;

    const submerged = height < SEA_LEVEL;
    let biome: Biome;
    if (height <= SEA_LEVEL - 4) biome = Biome.Ocean;
    else if (isRiver) biome = Biome.River;
    else if (height <= SEA_LEVEL + 2 && !mountFactor) biome = Biome.Beach;
    else if (height > SEA_LEVEL + 34 && mountFactor > 0.35) biome = Biome.Mountains;
    else if (temp < -0.35) biome = Biome.Snowy;
    else if (temp > 0.32 && humid < -0.05) biome = Biome.Desert;
    else if (humid > 0.12) biome = Biome.Forest;
    else biome = Biome.Plains;

    return { height, biome, temp, submerged };
  }

  heightAt(x: number, z: number): number {
    return this.column(x, z).height;
  }

  // --- Chunk generation ------------------------------------------------------

  generate(cx: number, cz: number): { blocks: Uint8Array; nonEmpty: boolean } {
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;
    let nonEmpty = false;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;
        const info = this.column(wx, wz);
        const h = info.height;
        const biome = info.biome;
        const bedrockTop = 1 + Math.floor((this.bedrockN.sample(wx * 0.3, wz * 0.3) * 0.5 + 0.5) * 3);

        for (let y = 0; y < WORLD_HEIGHT; y++) {
          let id: number = Block.Air;

          if (y <= bedrockTop) {
            id = Block.Bedrock;
          } else if (y <= h) {
            id = this.solidBlock(wx, y, wz, h, biome);
            // Cave carving (dry caves; lava omitted).
            if (id !== Block.Air && y > bedrockTop && y < h && this.isCave(wx, y, wz)) {
              id = Block.Air;
            }
          } else if (y <= SEA_LEVEL) {
            // Water body (freeze top in snowy biomes).
            if (biome === Biome.Snowy && y === SEA_LEVEL) id = Block.Ice;
            else id = Block.Water;
          }

          if (id !== Block.Air) {
            blocks[idx(lx, y, lz)] = id;
            nonEmpty = true;
          }
        }
      }
    }

    // Structures & vegetation (may reach into this chunk from neighbouring origins).
    this.stampFeatures(cx, cz, blocks);

    return { blocks, nonEmpty };
  }

  private solidBlock(wx: number, y: number, wz: number, h: number, biome: Biome): number {
    const depth = h - y;
    // Occasional dirt/gravel pockets in deep stone.
    const stoneBase = () => {
      if (depth > 4) {
        const s = this.soil.sample(wx * 0.08, y * 0.08, wz * 0.08);
        if (s > 0.75) return Block.Dirt;
        if (s < -0.82) return Block.Gravel;
        return this.oreAt(wx, y, wz, h);
      }
      return Block.Stone;
    };

    const underwater = h < SEA_LEVEL;

    if (biome === Biome.Desert) {
      if (depth === 0) return Block.Sand;
      if (depth <= 4) return Block.Sandstone;
      return stoneBase();
    }
    if (biome === Biome.Ocean || biome === Biome.Beach || underwater) {
      if (depth === 0) return h >= SEA_LEVEL - 1 ? Block.Sand : (this.soil.sample(wx * 0.2, 0, wz * 0.2) > 0.3 ? Block.Gravel : Block.Sand);
      if (depth <= 3) return Block.Sand;
      return stoneBase();
    }
    if (biome === Biome.Snowy) {
      if (depth === 0) return Block.Snowy;
      if (depth <= 4) return Block.Dirt;
      return stoneBase();
    }
    if (biome === Biome.Mountains) {
      if (h > 118) return depth === 0 ? Block.Snow : stoneBase();
      if (depth === 0) return h > 96 ? Block.Stone : Block.Grass;
      if (depth <= 3 && h <= 96) return Block.Dirt;
      return stoneBase();
    }
    if (biome === Biome.River) {
      if (depth <= 2) return Block.Sand;
      return stoneBase();
    }
    // Plains / Forest.
    if (depth === 0) return Block.Grass;
    if (depth <= 4) return Block.Dirt;
    return stoneBase();
  }

  private oreAt(wx: number, y: number, wz: number, h: number): number {
    const ov = this.ore.sample(wx * 0.09, y * 0.09, wz * 0.09);
    if (ov > 0.84) {
      if (y < 14 && hash3(wx, y, wz, this.seed ^ 0x1111) < 0.35) return Block.DiamondOre;
      if (y < 30) return Block.GoldOre;
      if (y < 56) return Block.IronOre;
      return Block.CoalOre;
    }
    // Coal veins nearer surface.
    if (y > 40 && y < h - 5) {
      const cv = this.ore.sample(wx * 0.11 + 100, y * 0.11, wz * 0.11);
      if (cv > 0.8) return Block.CoalOre;
    }
    return Block.Stone;
  }

  private isCave(wx: number, wy: number, wz: number): boolean {
    const n1 = this.caveA.sample(wx * 0.02, wy * 0.03, wz * 0.02);
    const n2 = this.caveB.sample(wx * 0.02, wy * 0.03, wz * 0.02);
    if (n1 * n1 + n2 * n2 < 0.02) return true; // spaghetti tunnels
    const cheese = this.caveC.fbm(wx, wy, wz, 2, 0.031);
    if (cheese > 0.72 && wy < SEA_LEVEL + 4) return true; // caverns
    return false;
  }

  // --- Features (trees, plants) ----------------------------------------------

  private setLocal(blocks: Uint8Array, lx: number, y: number, lz: number, id: number, overwrite: boolean): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return;
    const i = idx(lx, y, lz);
    const cur = blocks[i];
    if (!overwrite && cur !== Block.Air && cur !== Block.Leaves && cur !== Block.BirchLeaves) return;
    blocks[i] = id;
  }

  private stampFeatures(cx: number, cz: number, blocks: Uint8Array): void {
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;
    const R = 3; // max canopy radius reaching into neighbours
    const GRID = 6; // tree grid cell size

    // Trees: iterate grid cells overlapping this chunk (+radius).
    const gx0 = Math.floor((ox - R) / GRID);
    const gx1 = Math.floor((ox + CHUNK_SIZE + R) / GRID);
    const gz0 = Math.floor((oz - R) / GRID);
    const gz1 = Math.floor((oz + CHUNK_SIZE + R) / GRID);

    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const hsel = hash2(gx, gz, this.seed ^ 0xa5a5);
        // Deterministic trunk position within the grid cell.
        const tx = gx * GRID + Math.floor(hash2(gx, gz, this.seed ^ 0x1234) * GRID);
        const tz = gz * GRID + Math.floor(hash2(gx, gz, this.seed ^ 0x5678) * GRID);
        const info = this.column(tx, tz);
        const density = this.treeDensity(info.biome);
        if (density === 0 || hsel > density) continue;
        if (info.height < SEA_LEVEL || info.submerged) continue;
        this.placeFeature(blocks, ox, oz, tx, tz, info.height, info.biome, hash2(gx, gz, this.seed ^ 0x9999));
      }
    }

    // Ground vegetation for columns whose surface lies in this chunk.
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const info = this.column(wx, wz);
        const h = info.height;
        if (h < SEA_LEVEL || h + 1 >= WORLD_HEIGHT) continue;
        const surf = blocks[idx(lx, h, lz)];
        if (blocks[idx(lx, h + 1, lz)] !== Block.Air) continue;
        const rv = hash3(wx, 1, wz, this.seed ^ 0xbeef);
        if (surf === Block.Grass && info.biome !== Biome.Mountains) {
          if (rv < 0.16) blocks[idx(lx, h + 1, lz)] = Block.TallGrass;
          else if (rv < 0.19) blocks[idx(lx, h + 1, lz)] = Block.Flower;
          else if (rv < 0.215) blocks[idx(lx, h + 1, lz)] = Block.RedFlower;
          else if (rv < 0.223 && info.biome === Biome.Forest) blocks[idx(lx, h + 1, lz)] = Block.Mushroom;
        } else if (surf === Block.Sand && info.biome === Biome.Desert && rv < 0.02) {
          this.placeCactus(blocks, lx, h, lz);
        } else if (surf === Block.Snowy && rv < 0.05) {
          blocks[idx(lx, h + 1, lz)] = Block.TallGrass;
        }
      }
    }
  }

  private treeDensity(biome: Biome): number {
    switch (biome) {
      case Biome.Forest: return 0.62;
      case Biome.Plains: return 0.08;
      case Biome.Snowy: return 0.25;
      case Biome.Mountains: return 0.12;
      case Biome.Desert: return 0.05; // cactus handled as feature below
      default: return 0;
    }
  }

  private placeFeature(
    blocks: Uint8Array, ox: number, oz: number,
    tx: number, tz: number, ground: number, biome: Biome, rnd: number,
  ): void {
    if (biome === Biome.Desert) {
      this.placeCactus(blocks, tx - ox, ground, tz - oz);
      return;
    }
    const birch = biome === Biome.Forest && rnd > 0.6;
    const log = birch ? Block.BirchLog : Block.Log;
    const leaf = birch ? Block.BirchLeaves : Block.Leaves;
    const trunkH = 4 + Math.floor(rnd * 3);
    const baseLx = tx - ox;
    const baseLz = tz - oz;

    // Trunk.
    for (let i = 1; i <= trunkH; i++) {
      this.setLocal(blocks, baseLx, ground + i, baseLz, log, true);
    }
    // Canopy: a couple of layers of leaves.
    const topY = ground + trunkH;
    for (let dy = -1; dy <= 2; dy++) {
      const ly = topY + dy;
      const radius = dy >= 1 ? 1 : 2;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dz === 0 && dy < 1) continue;
          const dist = Math.abs(dx) + Math.abs(dz);
          if (dist > radius + 1) continue;
          // Trim corners for a rounder look.
          if (Math.abs(dx) === radius && Math.abs(dz) === radius && (dy === 2 || (dx !== 0 && dz !== 0 && hash3(tx + dx, ly, tz + dz, this.seed) < 0.5))) continue;
          this.setLocal(blocks, baseLx + dx, ly, baseLz + dz, leaf, false);
        }
      }
    }
    // Cap leaf.
    this.setLocal(blocks, baseLx, topY + 2, baseLz, leaf, false);
  }

  private placeCactus(blocks: Uint8Array, lx: number, ground: number, lz: number): void {
    const height = 2 + Math.floor(hash3(lx, ground, lz, this.seed ^ 0xca) * 2);
    for (let i = 1; i <= height; i++) {
      this.setLocal(blocks, lx, ground + i, lz, Block.Cactus, true);
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
