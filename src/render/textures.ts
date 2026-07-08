// Procedural 16x16 pixel-art texture generator for a browser voxel game.
// Pure array math only: no canvas, no DOM, no imports, no Math.random.
// Every texture is deterministic, seeded from a hash of its key string.

export const TILE = 16; // pixels per tile edge

type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// Deterministic PRNG + string hash (inline mulberry32 + FNV-style hash).
// imul32 is implemented manually so the file compiles under the default
// (ES5) lib where Math.imul is unavailable.
// ---------------------------------------------------------------------------

function imul32(a: number, b: number): number {
  const ah = (a >>> 16) & 0xffff;
  const al = a & 0xffff;
  const bh = (b >>> 16) & 0xffff;
  const bl = b & 0xffff;
  // (al*bl) is exact; the high partial is shifted and only low 32 bits kept.
  return (al * bl + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = imul32(h, 16777619) >>> 0;
  }
  // extra avalanche so similar keys diverge
  h ^= h >>> 15;
  h = imul32(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = imul32(t ^ (t >>> 15), 1 | t);
    t = (t + imul32(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(c: RGB, f: number): RGB {
  return [c[0] * f, c[1] * f, c[2] * f];
}

// ---------------------------------------------------------------------------
// Tile: a lightweight drawing context over a slice of the output buffer.
// ---------------------------------------------------------------------------

class Tile {
  constructor(
    public out: Uint8ClampedArray,
    public off: number,
    public rng: () => number,
  ) {}

  idx(x: number, y: number): number {
    return this.off + (y * TILE + x) * 4;
  }

  setPixel(x: number, y: number, r: number, g: number, b: number, a = 255): void {
    if (x < 0 || x >= TILE || y < 0 || y >= TILE) return;
    const i = this.idx(x, y);
    this.out[i] = r;
    this.out[i + 1] = g;
    this.out[i + 2] = b;
    this.out[i + 3] = a;
  }

  dot(x: number, y: number, c: RGB, a = 255): void {
    this.setPixel(x, y, c[0], c[1], c[2], a);
  }

  // Multiply an existing pixel's rgb by a factor (used for AO/shading).
  mul(x: number, y: number, f: number): void {
    if (x < 0 || x >= TILE || y < 0 || y >= TILE) return;
    const i = this.idx(x, y);
    if (this.out[i + 3] === 0) return;
    this.out[i] = this.out[i] * f;
    this.out[i + 1] = this.out[i + 1] * f;
    this.out[i + 2] = this.out[i + 2] * f;
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGB, a = 255): void {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) this.dot(x + i, y + j, c, a);
    }
  }

  fill(c: RGB, a = 255): void {
    this.fillRect(0, 0, TILE, TILE, c, a);
  }

  clear(): void {
    for (let i = 0; i < TILE * TILE; i++) {
      const b = this.off + i * 4;
      this.out[b] = 0;
      this.out[b + 1] = 0;
      this.out[b + 2] = 0;
      this.out[b + 3] = 0;
    }
  }

  border(c: RGB, a = 255): void {
    for (let x = 0; x < TILE; x++) {
      this.dot(x, 0, c, a);
      this.dot(x, TILE - 1, c, a);
    }
    for (let y = 0; y < TILE; y++) {
      this.dot(0, y, c, a);
      this.dot(TILE - 1, y, c, a);
    }
  }

  // Per-pixel brightness jitter over all opaque pixels.
  noiseOverlay(amount: number): void {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const i = this.idx(x, y);
        if (this.out[i + 3] === 0) continue;
        const d = (this.rng() * 2 - 1) * amount;
        this.out[i] = this.out[i] + d;
        this.out[i + 1] = this.out[i + 1] + d;
        this.out[i + 2] = this.out[i + 2] + d;
      }
    }
  }

  // Scatter individual specks (also used, clumped, by the ore painter).
  speckle(c: RGB, count: number, a = 255): void {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(this.rng() * TILE);
      const y = Math.floor(this.rng() * TILE);
      this.dot(x, y, c, a);
    }
  }

  // Vertical partial streaks (bark, ribs).
  verticalStreaks(c: RGB, count: number, a = 255): void {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(this.rng() * TILE);
      const y0 = Math.floor(this.rng() * 8);
      const len = 4 + Math.floor(this.rng() * 8);
      for (let y = y0; y < Math.min(TILE, y0 + len); y++) this.dot(x, y, c, a);
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 255): void {
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let cx = x0;
    let cy = y0;
    for (;;) {
      this.dot(cx, cy, c, a);
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        cx += sx;
      }
      if (e2 <= dx) {
        err += dx;
        cy += sy;
      }
    }
  }

  // A centered plant silhouette (grass-blade tuft) on the current background.
  cross(c: RGB): void {
    const dark = shade(c, 0.75);
    this.line(8, 15, 5, 6, c);
    this.line(8, 15, 8, 4, c);
    this.line(8, 15, 11, 7, dark);
    this.line(9, 15, 12, 9, c);
    this.line(7, 15, 4, 9, dark);
  }

  // A shaded filled circle (items: coal, apple, snowball, clay ball...).
  ball(cx: number, cy: number, r: number, c: RGB, a = 255): void {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) {
          const l = 1 - (dx + dy) / (r * 3.2);
          const f = Math.max(0.62, Math.min(1.25, l));
          this.dot(x, y, [c[0] * f, c[1] * f, c[2] * f], a);
        }
      }
    }
  }

  // Ambient-occlusion style depth: lighter top-left, darker bottom-right.
  ao(): void {
    for (let k = 0; k < TILE; k++) {
      this.mul(k, 0, 1.14);
      this.mul(0, k, 1.1);
      this.mul(k, TILE - 1, 0.8);
      this.mul(TILE - 1, k, 0.84);
    }
  }
}

// ---------------------------------------------------------------------------
// Palette (cohesive, slightly desaturated).
// ---------------------------------------------------------------------------

const STONE: RGB = [128, 131, 134];
const DIRT: RGB = [132, 96, 66];
const GRASS: RGB = [96, 158, 58];
const GRASS_S: RGB = [104, 168, 60];
const SAND: RGB = [222, 208, 157];
const RED_SAND: RGB = [192, 104, 58];
const LOG: RGB = [106, 78, 46];
const LOG_DARK: RGB = [76, 54, 32];
const LOG_RING: RGB = [140, 104, 60];
const LEAF: RGB = [58, 118, 48];
const LEAF_DARK: RGB = [40, 90, 34];
const BIRCH_LEAF: RGB = [124, 160, 74];
const WATER: RGB = [52, 108, 196];
const BRICK: RGB = [150, 74, 58];
const MORTAR: RGB = [196, 186, 172];
const PLANK: RGB = [164, 124, 74];
const PLANK_DARK: RGB = [118, 86, 48];
const SNOW: RGB = [236, 240, 247];
const SANDSTONE: RGB = [222, 210, 164];
const CACTUS: RGB = [74, 124, 54];
const CACTUS_DARK: RGB = [50, 94, 40];
const PUMPKIN: RGB = [214, 120, 34];
const PUMPKIN_DARK: RGB = [166, 86, 22];
const ICE: RGB = [156, 192, 226];
const MOSS: RGB = [74, 112, 48];
const HANDLE: RGB = [120, 84, 48];

// ---------------------------------------------------------------------------
// Shared block/base helpers.
// ---------------------------------------------------------------------------

function stoneBase(t: Tile): void {
  t.fill(STONE);
  t.noiseOverlay(18);
  t.speckle(shade(STONE, 0.7), 8);
  t.speckle(shade(STONE, 1.15), 6);
}

function dirtBase(t: Tile): void {
  t.fill(DIRT);
  t.noiseOverlay(16);
  t.speckle(shade(DIRT, 0.78), 16);
  t.speckle(shade(DIRT, 1.12), 8);
}

function sandBase(t: Tile, c: RGB): void {
  t.fill(c);
  t.noiseOverlay(14);
  t.speckle(shade(c, 0.85), 22);
  t.speckle(shade(c, 1.1), 14);
}

function planksBase(t: Tile): void {
  t.fill(PLANK);
  t.noiseOverlay(9);
  for (let gi = 0; gi < 4; gi++) t.fillRect(0, gi * 4 + 3, 16, 1, PLANK_DARK);
  const seams: [number, number][] = [
    [4, 0],
    [11, 0],
    [7, 4],
    [2, 8],
    [13, 8],
    [9, 12],
    [5, 12],
  ];
  for (const s of seams) t.fillRect(s[0], s[1] + 1, 1, 2, PLANK_DARK);
  t.verticalStreaks(shade(PLANK, 0.9), 3);
}

function pumpkinBase(t: Tile): void {
  t.fill(PUMPKIN);
  t.noiseOverlay(12);
  const grooves = [0, 5, 10, 15];
  for (const cx of grooves) t.fillRect(cx, 0, 1, 16, PUMPKIN_DARK);
  const highs = [2, 7, 12];
  for (const cx of highs) t.fillRect(cx, 0, 1, 16, shade(PUMPKIN, 1.12));
  t.ao();
}

function rings(t: Tile, base: RGB, dark: RGB, light: RGB): void {
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const dx = x - 7.5;
      const dy = y - 7.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      const r = Math.floor(d) % 2;
      let col: RGB = r === 0 ? base : dark;
      if (d < 1.4) col = light;
      t.dot(x, y, col);
    }
  }
  t.noiseOverlay(7);
  t.border(dark);
  t.ao();
}

// Voronoi-cell "stones" used by cobblestone, moss stone, gravel, bedrock.
function voronoiStones(t: Tile, base: RGB, n: number, gapf: number, moss: boolean): void {
  const px: number[] = [];
  const py: number[] = [];
  const sh: number[] = [];
  for (let i = 0; i < n; i++) {
    px.push(t.rng() * 16);
    py.push(t.rng() * 16);
    sh.push(0.78 + t.rng() * 0.44);
  }
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let b1 = 1e9;
      let b2 = 1e9;
      let ci = 0;
      for (let i = 0; i < n; i++) {
        const dx = x + 0.5 - px[i];
        const dy = y + 0.5 - py[i];
        const d = dx * dx + dy * dy;
        if (d < b1) {
          b2 = b1;
          b1 = d;
          ci = i;
        } else if (d < b2) {
          b2 = d;
        }
      }
      const edge = Math.sqrt(b2) - Math.sqrt(b1);
      const f = sh[ci];
      let col: RGB = [base[0] * f, base[1] * f, base[2] * f];
      if (edge < gapf) col = [col[0] * 0.4, col[1] * 0.4, col[2] * 0.42];
      else if (moss && t.rng() < 0.16) col = [MOSS[0] * f, MOSS[1] * f, MOSS[2] * f];
      t.dot(x, y, col);
    }
  }
  t.noiseOverlay(9);
}

function ore(t: Tile, c: RGB): void {
  stoneBase(t);
  const blob: [number, number][] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 0],
    [2, 1],
  ];
  for (let i = 0; i < 6; i++) {
    const cx = 1 + Math.floor(t.rng() * 12);
    const cy = 1 + Math.floor(t.rng() * 12);
    const k = 3 + Math.floor(t.rng() * 3);
    for (let j = 0; j < k; j++) t.dot(cx + blob[j][0], cy + blob[j][1], c);
    t.dot(cx, cy, shade(c, 1.35)); // facet sparkle
    t.dot(cx + 1, cy + 1, shade(c, 0.7)); // facet shadow
  }
  t.ao();
}

// ---------------------------------------------------------------------------
// Item helpers.
// ---------------------------------------------------------------------------

function ingot(t: Tile, c: RGB): void {
  const hi = shade(c, 1.2);
  const lo = shade(c, 0.7);
  const rows: [number, number, number][] = [
    [6, 5, 10],
    [7, 4, 11],
    [8, 4, 11],
    [9, 4, 11],
    [10, 5, 10],
  ];
  for (const r of rows) {
    const y = r[0];
    for (let x = r[1]; x <= r[2]; x++) {
      let col = c;
      if (y === 6) col = hi;
      else if (y === 10) col = lo;
      else if (x === r[1]) col = hi;
      else if (x === r[2]) col = lo;
      t.dot(x, y, col);
    }
  }
  t.dot(6, 7, shade(c, 1.4));
}

function gem(t: Tile, c: RGB): void {
  const hi = shade(c, 1.3);
  const lo = shade(c, 0.68);
  const rows: [number, number, number][] = [
    [3, 7, 8],
    [4, 6, 9],
    [5, 5, 10],
    [6, 5, 10],
    [7, 5, 10],
    [8, 6, 9],
    [9, 7, 8],
  ];
  for (const r of rows) {
    const y = r[0];
    for (let x = r[1]; x <= r[2]; x++) {
      let col = c;
      if (y <= 4) col = hi;
      else if (y >= 8) col = lo;
      if (x === 7) col = shade(c, 0.85);
      t.dot(x, y, col);
    }
  }
  t.line(5, 5, 8, 9, lo);
  t.dot(6, 4, [255, 255, 255]);
}

function drawBowl(t: Tile): void {
  const wood: RGB = [150, 102, 56];
  const rim: RGB = [176, 122, 68];
  const rows: [number, number, number][] = [
    [9, 4, 11],
    [10, 3, 12],
    [11, 4, 11],
    [12, 5, 10],
  ];
  for (const r of rows) for (let x = r[1]; x <= r[2]; x++) t.dot(x, r[0], wood);
  for (let x = 4; x <= 11; x++) t.dot(x, 8, rim);
  t.dot(4, 9, rim);
  t.dot(11, 9, rim);
  for (let x = 5; x <= 10; x++) t.dot(x, 9, [110, 72, 40]);
}

// ---------------------------------------------------------------------------
// Tool template: brown diagonal handle + material-colored head per shape.
// ---------------------------------------------------------------------------

function drawHandle(t: Tile, x0: number, y0: number, x1: number, y1: number): void {
  t.line(x0, y0, x1, y1, HANDLE);
  t.line(x0 + 1, y0, x1 + 1, y1, shade(HANDLE, 0.78));
}

function drawPick(t: Tile, c: RGB, hi: RGB, lo: RGB): void {
  t.line(4, 5, 9, 2, hi);
  t.line(9, 2, 14, 5, hi);
  t.line(4, 6, 9, 3, c);
  t.line(9, 3, 14, 6, c);
  t.line(4, 7, 9, 4, lo);
  t.line(9, 4, 14, 7, lo);
  t.dot(4, 6, hi);
  t.dot(14, 6, hi);
  drawHandle(t, 9, 4, 5, 13);
}

function drawAxe(t: Tile, c: RGB, hi: RGB, lo: RGB): void {
  drawHandle(t, 11, 4, 5, 13);
  const rows: [number, number, number][] = [
    [2, 9, 11],
    [3, 6, 12],
    [4, 5, 12],
    [5, 6, 11],
    [6, 8, 10],
  ];
  for (const r of rows) {
    const y = r[0];
    for (let x = r[1]; x <= r[2]; x++) {
      let col = c;
      if (x <= r[1] + 1) col = hi;
      else if (y === 6) col = lo;
      t.dot(x, y, col);
    }
  }
}

function drawShovel(t: Tile, c: RGB, hi: RGB, lo: RGB): void {
  drawHandle(t, 10, 6, 5, 13);
  const rows: [number, number, number][] = [
    [2, 9, 12],
    [3, 8, 13],
    [4, 8, 13],
    [5, 8, 13],
    [6, 9, 12],
  ];
  for (const r of rows) {
    const y = r[0];
    for (let x = r[1]; x <= r[2]; x++) {
      let col = c;
      if (y === 2 || x <= r[1] + 1) col = hi;
      else if (y === 6) col = lo;
      t.dot(x, y, col);
    }
  }
}

function drawSword(t: Tile, c: RGB, hi: RGB, lo: RGB): void {
  t.line(12, 3, 7, 10, c);
  t.line(11, 3, 6, 10, hi);
  t.line(13, 4, 8, 11, lo);
  t.dot(12, 3, hi);
  t.dot(13, 3, hi);
  const guard = shade(c, 0.5);
  t.line(5, 8, 9, 12, guard);
  t.line(7, 10, 4, 14, HANDLE);
  t.line(8, 10, 5, 14, shade(HANDLE, 0.78));
  t.dot(3, 14, guard);
  t.dot(4, 15, guard);
}

function drawTool(t: Tile, mat: RGB, shape: string): void {
  t.clear();
  const hi = shade(mat, 1.22);
  const lo = shade(mat, 0.66);
  if (shape === 'pickaxe') drawPick(t, mat, hi, lo);
  else if (shape === 'axe') drawAxe(t, mat, hi, lo);
  else if (shape === 'shovel') drawShovel(t, mat, hi, lo);
  else drawSword(t, mat, hi, lo);
}

// ---------------------------------------------------------------------------
// Painter registry.
// ---------------------------------------------------------------------------

const painters: { [key: string]: (t: Tile) => void } = {
  // --- terrain / stone family ---
  stone: (t) => {
    stoneBase(t);
    t.line(3, 4, 6, 7, shade(STONE, 0.72));
    t.line(10, 9, 12, 12, shade(STONE, 0.72));
    t.ao();
  },
  cobblestone: (t) => {
    voronoiStones(t, [138, 138, 142], 7, 0.95, false);
    t.ao();
  },
  moss_stone: (t) => {
    voronoiStones(t, [130, 132, 134], 7, 0.95, true);
    t.ao();
  },
  gravel: (t) => {
    voronoiStones(t, [126, 122, 120], 13, 0.7, false);
    t.ao();
  },
  bedrock: (t) => {
    voronoiStones(t, [62, 62, 66], 9, 0.85, false);
    t.speckle([40, 40, 44], 14);
    t.speckle([92, 92, 98], 8);
    t.ao();
  },

  // --- dirt / grass ---
  dirt: (t) => {
    dirtBase(t);
    t.ao();
  },
  grass_top: (t) => {
    t.fill(GRASS);
    t.noiseOverlay(16);
    t.speckle(shade(GRASS, 0.8), 18);
    t.speckle(shade(GRASS, 1.15), 14);
    t.ao();
  },
  grass_side: (t) => {
    dirtBase(t);
    for (let x = 0; x < 16; x++) {
      t.dot(x, 0, GRASS_S);
      t.dot(x, 1, GRASS_S);
      t.dot(x, 2, shade(GRASS_S, 0.95));
    }
    for (let x = 0; x < 16; x++) if (t.rng() < 0.55) t.dot(x, 3, shade(GRASS_S, 0.9));
    const drips: [number, number][] = [
      [2, 4],
      [3, 4],
      [7, 4],
      [7, 5],
      [11, 4],
      [12, 4],
      [12, 5],
      [14, 4],
    ];
    for (const d of drips) t.dot(d[0], d[1], shade(GRASS_S, 0.85));
    for (let x = 0; x < 16; x++) t.mul(x, 0, 1.1);
  },
  grass_snow_side: (t) => {
    dirtBase(t);
    for (let x = 0; x < 16; x++) {
      t.dot(x, 0, SNOW);
      t.dot(x, 1, SNOW);
      t.dot(x, 2, shade(SNOW, 0.95));
    }
    for (let x = 0; x < 16; x++) if (t.rng() < 0.5) t.dot(x, 3, shade(SNOW, 0.9));
    const drips: [number, number][] = [
      [3, 4],
      [8, 4],
      [12, 4],
    ];
    for (const d of drips) t.dot(d[0], d[1], shade(SNOW, 0.9));
  },

  // --- sand family ---
  sand: (t) => {
    sandBase(t, SAND);
    t.ao();
  },
  red_sand: (t) => {
    sandBase(t, RED_SAND);
    t.ao();
  },
  sandstone_top: (t) => {
    sandBase(t, SANDSTONE);
    t.border(shade(SANDSTONE, 0.86));
    t.ao();
  },
  sandstone_bottom: (t) => {
    sandBase(t, shade(SANDSTONE, 0.94));
    t.ao();
  },
  sandstone_side: (t) => {
    sandBase(t, SANDSTONE);
    t.fillRect(0, 0, 16, 3, shade(SANDSTONE, 1.05));
    t.fillRect(0, 5, 16, 1, shade(SANDSTONE, 0.82));
    t.fillRect(0, 11, 16, 1, shade(SANDSTONE, 0.82));
    t.ao();
  },

  // --- wood ---
  log_top: (t) => rings(t, LOG, LOG_DARK, LOG_RING),
  log_side: (t) => {
    t.fill(LOG);
    t.noiseOverlay(10);
    t.verticalStreaks(LOG_DARK, 7);
    t.verticalStreaks(LOG_RING, 3);
    t.ao();
  },
  birch_log_top: (t) => rings(t, [206, 204, 190], [150, 146, 128], [224, 222, 208]),
  birch_log_side: (t) => {
    t.fill([212, 210, 198]);
    t.noiseOverlay(8);
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(t.rng() * 14);
      const y = Math.floor(t.rng() * 14);
      t.dot(x, y, [58, 52, 44]);
      t.dot(x + 1, y, [58, 52, 44]);
    }
    t.dot(4, 6, [70, 60, 48]);
    t.dot(3, 6, [90, 80, 66]);
    t.dot(11, 10, [70, 60, 48]);
    t.ao();
  },
  planks: (t) => {
    planksBase(t);
    t.ao();
  },

  // --- foliage ---
  leaves: (t) => {
    t.fill(LEAF);
    t.noiseOverlay(20);
    t.speckle(LEAF_DARK, 18);
    t.speckle(shade(LEAF, 1.2), 12);
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(t.rng() * 15);
      const y = Math.floor(t.rng() * 15);
      t.setPixel(x, y, 0, 0, 0, 0);
      t.setPixel(x + 1, y, 0, 0, 0, 0);
      t.setPixel(x, y + 1, 0, 0, 0, 0);
    }
    t.ao();
  },
  birch_leaves: (t) => {
    t.fill(BIRCH_LEAF);
    t.noiseOverlay(18);
    t.speckle(shade(BIRCH_LEAF, 0.82), 16);
    t.speckle(shade(BIRCH_LEAF, 1.15), 12);
    for (let i = 0; i < 6; i++) {
      const x = Math.floor(t.rng() * 15);
      const y = Math.floor(t.rng() * 15);
      t.setPixel(x, y, 0, 0, 0, 0);
      t.setPixel(x + 1, y, 0, 0, 0, 0);
      t.setPixel(x, y + 1, 0, 0, 0, 0);
    }
    t.ao();
  },

  // --- liquids / translucent ---
  water: (t) => {
    t.fill(WATER, 170);
    t.noiseOverlay(12);
    const waves = [3, 7, 11, 14];
    for (const wy of waves) {
      for (let x = 0; x < 16; x++) if ((x + wy) % 4 < 2) t.dot(x, wy, [78, 138, 220], 170);
    }
  },
  ice: (t) => {
    t.fill(ICE, 205);
    t.noiseOverlay(8);
    t.line(2, 3, 7, 9, [210, 232, 248], 205);
    t.line(7, 9, 5, 14, [210, 232, 248], 205);
    t.line(10, 2, 13, 8, [120, 160, 200], 205);
    t.line(13, 8, 11, 14, [120, 160, 200], 205);
  },
  glass: (t) => {
    t.clear();
    t.border([206, 226, 236], 235);
    t.line(2, 2, 6, 2, [240, 250, 255], 235);
    t.line(2, 2, 2, 6, [240, 250, 255], 235);
    t.dot(11, 4, [230, 244, 252], 200);
    t.dot(12, 5, [230, 244, 252], 200);
  },

  // --- ores ---
  coal_ore: (t) => ore(t, [34, 34, 38]),
  iron_ore: (t) => ore(t, [196, 150, 110]),
  gold_ore: (t) => ore(t, [236, 204, 84]),
  diamond_ore: (t) => ore(t, [110, 214, 220]),

  // --- built blocks ---
  bricks: (t) => {
    t.fill(BRICK);
    t.noiseOverlay(12);
    for (let bi = 0; bi < 4; bi++) t.fillRect(0, bi * 4 + 3, 16, 1, MORTAR);
    for (let band = 0; band < 4; band++) {
      const y0 = band * 4;
      const off = (band % 2) * 4;
      for (let vx = off; vx < 16; vx += 8) t.fillRect(vx, y0, 1, 3, MORTAR);
    }
    t.ao();
  },
  snow: (t) => {
    t.fill(SNOW);
    t.noiseOverlay(6);
    t.speckle([210, 220, 236], 12);
    t.speckle([255, 255, 255], 8);
    t.ao();
  },
  clay: (t) => {
    t.fill([164, 172, 184]);
    t.noiseOverlay(8);
    t.speckle([148, 156, 170], 10);
    t.ao();
  },
  obsidian: (t) => {
    t.fill([24, 20, 36]);
    t.noiseOverlay(10);
    t.speckle([58, 42, 84], 12);
    t.speckle([80, 64, 112], 5);
    t.speckle([12, 10, 20], 8);
    t.ao();
  },
  glowstone: (t) => {
    t.fill([196, 164, 88]);
    t.noiseOverlay(14);
    t.speckle([248, 224, 130], 20);
    t.speckle([255, 242, 180], 10);
    t.speckle(shade([196, 164, 88], 0.7), 8);
    t.ao();
  },

  // --- cactus ---
  cactus_side: (t) => {
    t.fill([40, 40, 44]);
    t.fillRect(1, 0, 14, 16, CACTUS);
    t.noiseOverlay(10);
    t.fillRect(1, 0, 1, 16, CACTUS_DARK);
    t.fillRect(14, 0, 1, 16, CACTUS_DARK);
    t.fillRect(4, 0, 1, 16, CACTUS_DARK);
    t.fillRect(11, 0, 1, 16, CACTUS_DARK);
    t.fillRect(7, 0, 1, 16, shade(CACTUS, 1.12));
    t.speckle([200, 210, 120], 10);
    t.ao();
  },
  cactus_top: (t) => {
    t.fill(CACTUS);
    t.noiseOverlay(8);
    t.border(CACTUS_DARK);
    t.fillRect(6, 6, 4, 4, shade(CACTUS, 1.1));
    t.dot(7, 7, [200, 210, 120]);
    t.dot(8, 8, [200, 210, 120]);
    t.ao();
  },
  cactus_bottom: (t) => {
    t.fill(shade(CACTUS, 0.9));
    t.noiseOverlay(8);
    t.border(CACTUS_DARK);
    t.ao();
  },

  // --- furnace ---
  furnace_top: (t) => {
    t.fill([112, 112, 116]);
    t.noiseOverlay(12);
    t.border([88, 88, 92]);
    t.ao();
  },
  furnace_side: (t) => {
    t.fill([112, 112, 116]);
    t.noiseOverlay(12);
    t.ao();
  },
  furnace_front: (t) => {
    t.fill([112, 112, 116]);
    t.noiseOverlay(12);
    t.fillRect(4, 7, 8, 7, [46, 44, 46]);
    t.fillRect(4, 7, 8, 1, [30, 28, 30]);
    for (let x = 5; x <= 10; x++) t.dot(x, 12, [196, 96, 32]);
    for (let x = 6; x <= 9; x++) t.dot(x, 13, [236, 150, 50]);
    t.ao();
  },

  // --- crafting table ---
  crafting_top: (t) => {
    planksBase(t);
    t.fillRect(0, 5, 16, 1, PLANK_DARK);
    t.fillRect(0, 10, 16, 1, PLANK_DARK);
    t.fillRect(5, 0, 1, 16, PLANK_DARK);
    t.fillRect(10, 0, 1, 16, PLANK_DARK);
    t.border(shade(PLANK, 0.7));
    t.ao();
  },
  crafting_front: (t) => {
    planksBase(t);
    const cells: [number, number][] = [
      [3, 3],
      [9, 3],
      [3, 9],
      [9, 9],
    ];
    for (const c of cells) {
      t.fillRect(c[0], c[1], 4, 4, [120, 92, 58]);
      t.fillRect(c[0], c[1], 4, 1, [90, 66, 40]);
      t.fillRect(c[0], c[1], 1, 4, [90, 66, 40]);
    }
    t.ao();
  },
  crafting_side: (t) => {
    planksBase(t);
    t.fillRect(3, 6, 9, 2, [176, 178, 186]);
    for (let x = 3; x <= 11; x += 2) t.dot(x, 8, [176, 178, 186]);
    t.fillRect(11, 5, 2, 4, [120, 84, 48]);
    t.ao();
  },

  // --- pumpkin ---
  pumpkin_side: (t) => pumpkinBase(t),
  pumpkin_top: (t) => {
    t.fill(shade(PUMPKIN, 1.02));
    t.noiseOverlay(10);
    t.border(PUMPKIN_DARK);
    t.fillRect(7, 6, 3, 4, [126, 110, 58]);
    t.dot(8, 7, [150, 132, 70]);
    t.ao();
  },
  pumpkin_front: (t) => {
    pumpkinBase(t);
    const face: RGB = [92, 50, 12];
    const eyeL: [number, number][] = [
      [4, 6],
      [5, 6],
      [5, 7],
      [6, 7],
    ];
    const eyeR: [number, number][] = [
      [11, 6],
      [10, 6],
      [10, 7],
      [9, 7],
    ];
    for (const p of eyeL) t.dot(p[0], p[1], face);
    for (const p of eyeR) t.dot(p[0], p[1], face);
    t.dot(7, 8, face);
    t.dot(8, 8, face);
    const mouth: [number, number][] = [
      [4, 11],
      [5, 11],
      [6, 12],
      [7, 11],
      [8, 11],
      [9, 12],
      [10, 11],
      [11, 11],
      [5, 12],
      [10, 12],
    ];
    for (const p of mouth) t.dot(p[0], p[1], face);
  },

  // --- bookshelf ---
  bookshelf: (t) => {
    t.fill(PLANK);
    t.noiseOverlay(9);
    t.fillRect(0, 3, 16, 10, [52, 38, 26]);
    t.fillRect(0, 2, 16, 1, PLANK_DARK);
    t.fillRect(0, 13, 16, 1, PLANK_DARK);
    const cols: RGB[] = [
      [220, 64, 52],
      [64, 96, 168],
      [72, 152, 84],
      [196, 166, 64],
      [150, 80, 158],
      [80, 146, 164],
      [210, 120, 60],
    ];
    let x = 1;
    let ci = 0;
    while (x < 15) {
      const w = 1 + Math.floor(t.rng() * 2);
      const col = cols[ci % cols.length];
      const top = 3 + Math.floor(t.rng() * 2);
      for (let xx = x; xx < Math.min(15, x + w); xx++) {
        for (let y = top; y <= 12; y++) t.dot(xx, y, col);
      }
      t.fillRect(Math.min(14, x + w), 3, 1, 10, [40, 28, 18]);
      x += w + 1;
      ci++;
    }
    t.ao();
  },

  // --- plants (transparent background) ---
  flower: (t) => {
    t.clear();
    t.line(8, 14, 8, 7, [70, 132, 52]);
    t.dot(6, 10, [70, 132, 52]);
    t.dot(7, 11, [86, 150, 60]);
    const yellow: RGB = [246, 214, 72];
    const head: [number, number][] = [
      [7, 4],
      [8, 4],
      [6, 5],
      [7, 5],
      [8, 5],
      [9, 5],
      [7, 6],
      [8, 6],
    ];
    for (const p of head) t.dot(p[0], p[1], yellow);
    t.dot(7, 5, [252, 232, 120]);
    t.dot(8, 6, [214, 168, 40]);
  },
  red_flower: (t) => {
    t.clear();
    t.line(8, 14, 8, 7, [70, 132, 52]);
    t.dot(6, 11, [86, 150, 60]);
    const red: RGB = [206, 58, 52];
    const head: [number, number][] = [
      [7, 4],
      [8, 4],
      [6, 5],
      [7, 5],
      [8, 5],
      [9, 5],
      [6, 6],
      [7, 6],
      [8, 6],
      [9, 6],
    ];
    for (const p of head) t.dot(p[0], p[1], red);
    t.dot(7, 5, [40, 22, 20]);
    t.dot(8, 5, [40, 22, 20]);
    t.dot(9, 4, [236, 90, 80]);
  },
  mushroom: (t) => {
    t.clear();
    for (let y = 9; y <= 13; y++) {
      t.dot(7, y, [228, 222, 208]);
      t.dot(8, y, [206, 200, 186]);
    }
    const cap: RGB = [198, 52, 46];
    const caprows: [number, number, number][] = [
      [6, 6, 9],
      [7, 5, 10],
      [8, 5, 10],
    ];
    for (const r of caprows) for (let x = r[1]; x <= r[2]; x++) t.dot(x, r[0], cap);
    const spots: [number, number][] = [
      [6, 7],
      [9, 7],
      [7, 8],
      [10, 8],
    ];
    for (const p of spots) t.dot(p[0], p[1], [236, 232, 220]);
    t.dot(5, 8, shade(cap, 0.7));
    t.dot(10, 8, shade(cap, 0.7));
  },
  sapling: (t) => {
    t.clear();
    for (let y = 10; y <= 14; y++) t.dot(8, y, [110, 80, 44]);
    const g: RGB = [86, 150, 58];
    const gd: RGB = [62, 116, 44];
    const leaf: [number, number][] = [
      [7, 6],
      [8, 6],
      [9, 6],
      [6, 7],
      [7, 7],
      [8, 7],
      [9, 7],
      [10, 7],
      [7, 8],
      [8, 8],
      [9, 8],
      [8, 9],
    ];
    for (const p of leaf) t.dot(p[0], p[1], g);
    const dk: [number, number][] = [
      [6, 8],
      [10, 7],
      [9, 9],
    ];
    for (const p of dk) t.dot(p[0], p[1], gd);
  },
  tallgrass: (t) => {
    t.clear();
    t.cross([84, 152, 56]);
    t.dot(6, 12, [70, 132, 48]);
    t.dot(10, 11, [70, 132, 48]);
    t.dot(8, 3, [100, 168, 66]);
  },
  torch: (t) => {
    t.clear();
    for (let y = 6; y <= 15; y++) {
      t.dot(7, y, [122, 86, 50]);
      t.dot(8, y, [96, 66, 38]);
    }
    t.dot(7, 3, [252, 236, 150]);
    t.dot(8, 3, [252, 236, 150]);
    t.dot(6, 4, [250, 180, 60]);
    t.dot(7, 4, [255, 240, 170]);
    t.dot(8, 4, [255, 240, 170]);
    t.dot(9, 4, [250, 180, 60]);
    t.dot(7, 5, [255, 220, 110]);
    t.dot(8, 5, [255, 220, 110]);
    t.dot(7, 6, [248, 160, 50]);
    t.dot(8, 6, [248, 160, 50]);
  },

  // --- item icons (transparent background) ---
  stick: (t) => {
    t.clear();
    t.line(5, 13, 10, 4, [132, 94, 52]);
    t.line(6, 13, 11, 4, [104, 72, 40]);
  },
  coal: (t) => {
    t.clear();
    t.ball(8, 8, 4.6, [36, 36, 40]);
    t.dot(6, 6, [70, 70, 76]);
    t.dot(7, 6, [60, 60, 66]);
  },
  diamond: (t) => {
    t.clear();
    gem(t, [118, 214, 220]);
  },
  iron_ingot: (t) => {
    t.clear();
    ingot(t, [204, 206, 212]);
  },
  gold_ingot: (t) => {
    t.clear();
    ingot(t, [236, 206, 84]);
  },
  flint: (t) => {
    t.clear();
    const rows: [number, number, number][] = [
      [6, 7, 10],
      [7, 5, 11],
      [8, 4, 11],
      [9, 5, 10],
      [10, 7, 9],
    ];
    for (const r of rows) {
      for (let x = r[1]; x <= r[2]; x++) {
        t.dot(x, r[0], x === r[1] || r[0] === 6 ? [92, 94, 100] : [62, 64, 70]);
      }
    }
    t.dot(6, 7, [110, 112, 118]);
  },
  clay_ball: (t) => {
    t.clear();
    t.ball(8, 8, 4.4, [164, 172, 184]);
  },
  snowball: (t) => {
    t.clear();
    t.ball(8, 8, 4.4, [238, 242, 248]);
  },
  glowdust: (t) => {
    t.clear();
    for (let i = 0; i < 26; i++) {
      const x = 3 + Math.floor(t.rng() * 10);
      const y = 6 + Math.floor(t.rng() * 8);
      t.dot(x, y, t.rng() > 0.6 ? [252, 236, 150] : [220, 192, 96]);
    }
    t.dot(5, 5, [255, 250, 200]);
    t.dot(11, 6, [255, 250, 200]);
  },
  wheat_seeds: (t) => {
    t.clear();
    const seeds: [number, number][] = [
      [6, 7],
      [9, 6],
      [7, 9],
      [10, 9],
      [8, 7],
      [5, 10],
      [11, 7],
    ];
    for (const p of seeds) {
      t.dot(p[0], p[1], [150, 164, 80]);
      t.dot(p[0], p[1] + 1, [110, 124, 56]);
    }
  },
  wheat: (t) => {
    t.clear();
    const stalk: RGB = [210, 178, 70];
    const dark: RGB = [176, 140, 48];
    t.line(8, 14, 8, 4, [150, 140, 70]);
    for (let y = 4; y <= 10; y += 2) {
      t.dot(6, y, stalk);
      t.dot(7, y, dark);
      t.dot(9, y, dark);
      t.dot(10, y, stalk);
    }
    t.dot(7, 3, stalk);
    t.dot(8, 3, stalk);
    t.dot(9, 3, stalk);
  },
  book: (t) => {
    t.clear();
    const cover: RGB = [70, 58, 140];
    t.fillRect(4, 3, 9, 11, cover);
    t.fillRect(4, 3, 1, 11, shade(cover, 0.7));
    t.fillRect(11, 4, 2, 9, [232, 226, 208]);
    t.fillRect(6, 3, 1, 11, [220, 60, 60]);
  },
  bowl: (t) => {
    t.clear();
    drawBowl(t);
  },
  mushroom_stew: (t) => {
    t.clear();
    drawBowl(t);
    for (let x = 5; x <= 10; x++) {
      t.dot(x, 8, [168, 86, 54]);
      t.dot(x, 9, [150, 74, 46]);
    }
    t.dot(6, 8, [200, 120, 80]);
    t.dot(9, 9, [110, 150, 70]);
  },
  string: (t) => {
    t.clear();
    const c: RGB = [228, 226, 220];
    t.line(5, 3, 7, 6, c);
    t.line(7, 6, 5, 9, c);
    t.line(5, 9, 8, 12, c);
    t.line(8, 12, 6, 14, c);
    t.dot(9, 4, c);
    t.dot(10, 6, c);
    t.dot(9, 8, c);
    t.dot(11, 10, c);
  },
  apple: (t) => {
    t.clear();
    t.ball(8, 9, 4.6, [202, 52, 48]);
    t.dot(8, 3, [110, 74, 40]);
    t.dot(8, 4, [110, 74, 40]);
    t.dot(9, 3, [86, 150, 58]);
    t.dot(10, 3, [86, 150, 58]);
    t.dot(6, 7, [240, 140, 130]);
  },
  bread: (t) => {
    t.clear();
    const rows: [number, number, number][] = [
      [5, 4, 11],
      [6, 3, 12],
      [7, 3, 12],
      [8, 3, 12],
      [9, 4, 11],
      [10, 5, 10],
    ];
    for (const r of rows) {
      for (let x = r[1]; x <= r[2]; x++) {
        let c: RGB = [186, 132, 64];
        if (r[0] === 5) c = [214, 164, 90];
        else if (r[0] === 10) c = [150, 102, 48];
        t.dot(x, r[0], c);
      }
    }
    const marks = [5, 8, 11];
    for (const x of marks) {
      t.dot(x, 6, [150, 100, 50]);
      t.dot(x, 7, [150, 100, 50]);
    }
  },
  cooked_meat: (t) => {
    t.clear();
    const rows: [number, number, number][] = [
      [5, 5, 11],
      [6, 4, 12],
      [7, 3, 12],
      [8, 4, 12],
      [9, 5, 11],
      [10, 6, 10],
    ];
    for (const r of rows) {
      for (let x = r[1]; x <= r[2]; x++) {
        let c: RGB = [168, 96, 66];
        if (x === r[1] || x === r[2]) c = [120, 64, 42];
        else if (r[0] === 5) c = [192, 120, 86];
        t.dot(x, r[0], c);
      }
    }
    t.dot(3, 11, [236, 230, 214]);
    t.dot(4, 10, [236, 230, 214]);
    t.dot(2, 12, [236, 230, 214]);
  },
};

// Register the 20 tool icons from the shared template.
const TOOL_MAT: { [name: string]: RGB } = {
  wooden: [142, 100, 58],
  stone: [126, 126, 130],
  iron: [206, 208, 214],
  gold: [236, 206, 84],
  diamond: [104, 208, 214],
};
const TOOL_SHAPES: string[] = ['pickaxe', 'axe', 'shovel', 'sword'];
for (const matName of Object.keys(TOOL_MAT)) {
  const mat = TOOL_MAT[matName];
  for (const shape of TOOL_SHAPES) {
    painters[matName + '_' + shape] = (t) => drawTool(t, mat, shape);
  }
}

// Deterministic noisy-solid fallback so an unknown key is never blank.
function fallback(t: Tile, seed: number): void {
  const r = 64 + (seed & 127);
  const g = 64 + ((seed >>> 7) & 127);
  const b = 64 + ((seed >>> 14) & 127);
  t.fill([r, g, b]);
  t.noiseOverlay(24);
  t.ao();
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

// Writes TILE*TILE*4 RGBA bytes (row-major, top-left origin, y increases
// downward) into `out` starting at byte index `offset`. Alpha 0 = transparent.
export function paintTile(key: string, out: Uint8ClampedArray, offset: number): void {
  const seed = hashStr(key);
  const t = new Tile(out, offset, mulberry32(seed));
  const painter = painters[key];
  if (painter) painter(t);
  else fallback(t, seed);
}
