// ---------------------------------------------------------------------------
// Global engine constants. Kept in one place so tuning is trivial and workers
// and the main thread share exactly the same world layout.
// ---------------------------------------------------------------------------

/** Horizontal size of a chunk (blocks) in both X and Z. Power of two for cheap bit math. */
export const CHUNK_SIZE = 16;
export const CHUNK_SIZE_BITS = 4; // log2(CHUNK_SIZE)
export const CHUNK_SIZE_MASK = CHUNK_SIZE - 1;

/** Vertical extent of the world (blocks). */
export const WORLD_HEIGHT = 160;

/** Sea level used by terrain generation and water fill. */
export const SEA_LEVEL = 62;

/** Number of blocks in a single chunk column. */
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

/** Highest light level (sun at midday, torches, etc.). */
export const MAX_LIGHT = 15;

/** Gravity in blocks / second^2. Tuned to feel like classic voxel games. */
export const GRAVITY = 28;

/** Terminal falling speed (blocks/s). */
export const TERMINAL_VELOCITY = 55;

/** Fixed physics timestep (seconds). Physics is integrated at a fixed rate for determinism. */
export const PHYSICS_DT = 1 / 120;

/** Full day length in seconds. */
export const DAY_LENGTH = 600;

export const TICK_RATE = 20; // world ticks / second (block updates, plant growth, etc.)
