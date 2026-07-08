import * as THREE from 'three';
import { GRAVITY } from '../core/constants';
import { BLOCKS } from './blocks/registry';
import { getItem } from '../inventory/items';
import type { World } from './World';
import type { TextureAtlas } from '../render/TextureAtlas';
import type { Inventory } from '../inventory/Inventory';
import type { Player } from '../player/Player';

// ---------------------------------------------------------------------------
// Dropped item entities: pop out of broken blocks, obey gravity, settle on the
// ground, bob & spin, then get vacuumed into the player and added to inventory.
// ---------------------------------------------------------------------------

interface Drop {
  id: string;
  count: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  mesh: THREE.Mesh;
}

export class DroppedItems {
  private drops: Drop[] = [];
  private materialCache = new Map<string, THREE.Material>();
  private geometry = new THREE.PlaneGeometry(0.4, 0.4);

  onPickup: (() => void) | null = null;

  constructor(
    private scene: THREE.Scene,
    private world: World,
    private atlas: TextureAtlas,
  ) {}

  private materialFor(id: string): THREE.Material {
    let m = this.materialCache.get(id);
    if (!m) {
      const item = getItem(id);
      const key = item?.texture ?? 'stone';
      m = new THREE.MeshBasicMaterial({
        map: this.atlas.iconTexture(key),
        transparent: true,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      });
      this.materialCache.set(id, m);
    }
    return m;
  }

  spawn(id: string, count: number, x: number, y: number, z: number): void {
    if (count <= 0 || !getItem(id)) return;
    const mesh = new THREE.Mesh(this.geometry, this.materialFor(id));
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    this.drops.push({
      id, count,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3((Math.random() - 0.5) * 2, 3 + Math.random() * 1.5, (Math.random() - 0.5) * 2),
      age: 0,
      mesh,
    });
  }

  update(dt: number, player: Player, inventory: Inventory, cameraPos: THREE.Vector3): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;

      // Attraction to player once pickable.
      const dx = player.pos.x - d.pos.x;
      const dy = player.pos.y + 0.8 - d.pos.y;
      const dz = player.pos.z - d.pos.z;
      const dist = Math.hypot(dx, dy, dz);

      if (d.age > 0.5 && dist < 1.5) {
        if (inventory.canAdd(d.id, d.count)) {
          const left = inventory.add(d.id, d.count);
          if (left === 0) {
            this.remove(i);
            this.onPickup?.();
            continue;
          } else {
            d.count = left;
          }
        }
      }

      if (d.age > 0.5 && dist < 2.2 && inventory.canAdd(d.id, 1)) {
        const pull = (2.2 - dist) * 6;
        d.vel.x += (dx / (dist || 1)) * pull * dt;
        d.vel.y += (dy / (dist || 1)) * pull * dt;
        d.vel.z += (dz / (dist || 1)) * pull * dt;
      } else {
        // Gravity + ground settle.
        d.vel.y -= GRAVITY * dt;
        d.vel.x *= 0.86;
        d.vel.z *= 0.86;
      }

      d.pos.x += d.vel.x * dt;
      d.pos.y += d.vel.y * dt;
      d.pos.z += d.vel.z * dt;

      // Simple ground collision.
      const below = BLOCKS[this.world.getBlock(Math.floor(d.pos.x), Math.floor(d.pos.y - 0.2), Math.floor(d.pos.z))];
      if (below.solid && d.vel.y <= 0) {
        d.pos.y = Math.floor(d.pos.y - 0.2) + 1 + 0.2;
        d.vel.y = 0;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
      }

      // Render: bob, spin, billboard toward camera.
      const bob = Math.sin(d.age * 3) * 0.05;
      d.mesh.position.set(d.pos.x, d.pos.y + bob + 0.1, d.pos.z);
      d.mesh.lookAt(cameraPos.x, d.mesh.position.y, cameraPos.z);
    }
  }

  private remove(i: number): void {
    const d = this.drops[i];
    this.scene.remove(d.mesh);
    this.drops.splice(i, 1);
  }

  clear(): void {
    for (const d of this.drops) this.scene.remove(d.mesh);
    this.drops.length = 0;
  }

  get count(): number { return this.drops.length; }
}
