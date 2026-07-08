import { getItem } from '../inventory/items';
import type { Inventory } from '../inventory/Inventory';
import type { Survival } from '../survival/Survival';
import type { TextureAtlas } from '../render/TextureAtlas';

// ---------------------------------------------------------------------------
// Always-on heads-up display: crosshair, hotbar, health / hunger / air bars,
// item name toast and an optional debug overlay.
// ---------------------------------------------------------------------------

export class HUD {
  root: HTMLDivElement;
  private hotbarSlots: HTMLDivElement[] = [];
  private selector: HTMLDivElement;
  private healthCanvas: HTMLCanvasElement;
  private hungerCanvas: HTMLCanvasElement;
  private airCanvas: HTMLCanvasElement;
  private nameToast: HTMLDivElement;
  private debug: HTMLDivElement;
  private toastTimer = 0;

  private lastHealth = -1;
  private lastHunger = -1;
  private lastAir = -1;

  constructor(private atlas: TextureAtlas) {
    this.root = el('div', 'hud');

    // Crosshair.
    const cross = el('div', 'crosshair');
    cross.innerHTML =
      '<svg viewBox="0 0 20 20" width="20" height="20"><rect x="9" y="3" width="2" height="14" fill="white"/><rect x="3" y="9" width="14" height="2" fill="white"/></svg>';
    this.root.appendChild(cross);

    // Status bars container (above hotbar).
    const bars = el('div', 'bars');
    this.healthCanvas = document.createElement('canvas');
    this.hungerCanvas = document.createElement('canvas');
    this.airCanvas = document.createElement('canvas');
    for (const c of [this.healthCanvas, this.hungerCanvas, this.airCanvas]) {
      c.width = 10 * 18; c.height = 18;
      c.className = 'statbar';
    }
    const left = el('div', 'bars-left');
    const right = el('div', 'bars-right');
    left.appendChild(this.healthCanvas);
    right.appendChild(this.airCanvas);
    right.appendChild(this.hungerCanvas);
    bars.appendChild(left);
    bars.appendChild(right);
    this.root.appendChild(bars);

    // Hotbar.
    const hotbar = el('div', 'hotbar');
    for (let i = 0; i < 9; i++) {
      const slot = el('div', 'hotbar-slot');
      const img = document.createElement('img');
      img.className = 'slot-icon';
      const count = el('span', 'slot-count');
      const dura = el('div', 'slot-dura');
      slot.appendChild(img);
      slot.appendChild(count);
      slot.appendChild(dura);
      hotbar.appendChild(slot);
      this.hotbarSlots.push(slot);
    }
    this.selector = el('div', 'hotbar-selector');
    hotbar.appendChild(this.selector);
    this.root.appendChild(hotbar);

    // Item name toast.
    this.nameToast = el('div', 'item-toast');
    this.root.appendChild(this.nameToast);

    // Debug overlay.
    this.debug = el('div', 'debug');
    this.debug.style.display = 'none';
    this.root.appendChild(this.debug);
  }

  updateHotbar(inv: Inventory): void {
    for (let i = 0; i < 9; i++) {
      const slot = this.hotbarSlots[i];
      const stack = inv.get(i);
      const img = slot.querySelector('.slot-icon') as HTMLImageElement;
      const count = slot.querySelector('.slot-count') as HTMLSpanElement;
      const dura = slot.querySelector('.slot-dura') as HTMLDivElement;
      if (stack) {
        const item = getItem(stack.id);
        img.src = this.atlas.iconDataURL(item?.texture ?? 'stone');
        img.style.display = 'block';
        count.textContent = stack.count > 1 ? String(stack.count) : '';
        if (stack.durability !== undefined && item?.durability) {
          const frac = Math.max(0, stack.durability / item.durability);
          dura.style.display = 'block';
          dura.style.width = `${frac * 100}%`;
          dura.style.background = `hsl(${frac * 120}, 90%, 50%)`;
        } else {
          dura.style.display = 'none';
        }
      } else {
        img.style.display = 'none';
        count.textContent = '';
        dura.style.display = 'none';
      }
    }
    this.selector.style.transform = `translateX(${inv.selected * 52}px)`;
  }

  showItemName(name: string): void {
    this.nameToast.textContent = name;
    this.nameToast.style.opacity = '1';
    this.toastTimer = 2;
  }

  updateStats(survival: Survival, dt: number): void {
    if (survival.health !== this.lastHealth) {
      drawHearts(this.healthCanvas, survival.health, survival.maxHealth);
      this.lastHealth = survival.health;
    }
    if (survival.hunger !== this.lastHunger) {
      drawHunger(this.hungerCanvas, survival.hunger);
      this.lastHunger = survival.hunger;
    }
    const airShown = survival.air < survival.maxAir - 0.01;
    this.airCanvas.style.display = airShown ? 'block' : 'none';
    if (airShown && Math.abs(survival.air - this.lastAir) > 0.1) {
      drawAir(this.airCanvas, survival.air, survival.maxAir);
      this.lastAir = survival.air;
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.nameToast.style.opacity = '0';
    }
  }

  setBarsVisible(v: boolean): void {
    (this.root.querySelector('.bars') as HTMLElement).style.display = v ? 'flex' : 'none';
  }

  setDebug(visible: boolean, text: string): void {
    this.debug.style.display = visible ? 'block' : 'none';
    if (visible) this.debug.textContent = text;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

// --- Canvas stat icons -------------------------------------------------------

function heartPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  ctx.beginPath();
  const t = cy - s * 0.1;
  ctx.moveTo(cx, cy + s * 0.5);
  ctx.bezierCurveTo(cx - s * 0.9, cy - s * 0.2, cx - s * 0.5, t - s * 0.6, cx, t);
  ctx.bezierCurveTo(cx + s * 0.5, t - s * 0.6, cx + s * 0.9, cy - s * 0.2, cx, cy + s * 0.5);
  ctx.closePath();
}

function drawHearts(canvas: HTMLCanvasElement, value: number, max: number): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const n = max / 2;
  for (let i = 0; i < n; i++) {
    const x = i * 18 + 9;
    const y = 9;
    // Empty base.
    ctx.fillStyle = '#3a1414';
    heartPath(ctx, x, y, 7); ctx.fill();
    const filled = value - i * 2;
    if (filled <= 0) continue;
    ctx.save();
    if (filled < 2) { ctx.beginPath(); ctx.rect(x - 8, 0, 8, 18); ctx.clip(); }
    ctx.fillStyle = '#ff3b3b';
    heartPath(ctx, x, y, 7); ctx.fill();
    ctx.strokeStyle = '#7a0000'; ctx.lineWidth = 0.6; heartPath(ctx, x, y, 7); ctx.stroke();
    ctx.restore();
  }
}

function drumstick(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(x, y - 1, 5, 4.2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8d4a0';
  ctx.fillRect(x + 2, y + 2, 5, 2.4);
}

function drawHunger(canvas: HTMLCanvasElement, value: number): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 10; i++) {
    const x = (9 - i) * 18 + 9;
    drumstick(ctx, x, 9, '#3a2a14');
    const filled = value - i * 2;
    if (filled <= 0) continue;
    ctx.save();
    if (filled < 2) { ctx.beginPath(); ctx.rect(x, 0, 9, 18); ctx.clip(); }
    drumstick(ctx, x, 9, '#c8791f');
    ctx.restore();
  }
}

function drawAir(canvas: HTMLCanvasElement, value: number, max: number): void {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const bubbles = Math.ceil((value / max) * 10);
  for (let i = 0; i < bubbles; i++) {
    const x = (9 - i) * 18 + 9;
    ctx.fillStyle = '#bfe8ff';
    ctx.beginPath(); ctx.arc(x, 9, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a3a4a'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x - 1.5, 7, 1.2, 0, Math.PI * 2); ctx.fill();
  }
}
