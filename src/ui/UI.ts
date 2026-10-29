import { MAPS, MAX_HP, PLAYER_COLORS, WEAPONS, type MapId, type WeaponId } from '../game/config';

export interface PlayConfig {
  name: string;
  color: number;
  map: MapId;
}

export interface ScoreRow {
  name: string;
  color: number;
  kills: number;
  deaths: number;
  isPlayer: boolean;
}

export interface HudState {
  timeLeft: number;
  hp: number;
  weapon: WeaponId | null;
  ammo: number;
  kills: number;
  rows: ScoreRow[];
}

const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export class UI {
  onPlay: (cfg: PlayConfig) => void = () => {};
  onMapSelect: (map: MapId) => void = () => {};
  onResume: () => void = () => {};
  onQuit: () => void = () => {};
  onAgain: () => void = () => {};
  onPauseClick: () => void = () => {};
  onMuteToggle: () => boolean = () => false;

  private menu: HTMLDivElement;
  private hud: HTMLDivElement;
  private pause: HTMLDivElement;
  private end: HTMLDivElement;
  private center: HTMLDivElement;
  private feedEl!: HTMLDivElement;
  private boardEl!: HTMLDivElement;
  private timerEl!: HTMLDivElement;
  private heartsEl!: HTMLDivElement;
  private weaponEl!: HTMLDivElement;
  private killsEl!: HTMLDivElement;
  private vignette: HTMLDivElement;
  private centerTimer = 0;
  private cfg: PlayConfig;
  private lastBoard = '';
  private lastWeapon = '';

  constructor(private root: HTMLElement, saved: Partial<PlayConfig>, private stats: { wins: number; bestKills: number }) {
    this.cfg = {
      name: saved.name || 'Captain ' + Math.floor(100 + Math.random() * 900),
      color: saved.color ?? PLAYER_COLORS[0],
      map: saved.map ?? 'pond',
    };
    this.vignette = this.el('div', 'vignette');
    this.menu = this.el('div', 'screen menu');
    this.hud = this.el('div', 'hud hidden');
    this.pause = this.el('div', 'screen overlay hidden');
    this.end = this.el('div', 'screen overlay hidden');
    this.center = this.el('div', 'center-msg');
    this.buildMenu();
    this.buildHud();
    this.buildPause();
  }

  private el(tag: string, cls: string): HTMLDivElement {
    const e = document.createElement(tag) as HTMLDivElement;
    e.className = cls;
    this.root.appendChild(e);
    return e;
  }

  get config(): PlayConfig {
    return this.cfg;
  }

  setStats(stats: { wins: number; bestKills: number }): void {
    this.stats = stats;
    const s = this.menu.querySelector('.stats');
    if (s) s.innerHTML = this.statsHtml();
  }

  setName(name: string): void {
    this.cfg.name = name;
    const input = this.menu.querySelector<HTMLInputElement>('.name-input');
    if (input) input.value = name;
  }

  private statsHtml(): string {
    return `🏆 Wins <b>${this.stats.wins}</b> &nbsp;·&nbsp; 💥 Best <b>${this.stats.bestKills}</b> sinks`;
  }

  private buildMenu(): void {
    const maps = Object.values(MAPS)
      .map(
        (m) => `<button class="map-card ${m.id === this.cfg.map ? 'sel' : ''}" data-map="${m.id}" style="--water:${hex(m.waterShallow)};--deep:${hex(m.waterDeep)}">
          <span class="map-name">${m.name}</span><span class="map-blurb">${m.blurb}</span></button>`,
      )
      .join('');
    const colors = PLAYER_COLORS.map(
      (c) => `<button class="swatch ${c === this.cfg.color ? 'sel' : ''}" data-color="${c}" style="background:${hex(c)}" aria-label="colour"></button>`,
    ).join('');
    this.menu.innerHTML = `
      <div class="menu-card main-menu">
        <div class="col">
          <h1 class="logo">Nutshell<br/><span>Navy</span></h1>
          <p class="tag">Paddle. Pick up. Sink 'em all.</p>
          <label class="lbl">Captain name</label>
          <input class="name-input" maxlength="14" value="${esc(this.cfg.name)}" />
          <label class="lbl">Flag colour</label>
          <div class="swatches">${colors}</div>
        </div>
        <div class="col">
          <label class="lbl">Waters</label>
          <div class="maps">${maps}</div>
          <button class="btn play">▶ PLAY</button>
          <div class="stats">${this.statsHtml()}</div>
          <div class="help">WASD / Arrows to paddle · Space or Click to fire · Esc to pause</div>
        </div>
      </div>`;
    const input = this.menu.querySelector<HTMLInputElement>('.name-input')!;
    input.addEventListener('input', () => (this.cfg.name = input.value.trim().slice(0, 14)));
    // Don't let typing in the name field steer the attract-mode camera etc.
    input.addEventListener('keydown', (e) => e.stopPropagation());
    this.menu.querySelectorAll<HTMLButtonElement>('.swatch').forEach((b) =>
      b.addEventListener('click', () => {
        this.cfg.color = Number(b.dataset.color);
        this.menu.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s === b));
      }),
    );
    this.menu.querySelectorAll<HTMLButtonElement>('.map-card').forEach((b) =>
      b.addEventListener('click', () => {
        this.cfg.map = b.dataset.map as MapId;
        this.menu.querySelectorAll('.map-card').forEach((s) => s.classList.toggle('sel', s === b));
        this.onMapSelect(this.cfg.map);
      }),
    );
    this.menu.querySelector('.play')!.addEventListener('click', () => {
      if (!this.cfg.name) this.cfg.name = 'Captain';
      this.onPlay({ ...this.cfg });
    });
  }

  private buildHud(): void {
    this.hud.innerHTML = `
      <div class="hud-top-left">
        <div class="timer">3:00</div>
        <div class="hud-btns"><button class="icon-btn pause-btn" aria-label="pause">⏸</button><button class="icon-btn mute-btn" aria-label="mute">🔊</button></div>
      </div>
      <div class="hud-kills">💥 <span>0</span></div>
      <div class="board"></div>
      <div class="feed"></div>
      <div class="hud-bottom">
        <div class="hearts"></div>
        <div class="weapon empty"><span class="w-icon">·</span><span class="w-name">Grab a barrel!</span></div>
      </div>`;
    this.timerEl = this.hud.querySelector('.timer')!;
    this.boardEl = this.hud.querySelector('.board')!;
    this.feedEl = this.hud.querySelector('.feed')!;
    this.heartsEl = this.hud.querySelector('.hearts')!;
    this.weaponEl = this.hud.querySelector('.weapon')!;
    this.killsEl = this.hud.querySelector('.hud-kills span')!;
    this.hud.querySelector('.pause-btn')!.addEventListener('click', () => this.onPauseClick());
    const mute = this.hud.querySelector<HTMLButtonElement>('.mute-btn')!;
    mute.addEventListener('click', () => {
      mute.textContent = this.onMuteToggle() ? '🔇' : '🔊';
    });
  }

  private buildPause(): void {
    this.pause.innerHTML = `<div class="menu-card small"><h2>Paused</h2>
      <button class="btn resume">▶ Resume</button><button class="btn ghost quit">Quit to menu</button></div>`;
    this.pause.querySelector('.resume')!.addEventListener('click', () => this.onResume());
    this.pause.querySelector('.quit')!.addEventListener('click', () => this.onQuit());
  }

  showMenu(): void {
    this.menu.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.end.classList.add('hidden');
    this.center.textContent = '';
  }

  showHud(): void {
    this.menu.classList.add('hidden');
    this.end.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.feedEl.innerHTML = '';
    this.lastBoard = '';
    this.lastWeapon = '';
  }

  showPause(show: boolean): void {
    this.pause.classList.toggle('hidden', !show);
  }

  showEnd(rows: ScoreRow[], playerRank: number): void {
    this.hud.classList.add('hidden');
    this.center.textContent = '';
    const medal = ['🥇', '🥈', '🥉'];
    const title = playerRank === 1 ? 'Admiral of the Waves!' : playerRank <= 3 ? 'On the podium!' : 'Sunk but not forgotten';
    const list = rows
      .map(
        (r, i) => `<div class="res-row ${r.isPlayer ? 'me' : ''}"><span class="rk">${medal[i] ?? i + 1}</span>
        <span class="dot" style="background:${hex(r.color)}"></span><span class="nm">${esc(r.name)}</span>
        <span class="k">💥 ${r.kills}</span><span class="d">☠ ${r.deaths}</span></div>`,
      )
      .join('');
    this.end.innerHTML = `<div class="menu-card"><h2>${title}</h2><p class="tag">You placed <b>#${playerRank}</b></p>
      <div class="results">${list}</div>
      <button class="btn again">↻ Play again</button><button class="btn ghost menu-btn">Change waters</button></div>`;
    this.end.querySelector('.again')!.addEventListener('click', () => this.onAgain());
    this.end.querySelector('.menu-btn')!.addEventListener('click', () => this.onQuit());
    this.end.classList.remove('hidden');
  }

  updateHud(s: HudState, playerRespawn: number | null): void {
    const t = Math.max(0, Math.ceil(s.timeLeft));
    this.timerEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.timerEl.classList.toggle('low', t <= 15);
    this.killsEl.textContent = String(s.kills);

    let hearts = '';
    for (let i = 0; i < MAX_HP; i++) hearts += `<span class="heart ${i < s.hp ? '' : 'lost'}">❤</span>`;
    if (this.heartsEl.innerHTML !== hearts) this.heartsEl.innerHTML = hearts;

    const wkey = `${s.weapon}:${s.ammo}`;
    if (wkey !== this.lastWeapon) {
      this.lastWeapon = wkey;
      if (s.weapon) {
        const w = WEAPONS[s.weapon];
        this.weaponEl.className = 'weapon pop';
        this.weaponEl.innerHTML = `<span class="w-icon">${w.icon}</span><span class="w-name">${w.name}</span>${s.ammo > 1 ? `<span class="w-ammo">×${s.ammo}</span>` : ''}`;
      } else {
        this.weaponEl.className = 'weapon empty';
        this.weaponEl.innerHTML = `<span class="w-icon">·</span><span class="w-name">Grab a barrel!</span>`;
      }
    }

    const sorted = s.rows;
    const meIdx = sorted.findIndex((r) => r.isPlayer);
    const shown = sorted.slice(0, 5);
    let board = shown
      .map((r, i) => `<div class="row ${r.isPlayer ? 'me' : ''}"><span>${i + 1}</span><i style="background:${hex(r.color)}"></i><span class="nm">${esc(r.name)}</span><b>${r.kills}</b></div>`)
      .join('');
    if (meIdx >= 5) {
      const r = sorted[meIdx];
      board += `<div class="row me"><span>${meIdx + 1}</span><i style="background:${hex(r.color)}"></i><span class="nm">${esc(r.name)}</span><b>${r.kills}</b></div>`;
    }
    if (board !== this.lastBoard) {
      this.boardEl.innerHTML = board;
      this.lastBoard = board;
    }

    if (playerRespawn !== null) {
      this.center.innerHTML = `<div class="big">Sunk!</div><div>Back in ${Math.ceil(playerRespawn)}…</div>`;
      this.centerTimer = 0.1;
    }
  }

  tick(dt: number): void {
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) this.center.innerHTML = '';
    }
  }

  message(html: string, seconds: number): void {
    this.center.innerHTML = html;
    this.centerTimer = seconds;
  }

  feed(killer: { name: string; color: number } | null, victim: { name: string; color: number }, icon: string): void {
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = killer
      ? `<span style="color:${hex(killer.color)}">${esc(killer.name)}</span> ${icon} <span style="color:${hex(victim.color)}">${esc(victim.name)}</span>`
      : `<span style="color:${hex(victim.color)}">${esc(victim.name)}</span> 🌊 sank`;
    this.feedEl.prepend(row);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild?.remove();
    setTimeout(() => row.classList.add('fade'), 4000);
    setTimeout(() => row.remove(), 4600);
  }

  damageFlash(): void {
    this.vignette.classList.remove('hit');
    void this.vignette.offsetWidth; // restart animation
    this.vignette.classList.add('hit');
  }
}
