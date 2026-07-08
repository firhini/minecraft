import * as THREE from 'three';
import { Block } from '../world/blocks/types';
import { BLOCKS } from '../world/blocks/registry';
import { getItem } from '../inventory/items';
import { raycastVoxels, type RayHit } from './Raycaster';
import type { World } from '../world/World';
import type { ChunkManager } from '../world/ChunkManager';
import type { Player } from './Player';
import type { Input } from '../core/Input';
import type { Inventory } from '../inventory/Inventory';
import type { Survival } from '../survival/Survival';
import type { AudioEngine } from '../audio/AudioEngine';
import type { SaveManager } from '../save/SaveManager';
import type { DroppedItems } from '../world/DroppedItems';

// ---------------------------------------------------------------------------
// Mining, block placement and item use. Owns the block-selection outline and
// the progressive crack overlay. Emits events when a container UI should open.
// ---------------------------------------------------------------------------

const REACH = 5;

export class Interaction {
  private selection: THREE.LineSegments;
  private crackMesh: THREE.Mesh;
  private crackTextures: THREE.Texture[];
  private crackMaterial: THREE.MeshBasicMaterial;

  private miningKey = '';
  private progress = 0;
  private required = 0;
  private canHarvest = false;
  private digTimer = 0;

  target: RayHit | null = null;
  uiBlocking = false;
  creative = false;
  swing = 0; // 0..1 swing animation phase driver

  onOpenCrafting: ((size: number) => void) | null = null;

  private dir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private world: World,
    private chunks: ChunkManager,
    private player: Player,
    private camera: THREE.PerspectiveCamera,
    private inventory: Inventory,
    private survival: Survival,
    private audio: AudioEngine,
    private save: SaveManager,
    private dropped: DroppedItems,
  ) {
    // Selection outline.
    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const edges = new THREE.EdgesGeometry(box);
    const mat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 });
    this.selection = new THREE.LineSegments(edges, mat);
    this.selection.visible = false;
    this.selection.renderOrder = 999;
    scene.add(this.selection);

    // Crack overlay.
    this.crackTextures = makeCrackTextures();
    this.crackMaterial = new THREE.MeshBasicMaterial({
      map: this.crackTextures[0], transparent: true, opacity: 0.7,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), this.crackMaterial);
    this.crackMesh.visible = false;
    this.crackMesh.renderOrder = 998;
    scene.add(this.crackMesh);
  }

  update(input: Input, dt: number): void {
    this.camera.getWorldDirection(this.dir);
    const eye = this.camera.position;
    this.target = raycastVoxels(this.world, eye.x, eye.y, eye.z, this.dir.x, this.dir.y, this.dir.z, REACH);

    // Selection.
    if (this.target) {
      this.selection.visible = true;
      this.selection.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
    } else {
      this.selection.visible = false;
    }

    if (this.uiBlocking) {
      this.resetMining();
      return;
    }

    const held = this.inventory.getSelected();

    // Break (hold left).
    if (input.mouseButtons[0] && this.target) {
      this.mine(this.target, held, dt);
    } else {
      this.resetMining();
    }

    // Place / use (right click edge).
    if (input.mousePressed[2] && this.target) {
      this.use(this.target, held);
    }

    // Pick block (middle click).
    if (input.mousePressed[1] && this.target) {
      this.pickBlock(this.target);
    }

    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt * 3.5);
  }

  private mine(hit: RayHit, held: ReturnType<Inventory['getSelected']>, dt: number): void {
    const block = this.world.getBlock(hit.x, hit.y, hit.z);
    const def = BLOCKS[block];
    if (block === Block.Air || def.hardness < 0) { this.resetMining(); return; }

    const key = `${hit.x},${hit.y},${hit.z}`;
    if (key !== this.miningKey) {
      this.miningKey = key;
      this.progress = 0;
      const t = this.computeMiningTime(def, held);
      this.required = t.time;
      this.canHarvest = t.canHarvest;
      this.digTimer = 0;
    }

    if (this.creative) { this.breakBlock(hit, block, def, held, true); this.resetMining(); return; }

    this.progress += dt;
    this.digTimer -= dt;
    if (this.digTimer <= 0) {
      this.audio.dig(block);
      this.digTimer = 0.28;
      this.swing = 1;
    }

    // Crack overlay.
    if (this.required > 0.05) {
      const stage = Math.min(9, Math.floor((this.progress / this.required) * 10));
      this.crackMesh.visible = true;
      this.crackMesh.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      this.crackMaterial.map = this.crackTextures[stage];
      this.crackMaterial.needsUpdate = true;
    }

    if (this.progress >= this.required) {
      this.breakBlock(hit, block, def, held, this.canHarvest);
      this.resetMining();
    }
  }

  private computeMiningTime(def: typeof BLOCKS[number], held: ReturnType<Inventory['getSelected']>): { time: number; canHarvest: boolean } {
    if (def.hardness <= 0) return { time: 0, canHarvest: true };
    const hd = held ? getItem(held.id) : undefined;
    const matches = !!hd && hd.tool === def.preferredTool && def.preferredTool !== 'none';
    const speed = matches ? (hd!.toolSpeed ?? 1) : 1;
    const canHarvest = def.minTier === 0 || (matches && (hd!.tier ?? 0) >= def.minTier);
    const base = canHarvest ? def.hardness * 1.5 : def.hardness * 5;
    return { time: base / speed, canHarvest };
  }

  private breakBlock(hit: RayHit, block: number, def: typeof BLOCKS[number], held: ReturnType<Inventory['getSelected']>, harvest: boolean): void {
    this.world.setBlock(hit.x, hit.y, hit.z, Block.Air);
    this.save.recordEdit(hit.x, hit.y, hit.z, Block.Air);
    this.chunks.editRemesh(hit.x, hit.z);
    this.audio.breakBlock(block);
    this.swing = 1;

    // Drops.
    if (harvest && !this.creative) {
      this.produceDrops(def, hit.x, hit.y, hit.z);
    }

    // Tool durability.
    if (!this.creative && held && getItem(held.id)?.tool && def.hardness > 0) {
      this.inventory.damageSelected(1);
    }
  }

  private produceDrops(def: typeof BLOCKS[number], x: number, y: number, z: number): void {
    const cx = x + 0.5, cy = y + 0.5, cz = z + 0.5;
    if (def.drops === null) {
      this.dropped.spawn(def.itemId, 1, cx, cy, cz);
      return;
    }
    for (const drop of def.drops) {
      if (drop.chance !== undefined && Math.random() > drop.chance) continue;
      const min = drop.min ?? 1;
      const max = drop.max ?? min;
      const count = min + Math.floor(Math.random() * (max - min + 1));
      if (count > 0) this.dropped.spawn(drop.item, count, cx, cy, cz);
    }
  }

  private use(hit: RayHit, held: ReturnType<Inventory['getSelected']>): void {
    const block = this.world.getBlock(hit.x, hit.y, hit.z);

    // Open crafting table.
    if (block === Block.CraftingTable && !this.player.sneaking) {
      this.onOpenCrafting?.(3);
      this.audio.open();
      return;
    }

    if (!held) return;
    const item = getItem(held.id);
    if (!item) return;

    // Eat food.
    if (item.food !== undefined && this.survival.hunger < 20) {
      this.survival.eat(item.food, item.saturation ?? 0);
      this.audio.eat();
      this.inventory.consumeSelected();
      this.swing = 1;
      return;
    }

    // Place block.
    if (item.placeBlock !== undefined) {
      this.placeBlock(hit, item.placeBlock);
    }
  }

  private placeBlock(hit: RayHit, blockId: Block): void {
    const px = hit.px, py = hit.py, pz = hit.pz;
    if (py < 0 || py >= 160) return;
    const existing = this.world.getBlock(px, py, pz);
    const exDef = BLOCKS[existing];
    if (existing !== Block.Air && !exDef.replaceable) return;

    const def = BLOCKS[blockId];
    if (def.solid && this.overlapsPlayer(px, py, pz)) return;

    // Plants/torches need a solid block beneath.
    if (def.cross) {
      const below = BLOCKS[this.world.getBlock(px, py - 1, pz)];
      if (!below.solid) return;
    }

    this.world.setBlock(px, py, pz, blockId);
    this.save.recordEdit(px, py, pz, blockId);
    this.chunks.editRemesh(px, pz);
    this.audio.place(blockId);
    this.swing = 1;
    if (!this.creative) this.inventory.consumeSelected();
  }

  private pickBlock(hit: RayHit): void {
    const block = this.world.getBlock(hit.x, hit.y, hit.z);
    const def = BLOCKS[block];
    if (block === Block.Air) return;
    const itemId = def.itemId;
    if (this.creative) {
      const sel = this.inventory.selected;
      this.inventory.set(sel, { id: itemId, count: 1 });
    } else {
      // Select an existing hotbar slot holding this item if present.
      for (let i = 0; i < 9; i++) {
        const s = this.inventory.get(i);
        if (s && s.id === itemId) { this.inventory.selectHotbar(i); return; }
      }
    }
  }

  private overlapsPlayer(bx: number, by: number, bz: number): boolean {
    const p = this.player.pos;
    const hw = 0.3, h = 1.8;
    return (
      bx + 1 > p.x - hw && bx < p.x + hw &&
      by + 1 > p.y && by < p.y + h &&
      bz + 1 > p.z - hw && bz < p.z + hw
    );
  }

  private resetMining(): void {
    this.miningKey = '';
    this.progress = 0;
    this.crackMesh.visible = false;
  }

  setSelectionVisible(v: boolean): void {
    if (!v) { this.selection.visible = false; this.crackMesh.visible = false; }
  }
}

// --- Procedural crack overlay textures (10 stages) ---------------------------
function makeCrackTextures(): THREE.Texture[] {
  const textures: THREE.Texture[] = [];
  const S = 16;
  for (let stage = 0; stage < 10; stage++) {
    const canvas = document.createElement('canvas');
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 1;
    const cracks = stage + 1;
    // Deterministic-ish crack lines seeded by stage.
    let seed = stage * 9301 + 49297;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let c = 0; c < cracks; c++) {
      let x = rnd() * S, y = rnd() * S;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segs = 2 + Math.floor(rnd() * 3);
      for (let s = 0; s < segs; s++) {
        x += (rnd() - 0.5) * S * 0.6;
        y += (rnd() - 0.5) * S * 0.6;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    textures.push(tex);
  }
  return textures;
}
