import * as THREE from 'three';
import { getItem } from '../inventory/items';
import { BLOCKS } from '../world/blocks/registry';
import type { ItemStack } from '../inventory/Inventory';
import type { TextureAtlas } from './TextureAtlas';

// ---------------------------------------------------------------------------
// First-person held-item view model. Rendered as an overlay on top of the world
// (its own scene + camera, depth cleared) so it never clips into geometry.
// Blocks show as a small 3D cube; items/tools as an angled flat sprite.
// A swing animation plays on mining / placing.
// ---------------------------------------------------------------------------

export class HeldItemView {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private holder = new THREE.Group();
  private current: THREE.Object3D | null = null;
  private lastId: string | null = null;
  private lastWasEmpty = true;
  private cubeGeo = new THREE.BoxGeometry(1, 1, 1);
  private planeGeo = new THREE.PlaneGeometry(1, 1);

  constructor(private renderer: THREE.WebGLRenderer, private atlas: TextureAtlas) {
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 10);
    this.camera.position.set(0, 0, 0);
    this.scene.add(this.holder);
  }

  private buildFor(stack: ItemStack | null): void {
    if (this.current) { this.holder.remove(this.current); this.current = null; }
    if (!stack) { this.lastWasEmpty = true; return; }
    this.lastWasEmpty = false;
    const item = getItem(stack.id);
    if (!item) return;

    if (item.placeBlock !== undefined && !BLOCKS[item.placeBlock].cross) {
      const id = item.placeBlock;
      const mats: THREE.Material[] = [];
      for (let f = 0; f < 6; f++) {
        const layer = this.atlas.blockFaceLayer[id * 6 + f];
        mats.push(new THREE.MeshBasicMaterial({ map: this.atlas.layerTexture(layer), transparent: true, alphaTest: 0.5 }));
      }
      const cube = new THREE.Mesh(this.cubeGeo, mats);
      cube.scale.setScalar(0.42);
      cube.position.set(0.62, -0.62, -1.1);
      cube.rotation.set(-0.15, -0.7, 0);
      this.current = cube;
    } else {
      const key = item.texture;
      const mat = new THREE.MeshBasicMaterial({ map: this.atlas.iconTexture(key), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
      const plane = new THREE.Mesh(this.planeGeo, mat);
      plane.scale.setScalar(0.7);
      plane.position.set(0.68, -0.6, -1.0);
      plane.rotation.set(0, -0.5, -0.4);
      this.current = plane;
    }
    this.holder.add(this.current);
  }

  update(_dt: number, stack: ItemStack | null, swing: number): void {
    const id = stack?.id ?? null;
    if (id !== this.lastId || (stack === null) !== this.lastWasEmpty) {
      this.buildFor(stack);
      this.lastId = id;
    }
    // Swing: quick down-and-back arc.
    const s = Math.sin(Math.min(1, swing) * Math.PI);
    this.holder.position.set(-s * 0.12, -s * 0.18, 0);
    this.holder.rotation.set(s * 0.5, 0, 0);
  }

  render(): void {
    if (!this.current) return;
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.current) this.holder.remove(this.current);
    this.current = null;
  }
}
