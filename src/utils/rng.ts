// ---------------------------------------------------------------------------
// Deterministic pseudo-random utilities. All world generation is seeded so a
// given seed always produces the same world on every machine.
// ---------------------------------------------------------------------------

/** Hash a string seed into a 32-bit unsigned integer (xfnv1a). */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  }
  // Extra mixing.
  h += h << 13; h ^= h >>> 7;
  h += h << 3;  h ^= h >>> 17;
  h += h << 5;
  return h >>> 0;
}

/** Mulberry32 PRNG factory — fast, tiny, good enough for terrain features. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic per-coordinate hash → float in [0,1). Order-independent, so it
 * is safe to sample feature placement without a running stream.
 */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x1b873593);
  h = Math.imul(h ^ (y | 0), 0xcc9e2d51);
  h = Math.imul(h ^ (z | 0), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash2(x: number, z: number, seed: number): number {
  return hash3(x, 0, z, seed);
}
