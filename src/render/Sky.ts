import * as THREE from 'three';
import { DAY_LENGTH } from '../core/constants';
import type { ChunkMaterials } from './ChunkMaterial';

// ---------------------------------------------------------------------------
// Day/night cycle: gradient sky dome, sun & moon discs, star field, and the
// atmospheric colours + daylight factor that drive the world shader's lighting
// and fog. Everything follows the camera so the world feels infinite.
// ---------------------------------------------------------------------------

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // force to far plane
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
void main() {
  float h = clamp(vDir.y * 1.2, -1.0, 1.0);
  float t = smoothstep(-0.1, 0.6, h);
  vec3 col = mix(uHorizon, uTop, t);
  // Sun glow.
  float sd = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sd, 220.0) * 1.4;          // sharp disc
  col += uSunColor * pow(sd, 8.0) * 0.18 * uSunIntensity; // soft halo
  gl_FragColor = vec4(col, 1.0);
}
`;

const DAY_TOP = new THREE.Color(0x3a7bd5);
const DAY_HZ = new THREE.Color(0xbfe0ff);
const SUNSET_TOP = new THREE.Color(0x2a3d66);
const SUNSET_HZ = new THREE.Color(0xff9a4d);
const NIGHT_TOP = new THREE.Color(0x05060f);
const NIGHT_HZ = new THREE.Color(0x10132b);

export class Sky {
  time: number; // 0..1 fraction of day (0.5 = noon)
  private dome: THREE.Mesh;
  private uniforms: {
    uTop: { value: THREE.Color }; uHorizon: { value: THREE.Color };
    uSunDir: { value: THREE.Vector3 }; uSunColor: { value: THREE.Color };
    uSunIntensity: { value: number };
  };
  private stars: THREE.Points;
  private sunDir = new THREE.Vector3();
  daylight = 1;
  fogColor = new THREE.Color();

  constructor(private scene: THREE.Scene, private materials: ChunkMaterials, startTime = 0.3) {
    this.time = startTime;

    this.uniforms = {
      uTop: { value: DAY_TOP.clone() },
      uHorizon: { value: DAY_HZ.clone() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xfff2cc) },
      uSunIntensity: { value: 1 },
    };
    const geo = new THREE.SphereGeometry(1, 24, 16);
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    scene.add(this.dome);

    // Star field.
    const starCount = 1200;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const v = new THREE.Vector3(
        Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1,
      ).normalize().multiplyScalar(0.95);
      positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
    }
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const smat = new THREE.PointsMaterial({
      color: 0xffffff, size: 0.006, sizeAttenuation: true,
      transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false,
    });
    this.stars = new THREE.Points(sgeo, smat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -999;
    scene.add(this.stars);
  }

  update(dt: number, cameraPos: THREE.Vector3): void {
    this.time = (this.time + dt / DAY_LENGTH) % 1;
    const phase = this.time * Math.PI * 2 - Math.PI / 2; // 0.25→noon
    const alt = Math.sin(phase);
    this.sunDir.set(Math.cos(phase) * 0.5, alt, Math.cos(phase) * 0.3 + 0.2).normalize();

    // Daylight factor with smooth dawn/dusk.
    const day = smoothstep(-0.12, 0.18, alt);
    this.daylight = day;

    // Colours.
    const top = this.uniforms.uTop.value;
    const hz = this.uniforms.uHorizon.value;
    if (alt > 0.18) {
      top.copy(DAY_TOP); hz.copy(DAY_HZ);
    } else if (alt > -0.12) {
      const k = smoothstep(-0.12, 0.18, alt);
      top.copy(SUNSET_TOP).lerp(DAY_TOP, k);
      hz.copy(SUNSET_HZ).lerp(DAY_HZ, k);
    } else {
      const k = smoothstep(-0.5, -0.12, alt);
      top.copy(NIGHT_TOP).lerp(SUNSET_TOP, k);
      hz.copy(NIGHT_HZ).lerp(SUNSET_HZ, k);
    }
    this.uniforms.uSunDir.value.copy(this.sunDir);
    this.uniforms.uSunIntensity.value = day;
    this.uniforms.uSunColor.value.setRGB(1, 0.95, 0.82).lerp(new THREE.Color(0xff7a3c), 1 - smoothstep(-0.1, 0.25, alt));

    // Fog matches horizon; the world shader uses uDaylight for brightness.
    this.fogColor.copy(hz);
    this.materials.shared.uDaylight.value = 0.08 + 0.92 * day;
    this.materials.setFog(this.fogColor, this.materials.shared.uFogNear.value, this.materials.shared.uFogFar.value);
    this.scene.background = this.fogColor;

    // Follow camera.
    this.dome.position.copy(cameraPos);
    this.dome.scale.setScalar(1); // dome uses far-plane trick; scale irrelevant
    this.stars.position.copy(cameraPos);
    this.stars.scale.setScalar(400);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - day * 1.5) * 0.9;
    this.stars.rotation.y = this.time * Math.PI * 2;
  }

  getSunDir(): THREE.Vector3 { return this.sunDir; }

  setFogDistances(near: number, far: number): void {
    this.materials.setFog(this.fogColor, near, far);
  }
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
