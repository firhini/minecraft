// Procedural sound synthesis for a browser voxel game.
// Everything is generated live from oscillators and noise buffers via the
// Web Audio API — there are no audio files. Each exported function plays a
// single short one-shot routed to the provided `out` node (the master bus).
//
// Note: Math.random() is intentionally NOT used anywhere. Per-event variation
// comes from a module-level counter feeding a deterministic mulberry32 PRNG,
// so successive footsteps differ slightly but reproducibly.

export type Material =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'wood'
  | 'sand'
  | 'gravel'
  | 'glass'
  | 'leaves'
  | 'wool'
  | 'default';

// ---------------------------------------------------------------------------
// Deterministic pseudo-randomness (no Math.random)
// ---------------------------------------------------------------------------

// Global counter advanced on every event so repeated sounds vary a little.
let seedCounter = 0x9e3779b9 | 0;

/** Advance and return the next seed value. */
function nextSeed(): number {
  seedCounter = (seedCounter + 0x6d2b79f5) | 0;
  return seedCounter;
}

/** mulberry32 — tiny, fast, deterministic PRNG returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function (): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Reusable noise buffer (one per AudioContext)
// ---------------------------------------------------------------------------

const noiseCache = new WeakMap<AudioContext, AudioBuffer>();

/** One second of white noise, generated once per context and reused. */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;

  const length = Math.floor(ctx.sampleRate); // ~1s
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const rnd = mulberry32(0x1234abcd); // fixed seed => stable, reusable noise
  for (let i = 0; i < length; i++) {
    data[i] = rnd() * 2 - 1;
  }
  noiseCache.set(ctx, buf);
  return buf;
}

// ---------------------------------------------------------------------------
// Small building-block helpers
// ---------------------------------------------------------------------------

/**
 * Create a per-sound GainNode with a click-free attack/decay envelope.
 * Ramps 0 -> peak over `attack`, then decays to silence over `decay`.
 */
function envGain(
  ctx: AudioContext,
  out: AudioNode,
  peak: number,
  attack: number,
  decay: number,
  startTime: number,
): GainNode {
  const g = ctx.createGain();
  // exponentialRamp needs a strictly positive target, so use a tiny floor.
  g.gain.setValueAtTime(0.0001, startTime);
  g.gain.linearRampToValueAtTime(peak, startTime + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + attack + decay);
  g.connect(out);
  return g;
}

/**
 * Play a single enveloped oscillator. Optionally glides to `endFreq`.
 * The oscillator is explicitly stopped once its envelope has finished.
 */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  type: OscillatorType,
  freq: number,
  peak: number,
  attack: number,
  decay: number,
  startTime: number,
  endFreq?: number,
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  if (endFreq !== undefined && endFreq > 0) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + attack + decay);
  }
  const g = envGain(ctx, out, peak, attack, decay, startTime);
  osc.connect(g);
  osc.start(startTime);
  osc.stop(startTime + attack + decay + 0.03);
  return osc;
}

/**
 * Play a filtered burst of the cached noise buffer (percussive texture).
 * `rate` skews the playback speed for subtle timbral variation. A randomized
 * read offset keeps repeated bursts from sounding identical.
 */
function noiseBurst(
  ctx: AudioContext,
  out: AudioNode,
  filterType: BiquadFilterType,
  freq: number,
  Q: number,
  peak: number,
  attack: number,
  decay: number,
  startTime: number,
  rate = 1,
): AudioBufferSourceNode {
  const buf = noiseBuffer(ctx);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.setValueAtTime(rate, startTime);

  const filter = ctx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(freq, startTime);
  filter.Q.setValueAtTime(Q, startTime);

  const g = envGain(ctx, out, peak, attack, decay, startTime);
  src.connect(filter);
  filter.connect(g);

  const dur = attack + decay + 0.05;
  const rnd = mulberry32(nextSeed());
  const offset = rnd() * Math.max(0, buf.duration - dur - 0.05);
  src.start(startTime, offset, dur);
  src.stop(startTime + dur);
  return src;
}

// ---------------------------------------------------------------------------
// Material profiles: how each block type "sounds" when hit
// ---------------------------------------------------------------------------

interface MatProfile {
  filterType: BiquadFilterType;
  freq: number; // filter center/cutoff
  Q: number;
  decay: number; // base decay time for a dig
  peak: number; // relative loudness multiplier
  tock?: number; // optional pitched "tock" base frequency (wood etc.)
  tockType?: OscillatorType;
  ping?: number; // optional high metallic/glassy ping frequency
}

const MATERIALS: Record<Material, MatProfile> = {
  // Soft high-passed rustle.
  grass: { filterType: 'highpass', freq: 2200, Q: 0.7, decay: 0.07, peak: 0.85 },
  leaves: { filterType: 'highpass', freq: 3200, Q: 0.6, decay: 0.06, peak: 0.7 },
  // Low, muffled thuds.
  dirt: { filterType: 'lowpass', freq: 600, Q: 1.0, decay: 0.09, peak: 1.0 },
  sand: { filterType: 'lowpass', freq: 1000, Q: 0.7, decay: 0.08, peak: 0.8 },
  wool: { filterType: 'lowpass', freq: 700, Q: 0.7, decay: 0.08, peak: 0.65 },
  // Filtered noise bursts with different bandpass centers.
  stone: { filterType: 'bandpass', freq: 1000, Q: 1.4, decay: 0.1, peak: 1.0 },
  gravel: { filterType: 'bandpass', freq: 1700, Q: 2.2, decay: 0.11, peak: 1.0 },
  // Pitched "tock" plus a little noise.
  wood: { filterType: 'bandpass', freq: 1400, Q: 1.0, decay: 0.08, peak: 1.0, tock: 190, tockType: 'triangle' },
  // Bright noise + high ping.
  glass: { filterType: 'highpass', freq: 5000, Q: 0.7, decay: 0.06, peak: 0.9, ping: 2400 },
  // Neutral fallback.
  default: { filterType: 'bandpass', freq: 1000, Q: 1.0, decay: 0.09, peak: 1.0 },
};

/**
 * Core material-aware percussive hit shared by footsteps, digging, breaking
 * and placing. `basePeak` sets loudness, `decayScale` stretches the tail.
 */
function materialHit(
  ctx: AudioContext,
  out: AudioNode,
  material: Material,
  basePeak: number,
  decayScale: number,
): void {
  const t = ctx.currentTime;
  const rnd = mulberry32(nextSeed());
  const p = MATERIALS[material] ?? MATERIALS.default;

  const rate = 0.9 + rnd() * 0.2; // +/-10% character variation
  const peak = basePeak * p.peak;
  const decay = p.decay * decayScale;

  // Main filtered-noise body.
  noiseBurst(ctx, out, p.filterType, p.freq * rate, p.Q, peak, 0.003, decay, t, rate);

  // Optional pitched tock (wood).
  if (p.tock !== undefined) {
    tone(ctx, out, p.tockType ?? 'triangle', p.tock * rate, peak * 0.8, 0.002, decay, t, p.tock * rate * 0.6);
  }

  // Optional bright ping (glass).
  if (p.ping !== undefined) {
    tone(ctx, out, 'sine', p.ping * rate, peak * 0.5, 0.002, decay * 1.4, t);
  }
}

// ---------------------------------------------------------------------------
// Exported one-shot sounds
// ---------------------------------------------------------------------------

/** Footstep: a shorter, softer version of the dig sound for that material. */
export function playFootstep(ctx: AudioContext, out: AudioNode, material: Material): void {
  materialHit(ctx, out, material, 0.14, 0.6);
}

/** Dig: repeated while mining a block. */
export function playDig(ctx: AudioContext, out: AudioNode, material: Material): void {
  materialHit(ctx, out, material, 0.22, 1.0);
}

/** Break: the louder, weightier crunch when a block finally pops. */
export function playBreak(ctx: AudioContext, out: AudioNode, material: Material): void {
  materialHit(ctx, out, material, 0.34, 1.5);
  // Low body thump for a sense of mass.
  tone(ctx, out, 'sine', 150, 0.18, 0.004, 0.12, ctx.currentTime, 80);
}

/** Place: soft material hit plus a low tock to confirm placement. */
export function playPlace(ctx: AudioContext, out: AudioNode, material: Material): void {
  materialHit(ctx, out, material, 0.2, 0.7);
  tone(ctx, out, 'triangle', 160, 0.16, 0.003, 0.1, ctx.currentTime, 110);
}

/** UI click: a tiny bright triangle blip with a subtle harmonic. */
export function playUiClick(ctx: AudioContext, out: AudioNode): void {
  const t = ctx.currentTime;
  tone(ctx, out, 'triangle', 880, 0.14, 0.002, 0.05, t);
  tone(ctx, out, 'sine', 1320, 0.06, 0.002, 0.04, t);
}

/** UI hover: quieter and higher than the click. */
export function playUiHover(ctx: AudioContext, out: AudioNode): void {
  tone(ctx, out, 'sine', 1200, 0.05, 0.002, 0.03, ctx.currentTime);
}

/** Hurt: a short descending buzzy tone with a touch of grit. */
export function playHurt(ctx: AudioContext, out: AudioNode): void {
  const t = ctx.currentTime;
  tone(ctx, out, 'sawtooth', 300, 0.22, 0.004, 0.18, t, 110);
  noiseBurst(ctx, out, 'bandpass', 700, 1.0, 0.1, 0.004, 0.12, t);
}

/** Splash: a filtered white-noise swoosh with a sweeping bandpass. */
export function playSplash(ctx: AudioContext, out: AudioNode): void {
  const t = ctx.currentTime;
  const buf = noiseBuffer(ctx);
  const src = ctx.createBufferSource();
  src.buffer = buf;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.setValueAtTime(0.8, t);
  filter.frequency.setValueAtTime(400, t);
  filter.frequency.exponentialRampToValueAtTime(3000, t + 0.12); // rise
  filter.frequency.exponentialRampToValueAtTime(600, t + 0.35); // fall

  const g = envGain(ctx, out, 0.3, 0.02, 0.33, t);
  src.connect(filter);
  filter.connect(g);

  const rnd = mulberry32(nextSeed());
  const offset = rnd() * 0.4;
  src.start(t, offset, 0.38);
  src.stop(t + 0.38);
}

/** Pickup: a quick upward two-note blip (item collected). */
export function playPickup(ctx: AudioContext, out: AudioNode): void {
  const t = ctx.currentTime;
  tone(ctx, out, 'triangle', 660, 0.16, 0.003, 0.08, t);
  tone(ctx, out, 'triangle', 990, 0.16, 0.003, 0.1, t + 0.07);
}

/** Eat: two or three soft, muffled crunches. */
export function playEat(ctx: AudioContext, out: AudioNode): void {
  const t = ctx.currentTime;
  const rnd = mulberry32(nextSeed());
  for (let i = 0; i < 3; i++) {
    const dt = i * 0.11 + rnd() * 0.02;
    noiseBurst(ctx, out, 'lowpass', 500 + rnd() * 200, 0.9, 0.14, 0.004, 0.06, t + dt);
  }
}

/** Craft: a short, pleasant ascending arpeggio (C major triad). */
export function playCraft(ctx: AudioContext, out: AudioNode): void {
  const t = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99];
  for (let i = 0; i < notes.length; i++) {
    tone(ctx, out, 'triangle', notes[i], 0.14, 0.004, 0.14, t + i * 0.06);
  }
}

/** Open: a soft low thunk for opening inventory/chests. */
export function playOpen(ctx: AudioContext, out: AudioNode): void {
  const t = ctx.currentTime;
  tone(ctx, out, 'sine', 180, 0.2, 0.005, 0.14, t, 110);
  noiseBurst(ctx, out, 'lowpass', 400, 0.8, 0.08, 0.005, 0.1, t);
}
