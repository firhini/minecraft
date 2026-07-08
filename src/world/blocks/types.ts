// ---------------------------------------------------------------------------
// Block & item type definitions shared across the engine (main thread + workers).
// This module contains ONLY plain data / enums so it can be imported anywhere
// without pulling in Three.js or DOM APIs.
// ---------------------------------------------------------------------------

/** Numeric block ids stored in chunk arrays (0-255). */
export const enum Block {
  Air = 0,
  Stone = 1,
  Grass = 2,
  Dirt = 3,
  Sand = 4,
  Gravel = 5,
  Log = 6,
  Leaves = 7,
  Water = 8,
  Bedrock = 9,
  CoalOre = 10,
  IronOre = 11,
  GoldOre = 12,
  DiamondOre = 13,
  Glass = 14,
  Planks = 15,
  Bricks = 16,
  Cobblestone = 17,
  Snow = 18,
  Sandstone = 19,
  Cactus = 20,
  Flower = 21,
  TallGrass = 22,
  Torch = 23,
  CraftingTable = 24,
  Furnace = 25,
  Glowstone = 26,
  Ice = 27,
  Clay = 28,
  Pumpkin = 29,
  BirchLog = 30,
  BirchLeaves = 31,
  RedFlower = 32,
  Snowy = 33, // grass block with snow top (visual variant)
  Obsidian = 34,
  Bookshelf = 35,
  MossStone = 36,
  RedSand = 37,
  Mushroom = 38,
  Sapling = 39,
  Count = 40,
}

export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'sword' | 'none';
export type RenderLayer = 'opaque' | 'cutout' | 'translucent';

export interface FaceTextures {
  /** Fallback texture key for every face. */
  all?: string;
  top?: string;
  bottom?: string;
  side?: string;
  north?: string;
  south?: string;
  east?: string;
  west?: string;
}

export interface Drop {
  item: string;
  min?: number;
  max?: number;
  /** Probability [0,1] that this drop is produced at all. Default 1. */
  chance?: number;
}

export interface BlockDef {
  id: Block;
  name: string;
  /** Inventory item id used when this block is held / dropped. */
  itemId: string;
  /** Whether the block has collision. */
  solid: boolean;
  /** Fully blocks light & culls all neighbouring faces. */
  opaque: boolean;
  liquid: boolean;
  /** X-shaped billboard geometry (flowers, grass, saplings). */
  cross: boolean;
  /** Light emitted, 0-15. */
  luminance: number;
  /** Extra attenuation applied to light passing through (leaves, water). */
  lightFilter: number;
  /** Seconds to mine with bare hand at speed 1. -1 = unbreakable. */
  hardness: number;
  preferredTool: ToolType;
  /** Minimum tool tier (0 = hand) required to obtain drops. */
  minTier: number;
  drops: Drop[] | null; // null = drops itself; [] = drops nothing
  textures: FaceTextures;
  renderLayer: RenderLayer;
  /** Collision/render height for partial blocks (snow layer, water). 1 = full. */
  height: number;
  /** Whether entities can pass through (plants, torches, water). */
  passable: boolean;
  /** Replaceable by placement (grass, water, air) — used by placement logic. */
  replaceable: boolean;
  /** Gentle vertex sway in the shader (leaves, plants). */
  waving: boolean;
  /** Whether an item can be placed against/into this (used for cactus/water rules). */
  fluidLevel?: number;
}

/** The 6 cube faces. Index order is used everywhere in the mesher. */
export const enum Face {
  East = 0,  // +X
  West = 1,  // -X
  Top = 2,   // +Y
  Bottom = 3, // -Y
  South = 4, // +Z
  North = 5, // -Z
}

/** Unit normals per face, indexed by Face. */
export const FACE_NORMALS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
