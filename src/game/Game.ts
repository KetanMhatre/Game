import * as THREE from 'three';
import { Arena, type Collider } from './Arena';
import { Boat, INTERP_DELAY_MS } from './Boat';
import { BoatModel, RIDE_HEIGHT } from './BoatModel';
import { BotBrain } from './Bot';
import { SPECIES, speciesById, type SpeciesId } from './Character';
import { Combat, type CombatHost } from './Combat';
import { Input } from './Input';
import { Particles } from './Particles';
import { Sky } from './Sky';
import { Wake } from './Wake';
import { Water } from './Water';
import { Sfx } from './Audio';
import {
  BOAT, BOT_COUNT, BOT_NAMES, MAPS, MATCH_SECONDS, PLAYER_COLORS, RESPAWN_SECONDS,
  SPAWN_PROTECTION_SECONDS, WEAPONS, type MapId, type WeaponId,
} from './config';
import { angleDiff, damp } from './util';
import { waveHeight } from './waves';
import type { LobbyView, PlayConfig, ScoreRow, UI } from '../ui/UI';
import { CrazyGames } from '../sdk/crazygames';
import { Account, cleanStats, type Stats } from '../services/Account';
import type { NetSession, PlayerView } from '../net/NetSession';
import { POSE_HZ, type FeedMsg, type FireMsg, type GaveMsg, type HitMsg, type Phase, type PoseMsg } from '../../shared/protocol';

/** 'lobby' = in an online room between matches (menu-style backdrop with the room screen on top). */
type State = 'menu' | 'lobby' | 'countdown' | 'playing' | 'paused' | 'ended';
export type QualitySetting = 'auto' | 'high' | 'low';

/** Dev-only `?time=20` shortens matches for testing. */
const DEV_MATCH_SECONDS = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('time')) || 0 : 0;

/** Render quality steps; "auto" starts by device class and steps down if the frame rate drops. */
const LEVELS = [
  { pr: 2, shadow: 2048 },
  { pr: 1.5, shadow: 2048 },
  { pr: 1.25, shadow: 1024 },
  { pr: 1, shadow: 1024 },
  { pr: 1, shadow: 0 },
  { pr: 0.8, shadow: 0 },
];
const LOW_LEVEL = 4;
const SHADOW_HALF = 34;
const SUN_DIR = new THREE.Vector3(0.42, 0.82, 0.38).normalize();
const IS_MOBILE = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
/** Phones start a step down (lower pixel ratio, smaller shadow map); auto mode adapts from there. */
const startLevel = (q: QualitySetting) => (q === 'high' ? 0 : q === 'low' ? LOW_LEVEL : IS_MOBILE ? 2 : 0);

export class Game implements CombatHost {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly particles = new Particles();
  readonly input: Input;
  boats: Boat[] = [];
  arena!: Arena;
  time = 0;

  private world = new THREE.Group();
  private water!: Water;
  private sky!: Sky;
  private combat!: Combat;
  private bots: BotBrain[] = [];
  private wakes = new Map<number, Wake>();
  private player: Boat | null = null;
  private mapId: MapId | null = null;
  private state: State = 'menu';
  private timeLeft = MATCH_SECONDS;
  private countdown = 0;
  private lastCount = -1;
  private camShake = 0;
  private camHeading = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private hudT = 0;
  private adPaused = false;
  private lastCfg: PlayConfig | null = null;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private showcase: BoatModel | null = null;
  private showcaseSpot = { x: 0, z: 0, heading: 0, camX: 0, camZ: 0 };
  private showcaseCollider: Collider | null = null;
  private quality: QualitySetting;
  private level = 0;
  private shadowSize = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  /** Boats by id (network ids online; local ids in solo so shots can name their targets). */
  private byId = new Map<string, Boat>();
  // Online play
  private net: NetSession | null = null;
  /** The boats in the arena belong to an online match (not the menu/lobby backdrop). */
  private onlineRound = false;
  private netRound = -1;
  private netPhase: Phase | null = null;
  private connectSeq = 0;
  private poseT = 0;
  /** Online "pause": the menu is open but the match carries on. */
  private menuOpen = false;

  constructor(canvas: HTMLCanvasElement, private ui: UI, quality: QualitySetting) {
    // MSAA is cheap on mobile tile-based GPUs and hides jaggies at the reduced pixel ratios used there.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.4, 900);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 2.1);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -SHADOW_HALF;
    sc.right = sc.top = SHADOW_HALF;
    sc.near = 1;
    sc.far = 180;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.world, this.particles.group);

    this.input = new Input(canvas, document.getElementById('ui')!);
    this.input.onPause = () => this.togglePause();

    ui.onPlay = (cfg) => this.startMatch(cfg);
    ui.onMapSelect = (id) => this.previewMap(id);
    ui.onPreview = (cfg) => this.buildShowcase(cfg.color, cfg.character);
    ui.onPauseClick = () => this.togglePause();
    ui.onResume = () => this.togglePause(false);
    ui.onMuteToggle = () => {
      Sfx.setUserMuted(!Sfx.muted);
      return Sfx.muted;
    };
    ui.onQualityChange = (q) => this.setQuality(q);
    ui.onAgain = () => void this.afterMatch(() => this.lastCfg && this.startMatch(this.lastCfg));
    ui.onQuit = () => (this.net ? this.leaveOnline() : void this.afterMatch(() => this.toMenu()));
    ui.onQuickPlay = (cfg) => void this.goOnline('quick', cfg);
    ui.onCreateRoom = (cfg) => void this.goOnline('create', cfg);
    ui.onJoinRoom = (code, cfg) => void this.goOnline('join', cfg, code);
    ui.onCancelConnect = () => this.connectSeq++;
    ui.onLobbySettings = (msg) => this.net?.send('settings', msg);
    ui.onLobbyStart = () => {
      Sfx.click();
      this.net?.send('start');
    };
    ui.onLeaveRoom = () => this.leaveOnline();
    ui.inviteLink = (code) => CrazyGames.inviteLink(code);

    CrazyGames.onMuteChange = (m) => Sfx.setForcedMute(m);
    CrazyGames.onPauseChange = (p) => (this.adPaused = p);

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.togglePause(true);
    });
    this.quality = quality;
    this.applyLevel(startLevel(quality));
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    this.toMenu();
    let last = performance.now();
    const frame = (now: number) => {
      // rAF timestamps can be slightly *older* than `last` on the first frame: never step backwards.
      const raw = Math.max(0, (now - last) / 1000);
      last = now;
      this.frame(Math.min(0.05, raw), raw);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  previewMap(id: MapId): void {
    if (this.state === 'menu' && id !== this.mapId) {
      this.loadMap(id);
      this.populate(null);
      this.buildShowcase(this.ui.config.color, this.ui.config.character);
    }
  }

  private toMenu(): void {
    CrazyGames.gameplayStop();
    this.state = 'menu';
    this.input.enabled = false;
    this.input.showTouch(false);
    this.loadMap(this.ui.config.map);
    this.populate(null);
    this.buildShowcase(this.ui.config.color, this.ui.config.character);
    this.ui.showMenu();
    this.resize();
  }

  private savePrefs(cfg: PlayConfig): void {
    const prefs = { ...cfg, quality: this.quality };
    CrazyGames.setItem('nn_prefs', JSON.stringify(prefs));
    Account.save({ name: cfg.name, prefs });
  }

  private startMatch(cfg: PlayConfig): void {
    if (this.net) return;
    Sfx.unlock();
    Sfx.click();
    this.lastCfg = cfg;
    this.savePrefs(cfg);
    this.clearShowcase();
    this.loadMap(cfg.map);
    this.populate(cfg);
    this.timeLeft = DEV_MATCH_SECONDS || MATCH_SECONDS;
    this.countdown = 3.5;
    this.lastCount = -1;
    this.state = 'countdown';
    this.input.enabled = false;
    this.input.showTouch(true);
    this.input.setFireIcon(null);
    this.ui.showHud();
    this.resize();
    this.snapCamera();
    CrazyGames.gameplayStart();
  }

  private endMatch(): void {
    this.state = 'ended';
    this.input.enabled = false;
    this.input.showTouch(false);
    CrazyGames.gameplayStop();
    const rows = this.scoreRows();
    const rank = rows.findIndex((r) => r.isPlayer) + 1;
    this.recordResult(rank, true);
    this.ui.showEnd(rows, rank);
  }

  private recordResult(rank: number, solo: boolean): void {
    const p = this.player;
    if (!p) return;
    const stats = loadStats();
    // Online, a win needs at least one sink (nobody "wins" a match where no one scored).
    if (rank === 1 && (solo || p.kills > 0)) {
      stats.wins++;
      CrazyGames.happytime();
      Sfx.win();
      p.model.character.cheer();
    }
    stats.bestKills = Math.max(stats.bestKills, p.kills);
    stats.matches++;
    stats.sinks += p.kills;
    CrazyGames.setItem('nn_stats', JSON.stringify(stats));
    Account.save({ stats });
    this.ui.setStats(stats);
  }

  /** Natural break between matches: show a midgame ad, then continue. */
  private async afterMatch(next: () => void): Promise<void> {
    Sfx.click();
    this.state = 'paused';
    await CrazyGames.midgameAd();
    next();
  }

  private togglePause(force?: boolean): void {
    if (this.net) {
      // Online the match can't stop for one player: just open/close the menu over it.
      if (!this.onlineRound || this.state === 'ended') return;
      const show = force ?? !this.menuOpen;
      if (show === this.menuOpen) return;
      this.menuOpen = show;
      this.input.enabled = !show && this.state === 'playing';
      this.ui.showPause(show, this.quality, true);
      return;
    }
    if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'countdown') return;
    if (this.state === 'countdown' && force !== true) return;
    const pause = force ?? this.state !== 'paused';
    if (pause && this.state !== 'paused') {
      this.state = 'paused';
      this.input.enabled = false;
      CrazyGames.gameplayStop();
      this.ui.showPause(true, this.quality);
    } else if (!pause && this.state === 'paused') {
      this.state = this.countdown > 0 ? 'countdown' : 'playing';
      this.input.enabled = this.state === 'playing';
      CrazyGames.gameplayStart();
      this.ui.showPause(false, this.quality);
    }
  }

  // ---------------------------------------------------------------- quality

  /** Applies a graphics setting. `persist` saves it (false when it comes from a cloud save being applied). */
  setQuality(q: QualitySetting, persist = true): void {
    this.quality = q;
    this.applyLevel(startLevel(q));
    if (!persist) return;
    try {
      const prefs = { ...JSON.parse(CrazyGames.getItem('nn_prefs') || '{}'), quality: q };
      CrazyGames.setItem('nn_prefs', JSON.stringify(prefs));
      Account.save({ prefs });
    } catch {
      /* ignore */
    }
  }

  private applyLevel(level: number): void {
    this.level = Math.max(0, Math.min(LEVELS.length - 1, level));
    const lv = LEVELS[this.level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lv.pr));
    const on = lv.shadow > 0;
    const wasOn = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    if (on && lv.shadow !== this.shadowSize) {
      this.shadowSize = lv.shadow;
      this.sun.shadow.mapSize.set(lv.shadow, lv.shadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (on !== wasOn) {
      // Materials compile with or without shadow code: force a rebuild.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
      });
    }
    this.resize();
  }

  /** Auto mode: if the frame rate stays low during play, step quality down (never back up mid-session). */
  private monitorFps(raw: number): void {
    if (this.quality !== 'auto' || (this.state !== 'playing' && this.state !== 'countdown')) {
      this.fpsFrames = this.fpsTime = 0;
      return;
    }
    this.fpsFrames++;
    this.fpsTime += raw;
    if (this.fpsTime < 2.5) return;
    const fps = this.fpsFrames / this.fpsTime;
    this.fpsFrames = this.fpsTime = 0;
    if (fps < 45 && this.level < LEVELS.length - 1) this.applyLevel(this.level + 1);
  }

  // ---------------------------------------------------------------- world

  private loadMap(id: MapId): void {
    if (this.mapId === id && this.arena) {
      this.combat.reset();
      for (const b of this.boats) this.world.remove(b.model.root);
      for (const w of this.wakes.values()) this.world.remove(w.mesh);
      this.wakes.clear();
      this.boats = [];
      this.bots = [];
      this.byId.clear();
      this.particles.clear();
      return;
    }
    this.clearShowcase();
    // Geometry buffers are freed (shared ones are re-uploaded on next use); per-map shaders/textures too.
    this.world.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.water?.dispose();
    this.sky?.dispose();
    this.world.clear();
    this.wakes.clear();
    this.boats = [];
    this.bots = [];
    this.byId.clear();
    this.particles.clear();

    const map = MAPS[id];
    this.mapId = id;
    this.arena = new Arena(map);
    this.water = new Water(map, this.arena);
    this.sky = new Sky(map, SUN_DIR);
    this.combat = new Combat(this);
    this.world.add(this.sky.group, this.arena.group, this.water.mesh, this.combat.group);
    this.scene.background = new THREE.Color(map.skyHorizon);
    this.scene.fog = new THREE.Fog(map.skyHorizon, 60, map.radius * 2 + 90);
    this.hemi.color.setHex(0xffffff).lerp(new THREE.Color(map.skyTop), 0.28);
    this.hemi.groundColor.setHex(map.sand).lerp(new THREE.Color(map.grass), 0.5).multiplyScalar(0.75);
    this.pickShowcaseSpot();
  }

  /** Fill the arena with boats. With no config it's attract mode (bots only, menu backdrop). */
  private populate(cfg: PlayConfig | null): void {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const colors = PLAYER_COLORS.filter((c) => c !== cfg?.color).sort(() => Math.random() - 0.5);
    const species = SPECIES.map((s) => s.id).filter((s) => s !== cfg?.character).sort(() => Math.random() - 0.5);
    // Crates only roll weapons enabled on the Arsenal screen (the menu backdrop uses all of them).
    this.combat.setArsenal(cfg?.arsenal ?? []);
    this.combat.online = false;
    this.combat.lag = 0;
    this.onlineRound = false;
    this.player = null;
    if (cfg) {
      this.player = new Boat(cfg.name || 'You', cfg.color, true, cfg.character);
      this.player.netId = 'me';
      this.register(this.player);
    }
    const n = cfg ? BOT_COUNT : BOT_COUNT + 1;
    for (let i = 0; i < n; i++) {
      const b = new Boat(names[i], colors[i % colors.length], false, species[i % species.length]);
      b.labelEnabled = cfg !== null;
      b.netId = `bot-${i + 1}`;
      this.register(b);
      this.bots.push(new BotBrain(b, 0.45 + Math.random() * 0.45));
    }
    const spots = [...this.arena.spawnPoints].sort(() => Math.random() - 0.5);
    this.boats.forEach((b, i) => {
      const s = spots[i % spots.length];
      b.spawn(s.x, s.z, s.heading);
      b.update(0, this.arena, this.time);
    });
  }

  private register(b: Boat): void {
    this.boats.push(b);
    this.byId.set(b.netId, b);
    this.world.add(b.model.root);
    const w = new Wake();
    this.wakes.set(b.id, w);
    this.world.add(w.mesh);
  }

  private removeBoat(b: Boat): void {
    this.boats = this.boats.filter((x) => x !== b);
    this.bots = this.bots.filter((x) => x.boat !== b);
    this.byId.delete(b.netId);
    this.world.remove(b.model.root);
    const w = this.wakes.get(b.id);
    if (w) this.world.remove(w.mesh);
    this.wakes.delete(b.id);
    if (this.player === b) this.player = null;
  }

  private respawn(b: Boat): void {
    // Pick the spawn point furthest from any living enemy.
    let best = this.arena.spawnPoints[0];
    let bestD = -1;
    for (const s of this.arena.spawnPoints) {
      let minD = Infinity;
      for (const o of this.boats) if (o !== b && o.alive) minD = Math.min(minD, Math.hypot(o.x - s.x, o.z - s.z));
      if (minD > bestD) {
        bestD = minD;
        best = s;
      }
    }
    b.spawn(best.x, best.z, best.heading);
    b.protectT = SPAWN_PROTECTION_SECONDS;
    this.wakes.get(b.id)?.reset();
    this.particles.splash(best.x, 0.2, best.z, 1.4);
    this.particles.sparkle(best.x, 1, best.z, 0xbff4ff);
  }

  // ---------------------------------------------------------------- menu showcase

  /** A calm open-water spot where the menu shows off your boat, with the shore behind it. */
  private pickShowcaseSpot(): void {
    const R = this.arena.map.radius;
    for (let i = 0; i < 24; i++) {
      const a = 0.7 + i * 0.9;
      for (const f of [0.62, 0.55, 0.48, 0.4]) {
        const r = this.arena.shoreRadius(a) * f;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const camX = x - Math.cos(a) * 6.5, camZ = z - Math.sin(a) * 6.5;
        if (this.arena.isFree(x, z, 3.5) && this.arena.isFree(camX, camZ, 1)) {
          // Face mostly toward the camera, three-quarter view.
          const heading = Math.atan2(camX - x, camZ - z) + 0.75;
          this.showcaseSpot = { x, z, heading, camX, camZ };
          return;
        }
      }
    }
    this.showcaseSpot = { x: R * 0.3, z: 0, heading: -Math.PI / 2, camX: R * 0.3 - 6.5, camZ: 0 };
  }

  private buildShowcase(color: number, species: SpeciesId): void {
    if (this.state !== 'menu' && this.state !== 'lobby') return;
    this.clearShowcase();
    this.showcase = new BoatModel(color, species);
    this.world.add(this.showcase.root);
    this.showcaseCollider = { x: this.showcaseSpot.x, z: this.showcaseSpot.z, r: 2.2 };
    this.arena.colliders.push(this.showcaseCollider);
  }

  private clearShowcase(): void {
    if (this.showcase) this.world.remove(this.showcase.root);
    this.showcase = null;
    if (this.showcaseCollider && this.arena) {
      const i = this.arena.colliders.indexOf(this.showcaseCollider);
      if (i >= 0) this.arena.colliders.splice(i, 1);
    }
    this.showcaseCollider = null;
  }

  private updateShowcase(dt: number): void {
    const m = this.showcase;
    if (!m) return;
    const s = this.showcaseSpot;
    const amp = this.arena.map.waveAmp;
    const y = waveHeight(s.x, s.z, this.time, amp) + RIDE_HEIGHT;
    m.root.position.set(s.x, y, s.z);
    m.root.rotation.y = s.heading + Math.sin(this.time * 0.4) * 0.25;
    m.tilt.rotation.set(Math.sin(this.time * 1.1) * 0.04, 0, Math.cos(this.time * 0.9) * 0.05);
    m.animate(dt, 2, 0.25, Math.sin(this.time * 0.5) * 0.4, this.time);
  }

  // ---------------------------------------------------------------- CombatHost

  damage(target: Boat, amount: number, from: Boat | null, icon: string): void {
    if (!target.alive) return;
    if (target.invulnerable) {
      this.particles.sparkle(target.x, target.y + 1, target.z, 0xbff4ff);
      return;
    }
    const killed = target.takeDamage(amount, from);
    this.particles.emit(target.x, target.y + 0.8, target.z, 8, 0xffffff, { glow: true, speed: 5, up: 4, life: 0.35, size: 0.4 });
    if (target === this.player) {
      this.ui.damageFlash();
      Sfx.hit();
      this.shake(0.5);
    }
    const net = this.onlineRound ? this.net : null;
    // Online, damage only ever lands on boats this machine owns: tell everyone else.
    net?.send('hit', { victim: target.netId, by: from?.netId ?? null, w: icon, hp: target.hp } satisfies HitMsg);
    if (!killed) return;

    let credit: Boat | null = from && from !== target ? from : target.lastHitBy;
    if (credit === target) credit = null;
    target.respawnT = RESPAWN_SECONDS;
    if (net) {
      // The server keeps score and sends the kill feed back to everyone (see onFeed).
      this.particles.explosion(target.x, target.y, target.z, true);
      this.particles.emit(target.x, target.y + 0.5, target.z, 16, 0xb5763c, { speed: 6, up: 9, life: 1.3, size: 0.32, gravity: 20 });
      net.send('sunk', { victim: target.netId, by: credit?.netId ?? null, w: icon });
      return;
    }
    if (credit && this.state === 'playing') credit.kills++;
    credit?.model.character.cheer();
    this.particles.explosion(target.x, target.y, target.z, true);
    this.particles.emit(target.x, target.y + 0.5, target.z, 16, 0xb5763c, { speed: 6, up: 9, life: 1.3, size: 0.32, gravity: 20 });
    if (this.state === 'playing' || this.state === 'ended') this.ui.feed(credit, target, icon);
    if (credit === this.player) {
      Sfx.kill();
      this.ui.killBanner(target.name);
    }
  }

  listenerDist(x: number, z: number): number {
    const p = this.player;
    if (!p) return Math.hypot(x - this.camLook.x, z - this.camLook.z) + 20;
    return Math.hypot(x - p.x, z - p.z);
  }

  shake(amount: number): void {
    this.camShake = Math.max(this.camShake, amount);
  }

  onPickup(boat: Boat, weapon: WeaponId): void {
    if (boat !== this.player) return;
    Sfx.pickup();
    this.ui.weaponToast(weapon);
  }

  boatById(id: string): Boat | undefined {
    return this.byId.get(id);
  }

  requestPickup(b: Boat, index: number): void {
    this.net?.send('pickup', { by: b.netId, crate: index });
  }

  onTrap(id: string): void {
    if (this.onlineRound) this.net?.send('fx', { id });
  }

  // ---------------------------------------------------------------- frame

  private frame(dt: number, raw: number): void {
    if (this.net) this.pollNet();
    const running = !this.adPaused && this.state !== 'paused';
    if (running) {
      this.time += dt;
      this.update(dt);
    }
    this.updateCamera(running ? dt : 0);
    this.updateSun();
    this.sky.update(this.camera, dt);
    this.renderer.render(this.scene, this.camera);
    if (running) this.monitorFps(raw);
  }

  private update(dt: number): void {
    const online = this.onlineRound && this.net !== null;
    if (online) {
      this.tickOnlineClock(dt);
    } else if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 0.5);
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.ui.countdown(Math.max(0, n));
        Sfx.countdown(n <= 0);
      }
      if (this.countdown <= 0.5) {
        this.state = 'playing';
        this.countdown = 0;
        this.input.enabled = true;
      }
    } else if (this.state === 'playing') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.endMatch();
    }

    // Online, nobody can fire or move outside the match itself (the server ignores it anyway).
    const frozen = this.state === 'countdown' || (online && this.state !== 'playing');
    const amp = this.arena.map.waveAmp;
    if (this.player) this.input.read(this.player.input);
    for (const bot of this.bots) {
      bot.update(dt, this.boats, this.arena, this.combat);
      if (frozen) {
        bot.boat.input.throttle = bot.boat.input.steer = 0;
        bot.boat.input.fire = false;
      }
    }

    const now = performance.now();
    for (const b of this.boats) {
      if (b.owned) {
        if (b.alive && b.input.fire && !frozen) {
          const shot = this.combat.useWeapon(b);
          if (shot && online) this.net!.send('fire', shot);
        }
        const impact = b.update(dt, this.arena, this.time);
        if (impact > 5) {
          this.particles.splash(b.x + b.forwardX * 1.2, b.y - 0.2, b.z + b.forwardZ * 1.2, Math.min(1.2, impact / 10));
          if (b === this.player) this.shake(0.15);
        }
        if (!b.alive && b.respawnT <= 0) this.respawn(b);
      } else {
        // Another player's boat (or a bot simulated by someone else): follow its network poses.
        if (!b.hasSnapshots) continue;
        if (b.updateRemote(dt, this.arena, this.time, now)) {
          this.wakes.get(b.id)?.reset();
          this.particles.splash(b.x, 0.2, b.z, 1.4);
          this.particles.sparkle(b.x, 1, b.z, 0xbff4ff);
        }
      }
      this.wakes.get(b.id)?.update(dt, b, this.time, amp);
      // Propeller churn behind the outboard motor while the throttle is open.
      const thr = b.throttleAmount;
      if (b.alive && Math.abs(thr) > 0.1 && Math.random() < 0.35) {
        this.particles.emit(b.x - b.forwardX * 1.55, b.y - 0.45, b.z - b.forwardZ * 1.55, 1, 0xf2fbff, {
          dirX: -b.forwardX * Math.sign(thr), dirZ: -b.forwardZ * Math.sign(thr),
          speed: 2.5, up: 1.4, life: 0.4, size: 0.28, gravity: 6, alpha: 0.85,
        });
      }
    }
    this.collideBoats();
    if (online) {
      const net = this.net!;
      this.combat.lag = Math.min(0.4, (INTERP_DELAY_MS + net.rtt) / 1000);
      const taken = net.state.taken;
      this.combat.syncCrates((i) => taken.has(String(i)));
    }
    this.combat.update(dt);
    if (online) this.sendPoses(dt);
    this.arena.update(this.time);
    this.water.update(this.time);
    this.updateShowcase(dt);
    this.particles.update(dt);

    if (this.player) {
      this.input.setFireIcon(this.player.weapon);
      this.hudT -= dt;
      if (this.hudT <= 0 && this.state !== 'ended') {
        this.hudT = 0.1;
        const p = this.player;
        this.ui.updateHud(
          { timeLeft: this.timeLeft, hp: p.hp, weapon: p.weapon, ammo: p.ammo, kills: p.kills, rows: this.scoreRows() },
          p.alive ? null : Math.max(0, p.respawnT),
        );
      }
    }
    this.ui.tick(dt);
  }

  private collideBoats(): void {
    const bs = this.boats;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        // Online, each machine only moves its own boats; other players' boats act as solid obstacles.
        if (!b.alive || (!a.owned && !b.owned)) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d, nz = dz / d;
        const push = (min - d) / (a.owned && b.owned ? 2 : 1);
        if (a.owned) {
          a.x -= nx * push;
          a.z -= nz * push;
        }
        if (b.owned) {
          b.x += nx * push;
          b.z += nz * push;
        }
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rel >= 0) continue;
        const imp = (-rel * (1 + BOAT.boatRestitution)) / 2; // equal masses
        if (a.owned) {
          a.vx -= nx * imp;
          a.vz -= nz * imp;
        }
        if (b.owned) {
          b.vx += nx * imp;
          b.vz += nz * imp;
        }
        if (-rel > 2) this.particles.splash((a.x + b.x) / 2, a.y - 0.1, (a.z + b.z) / 2, Math.min(1, -rel / 10));
      }
    }
  }

  private scoreRows(): ScoreRow[] {
    return this.boats
      .map((b) => ({ name: b.name, color: b.color, kills: b.kills, deaths: b.deaths, isPlayer: b.isPlayer }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || Number(b.isPlayer) - Number(a.isPlayer));
  }

  // ---------------------------------------------------------------- online

  private async goOnline(kind: 'quick' | 'create' | 'join', cfg: PlayConfig, code?: string): Promise<void> {
    if (this.net || this.state !== 'menu') return;
    Sfx.unlock();
    Sfx.click();
    this.lastCfg = cfg;
    this.savePrefs(cfg);
    const seq = ++this.connectSeq;
    this.ui.showConnecting(kind === 'join' ? `Joining room ${code}…` : kind === 'create' ? 'Creating your room…' : 'Finding a match…');
    const profile = { name: cfg.name || 'Captain', color: cfg.color, character: cfg.character };
    try {
      // The networking code loads on first use, so it doesn't weigh on the initial download.
      const { NetSession } = await import('../net/NetSession');
      const net =
        kind === 'quick'
          ? await NetSession.quickPlay(profile)
          : kind === 'create'
            ? await NetSession.create(profile, { map: cfg.map, arsenal: cfg.arsenal, bots: true })
            : await NetSession.join(code ?? '', profile);
      // Cancelled (or started something else) while connecting.
      if (seq !== this.connectSeq || this.state !== 'menu' || this.net) {
        net.leave();
        return;
      }
      this.enterOnline(net);
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[net]', e);
      const text = await import('../net/NetSession').then((m) => m.friendlyError(e), () => "Can't load online play right now. Check your connection.");
      if (seq === this.connectSeq) this.ui.showError(text);
    }
  }

  private enterOnline(net: NetSession): void {
    this.net = net;
    this.netRound = -1;
    this.netPhase = null;
    this.menuOpen = false;
    net.bind({
      pose: (list) => this.onPoses(list),
      fire: (m) => this.onRemoteFire(m),
      fx: (m) => this.onlineRound && this.combat.triggerTrap(m.id),
      hit: (m) => this.onRemoteHit(m),
      gave: (m) => this.onGave(m),
      feed: (m) => this.onFeed(m),
      notice: (m) => this.ui.info(m.text),
      lost: () => this.leaveOnline('Lost connection to the game server.'),
    });
  }

  /** Leaves the room. With `lost` set it's a disconnect: back to the menu with that message. */
  private leaveOnline(lost?: string): void {
    const net = this.net;
    if (!net) return;
    this.net = null;
    this.connectSeq++;
    net.leave();
    CrazyGames.hideInviteButton();
    this.menuOpen = false;
    if (lost) {
      this.toMenu();
      this.ui.showError(lost);
    } else {
      void this.afterMatch(() => this.toMenu());
    }
  }

  /** Follows the server's room state: phases, rounds, who's in the room. */
  private pollNet(): void {
    const net = this.net!;
    if (!net.ready) return;
    const s = net.state;
    if ((s.phase === 'countdown' || s.phase === 'playing') && s.round !== this.netRound) this.beginOnlineRound();
    if (s.phase !== this.netPhase) {
      this.netPhase = s.phase;
      this.onPhase(s.phase);
    }
    if (!this.net) return;
    if (this.onlineRound) this.syncRoster(false);
    if (this.state === 'lobby') this.refreshLobby();
  }

  private onPhase(phase: Phase): void {
    const s = this.net!.state;
    const inMatch = this.onlineRound && this.netRound === s.round;
    if (phase === 'playing' && inMatch && this.state === 'countdown') {
      this.state = 'playing';
      this.input.enabled = !this.menuOpen;
      this.ui.countdown(0);
      Sfx.countdown(true);
    } else if (phase === 'results') {
      if (inMatch) this.endOnlineMatch();
      else this.enterLobby();
    } else if (phase === 'lobby') {
      this.enterLobby();
    }
  }

  /** A match is starting (or already running when we joined): build the arena and everyone's boats. */
  private beginOnlineRound(): void {
    const s = this.net!.state;
    const joinedLate = s.phase === 'playing';
    this.netRound = s.round;
    this.menuOpen = false;
    this.clearShowcase();
    this.loadMap(s.map in MAPS ? (s.map as MapId) : 'pond');
    this.combat.setArsenal(s.arsenal.split(',') as WeaponId[]);
    this.combat.online = true;
    this.onlineRound = true;
    this.player = null;
    this.syncRoster(true);
    const me = this.player as Boat | null; // set by syncRoster
    if (joinedLate && me) me.protectT = SPAWN_PROTECTION_SECONDS;
    this.timeLeft = joinedLate ? s.timeLeft : MATCH_SECONDS;
    this.countdown = s.countdown;
    this.lastCount = -1;
    this.poseT = 0;
    this.state = joinedLate ? 'playing' : 'countdown';
    this.input.enabled = joinedLate;
    this.input.showTouch(true);
    this.input.setFireIcon(null);
    this.ui.showHud();
    CrazyGames.hideInviteButton();
    this.resize();
    this.snapCamera();
    CrazyGames.gameplayStart();
  }

  /** Adds/removes boats as players come and go, and hands bots to whoever simulates them. */
  private syncRoster(initial: boolean): void {
    const net = this.net!;
    const s = net.state;
    const me = net.myId;
    const hostBots = s.botHostId === me;
    for (const [id, b] of this.byId) {
      if (s.players.has(id)) continue;
      this.removeBoat(b);
      if (!b.netId.startsWith('bot-')) this.ui.info(`${b.name} left`);
    }
    s.players.forEach((p, id) => {
      let b = this.byId.get(id);
      if (!b) {
        b = this.addNetBoat(p, initial);
        if (!initial && !p.isBot && id !== me) this.ui.info(`${p.name} joined`);
      }
      b.kills = p.kills;
      b.deaths = p.deaths;
      if (p.isBot && hostBots && !b.owned) this.adoptBot(b, p);
      else if (p.isBot && !hostBots && b.owned) {
        b.owned = false;
        this.bots = this.bots.filter((x) => x.boat !== b);
      }
    });
  }

  private addNetBoat(p: PlayerView, initial: boolean): Boat {
    const net = this.net!;
    const mine = p.id === net.myId;
    const b = new Boat(p.name, p.color, mine, speciesById(p.character).id);
    b.netId = p.id;
    b.owned = mine || (p.isBot && net.state.botHostId === net.myId);
    this.register(b);
    if (mine) this.player = b;
    if (b.owned) {
      this.spawnOwned(b, p, initial);
      if (p.isBot) this.bots.push(new BotBrain(b, 0.45 + Math.random() * 0.45));
    } else {
      b.model.root.visible = false; // until its first pose arrives
    }
    return b;
  }

  /** Round start: the server's spawn slot. Joining later: the spot furthest from the action. */
  private spawnOwned(b: Boat, p: PlayerView, initial: boolean): void {
    if (initial) {
      const spots = this.arena.spawnPoints;
      const s = spots[p.spawn % spots.length];
      b.spawn(s.x, s.z, s.heading);
    } else {
      this.respawn(b);
    }
    b.update(0, this.arena, this.time);
  }

  /** This machine became the bot host (the previous one left): carry on from the bot's last pose. */
  private adoptBot(b: Boat, p: PlayerView): void {
    if (b.hasSnapshots) b.takeOver();
    else {
      b.owned = true;
      this.spawnOwned(b, p, false);
    }
    this.bots.push(new BotBrain(b, 0.45 + Math.random() * 0.45));
  }

  private tickOnlineClock(dt: number): void {
    const s = this.net!.state;
    if (this.state === 'countdown') {
      // Run the clock locally between server updates, snapping back if it drifts.
      this.countdown = Math.max(0, this.countdown - dt);
      if (Math.abs(this.countdown - s.countdown) > 0.3) this.countdown = s.countdown;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCount) {
        if (n > 3 && this.lastCount === -1) this.ui.getReady(MAPS[this.mapId!].name);
        else if (n > 0 && n <= 3) {
          this.ui.countdown(n);
          Sfx.countdown(false);
        }
        this.lastCount = n;
      }
    } else if (this.state === 'playing') {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (Math.abs(this.timeLeft - s.timeLeft) > 0.5) this.timeLeft = s.timeLeft;
    } else if (this.state === 'ended') {
      const n = Math.max(0, Math.ceil(s.resultsLeft));
      this.ui.setEndNote(s.isPrivate ? `Back to the room in ${n}…` : `Next match starts in ${n}…`);
    }
  }

  private endOnlineMatch(): void {
    this.syncRoster(false);
    this.state = 'ended';
    this.menuOpen = false;
    this.ui.showPause(false, this.quality);
    this.input.enabled = false;
    this.input.showTouch(false);
    CrazyGames.gameplayStop();
    const rows = this.scoreRows();
    const rank = rows.findIndex((r) => r.isPlayer) + 1;
    this.recordResult(rank, false);
    this.ui.showEnd(rows, rank, true);
  }

  /** Between matches in a private room (or waiting for the next public one). */
  private enterLobby(): void {
    const s = this.net!.state;
    this.state = 'lobby';
    this.menuOpen = false;
    this.input.enabled = false;
    this.input.showTouch(false);
    CrazyGames.gameplayStop();
    this.loadLobbyBackdrop(s.map in MAPS ? (s.map as MapId) : 'pond');
    this.ui.showLobby(this.lobbyView());
    if (s.isPrivate) CrazyGames.showInviteButton(s.code);
    this.resize();
  }

  /** The menu-style scene behind the lobby: the room's waters with your boat in front. */
  private loadLobbyBackdrop(map: MapId): void {
    const net = this.net!;
    const me = net.state.players.get(net.myId);
    this.loadMap(map);
    this.populate(null);
    this.buildShowcase(me?.color ?? this.ui.config.color, speciesById(me?.character ?? this.ui.config.character).id);
  }

  private refreshLobby(): void {
    const s = this.net!.state;
    if (s.map !== this.mapId && s.map in MAPS) this.loadLobbyBackdrop(s.map as MapId);
    this.ui.updateLobby(this.lobbyView());
  }

  private lobbyView(): LobbyView {
    const net = this.net!;
    const s = net.state;
    const me = net.myId;
    const players: LobbyView['players'] = [];
    s.players.forEach((p) =>
      players.push({ name: p.name, color: p.color, isBot: p.isBot, isHost: s.isPrivate && p.id === s.hostId, isMe: p.id === me }),
    );
    players.sort((a, b) => Number(a.isBot) - Number(b.isBot));
    const isHost = s.hostId === me;
    const humans = players.filter((p) => !p.isBot).length;
    let status: string;
    if (!s.isPrivate) status = s.phase === 'results' ? `Next match starts in ${Math.max(0, Math.ceil(s.resultsLeft))}…` : 'Starting…';
    else if (s.phase !== 'lobby') status = 'Their match is finishing, hang tight…';
    else if (!isHost) status = 'Waiting for the host to start the match…';
    else if (humans > 1) status = 'Everyone ready? Press START!';
    else status = s.bots ? 'Share the code with friends, or START now vs bots!' : 'Share the code with friends to play together.';
    return {
      code: s.code,
      isPrivate: s.isPrivate,
      isHost,
      map: (s.map in MAPS ? s.map : 'pond') as MapId,
      arsenal: s.arsenal.split(',').filter((id): id is WeaponId => id in WEAPONS),
      bots: s.bots,
      players,
      status,
      canStart: s.isPrivate && isHost && s.phase === 'lobby',
    };
  }

  private sendPoses(dt: number): void {
    this.poseT -= dt;
    if (this.poseT > 0) return;
    this.poseT = Math.max(0, this.poseT + 1 / POSE_HZ);
    const list: PoseMsg[] = [];
    for (const b of this.boats) if (b.owned) list.push(b.pose());
    if (list.length) this.net!.send('pose', list);
  }

  private onPoses(list: PoseMsg[]): void {
    if (!this.onlineRound) return;
    const now = performance.now();
    for (const p of list) {
      const b = this.byId.get(p?.id);
      if (b && !b.owned) b.pushSnapshot(p, now);
    }
  }

  private onRemoteFire(m: FireMsg): void {
    const b = this.onlineRound ? this.byId.get(m?.by) : undefined;
    if (!b || b.owned || !(m.w in WEAPONS) || !Array.isArray(m.p)) return;
    // The shot left its owner about one round trip ago: fast-forward it (capped so it never skips a hit).
    this.combat.applyFire(m, b, Math.min(0.15, this.net!.rtt / 1000));
  }

  private onRemoteHit(m: HitMsg): void {
    const v = this.onlineRound ? this.byId.get(m?.victim) : undefined;
    if (!v || v.owned) return;
    v.showHit(m.hp, v.hp - m.hp);
    this.particles.emit(v.x, v.y + 0.8, v.z, 8, 0xffffff, { glow: true, speed: 5, up: 4, life: 0.35, size: 0.4 });
  }

  private onGave(m: GaveMsg): void {
    if (this.onlineRound) this.combat.grant(m.crate, this.byId.get(m.by) ?? null, m.weapon as WeaponId);
  }

  private onFeed(m: FeedMsg): void {
    const victim = this.onlineRound ? this.byId.get(m?.victim) : undefined;
    if (!victim) return;
    const killer = (m.killer && this.byId.get(m.killer)) || null;
    // Our own boats already blew up locally (damage()); others' explode when the news arrives.
    if (!victim.owned) {
      this.particles.explosion(victim.x, victim.y, victim.z, true);
      this.particles.emit(victim.x, victim.y + 0.5, victim.z, 16, 0xb5763c, { speed: 6, up: 9, life: 1.3, size: 0.32, gravity: 20 });
    }
    killer?.model.character.cheer();
    if (this.state === 'playing' || this.state === 'ended') this.ui.feed(killer, victim, m.w);
    if (killer && killer === this.player && victim !== killer) {
      Sfx.kill();
      this.ui.killBanner(victim.name);
    }
  }

  // ---------------------------------------------------------------- camera & sun

  private snapCamera(): void {
    const p = this.player;
    if (!p) return;
    this.camHeading = p.heading;
    this.updateCamera(1, true);
  }

  private updateCamera(dt: number, snap = false): void {
    const cam = this.camera;
    const p = this.player;
    if (!p || this.state === 'menu' || this.state === 'lobby') {
      const s = this.showcaseSpot;
      const y = waveHeight(s.x, s.z, this.time, this.arena.map.waveAmp);
      this.camPos.set(s.camX, 2.6 + y * 0.3, s.camZ);
      this.camLook.set(s.x, 0.9, s.z);
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      this.setFov(this.camera.aspect < 1 ? 62 : 46);
      return;
    }
    const portrait = cam.aspect < 1;
    const speedK = Math.min(1.5, p.speed / BOAT.maxSpeed);
    // Pull back slightly with speed so going fast *feels* fast without the boat actually being twitchy.
    const dist = (portrait ? 13 : 9.5) + speedK * 1.2;
    const height = portrait ? 8 : 5.2;
    this.camHeading += angleDiff(this.camHeading, p.heading) * (snap ? 1 : damp(3.2, dt));
    const fx = Math.sin(this.camHeading), fz = Math.cos(this.camHeading);
    const tx = p.x - fx * dist, tz = p.z - fz * dist;
    const k = snap ? 1 : damp(5.5, dt);
    this.camPos.x += (tx - this.camPos.x) * k;
    this.camPos.z += (tz - this.camPos.z) * k;
    this.camPos.y += (p.y * 0.3 + height - this.camPos.y) * k;
    this.camLook.set(p.x + fx * 5, p.y + 0.8, p.z + fz * 5);
    cam.position.copy(this.camPos);
    if (this.camShake > 0) {
      const s = this.camShake;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.camShake = Math.max(0, this.camShake - dt * 2.5);
    }
    cam.lookAt(this.camLook);
    const fov = (portrait ? 70 : 60) + speedK * 4;
    this.setFov(snap ? fov : cam.fov + (fov - cam.fov) * damp(5, dt));
  }

  private setFov(fov: number): void {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.particles.setViewport(this.renderer.domElement.height, fov);
  }

  /** The shadow camera follows the action, snapped to its texel grid so shadows don't shimmer. */
  private updateSun(): void {
    const f = this.player ?? null;
    const fx = f ? f.x + f.forwardX * 8 : this.camLook.x;
    const fz = f ? f.z + f.forwardZ * 8 : this.camLook.z;
    const texel = (SHADOW_HALF * 2) / (this.sun.shadow.mapSize.x || 1024);
    const sx = Math.round(fx / texel) * texel, sz = Math.round(fz / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + SUN_DIR.x * 80, SUN_DIR.y * 80, sz + SUN_DIR.z * 80);
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // On wide screens the menu card sits on the left: centre the 3D showcase in the space beside it.
    const right = this.state === 'menu' || this.state === 'lobby' ? this.ui.panelRight : 0;
    if (w / h > 1.25 && right > 0 && right < w * 0.7) this.camera.setViewOffset(w, h, -right / 2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.particles.setViewport(this.renderer.domElement.height, this.camera.fov);
  }
}

export function loadStats(): Stats {
  try {
    return cleanStats(JSON.parse(CrazyGames.getItem('nn_stats') || '{}'));
  } catch {
    return cleanStats({});
  }
}
