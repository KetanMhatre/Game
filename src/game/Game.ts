import * as THREE from 'three';
import { Arena, type Collider } from './Arena';
import { Boat } from './Boat';
import { BoatModel, RIDE_HEIGHT } from './BoatModel';
import { BotBrain } from './Bot';
import { SPECIES, type SpeciesId } from './Character';
import { Combat, type CombatHost } from './Combat';
import { Input } from './Input';
import { Particles } from './Particles';
import { Sky } from './Sky';
import { Wake } from './Wake';
import { Water } from './Water';
import { Sfx } from './Audio';
import {
  BOAT, BOT_COUNT, BOT_NAMES, MAPS, MATCH_SECONDS, PLAYER_COLORS, RESPAWN_SECONDS,
  SPAWN_PROTECTION_SECONDS, type MapId, type WeaponId,
} from './config';
import { angleDiff, damp } from './util';
import { waveHeight } from './waves';
import type { PlayConfig, ScoreRow, UI } from '../ui/UI';
import { CrazyGames } from '../sdk/crazygames';
import { Account, cleanStats, type Stats } from '../services/Account';

type State = 'menu' | 'countdown' | 'playing' | 'paused' | 'ended';
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
    ui.onQuit = () => void this.afterMatch(() => this.toMenu());

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

  private startMatch(cfg: PlayConfig): void {
    Sfx.unlock();
    Sfx.click();
    this.lastCfg = cfg;
    const prefs = { ...cfg, quality: this.quality };
    CrazyGames.setItem('nn_prefs', JSON.stringify(prefs));
    Account.save({ name: cfg.name, prefs });
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
    const p = this.player!;
    const stats = loadStats();
    if (rank === 1) {
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
    this.ui.showEnd(rows, rank);
  }

  /** Natural break between matches: show a midgame ad, then continue. */
  private async afterMatch(next: () => void): Promise<void> {
    Sfx.click();
    this.state = 'paused';
    await CrazyGames.midgameAd();
    next();
  }

  private togglePause(force?: boolean): void {
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
    this.player = null;
    if (cfg) {
      this.player = new Boat(cfg.name || 'You', cfg.color, true, cfg.character);
      this.boats.push(this.player);
    }
    const n = cfg ? BOT_COUNT : BOT_COUNT + 1;
    for (let i = 0; i < n; i++) {
      const b = new Boat(names[i], colors[i % colors.length], false, species[i % species.length]);
      b.labelEnabled = cfg !== null;
      this.boats.push(b);
      this.bots.push(new BotBrain(b, 0.45 + Math.random() * 0.45));
    }
    const spots = [...this.arena.spawnPoints].sort(() => Math.random() - 0.5);
    this.boats.forEach((b, i) => {
      const s = spots[i % spots.length];
      b.spawn(s.x, s.z, s.heading);
      b.update(0, this.arena, this.time);
      this.world.add(b.model.root);
      const w = new Wake();
      this.wakes.set(b.id, w);
      this.world.add(w.mesh);
    });
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
    if (this.state !== 'menu') return;
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
    if (!killed) return;

    let credit: Boat | null = from && from !== target ? from : target.lastHitBy;
    if (credit === target) credit = null;
    if (credit && this.state === 'playing') credit.kills++;
    credit?.model.character.cheer();
    target.respawnT = RESPAWN_SECONDS;
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

  // ---------------------------------------------------------------- frame

  private frame(dt: number, raw: number): void {
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
    if (this.state === 'countdown') {
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

    const frozen = this.state === 'countdown';
    const amp = this.arena.map.waveAmp;
    if (this.player) this.input.read(this.player.input);
    for (const bot of this.bots) {
      bot.update(dt, this.boats, this.arena, this.combat);
      if (frozen) {
        bot.boat.input.throttle = bot.boat.input.steer = 0;
        bot.boat.input.fire = false;
      }
    }

    for (const b of this.boats) {
      if (b.alive && b.input.fire && !frozen) this.combat.useWeapon(b);
      const impact = b.update(dt, this.arena, this.time);
      if (impact > 5) {
        this.particles.splash(b.x + b.forwardX * 1.2, b.y - 0.2, b.z + b.forwardZ * 1.2, Math.min(1.2, impact / 10));
        if (b === this.player) this.shake(0.15);
      }
      if (!b.alive && b.respawnT <= 0) this.respawn(b);
      this.wakes.get(b.id)?.update(dt, b, this.time, amp);
      // Propeller churn behind the outboard motor while the throttle is open.
      if (b.alive && Math.abs(b.input.throttle) > 0.1 && Math.random() < 0.35) {
        this.particles.emit(b.x - b.forwardX * 1.55, b.y - 0.45, b.z - b.forwardZ * 1.55, 1, 0xf2fbff, {
          dirX: -b.forwardX * Math.sign(b.input.throttle), dirZ: -b.forwardZ * Math.sign(b.input.throttle),
          speed: 2.5, up: 1.4, life: 0.4, size: 0.28, gravity: 6, alpha: 0.85,
        });
      }
    }
    this.collideBoats();
    this.combat.update(dt);
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
        if (!b.alive) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d, nz = dz / d;
        const push = (min - d) / 2;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rel >= 0) continue;
        const imp = (-rel * (1 + BOAT.boatRestitution)) / 2; // equal masses
        a.vx -= nx * imp;
        a.vz -= nz * imp;
        b.vx += nx * imp;
        b.vz += nz * imp;
        if (-rel > 2) this.particles.splash((a.x + b.x) / 2, a.y - 0.1, (a.z + b.z) / 2, Math.min(1, -rel / 10));
      }
    }
  }

  private scoreRows(): ScoreRow[] {
    return this.boats
      .map((b) => ({ name: b.name, color: b.color, kills: b.kills, deaths: b.deaths, isPlayer: b.isPlayer }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || Number(b.isPlayer) - Number(a.isPlayer));
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
    if (!p || this.state === 'menu') {
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
    // On wide screens the menu card sits on the left: shift the 3D showcase to the right.
    if (this.state === 'menu' && w / h > 1.25) this.camera.setViewOffset(w, h, -w * 0.17, 0, w, h);
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
