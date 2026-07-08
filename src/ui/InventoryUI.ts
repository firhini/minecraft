import { getItem } from '../inventory/items';
import { Inventory, stackSizeOf, type ItemStack } from '../inventory/Inventory';
import { matchRecipe } from '../crafting/recipes';
import type { TextureAtlas } from '../render/TextureAtlas';
import type { AudioEngine } from '../audio/AudioEngine';

// ---------------------------------------------------------------------------
// Modal inventory + crafting screen. Classic "carry a stack on the cursor"
// interaction: left click = pick up / drop all, right click = half / one.
// Supports a 2x2 personal grid and a 3x3 crafting-table grid.
// ---------------------------------------------------------------------------

function makeStack(id: string, count: number): ItemStack {
  const item = getItem(id);
  const stack: ItemStack = { id, count };
  if (item?.durability && (item.tool)) stack.durability = item.durability;
  return stack;
}

export class InventoryUI {
  root: HTMLDivElement;
  visible = false;
  private gridSize = 2;
  private craft: (ItemStack | null)[] = new Array(9).fill(null);
  private cursor: ItemStack | null = null;
  private cursorEl: HTMLDivElement;

  private invSlots: HTMLDivElement[] = [];
  private craftContainer: HTMLDivElement;
  private craftSlots: HTMLDivElement[] = [];
  private resultSlot: HTMLDivElement;
  private title: HTMLDivElement;

  onClose: (() => void) | null = null;

  constructor(private atlas: TextureAtlas, private inventory: Inventory, private audio: AudioEngine) {
    this.root = document.createElement('div');
    this.root.className = 'modal inventory-modal';
    this.root.style.display = 'none';

    const panel = document.createElement('div');
    panel.className = 'panel';

    this.title = document.createElement('div');
    this.title.className = 'panel-title';
    this.title.textContent = 'Inventory';
    panel.appendChild(this.title);

    // Crafting area.
    const craftArea = document.createElement('div');
    craftArea.className = 'craft-area';
    this.craftContainer = document.createElement('div');
    this.craftContainer.className = 'craft-grid';
    const arrow = document.createElement('div');
    arrow.className = 'craft-arrow';
    arrow.textContent = '➜';
    this.resultSlot = this.makeSlot('result', 0);
    this.resultSlot.classList.add('result-slot');
    craftArea.appendChild(this.craftContainer);
    craftArea.appendChild(arrow);
    craftArea.appendChild(this.resultSlot);
    panel.appendChild(craftArea);

    // Main inventory (3x9) + hotbar row.
    const invGrid = document.createElement('div');
    invGrid.className = 'inv-grid';
    // Rows for slots 9..35 (main), then a gap, then 0..8 (hotbar).
    for (let i = 9; i < 36; i++) invGrid.appendChild(this.makeInvSlot(i));
    const hotRow = document.createElement('div');
    hotRow.className = 'inv-grid hotbar-row';
    for (let i = 0; i < 9; i++) hotRow.appendChild(this.makeInvSlot(i));
    panel.appendChild(invGrid);
    panel.appendChild(hotRow);

    this.root.appendChild(panel);

    // Floating cursor stack.
    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'cursor-stack';
    this.cursorEl.style.display = 'none';
    this.root.appendChild(this.cursorEl);

    this.root.addEventListener('mousemove', (e) => this.onMouseMove(e));
    // Clicking the dark backdrop closes.
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  private makeSlot(type: string, index: number): HTMLDivElement {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.type = type;
    slot.dataset.index = String(index);
    const img = document.createElement('img');
    img.className = 'slot-icon';
    const count = document.createElement('span');
    count.className = 'slot-count';
    slot.appendChild(img);
    slot.appendChild(count);
    slot.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.onSlotClick(type, index, e.button, e.shiftKey);
    });
    slot.addEventListener('mouseenter', () => this.audio.uiHover());
    return slot;
  }

  private makeInvSlot(index: number): HTMLDivElement {
    const slot = this.makeSlot('inv', index);
    this.invSlots[index] = slot;
    return slot;
  }

  private buildCraftGrid(): void {
    this.craftContainer.innerHTML = '';
    this.craftSlots = [];
    this.craftContainer.style.gridTemplateColumns = `repeat(${this.gridSize}, 48px)`;
    for (let i = 0; i < this.gridSize * this.gridSize; i++) {
      const slot = this.makeSlot('craft', i);
      this.craftSlots.push(slot);
      this.craftContainer.appendChild(slot);
    }
  }

  open(size: number): void {
    this.gridSize = size === 3 ? 3 : 2;
    this.title.textContent = this.gridSize === 3 ? 'Crafting Table' : 'Inventory';
    this.buildCraftGrid();
    this.visible = true;
    this.root.style.display = 'flex';
    this.renderAll();
    this.audio.open();
  }

  close(): void {
    if (!this.visible) return;
    // Return crafting ingredients & cursor to inventory.
    for (let i = 0; i < this.craft.length; i++) {
      const s = this.craft[i];
      if (s) { this.inventory.add(s.id, s.count, s.durability); this.craft[i] = null; }
    }
    if (this.cursor) { this.inventory.add(this.cursor.id, this.cursor.count, this.cursor.durability); this.cursor = null; }
    this.updateCursorEl();
    this.visible = false;
    this.root.style.display = 'none';
    this.onClose?.();
  }

  private slotStackGet(type: string, index: number): ItemStack | null {
    if (type === 'inv') return this.inventory.get(index);
    if (type === 'craft') return this.craft[index];
    return null;
  }

  private slotStackSet(type: string, index: number, stack: ItemStack | null): void {
    if (type === 'inv') this.inventory.set(index, stack);
    else if (type === 'craft') this.craft[index] = stack;
  }

  private onSlotClick(type: string, index: number, button: number, shift: boolean): void {
    this.audio.uiClick();
    if (type === 'result') { this.takeResult(shift); this.renderAll(); return; }

    if (shift && type === 'inv') {
      // Quick-move between hotbar and main storage.
      this.quickMove(index);
      this.recompute();
      this.renderAll();
      return;
    }

    const s = this.slotStackGet(type, index);
    if (button === 2) this.rightClick(type, index, s);
    else this.leftClick(type, index, s);
    this.recompute();
    this.renderAll();
  }

  private leftClick(type: string, index: number, s: ItemStack | null): void {
    if (!this.cursor) {
      if (s) { this.cursor = s; this.slotStackSet(type, index, null); }
      return;
    }
    if (!s) {
      this.slotStackSet(type, index, this.cursor); this.cursor = null; return;
    }
    if (s.id === this.cursor.id) {
      const max = stackSizeOf(s.id);
      const move = Math.min(max - s.count, this.cursor.count);
      s.count += move; this.cursor.count -= move;
      if (this.cursor.count <= 0) this.cursor = null;
      this.slotStackSet(type, index, s);
    } else {
      const tmp = s; this.slotStackSet(type, index, this.cursor); this.cursor = tmp;
    }
  }

  private rightClick(type: string, index: number, s: ItemStack | null): void {
    if (!this.cursor) {
      if (s) {
        const half = Math.ceil(s.count / 2);
        this.cursor = { id: s.id, count: half, durability: s.durability };
        s.count -= half;
        this.slotStackSet(type, index, s.count > 0 ? s : null);
      }
      return;
    }
    if (!s) {
      this.slotStackSet(type, index, { id: this.cursor.id, count: 1, durability: this.cursor.durability });
      this.cursor.count--;
      if (this.cursor.count <= 0) this.cursor = null;
    } else if (s.id === this.cursor.id && s.count < stackSizeOf(s.id)) {
      s.count++; this.cursor.count--;
      if (this.cursor.count <= 0) this.cursor = null;
    }
  }

  private quickMove(index: number): void {
    const s = this.inventory.get(index);
    if (!s) return;
    // hotbar (0-8) <-> storage (9-35)
    const toHot = index >= 9;
    const start = toHot ? 0 : 9;
    const end = toHot ? 9 : 36;
    const max = stackSizeOf(s.id);
    for (let i = start; i < end && s.count > 0; i++) {
      const t = this.inventory.get(i);
      if (t && t.id === s.id && t.count < max) {
        const move = Math.min(max - t.count, s.count);
        t.count += move; s.count -= move;
      }
    }
    for (let i = start; i < end && s.count > 0; i++) {
      if (!this.inventory.get(i)) {
        this.inventory.set(i, { id: s.id, count: s.count, durability: s.durability });
        s.count = 0;
      }
    }
    this.inventory.set(index, s.count > 0 ? s : null);
  }

  private currentResult(): { id: string; count: number } | null {
    const n = this.gridSize * this.gridSize;
    const grid: (string | null)[] = [];
    for (let i = 0; i < n; i++) grid.push(this.craft[i]?.id ?? null);
    return matchRecipe(grid, this.gridSize);
  }

  private takeResult(all: boolean): void {
    let out = this.currentResult();
    if (!out) return;
    // If holding something incompatible, abort.
    if (this.cursor && (this.cursor.id !== out.id || this.cursor.count + out.count > stackSizeOf(out.id))) return;

    let iterations = 0;
    do {
      if (this.cursor && this.cursor.id === out.id) this.cursor.count += out.count;
      else this.cursor = makeStack(out.id, out.count);
      // Consume one of each ingredient.
      for (let i = 0; i < this.craft.length; i++) {
        const s = this.craft[i];
        if (s) { s.count--; if (s.count <= 0) this.craft[i] = null; }
      }
      out = this.currentResult();
      iterations++;
    } while (all && out && this.cursor && this.cursor.id === out.id &&
             this.cursor.count + out.count <= stackSizeOf(out.id) && iterations < 64);

    this.audio.craft();
  }

  private recompute(): void {
    // Result rendering handled in renderAll via currentResult.
  }

  private renderAll(): void {
    for (let i = 0; i < 36; i++) this.renderSlot(this.invSlots[i], this.inventory.get(i));
    for (let i = 0; i < this.craftSlots.length; i++) this.renderSlot(this.craftSlots[i], this.craft[i]);
    const out = this.currentResult();
    this.renderSlot(this.resultSlot, out ? { id: out.id, count: out.count } : null);
    this.updateCursorEl();
  }

  private renderSlot(slot: HTMLDivElement, stack: ItemStack | null): void {
    const img = slot.querySelector('.slot-icon') as HTMLImageElement;
    const count = slot.querySelector('.slot-count') as HTMLSpanElement;
    if (stack) {
      const item = getItem(stack.id);
      img.src = this.atlas.iconDataURL(item?.texture ?? 'stone');
      img.style.display = 'block';
      count.textContent = stack.count > 1 ? String(stack.count) : '';
    } else {
      img.style.display = 'none';
      count.textContent = '';
    }
  }

  private updateCursorEl(): void {
    if (this.cursor) {
      const item = getItem(this.cursor.id);
      this.cursorEl.style.display = 'block';
      this.cursorEl.innerHTML =
        `<img src="${this.atlas.iconDataURL(item?.texture ?? 'stone')}" class="slot-icon" style="display:block"/>` +
        (this.cursor.count > 1 ? `<span class="slot-count">${this.cursor.count}</span>` : '');
    } else {
      this.cursorEl.style.display = 'none';
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const rect = this.root.getBoundingClientRect();
    this.cursorEl.style.left = `${e.clientX - rect.left}px`;
    this.cursorEl.style.top = `${e.clientY - rect.top}px`;
  }
}
