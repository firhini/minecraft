import { Block, type BlockDef, type FaceTextures, type ToolType } from './types';

// ---------------------------------------------------------------------------
// Central block registry. Definitions are declared with terse defaults so the
// table stays readable. Everything downstream (mesher, physics, lighting,
// interaction) reads from BLOCKS[id].
// ---------------------------------------------------------------------------

type Partial<T> = { [P in keyof T]?: T[P] };

function def(id: Block, name: string, o: Partial<BlockDef> & { textures: FaceTextures }): BlockDef {
  return {
    id,
    name,
    itemId: o.itemId ?? name.toLowerCase().replace(/\s+/g, '_'),
    solid: o.solid ?? true,
    opaque: o.opaque ?? true,
    liquid: o.liquid ?? false,
    cross: o.cross ?? false,
    luminance: o.luminance ?? 0,
    lightFilter: o.lightFilter ?? (o.opaque === false ? 1 : 0),
    hardness: o.hardness ?? 1,
    preferredTool: o.preferredTool ?? 'none',
    minTier: o.minTier ?? 0,
    drops: o.drops ?? null,
    textures: o.textures,
    renderLayer: o.renderLayer ?? 'opaque',
    height: o.height ?? 1,
    passable: o.passable ?? false,
    replaceable: o.replaceable ?? false,
    waving: o.waving ?? false,
    fluidLevel: o.fluidLevel,
  };
}

const AIR: BlockDef = {
  id: Block.Air, name: 'Air', itemId: 'air', solid: false, opaque: false, liquid: false,
  cross: false, luminance: 0, lightFilter: 0, hardness: -1, preferredTool: 'none', minTier: 0,
  drops: [], textures: {}, renderLayer: 'opaque', height: 0, passable: true, replaceable: true, waving: false,
};

const P = 'pickaxe' as ToolType;
const A = 'axe' as ToolType;
const S = 'shovel' as ToolType;

export const BLOCKS: BlockDef[] = (() => {
  const list: BlockDef[] = new Array(Block.Count);
  const add = (d: BlockDef) => { list[d.id] = d; };

  add(AIR);

  add(def(Block.Stone, 'Stone', {
    textures: { all: 'stone' }, hardness: 1.5, preferredTool: P, minTier: 1,
    drops: [{ item: 'cobblestone' }],
  }));
  add(def(Block.Grass, 'Grass Block', {
    textures: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' }, itemId: 'grass',
    hardness: 0.6, preferredTool: S, drops: [{ item: 'dirt' }],
  }));
  add(def(Block.Dirt, 'Dirt', { textures: { all: 'dirt' }, hardness: 0.5, preferredTool: S }));
  add(def(Block.Sand, 'Sand', { textures: { all: 'sand' }, hardness: 0.5, preferredTool: S }));
  add(def(Block.Gravel, 'Gravel', {
    textures: { all: 'gravel' }, hardness: 0.6, preferredTool: S,
    drops: [{ item: 'gravel', chance: 0.9 }, { item: 'flint', chance: 0.1 }],
  }));
  add(def(Block.Log, 'Oak Log', {
    textures: { top: 'log_top', bottom: 'log_top', side: 'log_side' }, itemId: 'log',
    hardness: 1.2, preferredTool: A,
  }));
  add(def(Block.Leaves, 'Oak Leaves', {
    textures: { all: 'leaves' }, opaque: false, hardness: 0.2, renderLayer: 'cutout',
    lightFilter: 1, waving: true, drops: [{ item: 'sapling', chance: 0.08 }, { item: 'stick', chance: 0.06, max: 2 }],
  }));
  add(def(Block.Water, 'Water', {
    textures: { all: 'water' }, solid: false, opaque: false, liquid: true, passable: true,
    replaceable: true, renderLayer: 'translucent', hardness: -1, drops: [], height: 0.9,
    lightFilter: 2, fluidLevel: 8,
  }));
  add(def(Block.Bedrock, 'Bedrock', { textures: { all: 'bedrock' }, hardness: -1, drops: [] }));
  add(def(Block.CoalOre, 'Coal Ore', {
    textures: { all: 'coal_ore' }, hardness: 3, preferredTool: P, minTier: 1,
    drops: [{ item: 'coal' }],
  }));
  add(def(Block.IronOre, 'Iron Ore', {
    textures: { all: 'iron_ore' }, hardness: 3, preferredTool: P, minTier: 2,
    drops: [{ item: 'iron_ore' }],
  }));
  add(def(Block.GoldOre, 'Gold Ore', {
    textures: { all: 'gold_ore' }, hardness: 3, preferredTool: P, minTier: 3,
    drops: [{ item: 'gold_ore' }],
  }));
  add(def(Block.DiamondOre, 'Diamond Ore', {
    textures: { all: 'diamond_ore' }, hardness: 3, preferredTool: P, minTier: 3,
    drops: [{ item: 'diamond' }],
  }));
  add(def(Block.Glass, 'Glass', {
    textures: { all: 'glass' }, opaque: false, hardness: 0.3, renderLayer: 'cutout', drops: [],
  }));
  add(def(Block.Planks, 'Oak Planks', { textures: { all: 'planks' }, hardness: 1, preferredTool: A }));
  add(def(Block.Bricks, 'Bricks', { textures: { all: 'bricks' }, hardness: 1.5, preferredTool: P, minTier: 1 }));
  add(def(Block.Cobblestone, 'Cobblestone', {
    textures: { all: 'cobblestone' }, hardness: 1.5, preferredTool: P, minTier: 1,
  }));
  add(def(Block.Snow, 'Snow', {
    textures: { all: 'snow' }, hardness: 0.3, preferredTool: S, drops: [{ item: 'snowball', max: 2 }],
  }));
  add(def(Block.Sandstone, 'Sandstone', {
    textures: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' },
    itemId: 'sandstone', hardness: 0.8, preferredTool: P, minTier: 1,
  }));
  add(def(Block.Cactus, 'Cactus', {
    textures: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, itemId: 'cactus',
    opaque: false, hardness: 0.4, renderLayer: 'cutout', passable: false, height: 0.94,
  }));
  add(def(Block.Flower, 'Dandelion', {
    textures: { all: 'flower' }, solid: false, opaque: false, cross: true, passable: true,
    hardness: 0, renderLayer: 'cutout', height: 1, replaceable: false, waving: true,
  }));
  add(def(Block.TallGrass, 'Tall Grass', {
    textures: { all: 'tallgrass' }, solid: false, opaque: false, cross: true, passable: true,
    hardness: 0, renderLayer: 'cutout', waving: true, replaceable: true,
    drops: [{ item: 'wheat_seeds', chance: 0.2 }],
  }));
  add(def(Block.Torch, 'Torch', {
    textures: { all: 'torch' }, solid: false, opaque: false, cross: true, passable: true,
    luminance: 14, hardness: 0, renderLayer: 'cutout',
  }));
  add(def(Block.CraftingTable, 'Crafting Table', {
    textures: { top: 'crafting_top', bottom: 'planks', side: 'crafting_side', north: 'crafting_front', south: 'crafting_front' },
    itemId: 'crafting_table', hardness: 1.2, preferredTool: A,
  }));
  add(def(Block.Furnace, 'Furnace', {
    textures: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', north: 'furnace_front' },
    itemId: 'furnace', hardness: 2, preferredTool: P, minTier: 1,
  }));
  add(def(Block.Glowstone, 'Glowstone', {
    textures: { all: 'glowstone' }, luminance: 15, hardness: 0.3,
    drops: [{ item: 'glowdust', min: 2, max: 4 }],
  }));
  add(def(Block.Ice, 'Ice', {
    textures: { all: 'ice' }, opaque: false, hardness: 0.5, preferredTool: P,
    renderLayer: 'translucent', drops: [], lightFilter: 1,
  }));
  add(def(Block.Clay, 'Clay', {
    textures: { all: 'clay' }, hardness: 0.6, preferredTool: S, drops: [{ item: 'clay_ball', min: 4, max: 4 }],
  }));
  add(def(Block.Pumpkin, 'Pumpkin', {
    textures: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', north: 'pumpkin_front' },
    itemId: 'pumpkin', hardness: 1, preferredTool: A,
  }));
  add(def(Block.BirchLog, 'Birch Log', {
    textures: { top: 'birch_log_top', bottom: 'birch_log_top', side: 'birch_log_side' }, itemId: 'birch_log',
    hardness: 1.2, preferredTool: A,
  }));
  add(def(Block.BirchLeaves, 'Birch Leaves', {
    textures: { all: 'birch_leaves' }, opaque: false, hardness: 0.2, renderLayer: 'cutout',
    lightFilter: 1, waving: true, drops: [{ item: 'sapling', chance: 0.06 }],
  }));
  add(def(Block.RedFlower, 'Poppy', {
    textures: { all: 'red_flower' }, solid: false, opaque: false, cross: true, passable: true,
    hardness: 0, renderLayer: 'cutout', waving: true,
  }));
  add(def(Block.Snowy, 'Snowy Grass', {
    textures: { top: 'snow', bottom: 'dirt', side: 'grass_snow_side' }, itemId: 'snowy_grass',
    hardness: 0.6, preferredTool: S, drops: [{ item: 'dirt' }],
  }));
  add(def(Block.Obsidian, 'Obsidian', {
    textures: { all: 'obsidian' }, hardness: 12, preferredTool: P, minTier: 3,
  }));
  add(def(Block.Bookshelf, 'Bookshelf', {
    textures: { top: 'planks', bottom: 'planks', side: 'bookshelf' }, itemId: 'bookshelf',
    hardness: 1.2, preferredTool: A, drops: [{ item: 'book', min: 3, max: 3 }],
  }));
  add(def(Block.MossStone, 'Mossy Cobblestone', {
    textures: { all: 'moss_stone' }, itemId: 'moss_stone', hardness: 1.5, preferredTool: P, minTier: 1,
  }));
  add(def(Block.RedSand, 'Red Sand', { textures: { all: 'red_sand' }, hardness: 0.5, preferredTool: S }));
  add(def(Block.Mushroom, 'Mushroom', {
    textures: { all: 'mushroom' }, solid: false, opaque: false, cross: true, passable: true,
    hardness: 0, renderLayer: 'cutout',
  }));
  add(def(Block.Sapling, 'Sapling', {
    textures: { all: 'sapling' }, solid: false, opaque: false, cross: true, passable: true,
    hardness: 0, renderLayer: 'cutout', waving: true,
  }));

  // Ensure no gaps.
  for (let i = 0; i < Block.Count; i++) {
    if (!list[i]) list[i] = AIR;
  }
  return list;
})();

export function getBlock(id: number): BlockDef {
  return BLOCKS[id] ?? BLOCKS[0];
}

/** True if a face of `here` should be culled by neighbour `there`. */
export function occludes(here: number, there: number): boolean {
  const a = BLOCKS[here];
  const b = BLOCKS[there];
  if (b.opaque) return true;
  // Cull shared internal faces between identical non-opaque blocks (glass, water, leaves, ice).
  if (here === there && !a.cross) return true;
  return false;
}

/** All texture keys referenced by any block face — used to build the atlas. */
export function collectTextureKeys(): string[] {
  const keys = new Set<string>();
  for (const b of BLOCKS) {
    const t = b.textures as Record<string, string>;
    for (const k of Object.keys(t)) {
      if (t[k]) keys.add(t[k]);
    }
  }
  return [...keys].sort();
}
