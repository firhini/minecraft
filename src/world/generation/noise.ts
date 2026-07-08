import { createNoise2D, createNoise3D, type NoiseFunction2D, type NoiseFunction3D } from 'simplex-noise';
import { mulberry32 } from '../../utils/rng';

// ---------------------------------------------------------------------------
// Seeded noise utilities. Each field derives its own PRNG from the world seed
// plus a salt so different fields are decorrelated but fully deterministic.
// ---------------------------------------------------------------------------

export class Noise2D {
  private n: NoiseFunction2D;
  constructor(seed: number, salt: number) {
    this.n = createNoise2D(mulberry32((seed ^ (salt * 0x9e3779b1)) >>> 0));
  }
  sample(x: number, y: number): number {
    return this.n(x, y);
  }
  /** Fractal Brownian motion in [-1,1] (approx). */
  fbm(x: number, y: number, octaves: number, freq: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1, sum = 0, norm = 0, f = freq;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.n(x * f, y * f);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }
  /** Ridged fractal noise in [0,1], sharp ridges near 1. */
  ridged(x: number, y: number, octaves: number, freq: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1, sum = 0, norm = 0, f = freq;
    for (let o = 0; o < octaves; o++) {
      const v = 1 - Math.abs(this.n(x * f, y * f));
      sum += amp * v * v;
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }
}

export class Noise3D {
  private n: NoiseFunction3D;
  constructor(seed: number, salt: number) {
    this.n = createNoise3D(mulberry32((seed ^ (salt * 0x85ebca77)) >>> 0));
  }
  sample(x: number, y: number, z: number): number {
    return this.n(x, y, z);
  }
  fbm(x: number, y: number, z: number, octaves: number, freq: number, lacunarity = 2, gain = 0.5): number {
    let amp = 1, sum = 0, norm = 0, f = freq;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.n(x * f, y * f, z * f);
      norm += amp;
      amp *= gain;
      f *= lacunarity;
    }
    return sum / norm;
  }
}
