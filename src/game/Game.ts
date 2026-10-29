import * as THREE from 'three';
import { Arena } from './Arena';
import { Boat } from './Boat';
import { BotBrain } from './Bot';
import { Combat, type CombatHost } from './Combat';
import { Input } from './Input';
import { Particles } from './Particles';
import { Water } from './Water';
import { Sfx } from './Audio';
import {
  BOT_COUNT, BOT_NAMES, MAPS, MATCH_SECONDS, PLAYER_COLORS, RESPAWN_SECONDS,
  SPAWN_PROTECTION_SECONDS, WEAPONS, WEAPON_TUNING, type MapId, type WeaponId,
} from './config';
import { angleDiff, damp } from './util';
import type { PlayConfig, ScoreRow, UI } from '../ui/UI';
import { CrazyGames } from '../sdk/crazygames';

type State = 'menu' | 'countdown' | 'playing' | 'paused' | 'ended';

/** Dev-only `?time=20` shortens matches for testing. */
const DEV_MATCH_SECONDS = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('time')) || 0 : 0;

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
  private combat!: Combat;
  private bots: BotBrain[] = [];
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
  private orbit = 0;
  private hudT = 0;
  private adPaused = false;
  private lastCfg: PlayConfig | null = null;
  private wakeAcc = new Map<number, number>();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;

  constructor(canvas: HTMLCanvasElement, private ui: UI) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 700);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.3);
    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    this.sun.position.set(40, 80, 25);
    this.scene.add(this.hemi, this.sun, this.world, this.particles.mesh);

    this.input = new Input(canvas, document.getElementById('ui')!);
    this.input.onPause = () => this.togglePause();

    ui.onPlay = (cfg) => this.startMatch(cfg);
    ui.onMapSelect = (id) => this.previewMap(id);
    ui.onPauseClick = () => this.togglePause();
    ui.onResume = () => this.togglePause(false);
    ui.onMuteToggle = () => {
      Sfx.setUserMuted(!Sfx.muted);
      return Sfx.muted;
    };
    ui.onAgain = () => void this.afterMatch(() => this.lastCfg && this.startMatch(this.lastCfg));
    ui.onQuit = () => void this.afterMatch(() => this.toMenu());

    CrazyGames.onMuteChange = (m) => Sfx.setForcedMute(m);
    CrazyGames.onPauseChange = (p) => (this.adPaused = p);

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.togglePause(true);
    });
    this.resize();
  }

  // ---------------------------------------------------------------- lifecycle

  start(): void {
    this.toMenu();
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.frame(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  previewMap(id: MapId): void {
    if (this.state === 'menu' && id !== this.mapId) {
      this.loadMap(id);
      this.populate(null);
    }
  }

  private toMenu(): void {
    CrazyGames.gameplayStop();
    this.state = 'menu';
    this.input.enabled = false;
    this.input.showTouch(false);
    this.loadMap(this.ui.config.map);
    this.populate(null);
    this.ui.showMenu();
  }

  private startMatch(cfg: PlayConfig): void {
    Sfx.unlock();
    Sfx.click();
    this.lastCfg = cfg;
    CrazyGames.setItem('nn_prefs', JSON.stringify(cfg));
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
    }
    stats.bestKills = Math.max(stats.bestKills, p.kills);
    CrazyGames.setItem('nn_stats', JSON.stringify(stats));
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
      this.ui.showPause(true);
    } else if (!pause && this.state === 'paused') {
      this.state = this.countdown > 0 ? 'countdown' : 'playing';
      this.input.enabled = this.state === 'playing';
      CrazyGames.gameplayStart();
      this.ui.showPause(false);
    }
  }

  // ---------------------------------------------------------------- world

  private loadMap(id: MapId): void {
    if (this.mapId === id && this.arena) {
      this.combat.reset();
      for (const b of this.boats) this.world.remove(b.model.root);
      this.boats = [];
      this.bots = [];
      this.particles.clear();
      return;
    }
    this.world.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.world.clear();
    this.boats = [];
    this.bots = [];
    this.particles.clear();

    const map = MAPS[id];
    this.mapId = id;
    this.arena = new Arena(map);
    this.water = new Water(map);
    this.combat = new Combat(this);
    this.world.add(this.arena.group, this.water.mesh, this.combat.group);
    this.scene.background = new THREE.Color(map.sky);
    this.scene.fog = new THREE.Fog(map.fog, 70, map.radius * 2 + 80);
    // Only a hint of sky tint, otherwise grass reads as water.
    this.hemi.color.setHex(0xffffff).lerp(new THREE.Color(map.sky), 0.25);
  }

  /** Fill the arena with boats. With no config it's attract mode (bots only, menu backdrop). */
  private populate(cfg: PlayConfig | null): void {
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    const colors = PLAYER_COLORS.filter((c) => c !== cfg?.color);
    this.player = null;
    if (cfg) {
      this.player = new Boat(cfg.name || 'You', cfg.color, true);
      this.boats.push(this.player);
    }
    const n = cfg ? BOT_COUNT : BOT_COUNT + 1;
    for (let i = 0; i < n; i++) {
      const b = new Boat(names[i], colors[i % colors.length], false);
      this.boats.push(b);
      this.bots.push(new BotBrain(b, 0.45 + Math.random() * 0.45));
    }
    const spots = [...this.arena.spawnPoints].sort(() => Math.random() - 0.5);
    this.boats.forEach((b, i) => {
      const s = spots[i % spots.length];
      b.spawn(s.x, s.z, s.heading);
      b.update(0, this.arena, this.time);
      this.world.add(b.model.root);
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
    this.particles.emit(best.x, 0.5, best.z, 20, 0xb3e5fc, { speed: 6, up: 8, life: 0.8 });
  }

  // ---------------------------------------------------------------- CombatHost

  damage(target: Boat, amount: number, from: Boat | null, icon: string): void {
    if (!target.alive) return;
    if (target.invulnerable) {
      this.particles.emit(target.x, target.y + 1, target.z, 8, 0x9be7ff, { speed: 4, up: 3, life: 0.4 });
      return;
    }
    const killed = target.takeDamage(amount, from);
    this.particles.emit(target.x, target.y + 0.8, target.z, 10, 0xffffff, { speed: 5, up: 5, life: 0.5 });
    if (target === this.player) {
      this.ui.damageFlash();
      Sfx.hit();
      this.shake(0.5);
    }
    if (!killed) return;

    let credit: Boat | null = from && from !== target ? from : target.lastHitBy;
    if (credit === target) credit = null;
    if (credit && this.state === 'playing') credit.kills++;
    target.respawnT = RESPAWN_SECONDS;
    this.particles.emit(target.x, target.y + 0.5, target.z, 30, 0x8d6e63, { speed: 7, up: 9, life: 1.2, size: 0.45 });
    this.particles.emit(target.x, target.y, target.z, 25, 0xe1f5fe, { speed: 4, up: 12, life: 1, size: 0.5 });
    if (this.state === 'playing' || this.state === 'ended') this.ui.feed(credit, target, icon);
    if (credit === this.player) {
      Sfx.kill();
      this.ui.message(`<div class="big pop-kill">+1 SINK</div><div>${target.name}</div>`, 1.4);
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
    const w = WEAPONS[weapon];
    this.ui.message(`<div class="pickup-msg">${w.icon} ${w.name}</div>`, 1.1);
  }

  // ---------------------------------------------------------------- frame

  private frame(dt: number): void {
    const running = !this.adPaused && this.state !== 'paused';
    if (running) {
      this.time += dt;
      this.update(dt);
    }
    this.updateCamera(running ? dt : 0);
    this.renderer.render(this.scene, this.camera);
  }

  private update(dt: number): void {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown - 0.5);
      if (n !== this.lastCount) {
        this.lastCount = n;
        if (n > 0) {
          this.ui.message(`<div class="big count">${n}</div>`, 1);
          Sfx.countdown(false);
        } else {
          this.ui.message(`<div class="big count go">GO!</div>`, 0.8);
          Sfx.countdown(true);
        }
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
    if (this.player) this.input.read(this.player.input);
    for (const bot of this.bots) {
      bot.update(dt, this.boats, this.arena, this.combat);
      if (frozen) {
        bot.boat.input.throttle = bot.boat.input.steer = 0;
        bot.boat.input.fire = false;
      }
    }

    for (const b of this.boats) {
      if (b.alive && b.input.fire && !frozen) {
        const before = b.turboT;
        if (this.combat.useWeapon(b) && b.turboT > before) this.shake(0.15);
      }
      const impact = b.update(dt, this.arena, this.time);
      if (impact > 6) {
        this.particles.emit(b.x, b.y + 0.2, b.z, 6, 0xe1f5fe, { speed: 3, up: 4, life: 0.5 });
        if (b === this.player) this.shake(0.15);
      }
      if (!b.alive && b.respawnT <= 0) this.respawn(b);
      this.emitWake(b, dt);
    }
    this.collideBoats();
    this.combat.update(dt);
    this.arena.update(this.time, dt);
    this.water.update(this.time);
    this.particles.update(dt);

    if (this.player) {
      this.input.setFireIcon(this.player.weapon ? WEAPONS[this.player.weapon].icon : null);
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

  private emitWake(b: Boat, dt: number): void {
    if (!b.alive) return;
    const s = b.speed;
    if (s < 3) return;
    const acc = (this.wakeAcc.get(b.id) ?? 0) + dt * s * (b.turboT > 0 ? 2.5 : 1.1);
    let n = Math.floor(acc);
    this.wakeAcc.set(b.id, acc - n);
    const fx = b.forwardX, fz = b.forwardZ;
    while (n-- > 0) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const x = b.x - fx * 1.3 + fz * side * 0.7, z = b.z - fz * 1.3 - fx * side * 0.7;
      this.particles.emit(x, b.y - 0.05, z, 1, b.turboT > 0 ? 0xfff59d : 0xffffff, { speed: 1, up: 1.2, life: 0.7, size: 0.25, gravity: 3 });
    }
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
        const imp = -rel * 0.8;
        a.vx -= nx * imp;
        a.vz -= nz * imp;
        b.vx += nx * imp;
        b.vz += nz * imp;
        this.particles.emit((a.x + b.x) / 2, a.y + 0.4, (a.z + b.z) / 2, 5, 0xe1f5fe, { speed: 3, up: 4, life: 0.4 });
        // Turbo ramming.
        for (const [ram, victim] of [[a, b], [b, a]] as const) {
          if (ram.turboT > 0 && -rel > 5 && (ram.ramCooldown.get(victim.id) ?? 0) <= 0) {
            ram.ramCooldown.set(victim.id, 1);
            victim.vx += (victim === b ? nx : -nx) * 14;
            victim.vz += (victim === b ? nz : -nz) * 14;
            this.damage(victim, WEAPON_TUNING.turboRamDamage, ram, WEAPONS.turbo.icon);
            Sfx.boom(this.listenerDist(victim.x, victim.z));
          }
        }
      }
    }
  }

  private scoreRows(): ScoreRow[] {
    return this.boats
      .map((b) => ({ name: b.name, color: b.color, kills: b.kills, deaths: b.deaths, isPlayer: b.isPlayer }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || Number(b.isPlayer) - Number(a.isPlayer));
  }

  // ---------------------------------------------------------------- camera

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
      this.orbit += dt * 0.05;
      const r = this.arena.map.radius * 0.95;
      this.camPos.set(Math.cos(this.orbit) * r, r * 0.42, Math.sin(this.orbit) * r);
      this.camLook.set(0, 0, 0);
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      return;
    }
    const portrait = cam.aspect < 1;
    const dist = portrait ? 13 : 9.5;
    const height = portrait ? 8 : 5.2;
    this.camHeading += angleDiff(this.camHeading, p.heading) * (snap ? 1 : damp(4, dt));
    const fx = Math.sin(this.camHeading), fz = Math.cos(this.camHeading);
    const tx = p.x - fx * dist, tz = p.z - fz * dist;
    const k = snap ? 1 : damp(7, dt);
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
    const fov = (portrait ? 70 : 60) + (p.turboT > 0 ? 10 : 0);
    if (Math.abs(cam.fov - fov) > 0.1) {
      cam.fov += (fov - cam.fov) * (snap ? 1 : damp(5, dt));
      cam.updateProjectionMatrix();
    }
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

export function loadStats(): { wins: number; bestKills: number } {
  try {
    const s = JSON.parse(CrazyGames.getItem('nn_stats') || '{}');
    return { wins: Number(s.wins) || 0, bestKills: Number(s.bestKills) || 0 };
  } catch {
    return { wins: 0, bestKills: 0 };
  }
}
