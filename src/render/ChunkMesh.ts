import * as THREE from 'three';
import type { LayerGeometry, MeshResult } from '../world/meshing/ChunkMesher';
import type { ChunkMaterials } from './ChunkMaterial';

// ---------------------------------------------------------------------------
// Holds the (up to three) Three.js meshes for a single chunk and rebuilds them
// from mesher output. Geometry buffers are disposed on update/removal.
// ---------------------------------------------------------------------------

function buildGeometry(lg: LayerGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(lg.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(lg.uvs, 2));
  g.setAttribute('alayer', new THREE.BufferAttribute(lg.layers, 1));
  g.setAttribute('alight', new THREE.BufferAttribute(lg.light, 4, false));
  g.setIndex(new THREE.BufferAttribute(lg.indices, 1));
  g.computeBoundingSphere();
  return g;
}

export class ChunkMesh {
  private opaque: THREE.Mesh | null = null;
  private cutout: THREE.Mesh | null = null;
  private translucent: THREE.Mesh | null = null;
  readonly ox: number;
  readonly oz: number;

  constructor(
    private scene: THREE.Scene,
    private materials: ChunkMaterials,
    ox: number,
    oz: number,
  ) {
    this.ox = ox;
    this.oz = oz;
  }

  update(result: MeshResult): void {
    this.opaque = this.applyLayer(this.opaque, result.opaque, this.materials.opaque, 0);
    this.cutout = this.applyLayer(this.cutout, result.cutout, this.materials.cutout, 1);
    this.translucent = this.applyLayer(this.translucent, result.translucent, this.materials.translucent, 2);
  }

  private applyLayer(
    existing: THREE.Mesh | null,
    lg: LayerGeometry | null,
    material: THREE.ShaderMaterial,
    renderOrder: number,
  ): THREE.Mesh | null {
    if (!lg) {
      if (existing) {
        this.scene.remove(existing);
        existing.geometry.dispose();
      }
      return null;
    }
    const geo = buildGeometry(lg);
    if (existing) {
      existing.geometry.dispose();
      existing.geometry = geo;
      return existing;
    }
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(this.ox, 0, this.oz);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    return mesh;
  }

  dispose(): void {
    for (const m of [this.opaque, this.cutout, this.translucent]) {
      if (m) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
    }
    this.opaque = this.cutout = this.translucent = null;
  }
}
