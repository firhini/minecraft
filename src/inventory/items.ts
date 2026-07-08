import { Block, type ToolType } from '../world/blocks/types';
import { BLOCKS } from '../world/blocks/registry';

// ---------------------------------------------------------------------------
// Item registry. Unifies "block items" (placeable) with tools, materials and
// food. Items are keyed by short string ids used throughout inventory,
// crafting and drop tables.
// ---------------------------------------------------------------------------

export interface ItemDef {
  id: string;
  name: string;
  stackSize: number;
  /** If set, using this item places the given block. */
  placeBlock?: Block;
  /** Icon texture key in the atlas. Block items reuse their block texture. */
  texture: string;
  isBlock: boolean;
  tool?: ToolType;
  /** Tool tier: hand 0, wood 1, stone 2, iron 3, diamond 4. */
  tier?: number;
  /** Mining speed multiplier applied when the tool matches the block. */
  toolSpeed?: number;
  /** Melee damage (half-hearts). */
  attack?: number;
  /** Durability (uses) before the tool breaks. */
  durability?: number;
  /** Hunger points restored when eaten. */
  food?: number;
  /** Saturation restored when eaten. */
  saturation?: number;
}

const REGISTRY = new Map<string, ItemDef>();

function register(d: ItemDef) {
  REGISTRY.set(d.id, d);
}

// --- Auto-register a placeable item for every non-air block. ------------------
for (let id = 1; id < Block.Count; id++) {
  const b = BLOCKS[id];
  if (!b || b.id === Block.Air) continue;
  if (REGISTRY.has(b.itemId)) continue;
  // Icon: prefer explicit side, then top, then all.
  const t = b.textures as Record<string, string>;
  const icon = t.side ?? t.all ?? t.top ?? t.north ?? 'stone';
  register({
    id: b.itemId,
    name: b.name,
    stackSize: 64,
    placeBlock: b.id,
    texture: icon,
    isBlock: true,
  });
}

// --- Materials ----------------------------------------------------------------
const material = (id: string, name: string, texture = id, stackSize = 64) =>
  register({ id, name, stackSize, texture, isBlock: false });

material('stick', 'Stick');
material('coal', 'Coal');
material('charcoal', 'Charcoal', 'coal');
material('diamond', 'Diamond');
material('iron_ingot', 'Iron Ingot');
material('gold_ingot', 'Gold Ingot');
material('flint', 'Flint');
material('clay_ball', 'Clay Ball');
material('snowball', 'Snowball', 'snowball', 16);
material('glowdust', 'Glowstone Dust');
material('wheat_seeds', 'Seeds');
material('wheat', 'Wheat');
material('book', 'Book');
material('bowl', 'Bowl');
material('string', 'String');

// --- Food ---------------------------------------------------------------------
const food = (id: string, name: string, hunger: number, sat: number, texture = id, stackSize = 64) =>
  register({ id, name, stackSize, texture, isBlock: false, food: hunger, saturation: sat });

food('apple', 'Apple', 4, 2.4);
food('bread', 'Bread', 5, 6);
food('cooked_meat', 'Cooked Meat', 8, 12, 'cooked_meat');
food('mushroom_stew', 'Mushroom Stew', 6, 7.2, 'mushroom_stew', 1);

// --- Tools --------------------------------------------------------------------
interface ToolSpec { tier: number; speed: number; attack: number; durability: number; }
const TIERS: Record<string, ToolSpec> = {
  wooden: { tier: 1, speed: 2, attack: 1, durability: 60 },
  stone: { tier: 2, speed: 4, attack: 2, durability: 132 },
  iron: { tier: 3, speed: 6, attack: 3, durability: 251 },
  gold: { tier: 1, speed: 12, attack: 1, durability: 33 },
  diamond: { tier: 4, speed: 8, attack: 4, durability: 1562 },
};

function tool(material: string, kind: ToolType, extraAttack = 0) {
  const spec = TIERS[material];
  const id = `${material}_${kind}`;
  register({
    id,
    name: `${cap(material)} ${cap(kind)}`,
    stackSize: 1,
    texture: id,
    isBlock: false,
    tool: kind,
    tier: spec.tier,
    toolSpeed: spec.speed,
    attack: spec.attack + extraAttack,
    durability: spec.durability,
  });
}

for (const mat of ['wooden', 'stone', 'iron', 'gold', 'diamond']) {
  tool(mat, 'pickaxe');
  tool(mat, 'axe', 1);
  tool(mat, 'shovel');
  tool(mat, 'sword', 2);
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function getItem(id: string): ItemDef | undefined {
  return REGISTRY.get(id);
}

export function requireItem(id: string): ItemDef {
  const d = REGISTRY.get(id);
  if (!d) throw new Error(`Unknown item: ${id}`);
  return d;
}

export function allItems(): ItemDef[] {
  return [...REGISTRY.values()];
}

/** All texture keys referenced by non-block items (tools, materials, food). */
export function collectItemIconKeys(): string[] {
  const keys = new Set<string>();
  for (const it of REGISTRY.values()) {
    if (!it.isBlock) keys.add(it.texture);
  }
  return [...keys];
}
