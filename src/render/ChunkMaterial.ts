import * as THREE from 'three';
import type { TextureAtlas } from './TextureAtlas';

// ---------------------------------------------------------------------------
// Custom voxel shader material. WebGL2 / GLSL3 so we can sample a texture array
// (one layer per block tile). Handles per-vertex AO + voxel light, day/night
// modulation, distance fog and gentle wind sway for foliage.
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `
precision highp float;
in float alayer;
in vec4 alight;      // shade(0-255), sky(0-15), block(0-15), wave(0/1)

uniform float uTime;
uniform float uWaveAmp;

out float vLayer;
out vec2 vUv;
out float vShade;
out float vSky;
out float vBlock;
out float vFog;

void main() {
  vLayer = alayer;
  vUv = uv;
  vShade = alight.x / 255.0;
  vSky = alight.y / 15.0;
  vBlock = alight.z / 15.0;

  vec3 pos = position;
  if (alight.w > 0.5) {
    vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
    float ph = uTime * 2.2 + wp.x * 0.7 + wp.z * 0.7 + wp.y * 0.25;
    pos.x += sin(ph) * uWaveAmp;
    pos.z += cos(ph * 0.85) * uWaveAmp * 0.6;
  }

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vFog = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DArray;

uniform sampler2DArray uAtlas;
uniform float uDaylight;   // 0..1 sun strength
uniform float uAmbient;    // minimum brightness
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uAlphaTest;
uniform float uOpacity;

in float vLayer;
in vec2 vUv;
in float vShade;
in float vSky;
in float vBlock;
in float vFog;

out vec4 outColor;

void main() {
  vec4 tex = texture(uAtlas, vec3(vUv, vLayer));
  if (tex.a < uAlphaTest) discard;

  float lum = max(vBlock, vSky * uDaylight);
  float bright = vShade * (uAmbient + (1.0 - uAmbient) * lum);
  vec3 color = tex.rgb * bright;

  float fogF = clamp((vFog - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  color = mix(color, uFogColor, fogF);

  outColor = vec4(color, tex.a * uOpacity);
}
`;

export interface SharedUniforms {
  uAtlas: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uDaylight: THREE.IUniform<number>;
  uAmbient: THREE.IUniform<number>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogNear: THREE.IUniform<number>;
  uFogFar: THREE.IUniform<number>;
  uWaveAmp: THREE.IUniform<number>;
}

export class ChunkMaterials {
  readonly opaque: THREE.ShaderMaterial;
  readonly cutout: THREE.ShaderMaterial;
  readonly translucent: THREE.ShaderMaterial;
  readonly shared: SharedUniforms;

  constructor(atlas: TextureAtlas) {
    this.shared = {
      uAtlas: { value: atlas.texture },
      uTime: { value: 0 },
      uDaylight: { value: 1 },
      uAmbient: { value: 0.06 },
      uFogColor: { value: new THREE.Color(0x9fc7ff) },
      uFogNear: { value: 64 },
      uFogFar: { value: 220 },
      uWaveAmp: { value: 0.06 },
    };

    const make = (opts: { alphaTest: number; transparent: boolean; side: THREE.Side; depthWrite: boolean; opacity: number }) => {
      const mat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        uniforms: {
          ...this.shared,
          uAlphaTest: { value: opts.alphaTest },
          uOpacity: { value: opts.opacity },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: opts.transparent,
        side: opts.side,
        depthWrite: opts.depthWrite,
      });
      return mat;
    };

    this.opaque = make({ alphaTest: 0, transparent: false, side: THREE.FrontSide, depthWrite: true, opacity: 1 });
    this.cutout = make({ alphaTest: 0.5, transparent: false, side: THREE.FrontSide, depthWrite: true, opacity: 1 });
    this.translucent = make({ alphaTest: 0.02, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.82 });
  }

  setFog(color: THREE.Color, near: number, far: number): void {
    this.shared.uFogColor.value.copy(color);
    this.shared.uFogNear.value = near;
    this.shared.uFogFar.value = far;
  }
}
