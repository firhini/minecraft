// ---------------------------------------------------------------------------
// Crafting recipe system. Supports shaped (grid pattern) and shapeless recipes
// for both the 2x2 inventory grid and the 3x3 crafting table. Easily extended.
// ---------------------------------------------------------------------------

export interface RecipeOutput { id: string; count: number; }

export interface ShapedRecipe {
  type: 'shaped';
  pattern: string[];              // rows of single-char keys, ' ' = empty
  key: Record<string, string>;    // char → item id
  output: RecipeOutput;
}

export interface ShapelessRecipe {
  type: 'shapeless';
  ingredients: string[];          // item ids (order irrelevant)
  output: RecipeOutput;
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

const shaped = (pattern: string[], key: Record<string, string>, id: string, count = 1): ShapedRecipe =>
  ({ type: 'shaped', pattern, key, output: { id, count } });

const shapeless = (ingredients: string[], id: string, count = 1): ShapelessRecipe =>
  ({ type: 'shapeless', ingredients, output: { id, count } });

// P = planks, S = stick, C = cobblestone, I = iron, D = diamond, G = gold, W = wood log
export const RECIPES: Recipe[] = [
  // Wood → planks, planks → sticks.
  shapeless(['log'], 'planks', 4),
  shapeless(['birch_log'], 'planks', 4),
  shaped(['P', 'P'], { P: 'planks' }, 'stick', 4),

  // Crafting table & furnace.
  shaped(['PP', 'PP'], { P: 'planks' }, 'crafting_table', 1),
  shaped(['CCC', 'C C', 'CCC'], { C: 'cobblestone' }, 'furnace', 1),
  shaped(['PPP', 'BBB', 'PPP'], { P: 'planks', B: 'book' }, 'bookshelf', 1),

  // Torches (coal or charcoal + stick).
  shaped(['C', 'S'], { C: 'coal', S: 'stick' }, 'torch', 4),
  shaped(['C', 'S'], { C: 'charcoal', S: 'stick' }, 'torch', 4),

  // Glowstone from dust.
  shaped(['GG', 'GG'], { G: 'glowdust' }, 'glowstone', 1),

  // Bricks (4 clay bricks → decorative brick block; bricks item omitted → use clay).
  shaped(['BB', 'BB'], { B: 'clay_ball' }, 'bricks', 1),

  // Tools & food.
  ...toolRecipes(),
  shaped(['WWW'], { W: 'wheat' }, 'bread', 1),
];

function toolRecipes(): Recipe[] {
  const mats: [string, string][] = [
    ['planks', 'wooden'],
    ['cobblestone', 'stone'],
    ['iron_ingot', 'iron'],
    ['gold_ingot', 'gold'],
    ['diamond', 'diamond'],
  ];
  const out: Recipe[] = [];
  for (const [mat, name] of mats) {
    out.push(shaped(['MMM', ' S ', ' S '], { M: mat, S: 'stick' }, `${name}_pickaxe`));
    out.push(shaped(['MM', 'MS', ' S'], { M: mat, S: 'stick' }, `${name}_axe`));
    out.push(shaped(['M', 'S', 'S'], { M: mat, S: 'stick' }, `${name}_shovel`));
    out.push(shaped(['M', 'M', 'S'], { M: mat, S: 'stick' }, `${name}_sword`));
  }
  return out;
}

/**
 * Match a crafting grid (row-major, size*size) against known recipes.
 * Returns the matched recipe output or null.
 */
export function matchRecipe(grid: (string | null)[], size: number): RecipeOutput | null {
  const nonEmpty = grid.filter((g) => g !== null) as string[];
  if (nonEmpty.length === 0) return null;

  for (const recipe of RECIPES) {
    if (recipe.type === 'shapeless') {
      if (matchShapeless(recipe, nonEmpty)) return recipe.output;
    } else {
      if (matchShaped(recipe, grid, size)) return recipe.output;
    }
  }
  return null;
}

function matchShapeless(recipe: ShapelessRecipe, items: string[]): boolean {
  if (items.length !== recipe.ingredients.length) return false;
  const pool = [...items];
  for (const ing of recipe.ingredients) {
    const i = pool.indexOf(ing);
    if (i === -1) return false;
    pool.splice(i, 1);
  }
  return pool.length === 0;
}

function matchShaped(recipe: ShapedRecipe, grid: (string | null)[], size: number): boolean {
  const rows = recipe.pattern.length;
  const cols = Math.max(...recipe.pattern.map((r) => r.length));
  if (rows > size || cols > size) return false;

  // Try every offset so the pattern can sit anywhere in the grid.
  for (let oy = 0; oy + rows <= size; oy++) {
    for (let ox = 0; ox + cols <= size; ox++) {
      if (testShapedAt(recipe, grid, size, ox, oy, rows, cols)) return true;
    }
  }
  return false;
}

function testShapedAt(
  recipe: ShapedRecipe, grid: (string | null)[], size: number,
  ox: number, oy: number, rows: number, cols: number,
): boolean {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = grid[y * size + x];
      let want: string | null = null;
      const py = y - oy, px = x - ox;
      if (py >= 0 && py < rows && px >= 0 && px < cols) {
        const ch = recipe.pattern[py][px] ?? ' ';
        want = ch === ' ' ? null : (recipe.key[ch] ?? null);
      }
      if (want !== cell) return false;
    }
  }
  return true;
}
