import * as Synth from './synth';
import type { Material } from './synth';
import { Block } from '../world/blocks/types';

// ---------------------------------------------------------------------------
// Owns the AudioContext + master bus and exposes high-level game sounds.
// The context is created lazily and resumed on the first user gesture.
// ---------------------------------------------------------------------------

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private _volume = 0.7;
  muted = false;

  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this._volume;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  resume(): void {
    if (this.ensure() && this.ctx!.state === 'suspended') this.ctx!.resume();
  }

  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this._volume;
  }
  get volume(): number { return this._volume; }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this._volume;
  }

  private out(): AudioNode | null {
    if (!this.ensure()) return null;
    if (this.ctx!.state === 'suspended') this.ctx!.resume();
    return this.master;
  }

  footstep(block: number): void { const o = this.out(); if (o) Synth.playFootstep(this.ctx!, o, materialForBlock(block)); }
  dig(block: number): void { const o = this.out(); if (o) Synth.playDig(this.ctx!, o, materialForBlock(block)); }
  breakBlock(block: number): void { const o = this.out(); if (o) Synth.playBreak(this.ctx!, o, materialForBlock(block)); }
  place(block: number): void { const o = this.out(); if (o) Synth.playPlace(this.ctx!, o, materialForBlock(block)); }
  uiClick(): void { const o = this.out(); if (o) Synth.playUiClick(this.ctx!, o); }
  uiHover(): void { const o = this.out(); if (o) Synth.playUiHover(this.ctx!, o); }
  hurt(): void { const o = this.out(); if (o) Synth.playHurt(this.ctx!, o); }
  splash(): void { const o = this.out(); if (o) Synth.playSplash(this.ctx!, o); }
  pickup(): void { const o = this.out(); if (o) Synth.playPickup(this.ctx!, o); }
  eat(): void { const o = this.out(); if (o) Synth.playEat(this.ctx!, o); }
  craft(): void { const o = this.out(); if (o) Synth.playCraft(this.ctx!, o); }
  open(): void { const o = this.out(); if (o) Synth.playOpen(this.ctx!, o); }
}

export function materialForBlock(id: number): Material {
  switch (id) {
    case Block.Grass: case Block.Snowy: case Block.TallGrass: case Block.Flower:
    case Block.RedFlower: case Block.Mushroom: case Block.Sapling:
      return 'grass';
    case Block.Leaves: case Block.BirchLeaves: case Block.Cactus:
      return 'leaves';
    case Block.Dirt: case Block.Clay:
      return 'dirt';
    case Block.Sand: case Block.RedSand: case Block.Sandstone:
      return 'sand';
    case Block.Gravel:
      return 'gravel';
    case Block.Glass: case Block.Ice:
      return 'glass';
    case Block.Log: case Block.BirchLog: case Block.Planks:
    case Block.CraftingTable: case Block.Bookshelf: case Block.Pumpkin:
      return 'wood';
    case Block.Stone: case Block.Cobblestone: case Block.Bricks: case Block.Bedrock:
    case Block.CoalOre: case Block.IronOre: case Block.GoldOre: case Block.DiamondOre:
    case Block.Obsidian: case Block.MossStone: case Block.Furnace: case Block.Glowstone:
      return 'stone';
    default:
      return 'default';
  }
}
