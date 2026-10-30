import { MAPS, MAX_HP, PLAYER_COLORS, WEAPONS, WEAPON_ORDER, type MapId, type WeaponId } from '../game/config';
import { SPECIES, type SpeciesId } from '../game/Character';
import type { QualitySetting } from '../game/Game';
import { icon, medal } from './icons';
import { CODE_LENGTH, ROOM_SIZE, normalizeCode, type SettingsMsg } from '../../shared/protocol';

export interface PlayConfig {
  name: string;
  color: number;
  map: MapId;
  character: SpeciesId;
  /** Weapons crates may roll (Arsenal screen). */
  arsenal: WeaponId[];
}

export interface ScoreRow {
  name: string;
  color: number;
  kills: number;
  deaths: number;
  isPlayer: boolean;
}

/** The room lobby (private rooms between matches, or waiting for the next public match). */
export interface LobbyView {
  code: string;
  isPrivate: boolean;
  isHost: boolean;
  map: MapId;
  arsenal: WeaponId[];
  bots: boolean;
  players: { name: string; color: number; isBot: boolean; isHost: boolean; isMe: boolean }[];
  status: string;
  canStart: boolean;
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
const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}<sup>${s}</sup>`;
};
const QUALITY_LABEL: Record<QualitySetting, string> = { auto: 'Auto', high: 'High', low: 'Low' };

/** Clipboard API needs https/localhost; fall back to the old copy command on plain-http LAN tests. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Saved arsenals may be missing, empty or contain removed weapons: fall back to everything. */
function validArsenal(list: unknown): WeaponId[] {
  const ok = Array.isArray(list) ? WEAPON_ORDER.filter((id) => list.includes(id)) : [];
  return ok.length ? ok : [...WEAPON_ORDER];
}

export class UI {
  onPlay: (cfg: PlayConfig) => void = () => {};
  onMapSelect: (map: MapId) => void = () => {};
  /** Character or colour changed in the menu (updates the 3D showcase). */
  onPreview: (cfg: PlayConfig) => void = () => {};
  onResume: () => void = () => {};
  onQuit: () => void = () => {};
  onAgain: () => void = () => {};
  onPauseClick: () => void = () => {};
  onMuteToggle: () => boolean = () => false;
  onQualityChange: (q: QualitySetting) => void = () => {};
  // Online play
  onQuickPlay: (cfg: PlayConfig) => void = () => {};
  onCreateRoom: (cfg: PlayConfig) => void = () => {};
  onJoinRoom: (code: string, cfg: PlayConfig) => void = () => {};
  onCancelConnect: () => void = () => {};
  onLobbySettings: (s: SettingsMsg) => void = () => {};
  onLobbyStart: () => void = () => {};
  onLeaveRoom: () => void = () => {};
  inviteLink: (code: string) => string = (code) => code;

  private menu: HTMLDivElement;
  private lobby: HTMLDivElement;
  private modal: HTMLDivElement;
  private arsenalEl: HTMLDivElement;
  private hud: HTMLDivElement;
  private pause: HTMLDivElement;
  private end: HTMLDivElement;
  private center: HTMLDivElement;
  private toast: HTMLDivElement;
  private vignette: HTMLDivElement;
  private feedEl!: HTMLDivElement;
  private boardEl!: HTMLDivElement;
  private rankEl!: HTMLDivElement;
  private timerEl!: HTMLSpanElement;
  private timerBox!: HTMLDivElement;
  private hpEl!: HTMLDivElement;
  private weaponEl!: HTMLDivElement;
  private centerTimer = 0;
  private toastTimer = 0;
  private cfg: PlayConfig;
  private lastBoard = '';
  private lastWeapon = '';
  private lastHp = -1;
  private lastRank = '';
  private quality: QualitySetting = 'auto';
  private lobbyView: LobbyView | null = null;
  private lobbyKeys = { players: '', settings: '', status: '' };

  constructor(private root: HTMLElement, saved: Partial<PlayConfig>, private stats: { wins: number; bestKills: number }) {
    this.cfg = {
      name: saved.name || 'Captain ' + Math.floor(100 + Math.random() * 900),
      color: PLAYER_COLORS.includes(saved.color as number) ? (saved.color as number) : PLAYER_COLORS[0],
      map: saved.map && MAPS[saved.map] ? saved.map : 'pond',
      character: SPECIES.some((s) => s.id === saved.character) ? (saved.character as SpeciesId) : SPECIES[0].id,
      arsenal: validArsenal(saved.arsenal),
    };
    this.vignette = this.el('div', 'vignette');
    this.menu = this.el('div', 'screen menu');
    this.lobby = this.el('div', 'screen menu lobby hidden');
    this.arsenalEl = this.el('div', 'screen overlay hidden');
    this.hud = this.el('div', 'hud hidden');
    this.pause = this.el('div', 'screen overlay hidden');
    this.end = this.el('div', 'screen overlay hidden');
    this.center = this.el('div', 'center-msg');
    this.toast = this.el('div', 'toast');
    this.modal = this.el('div', 'screen overlay hidden');
    this.buildMenu();
    this.buildHud();
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

  /** Right edge (px) of the menu or lobby card, so the 3D showcase can sit in the space beside it. */
  get panelRight(): number {
    const el = !this.lobby.classList.contains('hidden') ? this.lobby.firstElementChild : !this.menu.classList.contains('hidden') ? this.menu.firstElementChild : null;
    return el ? el.getBoundingClientRect().right : 0;
  }

  /** Top-right corner of the menu (hosts the account and sound buttons). */
  get menuCorner(): HTMLElement {
    return this.menu.querySelector<HTMLElement>('.menu-corner')!;
  }

  /** Applies settings loaded from elsewhere (e.g. a cloud save) and refreshes the menu + 3D preview. */
  applyConfig(p: Record<string, unknown>): void {
    if (typeof p.name === 'string' && p.name.trim()) this.setName(p.name.trim().slice(0, 14));
    if (PLAYER_COLORS.includes(p.color as number)) this.cfg.color = p.color as number;
    if (typeof p.map === 'string' && p.map in MAPS) this.cfg.map = p.map as MapId;
    if (SPECIES.some((s) => s.id === p.character)) this.cfg.character = p.character as SpeciesId;
    if (Array.isArray(p.arsenal)) this.cfg.arsenal = validArsenal(p.arsenal);
    this.menu.querySelectorAll<HTMLElement>('.swatch').forEach((s) => s.classList.toggle('sel', Number(s.dataset.color) === this.cfg.color));
    this.menu.querySelectorAll<HTMLElement>('.map-card').forEach((s) => s.classList.toggle('sel', s.dataset.map === this.cfg.map));
    this.renderPicker();
    this.renderArsenalCount();
    this.onMapSelect(this.cfg.map);
    this.onPreview({ ...this.cfg });
  }

  setMuted(muted: boolean): void {
    this.root.querySelectorAll('.mute-btn').forEach((b) => (b.innerHTML = icon(muted ? 'soundOff' : 'soundOn')));
  }

  private statsHtml(): string {
    return `<span class="ic">${icon('trophy')}</span> Wins <b>${this.stats.wins}</b><span class="sep"></span><span class="ic">${icon('sink')}</span> Best <b>${this.stats.bestKills}</b> sinks`;
  }

  private muteButton(): string {
    return `<button class="icon-btn mute-btn" aria-label="Sound">${icon('soundOn')}</button>`;
  }

  private bindMute(scope: HTMLElement): void {
    scope.querySelectorAll<HTMLButtonElement>('.mute-btn').forEach((b) =>
      b.addEventListener('click', () => this.setMuted(this.onMuteToggle())),
    );
  }

  // ---------------------------------------------------------------- menu

  private buildMenu(): void {
    const maps = Object.values(MAPS)
      .map(
        (m) => `<button class="map-card ${m.id === this.cfg.map ? 'sel' : ''}" data-map="${m.id}" style="--water:${hex(m.waterShallow)};--deep:${hex(m.waterDeep)}">
          <span class="map-ic">${icon(m.id)}</span><span class="map-name">${m.name}</span></button>`,
      )
      .join('');
    const colors = PLAYER_COLORS.map(
      (c) => `<button class="swatch ${c === this.cfg.color ? 'sel' : ''}" data-color="${c}" style="--c:${hex(c)}" aria-label="Boat colour"></button>`,
    ).join('');
    this.menu.innerHTML = `
      <div class="menu-card card">
        <div class="col">
          <h1 class="logo"><span class="l1">Nutshell</span><span class="l2">Navy</span></h1>
          <p class="tag">Steer. Pick up. Sink 'em all!</p>
          <label class="lbl">Captain name</label>
          <input class="name-input" maxlength="14" value="${esc(this.cfg.name)}" spellcheck="false" />
          <label class="lbl">Sailor</label>
          <div class="picker">
            <button class="arrow prev" aria-label="Previous sailor">${icon('left')}</button>
            <div class="pick-name"></div>
            <button class="arrow next" aria-label="Next sailor">${icon('right')}</button>
          </div>
          <label class="lbl">Boat colour</label>
          <div class="swatches">${colors}</div>
        </div>
        <div class="col">
          <label class="lbl">Waters</label>
          <div class="maps">${maps}</div>
          <button class="btn btn-alt arsenal-btn"><span class="ab-ics">${['torpedoes', 'deckGun', 'maelstrom'].map((w) => `<i>${icon(w)}</i>`).join('')}</span>
            <span class="ab-label">Arsenal</span><b class="ab-count"></b></button>
          <button class="btn btn-play btn-online">PLAY ONLINE</button>
          <div class="room-btns">
            <button class="btn btn-alt btn-create">Create Room</button>
            <button class="btn btn-alt btn-join">Join Room</button>
          </div>
          <button class="link solo-link">or practice offline vs bots</button>
          <div class="stats">${this.statsHtml()}</div>
          <div class="help">WASD / Arrows to steer · Space or Click to fire · Esc to pause</div>
        </div>
      </div>
      <div class="menu-corner">${this.muteButton()}</div>`;

    const input = this.menu.querySelector<HTMLInputElement>('.name-input')!;
    input.addEventListener('input', () => (this.cfg.name = input.value.trim().slice(0, 14)));
    input.addEventListener('keydown', (e) => e.stopPropagation());
    this.menu.querySelectorAll<HTMLButtonElement>('.swatch').forEach((b) =>
      b.addEventListener('click', () => {
        this.cfg.color = Number(b.dataset.color);
        this.menu.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('sel', s === b));
        this.onPreview({ ...this.cfg });
      }),
    );
    this.menu.querySelectorAll<HTMLButtonElement>('.map-card').forEach((b) =>
      b.addEventListener('click', () => {
        this.cfg.map = b.dataset.map as MapId;
        this.menu.querySelectorAll('.map-card').forEach((s) => s.classList.toggle('sel', s === b));
        this.onMapSelect(this.cfg.map);
      }),
    );
    const step = (d: number) => {
      const i = SPECIES.findIndex((s) => s.id === this.cfg.character);
      this.cfg.character = SPECIES[(i + d + SPECIES.length) % SPECIES.length].id;
      this.renderPicker();
      this.onPreview({ ...this.cfg });
    };
    this.menu.querySelector('.prev')!.addEventListener('click', () => step(-1));
    this.menu.querySelector('.next')!.addEventListener('click', () => step(1));
    const go = (fn: (cfg: PlayConfig) => void) => () => fn(this.playConfig());
    this.menu.querySelector('.btn-online')!.addEventListener('click', go((c) => this.onQuickPlay(c)));
    this.menu.querySelector('.btn-create')!.addEventListener('click', go((c) => this.onCreateRoom(c)));
    this.menu.querySelector('.btn-join')!.addEventListener('click', () => this.showJoin());
    this.menu.querySelector('.solo-link')!.addEventListener('click', go((c) => this.onPlay(c)));
    this.menu.querySelector('.arsenal-btn')!.addEventListener('click', () =>
      this.openArsenal(this.cfg.arsenal, (ids) => {
        this.cfg.arsenal = ids;
        this.renderArsenalCount();
      }),
    );
    this.bindMute(this.menu);
    this.renderPicker();
    this.renderArsenalCount();
  }

  /** Snapshot of the menu choices for starting a match or joining a room. */
  playConfig(): PlayConfig {
    if (!this.cfg.name) this.cfg.name = 'Captain';
    return { ...this.cfg, arsenal: [...this.cfg.arsenal] };
  }

  private renderArsenalCount(): void {
    const el = this.menu.querySelector('.ab-count');
    if (el) el.textContent = `${this.cfg.arsenal.length}/${WEAPON_ORDER.length}`;
  }

  // ---------------------------------------------------------------- arsenal

  /** Weapon picker: toggle which weapons crates can roll. Edits a draft; Done applies it. */
  private openArsenal(initial: WeaponId[], apply: (ids: WeaponId[]) => void): void {
    const draft = new Set<WeaponId>(initial);
    const items = WEAPON_ORDER.map((id) => {
      const w = WEAPONS[id];
      return `<button class="ars-item" data-w="${id}" aria-pressed="true">
        <span class="ars-badge">${icon(w.icon)}<span class="ars-check"></span></span>
        <span class="ars-name">${w.name}</span></button>`;
    }).join('');
    this.arsenalEl.innerHTML = `<div class="card arsenal-card">
      <h2 class="title">Arsenal</h2>
      <p class="tag ars-sub">Choose which weapons can drop from crates</p>
      <div class="ars-grid">${items}</div>
      <div class="ars-desc"></div>
      <div class="ars-btns">
        <button class="btn btn-alt all-on">All ON</button>
        <button class="btn btn-alt all-off">All OFF</button>
        <button class="btn btn-alt shuffle">Randomize</button>
        <button class="btn btn-play done">Done</button>
      </div></div>`;
    const desc = this.arsenalEl.querySelector<HTMLDivElement>('.ars-desc')!;
    const buttons = [...this.arsenalEl.querySelectorAll<HTMLButtonElement>('.ars-item')];
    const describe = (id: WeaponId | null) => {
      desc.classList.remove('warn');
      desc.innerHTML = id
        ? `<b>${WEAPONS[id].name}</b> — ${esc(WEAPONS[id].desc)}`
        : `<b>${draft.size}</b> of ${WEAPON_ORDER.length} weapons on`;
    };
    const sync = () => {
      for (const b of buttons) {
        const on = draft.has(b.dataset.w as WeaponId);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      }
    };
    for (const b of buttons) {
      const id = b.dataset.w as WeaponId;
      b.addEventListener('click', () => {
        if (draft.has(id)) draft.delete(id);
        else draft.add(id);
        sync();
        describe(id);
      });
      b.addEventListener('pointerenter', () => describe(id));
    }
    const setAll = (ids: WeaponId[]) => {
      draft.clear();
      ids.forEach((id) => draft.add(id));
      sync();
      describe(null);
    };
    this.arsenalEl.querySelector('.all-on')!.addEventListener('click', () => setAll(WEAPON_ORDER));
    this.arsenalEl.querySelector('.all-off')!.addEventListener('click', () => setAll([]));
    this.arsenalEl.querySelector('.shuffle')!.addEventListener('click', () => {
      // A random loadout of 4–8 weapons.
      const n = 4 + Math.floor(Math.random() * 5);
      setAll([...WEAPON_ORDER].sort(() => Math.random() - 0.5).slice(0, n));
    });
    this.arsenalEl.querySelector('.done')!.addEventListener('click', () => {
      if (!draft.size) {
        desc.innerHTML = 'Turn on at least one weapon!';
        desc.classList.remove('warn');
        void desc.offsetWidth;
        desc.classList.add('warn');
        return;
      }
      apply(WEAPON_ORDER.filter((id) => draft.has(id)));
      this.arsenalEl.classList.add('hidden');
    });
    sync();
    describe(null);
    this.arsenalEl.classList.remove('hidden');
  }

  private renderPicker(): void {
    const i = SPECIES.findIndex((s) => s.id === this.cfg.character);
    const dots = SPECIES.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
    const sp = SPECIES[i];
    this.menu.querySelector('.pick-name')!.innerHTML = `<span>${sp.name} <small>the ${sp.kind}</small></span><span class="dots">${dots}</span>`;
  }

  // ---------------------------------------------------------------- HUD

  private buildHud(): void {
    this.hud.innerHTML = `
      <div class="hud-tl">
        <div class="rank-pill panel"></div>
        <div class="board panel"></div>
      </div>
      <div class="hud-tc">
        <div class="hp"><span class="hp-ic">${icon('heart')}</span><div class="hp-track panel"></div></div>
        <div class="timer panel"><span class="t-ic">${icon('clock')}</span><span class="t-val">3:00</span></div>
      </div>
      <div class="hud-tr">${this.muteButton()}<button class="icon-btn pause-btn" aria-label="Pause">${icon('pause')}</button></div>
      <div class="feed"></div>
      <div class="weapon-slot empty"></div>`;
    this.rankEl = this.hud.querySelector('.rank-pill')!;
    this.boardEl = this.hud.querySelector('.board')!;
    this.timerEl = this.hud.querySelector('.t-val')!;
    this.timerBox = this.hud.querySelector('.timer')!;
    this.hpEl = this.hud.querySelector('.hp-track')!;
    this.feedEl = this.hud.querySelector('.feed')!;
    this.weaponEl = this.hud.querySelector('.weapon-slot')!;
    this.hud.querySelector('.pause-btn')!.addEventListener('click', () => this.onPauseClick());
    this.bindMute(this.hud);
  }

  showMenu(): void {
    this.menu.classList.remove('hidden');
    this.lobby.classList.add('hidden');
    this.modal.classList.add('hidden');
    this.arsenalEl.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.end.classList.add('hidden');
    this.center.innerHTML = '';
    this.toast.innerHTML = '';
  }

  showHud(): void {
    this.menu.classList.add('hidden');
    this.lobby.classList.add('hidden');
    this.modal.classList.add('hidden');
    this.arsenalEl.classList.add('hidden');
    this.end.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.hud.classList.remove('hidden');
    this.feedEl.innerHTML = '';
    this.lastBoard = this.lastWeapon = this.lastRank = '';
    this.lastHp = -1;
  }

  /** Pause menu. Online the match keeps going underneath, so it's just a menu. */
  showPause(show: boolean, quality: QualitySetting, online = false): void {
    this.quality = quality;
    if (!show) {
      this.pause.classList.add('hidden');
      return;
    }
    this.pause.innerHTML = `<div class="card small">
      <h2 class="title">${online ? 'Menu' : 'Paused'}</h2>
      ${online ? '<p class="tag">The match is still going!</p>' : ''}
      <button class="btn btn-play resume">${online ? 'Back to battle' : 'Resume'}</button>
      <button class="btn btn-alt quality">Graphics: <b>${QUALITY_LABEL[this.quality]}</b></button>
      <button class="btn btn-alt quit">${online ? 'Leave room' : 'Quit to menu'}</button></div>`;
    this.pause.querySelector('.resume')!.addEventListener('click', () => this.onResume());
    this.pause.querySelector('.quit')!.addEventListener('click', () => this.onQuit());
    const qb = this.pause.querySelector<HTMLButtonElement>('.quality')!;
    qb.addEventListener('click', () => {
      const order: QualitySetting[] = ['auto', 'high', 'low'];
      this.quality = order[(order.indexOf(this.quality) + 1) % order.length];
      qb.innerHTML = `Graphics: <b>${QUALITY_LABEL[this.quality]}</b>`;
      this.onQualityChange(this.quality);
    });
    this.pause.classList.remove('hidden');
  }

  /** Results. Online there's no "play again": the room moves on by itself (see setEndNote). */
  showEnd(rows: ScoreRow[], playerRank: number, online = false): void {
    this.hud.classList.add('hidden');
    this.center.innerHTML = '';
    this.toast.innerHTML = '';
    const title = playerRank === 1 ? 'Admiral of the Waves!' : playerRank <= 3 ? 'On the podium!' : 'Sunk but not forgotten';
    const list = rows
      .map(
        (r, i) => `<div class="res-row ${r.isPlayer ? 'me' : ''}" style="--d:${i * 0.05}s">
          <span class="rk">${i < 3 ? medal(i + 1) : `<b>${i + 1}</b>`}</span>
          <span class="dot" style="background:${hex(r.color)}"></span><span class="nm">${esc(r.name)}</span>
          <span class="k">${icon('sink')}${r.kills}</span></div>`,
      )
      .join('');
    this.end.innerHTML = `<div class="card end-card">
      <div class="end-medal">${medal(playerRank)}</div>
      <h2 class="title">${title}</h2>
      <p class="tag">You placed <b>${ordinal(playerRank)}</b> of ${rows.length}</p>
      <div class="results">${list}</div>
      ${
        online
          ? '<p class="end-note"></p><div class="end-btns one"><button class="btn btn-alt menu-btn">Leave room</button></div>'
          : '<div class="end-btns"><button class="btn btn-play again">Play again</button><button class="btn btn-alt menu-btn">Change waters</button></div>'
      }</div>`;
    this.end.querySelector('.again')?.addEventListener('click', () => this.onAgain());
    this.end.querySelector('.menu-btn')!.addEventListener('click', () => this.onQuit());
    this.end.classList.remove('hidden');
  }

  setEndNote(text: string): void {
    const el = this.end.querySelector('.end-note');
    if (el && el.textContent !== text) el.textContent = text;
  }

  // ---------------------------------------------------------------- online: join / connecting / errors

  private openModal(html: string): HTMLDivElement {
    this.modal.innerHTML = html;
    this.modal.classList.remove('hidden');
    return this.modal;
  }

  closeModal(): void {
    this.modal.classList.add('hidden');
    this.modal.innerHTML = '';
  }

  private showJoin(): void {
    const m = this.openModal(`<div class="card small join-card">
      <button class="x-btn" aria-label="Close">${icon('close')}</button>
      <h2 class="title">Join Room</h2>
      <p class="tag">Enter the ${CODE_LENGTH}-letter code from your friend</p>
      <input class="code-input" maxlength="${CODE_LENGTH + 2}" placeholder="${'•'.repeat(CODE_LENGTH)}" autocomplete="off" autocapitalize="characters" spellcheck="false" />
      <div class="acc-msg"></div>
      <button class="btn btn-play join-go">Join</button></div>`);
    const input = m.querySelector<HTMLInputElement>('.code-input')!;
    const msg = m.querySelector<HTMLDivElement>('.acc-msg')!;
    const submit = () => {
      const code = normalizeCode(input.value);
      if (code.length !== CODE_LENGTH) {
        msg.className = 'acc-msg error';
        msg.textContent = `Room codes have ${CODE_LENGTH} letters.`;
        return;
      }
      this.onJoinRoom(code, this.playConfig());
    };
    input.addEventListener('input', () => (input.value = normalizeCode(input.value)));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') this.closeModal();
    });
    m.querySelector('.join-go')!.addEventListener('click', submit);
    m.querySelector('.x-btn')!.addEventListener('click', () => this.closeModal());
    setTimeout(() => input.focus(), 50);
  }

  showConnecting(text: string): void {
    const m = this.openModal(`<div class="card small">
      <div class="spinner"></div>
      <h2 class="title connecting">${esc(text)}</h2>
      <button class="btn btn-alt cancel">Cancel</button></div>`);
    m.querySelector('.cancel')!.addEventListener('click', () => {
      this.closeModal();
      this.onCancelConnect();
    });
  }

  showError(text: string): void {
    const m = this.openModal(`<div class="card small">
      <h2 class="title">Ahoy!</h2>
      <p class="tag err-text">${esc(text)}</p>
      <button class="btn btn-play ok">OK</button>
      <button class="link solo">Practice offline vs bots instead</button></div>`);
    m.querySelector('.ok')!.addEventListener('click', () => this.closeModal());
    m.querySelector('.solo')!.addEventListener('click', () => {
      this.closeModal();
      this.onPlay(this.playConfig());
    });
  }

  // ---------------------------------------------------------------- online: room lobby

  showLobby(view: LobbyView): void {
    this.menu.classList.add('hidden');
    this.hud.classList.add('hidden');
    this.pause.classList.add('hidden');
    this.end.classList.add('hidden');
    this.modal.classList.add('hidden');
    this.center.innerHTML = '';
    this.lobby.innerHTML = `<div class="card lobby-card">
      <h2 class="title">${view.isPrivate ? 'Private Room' : 'Quick Play'}</h2>
      ${
        view.isPrivate
          ? `<div class="code-row">
              <div class="code-box"><span class="code-lbl">Room code</span><b class="code">${esc(view.code)}</b></div>
              <button class="btn btn-alt copy-code">Copy code</button>
              <button class="btn btn-alt copy-link">Invite link</button>
            </div>`
          : ''
      }
      <label class="lbl">Captains <span class="lp-count"></span></label>
      <div class="lobby-players"></div>
      <div class="lobby-settings"></div>
      <div class="lobby-status"></div>
      <div class="lobby-btns">
        <button class="btn btn-alt leave">Leave</button>
        <button class="btn btn-play start hidden">START</button>
      </div></div>`;
    const copy = (btn: HTMLButtonElement, text: string) => {
      const label = btn.textContent;
      void copyText(text).then((ok) => {
        btn.textContent = ok ? 'Copied!' : 'Copy failed';
        setTimeout(() => (btn.textContent = label), 1500);
      });
    };
    this.lobby.querySelector<HTMLButtonElement>('.copy-code')?.addEventListener('click', (e) =>
      copy(e.currentTarget as HTMLButtonElement, this.lobbyView?.code ?? ''),
    );
    this.lobby.querySelector<HTMLButtonElement>('.copy-link')?.addEventListener('click', (e) =>
      copy(e.currentTarget as HTMLButtonElement, this.inviteLink(this.lobbyView?.code ?? '')),
    );
    this.lobby.querySelector('.leave')!.addEventListener('click', () => this.onLeaveRoom());
    this.lobby.querySelector('.start')!.addEventListener('click', () => this.onLobbyStart());
    this.lobbyKeys = { players: '', settings: '', status: '' };
    this.lobbyView = null;
    this.updateLobby(view);
    this.lobby.classList.remove('hidden');
  }

  get lobbyOpen(): boolean {
    return !this.lobby.classList.contains('hidden');
  }

  /** Refreshes only the parts of the lobby that changed (so buttons don't flicker under the cursor). */
  updateLobby(view: LobbyView): void {
    this.lobbyView = view;
    const L = this.lobby;
    const pKey = JSON.stringify(view.players);
    if (pKey !== this.lobbyKeys.players) {
      this.lobbyKeys.players = pKey;
      L.querySelector('.lp-count')!.textContent = `${view.players.filter((p) => !p.isBot).length} / ${ROOM_SIZE}`;
      L.querySelector('.lobby-players')!.innerHTML = view.players
        .map(
          (p) => `<div class="lp-row ${p.isMe ? 'me' : ''} ${p.isBot ? 'bot' : ''}">
            <span class="dot" style="background:${hex(p.color)}"></span><span class="nm">${esc(p.name)}</span>
            ${p.isHost ? `<span class="lp-tag host"><i>${icon('crown')}</i>Host</span>` : ''}
            ${p.isMe ? '<span class="lp-tag you">You</span>' : ''}${p.isBot ? '<span class="lp-tag">Bot</span>' : ''}</div>`,
        )
        .join('');
    }
    const sKey = `${view.isPrivate}|${view.isHost}|${view.map}|${view.arsenal.join()}|${view.bots}`;
    if (sKey !== this.lobbyKeys.settings) {
      this.lobbyKeys.settings = sKey;
      this.renderLobbySettings(view);
    }
    const stKey = `${view.status}|${view.canStart}`;
    if (stKey !== this.lobbyKeys.status) {
      this.lobbyKeys.status = stKey;
      L.querySelector('.lobby-status')!.textContent = view.status;
      L.querySelector('.start')!.classList.toggle('hidden', !view.canStart);
    }
  }

  private renderLobbySettings(view: LobbyView): void {
    const el = this.lobby.querySelector<HTMLDivElement>('.lobby-settings')!;
    const m = MAPS[view.map];
    if (!view.isPrivate || !view.isHost) {
      el.innerHTML = `<div class="lobby-summary"><span class="ls-ic">${icon(view.map)}</span><b>${m.name}</b>
        <span>· ${view.arsenal.length}/${WEAPON_ORDER.length} weapons</span>${view.isPrivate ? `<span>· Bots ${view.bots ? 'on' : 'off'}</span>` : ''}</div>`;
      return;
    }
    const maps = Object.values(MAPS)
      .map(
        (mm) => `<button class="map-card ${mm.id === view.map ? 'sel' : ''}" data-map="${mm.id}" style="--water:${hex(mm.waterShallow)};--deep:${hex(mm.waterDeep)}">
          <span class="map-ic">${icon(mm.id)}</span><span class="map-name">${mm.name}</span></button>`,
      )
      .join('');
    el.innerHTML = `<label class="lbl">Waters</label><div class="maps">${maps}</div>
      <div class="lobby-opts">
        <button class="btn btn-alt arsenal-btn"><span class="ab-label">Arsenal</span><b class="ab-count">${view.arsenal.length}/${WEAPON_ORDER.length}</b></button>
        <button class="btn btn-alt bots-btn">Bots <b>${view.bots ? 'ON' : 'OFF'}</b></button>
      </div>`;
    el.querySelectorAll<HTMLButtonElement>('.map-card').forEach((b) =>
      b.addEventListener('click', () => this.onLobbySettings({ map: b.dataset.map })),
    );
    el.querySelector('.arsenal-btn')!.addEventListener('click', () =>
      this.openArsenal(view.arsenal, (ids) => this.onLobbySettings({ arsenal: ids })),
    );
    el.querySelector('.bots-btn')!.addEventListener('click', () => this.onLobbySettings({ bots: !view.bots }));
  }

  /** "Get ready" before an online countdown (there's an extra beat while everyone loads the map). */
  getReady(sub: string): void {
    this.message(`<div class="big ready">Get ready!</div><div class="sub">${esc(sub)}</div>`, 1.1);
  }

  /** Small info line in the kill feed (players joining/leaving). */
  info(text: string): void {
    const row = document.createElement('div');
    row.className = 'feed-row info';
    row.textContent = text;
    this.feedEl.prepend(row);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild?.remove();
    setTimeout(() => row.classList.add('fade'), 3500);
    setTimeout(() => row.remove(), 4100);
  }

  updateHud(s: HudState, playerRespawn: number | null): void {
    const t = Math.max(0, Math.ceil(s.timeLeft));
    this.timerEl.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.timerBox.classList.toggle('low', t <= 15);

    if (s.hp !== this.lastHp) {
      // Only shake for real hits, not every bullet graze.
      if (this.lastHp - s.hp >= 0.5) {
        this.hpEl.classList.remove('hurt');
        void this.hpEl.offsetWidth;
        this.hpEl.classList.add('hurt');
      }
      this.lastHp = s.hp;
      let segs = '';
      for (let i = 0; i < MAX_HP; i++) {
        const f = Math.min(1, Math.max(0, s.hp - i));
        segs += `<i><b style="width:${(f * 100).toFixed(1)}%"></b></i>`;
      }
      this.hpEl.innerHTML = segs;
    }

    const wkey = `${s.weapon}:${s.ammo}`;
    if (wkey !== this.lastWeapon) {
      this.lastWeapon = wkey;
      if (s.weapon) {
        const w = WEAPONS[s.weapon];
        this.weaponEl.className = 'weapon-slot pop';
        this.weaponEl.innerHTML = `<div class="w-badge">${icon(w.icon)}${s.ammo > 1 ? `<span class="w-ammo">×${s.ammo}</span>` : ''}</div>
          <div class="w-name">${w.name}</div>`;
      } else {
        this.weaponEl.className = 'weapon-slot empty';
        this.weaponEl.innerHTML = `<div class="w-badge">${icon('question')}</div><div class="w-name">Grab a crate!</div>`;
      }
    }

    const rows = s.rows;
    const meIdx = rows.findIndex((r) => r.isPlayer);
    const rankKey = `${meIdx}/${rows.length}`;
    if (rankKey !== this.lastRank) {
      this.lastRank = rankKey;
      this.rankEl.innerHTML = `<span class="r-ic">${medal(meIdx + 1)}</span><span class="r-val">${ordinal(meIdx + 1)}</span><span class="r-of">/ ${rows.length}</span>`;
    }
    const row = (r: ScoreRow, i: number) =>
      `<div class="row ${r.isPlayer ? 'me' : ''}"><span class="pos">${i + 1}</span><i style="background:${hex(r.color)}"></i><span class="nm">${esc(r.name)}</span><b>${r.kills}</b></div>`;
    let board = rows.slice(0, 4).map(row).join('');
    if (meIdx >= 4) board += `<div class="gap">• • •</div>${row(rows[meIdx], meIdx)}`;
    if (board !== this.lastBoard) {
      this.boardEl.innerHTML = board;
      this.lastBoard = board;
    }

    if (playerRespawn !== null) {
      this.center.innerHTML = `<div class="big sunk">SUNK!</div><div class="sub">Back in ${Math.ceil(playerRespawn)}…</div>`;
      this.centerTimer = 0.15;
    }
  }

  tick(dt: number): void {
    if (this.centerTimer > 0) {
      this.centerTimer -= dt;
      if (this.centerTimer <= 0) this.center.innerHTML = '';
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.innerHTML = '';
    }
  }

  private message(html: string, seconds: number): void {
    this.center.innerHTML = html;
    this.centerTimer = seconds;
  }

  /** 3, 2, 1 … then 0 = GO! */
  countdown(n: number): void {
    this.message(n > 0 ? `<div class="big count">${n}</div>` : `<div class="big count go">GO!</div>`, n > 0 ? 1 : 0.8);
  }

  killBanner(victim: string): void {
    this.message(`<div class="big kill">+1 SINK</div><div class="sub">${esc(victim)}</div>`, 1.4);
  }

  weaponToast(id: WeaponId): void {
    const w = WEAPONS[id];
    this.toast.innerHTML = `<div class="toast-in"><span class="ic">${icon(w.icon)}</span>${w.name}</div>`;
    this.toastTimer = 1.3;
  }

  feed(killer: { name: string; color: number } | null, victim: { name: string; color: number }, iconKey: string): void {
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = killer
      ? `<span class="who" style="--c:${hex(killer.color)}">${esc(killer.name)}</span><span class="ic">${icon(iconKey)}</span><span class="who" style="--c:${hex(victim.color)}">${esc(victim.name)}</span>`
      : `<span class="who" style="--c:${hex(victim.color)}">${esc(victim.name)}</span><span class="ic">${icon('sink')}</span>`;
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
