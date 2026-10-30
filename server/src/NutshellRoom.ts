import { Room, matchMaker, type Client } from 'colyseus';
import { GameState, PlayerState } from './state.ts';
import {
  CHARACTER_IDS, CODE_ALPHABET, CODE_LENGTH, COUNTDOWN_SECONDS, MAP_ROTATION, PROTOCOL_VERSION, RESULTS_SECONDS, ROOM_SIZE,
  type CreateOptions, type FireMsg, type HitMsg, type JoinOptions, type PickupMsg, type PoseMsg, type RoomMode,
  type SettingsMsg, type SunkMsg, type TrapMsg,
} from '../../shared/protocol.ts';
import { BOT_NAMES, MAPS, MATCH_SECONDS, PICKUP_RESPAWN_SECONDS, PLAYER_COLORS, WEAPONS, WEAPON_ORDER, type WeaponId } from '../../src/game/config.ts';

const TICK = 0.1;
/** `MATCH_SECONDS=30 npm run dev` shortens matches for testing. */
const MATCH_LENGTH = Number(process.env.MATCH_SECONDS) || MATCH_SECONDS;
const isBotId = (id: string) => id.startsWith('bot-');
const cleanName = (s: unknown) => (typeof s === 'string' ? s.replace(/[<>]/g, '').trim().slice(0, 14) : '') || 'Captain';
const validMap = (m: unknown): m is string => typeof m === 'string' && m in MAPS;
function validArsenal(list: unknown): WeaponId[] {
  return Array.isArray(list) ? WEAPON_ORDER.filter((id) => list.includes(id)) : [];
}

/**
 * One match room. "public" rooms are found by Quick Play, start on their own, run back-to-back
 * matches and fill empty seats with bots. "private" rooms get a 5-letter code (the room id),
 * and the host picks the map/arsenal/bots and presses Start.
 *
 * The server is the referee (phases, timer, scores, crates) and a relay: each client simulates its
 * own boat (and the bot host simulates the bots) and reports poses, shots, hits and sinkings.
 */
export class NutshellRoom extends Room<{ state: GameState }> {
  maxClients = ROOM_SIZE;
  private mode: RoomMode = 'public';
  private botSeq = 0;
  private crateTimers = new Map<string, { clear(): void }>();
  private mapIndex = Math.floor(Math.random() * MAP_ROTATION.length);

  async onCreate(options: Partial<CreateOptions>) {
    this.mode = this.roomName === 'private' ? 'private' : 'public';
    this.state = new GameState();
    const s = this.state;
    s.isPrivate = this.mode === 'private';
    if (s.isPrivate) {
      this.roomId = await this.uniqueCode();
      s.code = this.roomId;
      await this.setPrivate(true);
      s.map = validMap(options.map) ? options.map : 'pond';
      const arsenal = validArsenal(options.arsenal);
      s.arsenal = (arsenal.length ? arsenal : WEAPON_ORDER).join(',');
      s.bots = options.bots !== false;
    } else {
      s.map = MAP_ROTATION[this.mapIndex];
      s.arsenal = WEAPON_ORDER.join(',');
      s.bots = true;
    }
    s.phase = 'lobby';

    this.onMessage('pose', (client, msg: PoseMsg | PoseMsg[]) => {
      // Drop poses for boats the sender doesn't control (e.g. a bot that was just replaced by a player).
      const list = (Array.isArray(msg) ? msg : [msg]).filter((p) => p && this.owns(client, p.id));
      if (list.length) this.broadcast('pose', list, { except: client });
    });
    this.onMessage('fire', (client, msg: FireMsg) => {
      if (s.phase !== 'playing' || !msg || !this.owns(client, msg.by)) return;
      this.broadcast('fire', msg, { except: client });
    });
    this.onMessage('fx', (client, msg: TrapMsg) => {
      if (s.phase !== 'playing' || typeof msg?.id !== 'string') return;
      this.broadcast('fx', msg, { except: client });
    });
    this.onMessage('hit', (client, msg: HitMsg) => {
      if (!msg || !this.owns(client, msg.victim)) return;
      this.broadcast('hit', msg, { except: client });
    });
    this.onMessage('sunk', (client, msg: SunkMsg) => this.onSunk(client, msg));
    this.onMessage('pickup', (client, msg: PickupMsg) => this.onPickup(client, msg));
    this.onMessage('settings', (client, msg: SettingsMsg) => this.onSettings(client, msg));
    this.onMessage('start', (client) => {
      if (s.isPrivate && client.sessionId === s.hostId && s.phase === 'lobby') this.beginRound();
    });

    this.clock.setInterval(() => this.tick(TICK), TICK * 1000);
  }

  onJoin(client: Client, options: Partial<JoinOptions>) {
    if (options?.version !== PROTOCOL_VERSION) throw new Error('Please refresh the game to play online (new version available).');
    const s = this.state;
    const p = new PlayerState();
    p.id = client.sessionId;
    p.name = cleanName(options.name);
    p.color = this.freeColor(Number(options.color));
    p.character = CHARACTER_IDS.includes(String(options.character)) ? String(options.character) : CHARACTER_IDS[0];
    p.spawn = -1;
    s.players.set(p.id, p);
    if (!s.hostId) s.hostId = client.sessionId;
    if (!s.botHostId) s.botHostId = client.sessionId;
    this.reconcileBots();
    // After a bot has made room: take its spawn slot.
    p.spawn = this.freeSpawn();
    // Public rooms start by themselves as soon as someone is there.
    if (!s.isPrivate && s.phase === 'lobby') this.beginRound();
  }

  onLeave(client: Client) {
    const s = this.state;
    s.players.delete(client.sessionId);
    const humans = this.humans();
    if (s.hostId === client.sessionId) s.hostId = humans[0]?.id ?? '';
    if (s.botHostId === client.sessionId) s.botHostId = humans[0]?.id ?? '';
    this.reconcileBots();
  }

  // ---------------------------------------------------------------- match flow

  private tick(dt: number): void {
    const s = this.state;
    if (s.phase === 'countdown') {
      s.countdown = Math.max(0, s.countdown - dt);
      if (s.countdown <= 0) {
        s.phase = 'playing';
        s.timeLeft = MATCH_LENGTH;
      }
    } else if (s.phase === 'playing') {
      s.timeLeft = Math.max(0, s.timeLeft - dt);
      if (s.timeLeft <= 0) {
        s.phase = 'results';
        s.resultsLeft = RESULTS_SECONDS;
      }
    } else if (s.phase === 'results') {
      s.resultsLeft = Math.max(0, s.resultsLeft - dt);
      if (s.resultsLeft <= 0) {
        if (s.isPrivate) {
          s.phase = 'lobby';
        } else {
          this.mapIndex = (this.mapIndex + 1) % MAP_ROTATION.length;
          s.map = MAP_ROTATION[this.mapIndex];
          this.beginRound();
        }
      }
    }
  }

  private beginRound(): void {
    const s = this.state;
    s.round++;
    for (const t of this.crateTimers.values()) t.clear();
    this.crateTimers.clear();
    s.taken.clear();
    const slots = [...Array(ROOM_SIZE).keys()].sort(() => Math.random() - 0.5);
    let i = 0;
    s.players.forEach((p) => {
      p.kills = 0;
      p.deaths = 0;
      p.spawn = slots[i++ % ROOM_SIZE];
    });
    // A little extra countdown so every client has time to build the map.
    s.countdown = COUNTDOWN_SECONDS + 1;
    s.phase = 'countdown';
  }

  // ---------------------------------------------------------------- messages

  private onSunk(client: Client, msg: SunkMsg): void {
    const s = this.state;
    if (!msg || !this.owns(client, msg.victim)) return;
    const victim = s.players.get(msg.victim);
    if (!victim) return;
    const killer = msg.by && msg.by !== msg.victim ? s.players.get(msg.by) : undefined;
    if (s.phase === 'playing') {
      victim.deaths++;
      if (killer) killer.kills++;
    }
    this.broadcast('feed', { killer: killer ? killer.id : null, victim: victim.id, w: String(msg.w ?? '') });
  }

  private onPickup(client: Client, msg: PickupMsg): void {
    const s = this.state;
    if (s.phase !== 'playing' || !msg || !this.owns(client, msg.by)) return;
    const crate = Math.floor(Number(msg.crate));
    if (!(crate >= 0 && crate < 64)) return;
    const key = String(crate);
    if (s.taken.has(key)) return; // someone got there first
    s.taken.set(key, true);
    this.broadcast('gave', { by: msg.by, crate, weapon: this.rollWeapon() });
    this.crateTimers.set(
      key,
      this.clock.setTimeout(() => {
        s.taken.delete(key);
        this.crateTimers.delete(key);
      }, PICKUP_RESPAWN_SECONDS * 1000),
    );
  }

  private onSettings(client: Client, msg: SettingsMsg): void {
    const s = this.state;
    if (!s.isPrivate || client.sessionId !== s.hostId || s.phase !== 'lobby' || !msg) return;
    if (validMap(msg.map)) s.map = msg.map;
    if (msg.arsenal) {
      const list = validArsenal(msg.arsenal);
      if (list.length) s.arsenal = list.join(',');
    }
    if (typeof msg.bots === 'boolean') {
      s.bots = msg.bots;
      this.reconcileBots();
    }
  }

  // ---------------------------------------------------------------- helpers

  /** The sender controls this boat: their own, or a bot if they're the bot host. */
  private owns(client: Client, id: unknown): boolean {
    if (typeof id !== 'string') return false;
    return id === client.sessionId || (isBotId(id) && this.state.botHostId === client.sessionId && this.state.players.has(id));
  }

  private humans(): PlayerState[] {
    const out: PlayerState[] = [];
    this.state.players.forEach((p) => {
      if (!p.isBot) out.push(p);
    });
    return out;
  }

  /** Bots fill the empty seats (if enabled), and step aside when real players join. */
  private reconcileBots(): void {
    const s = this.state;
    const humans = this.humans().length;
    const target = s.bots && humans > 0 ? ROOM_SIZE - humans : 0;
    const bots: PlayerState[] = [];
    s.players.forEach((p) => {
      if (p.isBot) bots.push(p);
    });
    while (bots.length > target) s.players.delete(bots.pop()!.id);
    const usedNames = new Set<string>();
    s.players.forEach((p) => usedNames.add(p.name));
    for (let n = bots.length; n < target; n++) {
      const b = new PlayerState();
      b.id = `bot-${++this.botSeq}`;
      b.isBot = true;
      b.name = BOT_NAMES.find((name) => !usedNames.has(name)) ?? `Bot ${this.botSeq}`;
      usedNames.add(b.name);
      b.character = CHARACTER_IDS[Math.floor(Math.random() * CHARACTER_IDS.length)];
      b.spawn = this.freeSpawn();
      s.players.set(b.id, b);
    }
    // Players pick colours first; bots take what's left, so no two boats look alike.
    const used = new Set(this.humans().map((h) => h.color));
    s.players.forEach((p) => {
      if (!p.isBot) return;
      if (used.has(p.color) || !PLAYER_COLORS.includes(p.color)) p.color = PLAYER_COLORS.find((c) => !used.has(c)) ?? p.color;
      used.add(p.color);
    });
  }

  /** A colour no other player has (bots don't count: they give theirs up, see reconcileBots). */
  private freeColor(wanted: number): number {
    const used = new Set(this.humans().map((h) => h.color));
    if (PLAYER_COLORS.includes(wanted) && !used.has(wanted)) return wanted;
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
  }

  private freeSpawn(): number {
    const used = new Set<number>();
    this.state.players.forEach((p) => used.add(p.spawn));
    for (let i = 0; i < ROOM_SIZE; i++) if (!used.has(i)) return i;
    return Math.floor(Math.random() * ROOM_SIZE);
  }

  private rollWeapon(): WeaponId {
    const pool = this.state.arsenal.split(',').filter((id): id is WeaponId => id in WEAPONS).map((id) => WEAPONS[id]);
    const list = pool.length ? pool : WEAPON_ORDER.map((id) => WEAPONS[id]);
    let r = Math.random() * list.reduce((sum, w) => sum + w.weight, 0);
    for (const w of list) {
      r -= w.weight;
      if (r <= 0) return w.id;
    }
    return list[list.length - 1].id;
  }

  private async uniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      const existing = await matchMaker.query({ roomId: code }).catch(() => []);
      if (!existing.length) return code;
    }
    throw new Error('Could not allocate a room code');
  }
}
