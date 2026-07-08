# VoxelCraft

A polished, original **voxel sandbox game** inspired by the gameplay of Minecraft, built to run entirely in the browser. Infinite procedural worlds, mining, building, crafting, survival, and a full day/night cycle — no server, no accounts, no downloads. Everything runs locally and works offline.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6) ![Three.js](https://img.shields.io/badge/Three.js-WebGL2-049ef4) ![Vite](https://img.shields.io/badge/Vite-bundled-646cff)

## Features

- **Infinite procedural terrain** — seeded, deterministic world generation with continents, mountains, rivers, beaches, oceans, caves, and ore veins.
- **Biomes** — plains, forest, desert, snowy taiga, mountains, beaches, rivers and oceans, each with their own blocks, trees and vegetation.
- **Chunk streaming** — chunks generate on background Web Workers and load/unload dynamically around the player, prioritised nearest-first.
- **Greedy meshing** with per-vertex **ambient occlusion**, face culling, a texture **array** (no atlas bleeding), and time-sliced rebuilds for a smooth frame rate.
- **Voxel lighting** — sky light and coloured block light (torches, glowstone) propagated with a flood fill, bleeding across chunk borders.
- **Day/night cycle** — moving sun, gradient sky, sunset colours, stars at night, distance fog.
- **First-person controls** — walking, sprinting, sneaking, jumping, swimming, and a creative fly mode, with swept-AABB collision and fixed-timestep physics.
- **Mining & building** — responsive block breaking with a progress crack overlay, tool tiers & mining speeds, block drops that pop out as collectable items, and accurate placement.
- **Inventory & crafting** — a hotbar, a full inventory grid with click-to-move stacking, a 2×2 personal crafting grid and a 3×3 crafting table, with an easily extended recipe system.
- **Survival** — health, hunger, saturation, breath, fall/drown/starvation damage, natural regeneration, respawning, and eating food.
- **Persistent saves** — the world, player, inventory and every block you place or break are stored locally in IndexedDB and reload exactly.
- **Procedural everything** — all block/item textures and all sound effects are generated in code (no external assets), keeping the game tiny and fully offline.

## Play

```bash
npm install
npm run dev      # open the printed localhost URL
```

Production build:

```bash
npm run build    # type-checks then bundles to dist/
npm run preview  # serve the production build
```

Requires a browser with **WebGL2** (recent Chrome, Edge, Firefox or Safari).

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look |
| `Space` | Jump / swim up |
| `Shift` | Sneak / descend (flying) |
| `Ctrl` or double-tap `W` | Sprint |
| Left click | Break block (hold) |
| Right click | Place block / use item / open table |
| `1`–`9`, mouse wheel | Select hotbar slot |
| `E` | Open inventory |
| Double-tap `Space` | Toggle fly (creative mode) |
| `F3` | Debug overlay |
| `Esc` | Pause |

## Architecture

The codebase is organised into modular systems under `src/`:

```
core/        game loop, input, settings, constants
world/       chunks, world store, streaming manager, dropped items
  blocks/       block & item type definitions + registry
  generation/   seeded noise, terrain generator, worker pool
  meshing/      greedy mesher with AO
  lighting/     sky + block light flood fill
render/      WebGL2 renderer glue: texture array, chunk shader, sky, view model
player/      physics (AABB), controller, raycaster, interaction
inventory/   inventory model + item registry
crafting/    recipe system
survival/    health / hunger / damage
audio/       procedural Web Audio synthesis
save/        IndexedDB persistence
ui/          HUD, inventory screen, menus
```

### Performance notes

- Terrain generation runs on a pool of Web Workers; the main thread only stores block data (needed for physics/raycasting).
- Meshing uses greedy quads merged by block, texture layer, light and AO, with per-frame time budgeting so streaming never stalls the render loop.
- A `sampler2DArray` texture (one layer per tile) with mipmaps avoids the seams and bleeding of a packed atlas while keeping a single draw call per chunk layer.
- Light and mesh rebuilds are queued and processed nearest-first under a millisecond budget.

## License

Original work. Inspired by the voxel-sandbox genre; contains no assets or code from Minecraft.
