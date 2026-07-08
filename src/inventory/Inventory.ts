import { getItem } from './items';

// ---------------------------------------------------------------------------
// Player inventory model. Slots 0-8 are the hotbar; 9-35 the main grid.
// Pure data + operations; UI and drag/drop live elsewhere.
// ---------------------------------------------------------------------------

export interface ItemStack {
  id: string;
  count: number;
  /** Remaining tool durability (uses left); undefined for non-tools. */
  durability?: number;
}

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36;

export function stackSizeOf(id: string): number {
  return getItem(id)?.stackSize ?? 64;
}

export function cloneStack(s: ItemStack | null): ItemStack | null {
  return s ? { id: s.id, count: s.count, durability: s.durability } : null;
}

export class Inventory {
  slots: (ItemStack | null)[];
  selected = 0;
  onChange: (() => void) | null = null;

  constructor(size = INVENTORY_SIZE) {
    this.slots = new Array(size).fill(null);
  }

  private changed(): void { this.onChange?.(); }

  get(index: number): ItemStack | null {
    return this.slots[index];
  }

  set(index: number, stack: ItemStack | null): void {
    this.slots[index] = stack;
    this.changed();
  }

  getSelected(): ItemStack | null {
    return this.slots[this.selected];
  }

  selectHotbar(index: number): void {
    this.selected = ((index % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
    this.changed();
  }

  scrollHotbar(dir: number): void {
    this.selectHotbar(this.selected + dir);
  }

  /** Add items, returning the count that did not fit. */
  add(id: string, count: number, durability?: number): number {
    const max = stackSizeOf(id);
    // First, top up existing stacks (tools never stack).
    if (max > 1) {
      for (let i = 0; i < this.slots.length && count > 0; i++) {
        const s = this.slots[i];
        if (s && s.id === id && s.count < max) {
          const add = Math.min(max - s.count, count);
          s.count += add;
          count -= add;
        }
      }
    }
    // Then fill empty slots (hotbar first for convenience).
    for (let i = 0; i < this.slots.length && count > 0; i++) {
      if (!this.slots[i]) {
        const add = Math.min(max, count);
        this.slots[i] = { id, count: add, durability };
        count -= add;
      }
    }
    this.changed();
    return count;
  }

  canAdd(id: string, count: number): boolean {
    const max = stackSizeOf(id);
    let remaining = count;
    for (const s of this.slots) {
      if (s === null) remaining -= max;
      else if (s.id === id && max > 1) remaining -= (max - s.count);
      if (remaining <= 0) return true;
    }
    return remaining <= 0;
  }

  /** Remove up to `count` of `id`; returns amount actually removed. */
  remove(id: string, count: number): number {
    let removed = 0;
    for (let i = 0; i < this.slots.length && removed < count; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, count - removed);
        s.count -= take;
        removed += take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    if (removed > 0) this.changed();
    return removed;
  }

  count(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Consume one from the selected slot (used when placing a block). */
  consumeSelected(): void {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count--;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  /** Damage the tool in the selected slot; removes it when it breaks. Returns true if broke. */
  damageSelected(amount = 1): boolean {
    const s = this.slots[this.selected];
    if (!s || s.durability === undefined) return false;
    s.durability -= amount;
    if (s.durability <= 0) {
      this.slots[this.selected] = null;
      this.changed();
      return true;
    }
    this.changed();
    return false;
  }

  serialize(): (ItemStack | null)[] {
    return this.slots.map(cloneStack);
  }

  load(data: (ItemStack | null)[]): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i] = i < data.length ? cloneStack(data[i]) : null;
    }
    this.changed();
  }
}
