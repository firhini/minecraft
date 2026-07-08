import * as THREE from 'three';
import { Block, Face, type FaceTextures } from '../world/blocks/types';
import { BLOCKS, collectTextureKeys } from '../world/blocks/registry';
import { collectItemIconKeys } from '../inventory/items';
import { TILE, paintTile } from './textures';

// ---------------------------------------------------------------------------
// Builds a DataArrayTexture where each layer is one 16x16 tile. Using an array
// texture (instead of a packed atlas) means per-block texture tiling with
// mipmaps and zero bleeding between neighbouring tiles.
// ---------------------------------------------------------------------------

export class TextureAtlas {
  readonly texture: THREE.DataArrayTexture;
  readonly layerOf = new Map<string, number>();
  /** blockId*6 + Face → texture layer. */
  readonly blockFaceLayer: Int32Array;
  /** Per-tile canvas snapshots for UI icons (data URLs), lazily built. */
  private iconCanvasCache = new Map<string, string>();
  private atlasData: Uint8ClampedArray;

  constructor() {
    const keys = new Set<string>();
    for (const k of collectTextureKeys()) keys.add(k);
    for (const k of collectItemIconKeys()) keys.add(k);
    const keyList = [...keys];

    const layers = keyList.length;
    const data = new Uint8ClampedArray(TILE * TILE * 4 * layers);
    for (let i = 0; i < keyList.length; i++) {
      const key = keyList[i];
      this.layerOf.set(key, i);
      paintTile(key, data, i * TILE * TILE * 4);
    }
    this.atlasData = data;

    const tex = new THREE.DataArrayTexture(new Uint8Array(data.buffer), TILE, TILE, layers);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    this.texture = tex;

    // Precompute block face → layer.
    this.blockFaceLayer = new Int32Array(Block.Count * 6);
    for (let id = 0; id < Block.Count; id++) {
      const def = BLOCKS[id];
      for (let f = 0; f < 6; f++) {
        const key = this.faceKey(def.textures, f as Face);
        this.blockFaceLayer[id * 6 + f] = this.layerOf.get(key) ?? 0;
      }
    }
  }

  private faceKey(t: FaceTextures, face: Face): string {
    switch (face) {
      case Face.Top: return t.top ?? t.all ?? t.side ?? t.north ?? 'stone';
      case Face.Bottom: return t.bottom ?? t.all ?? t.side ?? t.north ?? 'stone';
      case Face.East: return t.east ?? t.side ?? t.all ?? 'stone';
      case Face.West: return t.west ?? t.side ?? t.all ?? 'stone';
      case Face.South: return t.south ?? t.side ?? t.all ?? 'stone';
      case Face.North: return t.north ?? t.side ?? t.all ?? 'stone';
    }
  }

  layerFor(key: string): number {
    return this.layerOf.get(key) ?? 0;
  }

  private iconTexCache = new Map<string, THREE.DataTexture>();
  private layerTexCache = new Map<number, THREE.DataTexture>();

  /** A standalone 16x16 texture for one atlas layer (for held-item cube faces). */
  layerTexture(layer: number): THREE.DataTexture {
    const cached = this.layerTexCache.get(layer);
    if (cached) return cached;
    const off = layer * TILE * TILE * 4;
    const data = new Uint8Array(TILE * TILE * 4);
    for (let i = 0; i < data.length; i++) data[i] = this.atlasData[off + i];
    const tex = new THREE.DataTexture(data, TILE, TILE, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.layerTexCache.set(layer, tex);
    return tex;
  }

  /** A standalone 16x16 texture for one tile (for 3D dropped items). */
  iconTexture(key: string): THREE.DataTexture {
    const cached = this.iconTexCache.get(key);
    if (cached) return cached;
    const layer = this.layerOf.get(key) ?? 0;
    const off = layer * TILE * TILE * 4;
    const data = new Uint8Array(TILE * TILE * 4);
    for (let i = 0; i < data.length; i++) data[i] = this.atlasData[off + i];
    const tex = new THREE.DataTexture(data, TILE, TILE, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    this.iconTexCache.set(key, tex);
    return tex;
  }

  /** Returns a data URL for a single tile, for rendering inventory icons in the DOM. */
  iconDataURL(key: string): string {
    const cached = this.iconCanvasCache.get(key);
    if (cached) return cached;
    const layer = this.layerOf.get(key);
    const canvas = document.createElement('canvas');
    canvas.width = TILE;
    canvas.height = TILE;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(TILE, TILE);
    if (layer !== undefined) {
      const off = layer * TILE * TILE * 4;
      for (let i = 0; i < TILE * TILE * 4; i++) img.data[i] = this.atlasData[off + i];
    }
    ctx.putImageData(img, 0, 0);
    const url = canvas.toDataURL();
    this.iconCanvasCache.set(key, url);
    return url;
  }
}
