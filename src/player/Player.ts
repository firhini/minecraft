import * as THREE from 'three';
import { GRAVITY, TERMINAL_VELOCITY } from '../core/constants';
import type { World } from '../world/World';
import type { Input } from '../core/Input';
import { moveWithCollision, isInLiquid, isHeadInLiquid, isOnGround, type Box } from './Physics';

// ---------------------------------------------------------------------------
// First-person player: look, movement modes (walk/sprint/sneak/swim/fly),
// gravity, jumping and fall-distance tracking for survival damage.
// ---------------------------------------------------------------------------

const WALK = 4.3;
const SPRINT = 5.9;
const SNEAK = 1.6;
const FLY = 12;
const FLY_SPRINT = 24;
const JUMP_VELOCITY = 8.4;
const SWIM_SPEED = 3.2;
const PLAYER_HW = 0.3;
const PLAYER_HEIGHT = 1.8;
const EYE = 1.62;
const SNEAK_EYE = 1.4;

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  onGround = false;
  inWater = false;
  headUnderWater = false;
  flying = false;
  sneaking = false;
  sprinting = false;
  canFly = false; // creative toggle

  /** Fall distance available for damage calculation, consumed by survival. */
  lastFall = 0;
  private fallStartY = 0;
  private prevOnGround = true;

  sensitivity = 0.0022;
  private lastSpaceTime = -1;

  private box: Box = { x: 0, y: 0, z: 0, hw: PLAYER_HW, h: PLAYER_HEIGHT };

  // Intent (set once per frame).
  private inForward = 0;
  private inRight = 0;
  private inJump = false;
  private inSneak = false;

  private tmp = new THREE.Vector3();

  get eyeHeight(): number {
    return this.sneaking ? SNEAK_EYE : EYE;
  }

  getEyePosition(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  /** Read input & mouse look. Called once per rendered frame. */
  handleInput(input: Input, gameTime: number): void {
    // Look.
    this.yaw -= input.mouseDX * this.sensitivity;
    this.pitch -= input.mouseDY * this.sensitivity;
    const lim = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));

    // Movement intent.
    const f = (input.isDown('KeyW') ? 1 : 0) - (input.isDown('KeyS') ? 1 : 0);
    const r = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    this.inForward = f;
    this.inRight = r;
    this.inJump = input.isDown('Space');
    this.inSneak = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    this.sneaking = this.inSneak && this.onGround && !this.flying;

    // Sprint: hold Ctrl or double-tap W. Latch clears when W released.
    if (input.wasPressed('KeyW')) {
      if (gameTime - this.lastWTime < 0.3) this.sprintLatch = true;
      this.lastWTime = gameTime;
    }
    if (!input.isDown('KeyW')) this.sprintLatch = false;
    this.sprinting = (input.isDown('ControlLeft') || this.sprintLatch) && this.inForward > 0 && !this.sneaking;

    // Double-tap space toggles fly (creative).
    if (input.wasPressed('Space') && this.canFly) {
      if (gameTime - this.lastSpaceTime < 0.3) {
        this.flying = !this.flying;
        this.vel.y = 0;
      }
      this.lastSpaceTime = gameTime;
    }
    if (!this.canFly) this.flying = false;
  }

  private lastWTime = -1;
  private sprintLatch = false;

  /** Fixed-timestep physics integration. */
  fixedStep(world: World, dt: number): void {
    this.box.x = this.pos.x; this.box.y = this.pos.y; this.box.z = this.pos.z;
    this.box.hw = PLAYER_HW; this.box.h = PLAYER_HEIGHT;

    this.inWater = isInLiquid(world, this.box);
    this.headUnderWater = isHeadInLiquid(world, this.box);

    // Horizontal wish direction.
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    // forward (yaw 0 → -Z), right = (-forward.z, forward.x)
    const fwdX = -sinY, fwdZ = -cosY;
    const rgtX = cosY, rgtZ = -sinY;
    let wishX = fwdX * this.inForward + rgtX * this.inRight;
    let wishZ = fwdZ * this.inForward + rgtZ * this.inRight;
    const wl = Math.hypot(wishX, wishZ);
    if (wl > 0) { wishX /= wl; wishZ /= wl; }

    if (this.flying) {
      this.stepFly(world, dt, wishX, wishZ);
      return;
    }

    let speed = this.sneaking ? SNEAK : this.sprinting && this.inForward > 0 ? SPRINT : WALK;
    if (this.inWater) speed = SWIM_SPEED;

    // Horizontal acceleration (snappier on ground).
    const control = this.onGround ? 0.28 : this.inWater ? 0.12 : 0.06;
    const targetVX = wishX * speed;
    const targetVZ = wishZ * speed;
    this.vel.x += (targetVX - this.vel.x) * control;
    this.vel.z += (targetVZ - this.vel.z) * control;

    // Gravity / buoyancy.
    if (this.inWater) {
      this.vel.y -= GRAVITY * 0.28 * dt;
      this.vel.y = Math.max(this.vel.y, -3.0);
      if (this.inJump) this.vel.y = 3.4; // swim up
      this.vel.y *= 0.86; // water drag
    } else {
      this.vel.y -= GRAVITY * dt;
      if (this.vel.y < -TERMINAL_VELOCITY) this.vel.y = -TERMINAL_VELOCITY;
      // Jump.
      if (this.inJump && this.onGround) {
        this.vel.y = JUMP_VELOCITY;
        if (this.sprinting) { this.vel.x += fwdX * 1.6; this.vel.z += fwdZ * 1.6; }
      }
    }

    // Integrate with collision.
    const res = moveWithCollision(world, this.box, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    this.pos.set(this.box.x, this.box.y, this.box.z);

    if (res.hitWallX) this.vel.x = 0;
    if (res.hitWallZ) this.vel.z = 0;
    if (res.onGround) this.vel.y = 0;
    if (res.hitCeiling && this.vel.y > 0) this.vel.y = 0;

    this.onGround = res.onGround || isOnGround(world, this.box);

    // Fall tracking.
    this.trackFall();
  }

  private stepFly(world: World, dt: number, wishX: number, wishZ: number): void {
    const speed = this.sprinting ? FLY_SPRINT : FLY;
    const targetVX = wishX * speed;
    const targetVZ = wishZ * speed;
    this.vel.x += (targetVX - this.vel.x) * 0.3;
    this.vel.z += (targetVZ - this.vel.z) * 0.3;
    let vy = 0;
    if (this.inJump) vy += speed;
    if (this.inSneak) vy -= speed;
    this.vel.y += (vy - this.vel.y) * 0.3;

    const res = moveWithCollision(world, this.box, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt);
    this.pos.set(this.box.x, this.box.y, this.box.z);
    if (res.hitWallX) this.vel.x = 0;
    if (res.hitWallZ) this.vel.z = 0;
    if (res.onGround || res.hitCeiling) this.vel.y = 0;
    this.onGround = res.onGround;
    this.fallStartY = this.pos.y;
    this.prevOnGround = true;
  }

  private trackFall(): void {
    if (!this.onGround && this.prevOnGround) {
      this.fallStartY = this.pos.y;
    }
    if (!this.onGround && this.pos.y > this.fallStartY) {
      this.fallStartY = this.pos.y; // rose (jumped) — reset baseline
    }
    if (this.onGround && !this.prevOnGround) {
      const fell = this.fallStartY - this.pos.y;
      if (fell > 0 && !this.inWater) this.lastFall = fell;
    }
    this.prevOnGround = this.onGround;
  }

  /** Zero out movement intent (used when a menu/inventory opens). */
  clearIntent(): void {
    this.inForward = 0;
    this.inRight = 0;
    this.inJump = false;
    this.inSneak = false;
    this.sprinting = false;
    this.sneaking = false;
  }

  teleport(x: number, y: number, z: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.fallStartY = y;
    this.prevOnGround = true;
  }

  getForwardXZ(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  applyToCamera(camera: THREE.PerspectiveCamera): void {
    this.getEyePosition(this.tmp);
    camera.position.copy(this.tmp);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
