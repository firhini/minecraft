import type { Settings } from '../core/Settings';
import type { AudioEngine } from '../audio/AudioEngine';

// ---------------------------------------------------------------------------
// Title screen, loading overlay, pause menu, settings panel and death screen.
// ---------------------------------------------------------------------------

export interface MenuCallbacks {
  onPlay: (seed: string, creative: boolean) => void;
  onContinue: () => void;
  onResume: () => void;
  onQuit: () => void;
  onRespawn: () => void;
  onDeleteWorld: () => void;
}

export class Menus {
  root: HTMLDivElement;
  private title: HTMLDivElement;
  private loading: HTMLDivElement;
  private loadingBar: HTMLDivElement;
  private loadingText: HTMLDivElement;
  private pause: HTMLDivElement;
  private settingsPanel: HTMLDivElement;
  private death: HTMLDivElement;
  private continueBtn: HTMLButtonElement;

  constructor(private settings: Settings, private audio: AudioEngine, private cb: MenuCallbacks) {
    this.root = div('menu-root');

    // --- Title ---
    this.title = div('screen title-screen');
    const logo = div('logo');
    logo.innerHTML = '<span>VOXEL</span><span class="accent">CRAFT</span>';
    this.title.appendChild(logo);
    const sub = div('subtitle');
    sub.textContent = 'An infinite voxel sandbox';
    this.title.appendChild(sub);

    const card = div('menu-card');
    const seedLabel = div('field-label');
    seedLabel.textContent = 'World Seed (blank = random)';
    const seedInput = document.createElement('input');
    seedInput.className = 'text-input';
    seedInput.placeholder = 'e.g. skyblock, 12345…';
    const creativeRow = this.checkbox('Creative mode (fly, instant break, infinite blocks)', false);
    const playBtn = button('Create New World', 'primary', () => {
      this.audio.uiClick();
      this.cb.onPlay(seedInput.value.trim(), creativeRow.input.checked);
    });
    this.continueBtn = button('Continue Saved World', 'secondary', () => { this.audio.uiClick(); this.cb.onContinue(); });
    const settingsBtn = button('Settings', 'secondary', () => { this.audio.uiClick(); this.showSettings('title'); });
    const deleteBtn = button('Delete Saved World', 'danger small', () => {
      this.audio.uiClick();
      if (confirm('Delete the saved world? This cannot be undone.')) this.cb.onDeleteWorld();
    });
    card.append(seedLabel, seedInput, creativeRow.row, playBtn, this.continueBtn, settingsBtn, deleteBtn);
    this.title.appendChild(card);

    const hint = div('controls-hint');
    hint.innerHTML = controlsHTML();
    this.title.appendChild(hint);
    this.root.appendChild(this.title);

    // --- Loading ---
    this.loading = div('screen loading-screen');
    const loadingBox = div('loading-box');
    const lt = div('loading-title');
    lt.textContent = 'Generating world…';
    this.loadingText = div('loading-text');
    const barOuter = div('loading-bar-outer');
    this.loadingBar = div('loading-bar-inner');
    barOuter.appendChild(this.loadingBar);
    loadingBox.append(lt, barOuter, this.loadingText);
    this.loading.appendChild(loadingBox);
    this.loading.style.display = 'none';
    this.root.appendChild(this.loading);

    // --- Pause ---
    this.pause = div('screen pause-screen');
    const pauseCard = div('menu-card');
    const pt = div('menu-card-title');
    pt.textContent = 'Paused';
    pauseCard.appendChild(pt);
    pauseCard.appendChild(button('Resume', 'primary', () => { this.audio.uiClick(); this.cb.onResume(); }));
    pauseCard.appendChild(button('Settings', 'secondary', () => { this.audio.uiClick(); this.showSettings('pause'); }));
    pauseCard.appendChild(button('Save & Quit to Title', 'secondary', () => { this.audio.uiClick(); this.cb.onQuit(); }));
    this.pause.appendChild(pauseCard);
    this.pause.style.display = 'none';
    this.root.appendChild(this.pause);

    // --- Settings ---
    this.settingsPanel = div('screen settings-screen');
    this.settingsPanel.style.display = 'none';
    this.root.appendChild(this.settingsPanel);

    // --- Death ---
    this.death = div('screen death-screen');
    const deathCard = div('menu-card');
    const dt = div('death-title');
    dt.textContent = 'You Died!';
    deathCard.appendChild(dt);
    deathCard.appendChild(button('Respawn', 'primary', () => { this.audio.uiClick(); this.cb.onRespawn(); }));
    deathCard.appendChild(button('Title Screen', 'secondary', () => { this.audio.uiClick(); this.cb.onQuit(); }));
    this.death.appendChild(deathCard);
    this.death.style.display = 'none';
    this.root.appendChild(this.death);
  }

  private settingsReturn: 'title' | 'pause' = 'title';

  private checkbox(label: string, checked: boolean): { row: HTMLDivElement; input: HTMLInputElement } {
    const row = div('check-row');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    const l = document.createElement('label');
    l.textContent = label;
    l.prepend(input);
    row.appendChild(l);
    return { row, input };
  }

  showTitle(hasSave: boolean): void {
    this.hideAll();
    this.continueBtn.style.display = hasSave ? 'block' : 'none';
    this.title.style.display = 'flex';
    this.root.style.pointerEvents = 'auto';
  }

  showLoading(): void { this.hideAll(); this.loading.style.display = 'flex'; this.root.style.pointerEvents = 'auto'; }

  setLoadingProgress(frac: number, text: string): void {
    this.loadingBar.style.width = `${Math.round(frac * 100)}%`;
    this.loadingText.textContent = text;
  }

  showPause(): void { this.hideAll(); this.pause.style.display = 'flex'; this.root.style.pointerEvents = 'auto'; }
  showDeath(): void { this.hideAll(); this.death.style.display = 'flex'; this.root.style.pointerEvents = 'auto'; }

  hideAll(): void {
    for (const s of [this.title, this.loading, this.pause, this.settingsPanel, this.death]) s.style.display = 'none';
    this.root.style.pointerEvents = 'none';
  }

  showSettings(from: 'title' | 'pause'): void {
    this.settingsReturn = from;
    this.buildSettings();
    this.hideAll();
    this.settingsPanel.style.display = 'flex';
    this.root.style.pointerEvents = 'auto';
  }

  private buildSettings(): void {
    const s = this.settings.data;
    this.settingsPanel.innerHTML = '';
    const card = div('menu-card wide');
    const t = div('menu-card-title');
    t.textContent = 'Settings';
    card.appendChild(t);

    card.appendChild(this.slider('Field of View', s.fov, 60, 110, 1, (v) => this.settings.set('fov', v)));
    card.appendChild(this.slider('Render Distance (chunks)', s.renderDistance, 4, 20, 1, (v) => this.settings.set('renderDistance', v)));
    card.appendChild(this.slider('Mouse Sensitivity', s.sensitivity, 0.2, 3, 0.05, (v) => this.settings.set('sensitivity', round2(v))));
    card.appendChild(this.slider('Volume', Math.round(s.volume * 100), 0, 100, 1, (v) => this.settings.set('volume', v / 100)));

    const creative = this.checkbox('Creative Mode', s.creative);
    creative.input.addEventListener('change', () => this.settings.set('creative', creative.input.checked));
    card.appendChild(creative.row);
    const fps = this.checkbox('Show Debug (F3)', s.showFps);
    fps.input.addEventListener('change', () => this.settings.set('showFps', fps.input.checked));
    card.appendChild(fps.row);
    const wave = this.checkbox('Foliage Sway', s.waveEffects);
    wave.input.addEventListener('change', () => this.settings.set('waveEffects', wave.input.checked));
    card.appendChild(wave.row);

    card.appendChild(button('Back', 'primary', () => {
      this.audio.uiClick();
      if (this.settingsReturn === 'title') this.showTitle(true); else this.showPause();
    }));
    this.settingsPanel.appendChild(card);
  }

  private slider(label: string, value: number, min: number, max: number, step: number, onInput: (v: number) => void): HTMLDivElement {
    const row = div('slider-row');
    const l = document.createElement('label');
    const val = document.createElement('span');
    val.className = 'slider-val';
    val.textContent = String(value);
    l.textContent = label + ': ';
    l.appendChild(val);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      val.textContent = step < 1 ? v.toFixed(2) : String(v);
      onInput(v);
    });
    row.append(l, input);
    return row;
  }
}

function div(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}

function button(text: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function round2(v: number): number { return Math.round(v * 100) / 100; }

function controlsHTML(): string {
  return `
  <div class="controls-title">Controls</div>
  <div class="controls-grid">
    <span>WASD</span><span>Move</span>
    <span>Mouse</span><span>Look</span>
    <span>Space</span><span>Jump / Swim up</span>
    <span>Shift</span><span>Sneak / Descend</span>
    <span>Ctrl / 2×W</span><span>Sprint</span>
    <span>Left click</span><span>Break block</span>
    <span>Right click</span><span>Place / Use</span>
    <span>1–9 / Wheel</span><span>Select item</span>
    <span>E</span><span>Inventory</span>
    <span>2×Space</span><span>Fly (creative)</span>
    <span>F3</span><span>Debug</span>
    <span>Esc</span><span>Pause</span>
  </div>`;
}
