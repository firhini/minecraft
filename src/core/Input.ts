// ---------------------------------------------------------------------------
// Centralised input: keyboard, mouse look (pointer lock), buttons and wheel.
// Per-frame "pressed" edges are tracked so gameplay code can react once.
// ---------------------------------------------------------------------------

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();

  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;

  mouseButtons = [false, false, false];
  mousePressed = [false, false, false];
  mouseReleased = [false, false, false];

  locked = false;
  enabled = true;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private canvas: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock(): void {
    this.canvas.requestPointerLock();
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private onPointerLockChange = () => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) {
      this.down.clear();
      this.mouseButtons = [false, false, false];
    }
    this.onLockChange?.(this.locked);
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
    // Prevent page scroll on space / arrows while playing.
    if (this.locked && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
    this.released.add(e.code);
  };

  private onMouseDown = (e: MouseEvent) => {
    if (e.button < 3) {
      if (!this.mouseButtons[e.button]) this.mousePressed[e.button] = true;
      this.mouseButtons[e.button] = true;
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button < 3) {
      this.mouseButtons[e.button] = false;
      this.mouseReleased[e.button] = true;
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.locked) {
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (this.locked) {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }
  };

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  wasReleased(code: string): boolean {
    return this.released.has(code);
  }

  /** Call at end of each frame to clear per-frame edges and deltas. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
  }
}
