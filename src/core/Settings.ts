// ---------------------------------------------------------------------------
// User settings, persisted to localStorage.
// ---------------------------------------------------------------------------

export interface SettingsData {
  fov: number;
  renderDistance: number;   // chunks
  sensitivity: number;      // mouse
  volume: number;           // 0..1
  creative: boolean;
  showFps: boolean;
  waveEffects: boolean;
}

const KEY = 'voxelcraft.settings';

const DEFAULTS: SettingsData = {
  fov: 75,
  renderDistance: 8,
  sensitivity: 1.0,
  volume: 0.7,
  creative: false,
  showFps: false,
  waveEffects: true,
};

export class Settings {
  data: SettingsData;
  onChange: ((s: SettingsData) => void) | null = null;

  constructor() {
    this.data = { ...DEFAULTS };
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch { /* ignore */ }
  }

  save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
    this.onChange?.(this.data);
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    this.data[key] = value;
    this.save();
  }
}
