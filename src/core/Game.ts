import * as THREE from 'three';
import { PHYSICS_DT, SEA_LEVEL, WORLD_HEIGHT } from './constants';
import { Settings, type SettingsData } from './Settings';
import { Input } from './Input';
import { TextureAtlas } from '../render/TextureAtlas';
import { ChunkMaterials } from '../render/ChunkMaterial';
import { ChunkManager } from '../world/ChunkManager';
import { Sky } from '../render/Sky';
import { Player } from '../player/Player';
import { Interaction } from '../player/Interaction';
import { Survival } from '../survival/Survival';
import { Inventory } from '../inventory/Inventory';
import { getItem } from '../inventory/items';
import { AudioEngine } from '../audio/AudioEngine';
import { SaveManager, type SaveMeta } from '../save/SaveManager';
import { DroppedItems } from '../world/DroppedItems';
import { TerrainGenerator, Biome } from '../world/generation/TerrainGenerator';
import { BLOCKS } from '../world/blocks/registry';
import { Block } from '../world/blocks/types';
import { hashSeed } from '../utils/rng';
import { HUD } from '../ui/HUD';
import { InventoryUI } from '../ui/InventoryUI';
import { Menus } from '../ui/Menus';
import { HeldItemView } from '../render/HeldItemView';

type State = 'title' | 'loading' | 'playing' | 'paused' | 'inventory' | 'dead';
const SAVE_VERSION = 1;
const BIOME_NAMES = ['Ocean', 'Beach', 'Plains', 'Forest', 'Desert', 'Mountains', 'Snowy', 'River'];

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private atlas: TextureAtlas;
  private materials: ChunkMaterials;
  private input: Input;
  private settings = new Settings();
  private audio = new AudioEngine();
  private save = new SaveManager();

  private hud: HUD;
  private inventoryUI: InventoryUI;
  private menus: Menus;
  private overlay: HTMLDivElement;
  private clickPrompt: HTMLDivElement;
  private waterOverlay: HTMLDivElement;
  private damageFlash: HTMLDivElement;

  // Per-world systems (created on start).
  private chunks: ChunkManager | null = null;
  private sky: Sky | null = null;
  private player = new Player();
  private survival = new Survival();
  private inventory = new Inventory();
  private dropped: DroppedItems | null = null;
  private interaction: Interaction | null = null;
  private heldView: HeldItemView | null = null;
  private previewGen: TerrainGenerator | null = null;

  private state: State = 'title';
  private seed = 0;
  private spawnX = 0.5;
  private spawnZ = 0.5;
  private creative = false;
  private accumulator = 0;
  private lastTime = 0;
  private time = 0;
  private fpsSmooth = 60;
  private stepDist = 0;
  private autosaveTimer = 0;
  private spawnResolved = false;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(this.settings.data.fov, window.innerWidth / window.innerHeight, 0.05, 1000);

    this.atlas = new TextureAtlas();
    this.materials = new ChunkMaterials(this.atlas);
    this.input = new Input(this.renderer.domElement);

    // UI overlay layer.
    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    container.appendChild(this.overlay);

    this.hud = new HUD(this.atlas);
    this.hud.root.style.display = 'none';
    this.overlay.appendChild(this.hud.root);

    this.inventoryUI = new InventoryUI(this.atlas, this.inventory, this.audio);
    this.overlay.appendChild(this.inventoryUI.root);
    this.inventoryUI.onClose = () => this.closeInventory();

    this.menus = new Menus(this.settings, this.audio, {
      onPlay: (seed, creative) => this.startNewWorld(seed, creative),
      onContinue: () => this.continueWorld(),
      onResume: () => this.resume(),
      onQuit: () => this.quitToTitle(),
      onRespawn: () => this.respawn(),
      onDeleteWorld: () => this.deleteWorld(),
    });
    this.overlay.appendChild(this.menus.root);

    this.clickPrompt = document.createElement('div');
    this.clickPrompt.className = 'click-prompt';
    this.clickPrompt.textContent = 'Click to play';
    this.clickPrompt.style.display = 'none';
    this.overlay.appendChild(this.clickPrompt);

    this.waterOverlay = document.createElement('div');
    this.waterOverlay.className = 'water-overlay';
    this.overlay.appendChild(this.waterOverlay);
    this.damageFlash = document.createElement('div');
    this.damageFlash.className = 'damage-flash';
    this.overlay.appendChild(this.damageFlash);

    this.wireEvents();
    this.applyRenderDistance();

    // Debug handle (used by dev tooling / screenshots).
    (window as unknown as { __vc: Game }).__vc = this;

    this.inventory.onChange = () => { this.hud.updateHotbar(this.inventory); this.save.markDirty(); };
    this.settings.onChange = (s) => this.applySettings(s);
    this.applySettings(this.settings.data);
  }

  async init(): Promise<void> {
    try { await this.save.open(); } catch { /* storage may be unavailable */ }
    const hasSave = await this.save.hasSave().catch(() => false);
    this.menus.showTitle(hasSave);
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  private wireEvents(): void {
    window.addEventListener('resize', () => this.onResize());
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
      if (locked && (this.state === 'playing')) this.clickPrompt.style.display = 'none';
    };
    this.renderer.domElement.addEventListener('click', () => {
      this.audio.resume();
      if (this.state === 'playing' && !this.input.locked) this.input.requestLock();
    });
  }

  private applySettings(s: SettingsData): void {
    this.audio.volume = s.volume;
    this.player.sensitivity = 0.0022 * s.sensitivity;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.materials.shared.uWaveAmp.value = s.waveEffects ? 0.06 : 0;
    if (this.chunks && this.chunks.viewDistance !== s.renderDistance) {
      this.chunks.setViewDistance(s.renderDistance);
      this.applyRenderDistance();
    }
    this.creative = s.creative;
    this.player.canFly = s.creative;
    this.survival.enabled = !s.creative;
    if (this.interaction) this.interaction.creative = s.creative;
  }

  private applyRenderDistance(): void {
    const vd = this.settings.data.renderDistance;
    const far = (vd + 1) * 16 + 24;
    this.camera.far = far + 200;
    this.camera.updateProjectionMatrix();
    this.materials.shared.uFogNear.value = far * 0.55;
    this.materials.shared.uFogFar.value = far * 0.92;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // --- World lifecycle -------------------------------------------------------

  private startNewWorld(seedStr: string, creative: boolean): void {
    const seed = seedStr ? (/^\d+$/.test(seedStr) ? parseInt(seedStr, 10) >>> 0 : hashSeed(seedStr)) : (Math.floor(Math.random() * 0xffffffff) >>> 0);
    this.settings.set('creative', creative);
    this.save.deleteWorld();
    this.beginWorld(seed, creative, null);
  }

  private async continueWorld(): Promise<void> {
    const loaded = await this.save.load();
    if (!loaded) { this.menus.showTitle(false); return; }
    this.beginWorld(loaded.meta.seed, loaded.meta.creative, loaded.meta);
  }

  private beginWorld(seed: number, creative: boolean, meta: SaveMeta | null): void {
    this.audio.resume();
    this.seed = seed;
    this.creative = creative;
    this.settings.set('creative', creative);
    this.previewGen = new TerrainGenerator(seed);

    // Fresh scene.
    this.disposeWorld();
    this.scene = new THREE.Scene();

    this.chunks = new ChunkManager(this.scene, seed, this.atlas, this.materials, this.settings.data.renderDistance);
    this.chunks.save = this.save;
    this.sky = new Sky(this.scene, this.materials, meta ? meta.time : 0.3);
    this.dropped = new DroppedItems(this.scene, this.chunks.world, this.atlas);
    this.dropped.onPickup = () => this.audio.pickup();
    this.heldView = new HeldItemView(this.renderer, this.atlas);

    this.survival.enabled = !creative;
    this.survival.respawn();
    this.survival.onDamage = (_a, cause) => { if (cause !== 'starve') this.audio.hurt(); this.flashDamage(); };
    this.survival.onDeath = () => this.onDeath();

    this.interaction = new Interaction(
      this.scene, this.chunks.world, this.chunks, this.player, this.camera,
      this.inventory, this.survival, this.audio, this.save, this.dropped,
    );
    this.interaction.creative = creative;
    this.interaction.onOpenCrafting = (size) => this.openInventory(size);

    // Player / inventory state.
    if (meta) {
      this.player.teleport(meta.player.x, meta.player.y, meta.player.z);
      this.player.yaw = meta.player.yaw;
      this.player.pitch = meta.player.pitch;
      this.inventory.load(meta.inventory as any);
      this.inventory.selected = meta.selected;
      this.survival.load(meta.survival);
      this.spawnResolved = true;
    } else {
      this.setupNewInventory();
      this.findSpawn();
      const h = this.previewGen.heightAt(Math.floor(this.spawnX), Math.floor(this.spawnZ));
      this.player.teleport(this.spawnX, Math.max(h, SEA_LEVEL) + 2, this.spawnZ);
      this.player.yaw = 0; this.player.pitch = 0;
      this.spawnResolved = false;
    }
    this.player.canFly = creative;

    this.hud.updateHotbar(this.inventory);
    this.applyRenderDistance();

    this.state = 'loading';
    this.menus.showLoading();
    this.hud.root.style.display = 'none';
  }

  /** Find a pleasant on-land spawn near the origin (avoids oceans/rivers). */
  private findSpawn(): void {
    const gen = this.previewGen!;
    let best: { x: number; z: number; h: number } | null = null;
    for (let r = 0; r <= 80; r += 4) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * r);
        const z = Math.round(Math.sin(ang) * r);
        const col = gen.column(x, z);
        if (col.biome === Biome.Ocean || col.biome === Biome.River || col.submerged) continue;
        if (col.height <= SEA_LEVEL) continue;
        best = { x, z, h: col.height };
        break;
      }
      if (best) break;
    }
    if (!best) best = { x: 0, z: 0, h: gen.heightAt(0, 0) };
    this.spawnX = best.x + 0.5;
    this.spawnZ = best.z + 0.5;
  }

  private setupNewInventory(): void {
    this.inventory.load(new Array(36).fill(null));
    if (this.creative) {
      // Handy creative starting kit.
      const kit = ['grass', 'dirt', 'stone', 'cobblestone', 'planks', 'log', 'glass', 'torch', 'glowstone'];
      kit.forEach((id, i) => this.inventory.set(i, { id, count: 64 }));
    } else {
      this.inventory.set(0, { id: 'wooden_pickaxe', count: 1, durability: getItem('wooden_pickaxe')?.durability });
      this.inventory.set(1, { id: 'wooden_axe', count: 1, durability: getItem('wooden_axe')?.durability });
      this.inventory.set(2, { id: 'torch', count: 16 });
      this.inventory.set(3, { id: 'bread', count: 4 });
    }
  }

  private disposeWorld(): void {
    this.chunks?.dispose();
    this.dropped?.clear();
    this.heldView?.dispose();
    this.chunks = null;
    this.sky = null;
    this.interaction = null;
    this.dropped = null;
    this.heldView = null;
  }

  private quitToTitle(): void {
    this.persist();
    this.input.exitLock();
    this.disposeWorld();
    this.scene = new THREE.Scene();
    this.state = 'title';
    this.hud.root.style.display = 'none';
    this.clickPrompt.style.display = 'none';
    this.save.hasSave().then((h) => this.menus.showTitle(h));
  }

  // --- Pause / inventory -----------------------------------------------------

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitLock();
    this.player.clearIntent();
    this.menus.showPause();
    this.clickPrompt.style.display = 'none';
  }

  private resume(): void {
    this.menus.hideAll();
    this.state = 'playing';
    this.hud.root.style.display = 'block';
    this.audio.resume();
    this.input.requestLock();
  }

  private openInventory(size: number): void {
    if (this.state !== 'playing') return;
    this.state = 'inventory';
    this.player.clearIntent();
    if (this.interaction) this.interaction.uiBlocking = true;
    this.input.exitLock();
    this.inventoryUI.open(size);
  }

  private closeInventory(): void {
    if (this.state !== 'inventory') return;
    this.state = 'playing';
    if (this.interaction) this.interaction.uiBlocking = false;
    this.hud.updateHotbar(this.inventory);
    this.input.requestLock();
  }

  private onDeath(): void {
    this.state = 'dead';
    this.input.exitLock();
    this.menus.showDeath();
  }

  private respawn(): void {
    this.survival.respawn();
    const y = this.chunks ? this.findSurface(Math.floor(this.spawnX), Math.floor(this.spawnZ)) : SEA_LEVEL + 2;
    this.player.teleport(this.spawnX, y, this.spawnZ);
    this.player.yaw = 0; this.player.pitch = 0;
    this.menus.hideAll();
    this.state = 'playing';
    this.hud.root.style.display = 'block';
    this.input.requestLock();
  }

  private async deleteWorld(): Promise<void> {
    await this.save.deleteWorld();
    this.menus.showTitle(false);
  }

  // --- Persistence -----------------------------------------------------------

  private persist(): void {
    if (!this.chunks || !this.sky) return;
    const meta: SaveMeta = {
      seed: this.seed,
      version: SAVE_VERSION,
      time: this.sky.time,
      player: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, yaw: this.player.yaw, pitch: this.player.pitch },
      survival: this.survival.serialize(),
      inventory: this.inventory.serialize(),
      selected: this.inventory.selected,
      creative: this.creative,
    };
    this.save.persist(meta);
  }

  // --- Main loop -------------------------------------------------------------

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.1) dt = 0.1;
    this.time += dt;
    this.fpsSmooth += ((1 / Math.max(dt, 1e-3)) - this.fpsSmooth) * 0.1;

    if (this.state === 'loading') this.updateLoading(dt);
    else if (this.state === 'playing') this.updatePlaying(dt);
    else if (this.state === 'inventory') this.updateBackground(dt);

    this.render();
    this.input.endFrame();
  };

  private updateLoading(dt: number): void {
    if (!this.chunks || !this.previewGen) return;
    this.chunks.update(this.player.pos.x, this.player.pos.z);
    this.sky?.update(dt, this.camera.position);

    const radius = 2;
    const target = (radius * 2 + 1) * (radius * 2 + 1);
    const ready = this.chunks.readyCount(radius);
    this.menus.setLoadingProgress(ready / target, `${ready} / ${target} chunks`);

    // Resolve a safe spawn once the spawn column exists.
    const scx = Math.floor(this.spawnX / 16), scz = Math.floor(this.spawnZ / 16);
    if (!this.spawnResolved && this.chunks.world.hasBlocks(scx, scz)) {
      const y = this.findSurface(Math.floor(this.spawnX), Math.floor(this.spawnZ));
      this.player.teleport(this.spawnX, y, this.spawnZ);
      this.spawnResolved = true;
    }

    if (ready >= target && this.spawnResolved) {
      this.state = 'playing';
      this.menus.hideAll();
      this.hud.root.style.display = 'block';
      this.hud.updateHotbar(this.inventory);
      if (!this.input.locked) this.input.requestLock();
    }
  }

  private findSurface(wx: number, wz: number): number {
    const world = this.chunks!.world;
    for (let y = WORLD_HEIGHT - 1; y > 1; y--) {
      const b = world.getBlock(wx, y, wz);
      if (b !== Block.Air && BLOCKS[b].solid) return y + 2;
    }
    return SEA_LEVEL + 2;
  }

  private updateBackground(dt: number): void {
    // Inventory open: keep world alive (streaming, gravity) but no look/interaction.
    if (!this.chunks) return;
    this.stepPhysics(dt);
    this.player.applyToCamera(this.camera);
    this.chunks.update(this.player.pos.x, this.player.pos.z);
    this.sky?.update(dt, this.camera.position);
    this.dropped?.update(dt, this.player, this.inventory, this.camera.position);
    this.materials.shared.uTime.value = this.time;
    this.survival.update(dt, this.player);
    this.hud.updateStats(this.survival, dt);
  }

  private updatePlaying(dt: number): void {
    if (!this.chunks || !this.interaction || !this.sky || !this.dropped) return;
    this.handleHotbarInput();

    // Toggle inventory / debug.
    if (this.input.wasPressed('KeyE')) { this.openInventory(2); return; }
    if (this.input.wasPressed('Escape')) { this.pause(); return; }
    if (this.input.wasPressed('F3')) this.settings.set('showFps', !this.settings.data.showFps);

    this.player.handleInput(this.input, this.time);
    this.stepPhysics(dt);
    this.player.applyToCamera(this.camera);

    this.interaction.update(this.input, dt);
    this.chunks.update(this.player.pos.x, this.player.pos.z);
    this.sky.update(dt, this.camera.position);
    this.dropped.update(dt, this.player, this.inventory, this.camera.position);
    this.survival.update(dt, this.player);

    this.materials.shared.uTime.value = this.time;
    this.updateFootsteps();
    this.updateOverlays();
    this.heldView?.update(dt, this.inventory.getSelected(), this.interaction.swing);

    this.hud.updateStats(this.survival, dt);
    if (this.settings.data.showFps) this.hud.setDebug(true, this.debugText());
    else this.hud.setDebug(false, '');

    // Autosave every 25s.
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 25) { this.autosaveTimer = 0; this.persist(); }
  }

  private stepPhysics(dt: number): void {
    if (!this.chunks) return;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= PHYSICS_DT && steps < 8) {
      this.player.fixedStep(this.chunks.world, PHYSICS_DT);
      this.accumulator -= PHYSICS_DT;
      steps++;
    }
    if (steps === 8) this.accumulator = 0;
  }

  private handleHotbarInput(): void {
    for (let i = 0; i < 9; i++) {
      if (this.input.wasPressed(`Digit${i + 1}`)) {
        this.inventory.selectHotbar(i);
        this.showHeldName();
      }
    }
    if (this.input.wheel !== 0) {
      this.inventory.scrollHotbar(this.input.wheel > 0 ? 1 : -1);
      this.showHeldName();
    }
  }

  private showHeldName(): void {
    const s = this.inventory.getSelected();
    if (s) this.hud.showItemName(getItem(s.id)?.name ?? s.id);
  }

  private updateFootsteps(): void {
    if (!this.player.onGround) return;
    const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
    if (speed < 0.5) { return; }
    this.stepDist += speed * (1 / 60);
    const interval = this.player.sprinting ? 1.8 : 2.4;
    if (this.stepDist >= interval) {
      this.stepDist = 0;
      const below = this.chunks!.world.getBlock(Math.floor(this.player.pos.x), Math.floor(this.player.pos.y - 0.1), Math.floor(this.player.pos.z));
      if (below !== Block.Air) this.audio.footstep(below);
    }
  }

  private updateOverlays(): void {
    this.waterOverlay.style.opacity = this.player.headUnderWater ? '1' : '0';
  }

  private flashDamage(): void {
    this.damageFlash.style.transition = 'none';
    this.damageFlash.style.opacity = '0.6';
    requestAnimationFrame(() => {
      this.damageFlash.style.transition = 'opacity 0.4s';
      this.damageFlash.style.opacity = '0';
    });
  }

  private debugText(): string {
    const p = this.player.pos;
    const biome = this.previewGen ? BIOME_NAMES[this.previewGen.column(Math.floor(p.x), Math.floor(p.z)).biome as Biome] : '?';
    return [
      `VoxelCraft — ${this.fpsSmooth.toFixed(0)} FPS`,
      `XYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}`,
      `Chunk ${Math.floor(p.x / 16)}, ${Math.floor(p.z / 16)}  Biome ${biome}`,
      `Chunks loaded ${this.chunks?.loadedChunks ?? 0}  pending ${this.chunks?.pendingChunks ?? 0}`,
      `Seed ${this.seed >>> 0}  ${this.creative ? 'Creative' : 'Survival'}${this.player.flying ? ' (flying)' : ''}`,
      `Time ${(this.sky?.time ?? 0).toFixed(2)}  drops ${this.dropped?.count ?? 0}`,
    ].join('\n');
  }

  /** Debug: reposition the camera to survey terrain. */
  debugView(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.player.teleport(x, y, z);
    this.player.yaw = yaw;
    this.player.pitch = pitch;
    this.player.flying = true;
    this.player.canFly = true;
    this.player.applyToCamera(this.camera);
  }

  get debugState(): string { return this.state; }
  get debugDropCount(): number { return this.dropped?.count ?? 0; }
  get debugTarget(): unknown { return this.interaction?.target ?? null; }
  get debugPlayer(): { x: number; y: number; z: number; onGround: boolean } {
    return { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, onGround: this.player.onGround };
  }
  debugBlock(x: number, y: number, z: number): number { return this.chunks?.world.getBlock(x, y, z) ?? -1; }
  debugSelect(i: number): void { this.inventory.selectHotbar(i); }
  async debugSave(): Promise<void> { this.persist(); await new Promise((r) => setTimeout(r, 150)); }
  debugSetBlock(x: number, y: number, z: number, id: number): void {
    if (!this.chunks) return;
    this.chunks.world.setBlock(x, y, z, id);
    this.save.recordEdit(x, y, z, id);
    this.chunks.editRemesh(x, z);
  }

  private render(): void {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.state === 'playing' || this.state === 'inventory') this.heldView?.render();
  }
}
