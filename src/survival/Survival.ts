import type { Player } from '../player/Player';

// ---------------------------------------------------------------------------
// Survival state: health, hunger, saturation, breath, regeneration, starvation,
// fall & drowning damage. Half-hearts scale (20 = 10 hearts).
// ---------------------------------------------------------------------------

export class Survival {
  health = 20;
  maxHealth = 20;
  hunger = 20;
  saturation = 5;
  air = 10;      // breath, 0-10
  maxAir = 10;
  exhaustion = 0;
  dead = false;
  enabled = true; // false in creative

  private regenTimer = 0;
  private starveTimer = 0;
  private drownTimer = 0;
  private hurtCooldown = 0;

  onDamage: ((amount: number, cause: string) => void) | null = null;
  onDeath: (() => void) | null = null;
  onHeal: (() => void) | null = null;

  update(dt: number, player: Player): void {
    if (this.dead) return;
    this.hurtCooldown = Math.max(0, this.hurtCooldown - dt);

    if (!this.enabled) {
      this.health = this.maxHealth;
      this.hunger = 20;
      this.air = this.maxAir;
      player.lastFall = 0;
      return;
    }

    // Movement exhaustion.
    const speed = Math.hypot(player.vel.x, player.vel.z);
    if (player.onGround && speed > 0.1) this.exhaustion += (player.sprinting ? 0.06 : 0.01) * dt * speed;

    // Breath.
    if (player.headUnderWater) {
      this.air -= dt;
      if (this.air <= 0) {
        this.air = 0;
        this.drownTimer += dt;
        if (this.drownTimer >= 1) { this.drownTimer = 0; this.damage(2, 'drown'); }
      }
    } else {
      this.air = Math.min(this.maxAir, this.air + dt * 4);
      this.drownTimer = 0;
    }

    // Hunger drain via exhaustion.
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
    }

    // Regeneration when well fed.
    if (this.hunger >= 18 && this.health < this.maxHealth) {
      this.regenTimer += dt;
      if (this.regenTimer >= 3.5) {
        this.regenTimer = 0;
        this.health = Math.min(this.maxHealth, this.health + 1);
        this.saturation = Math.max(0, this.saturation - 0.6);
        this.exhaustion += 1;
        this.onHeal?.();
      }
    } else {
      this.regenTimer = 0;
    }

    // Starvation.
    if (this.hunger <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 4) {
        this.starveTimer = 0;
        if (this.health > 1) this.damage(1, 'starve');
      }
    } else {
      this.starveTimer = 0;
    }

    // Fall damage.
    if (player.lastFall > 0) {
      const dmg = Math.floor(player.lastFall - 3);
      if (dmg > 0) this.damage(dmg, 'fall');
      player.lastFall = 0;
    }
  }

  damage(amount: number, cause: string): void {
    if (this.dead || amount <= 0) return;
    if (cause !== 'fall' && cause !== 'starve' && cause !== 'drown' && this.hurtCooldown > 0) return;
    this.hurtCooldown = 0.4;
    this.health = Math.max(0, this.health - amount);
    this.onDamage?.(amount, cause);
    if (this.health <= 0) {
      this.dead = true;
      this.onDeath?.();
    }
  }

  eat(foodPoints: number, saturation: number): void {
    this.hunger = Math.min(20, this.hunger + foodPoints);
    this.saturation = Math.min(this.hunger, this.saturation + saturation);
  }

  respawn(): void {
    this.health = this.maxHealth;
    this.hunger = 20;
    this.saturation = 5;
    this.air = this.maxAir;
    this.exhaustion = 0;
    this.dead = false;
  }

  serialize() {
    return { health: this.health, hunger: this.hunger, saturation: this.saturation, air: this.air };
  }

  load(d: { health: number; hunger: number; saturation: number; air: number }): void {
    this.health = d.health;
    this.hunger = d.hunger;
    this.saturation = d.saturation;
    this.air = d.air;
    this.dead = this.health <= 0;
  }
}
