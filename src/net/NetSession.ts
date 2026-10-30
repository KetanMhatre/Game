import { Client, type Room } from '@colyseus/sdk';
import {
  PROTOCOL_VERSION, normalizeCode,
  type CreateOptions, type FeedMsg, type FireMsg, type GaveMsg, type HitMsg, type JoinOptions, type NoticeMsg,
  type Phase, type PoseMsg, type TrapMsg,
} from '../../shared/protocol';

// Connection to the multiplayer server (see /server). One NetSession = one room.

/** What the client sees of the room state (mirrors server/src/state.ts). */
export interface PlayerView {
  id: string;
  name: string;
  color: number;
  character: string;
  kills: number;
  deaths: number;
  isBot: boolean;
  spawn: number;
}

interface MapView<T> {
  get(key: string): T | undefined;
  has(key: string): boolean;
  forEach(cb: (value: T, key: string) => void): void;
  readonly size: number;
}

export interface RoomView {
  phase: Phase;
  map: string;
  arsenal: string;
  bots: boolean;
  isPrivate: boolean;
  code: string;
  hostId: string;
  botHostId: string;
  round: number;
  countdown: number;
  timeLeft: number;
  resultsLeft: number;
  players: MapView<PlayerView>;
  taken: MapView<boolean>;
}

export interface NetEvents {
  pose(list: PoseMsg[]): void;
  fire(m: FireMsg): void;
  fx(m: TrapMsg): void;
  hit(m: HitMsg): void;
  gave(m: GaveMsg): void;
  feed(m: FeedMsg): void;
  notice(m: NoticeMsg): void;
  /** The connection ended without us leaving (network loss, server restart). */
  lost(): void;
}

type Profile = Omit<JoinOptions, 'version'>;

/**
 * `VITE_GAME_SERVER_URL` in production. Otherwise the same address under /net: the Vite dev/preview
 * server forwards it to the game server on port 2567 (see vite.config.ts), so localhost, LAN and tunnels all work.
 */
export function serverUrl(): string {
  const env = import.meta.env.VITE_GAME_SERVER_URL;
  if (env) return env;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/net`;
}

/** Turns join/connect failures into something a player can act on. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (/refresh/i.test(msg)) return msg;
  if (/not found|no rooms|invalid room|does not exist/i.test(msg)) return "Couldn't find that room. Check the code and try again.";
  if (/locked|full/i.test(msg)) return 'That room is full or its match is ending. Try again in a moment.';
  return "Can't reach the game server right now. Check your connection and try again.";
}

export class NetSession {
  /** Round-trip time to the server in ms (smoothed). */
  rtt = 100;
  private handlers: NetEvents | null = null;
  private leaving = false;
  private pingTimer: number;

  private constructor(private room: Room) {
    // Every message type is registered up front so nothing is dropped before bind().
    room.onMessage('pose', (m: PoseMsg | PoseMsg[]) => this.handlers?.pose(Array.isArray(m) ? m : [m]));
    room.onMessage('fire', (m: FireMsg) => this.handlers?.fire(m));
    room.onMessage('fx', (m: TrapMsg) => this.handlers?.fx(m));
    room.onMessage('hit', (m: HitMsg) => this.handlers?.hit(m));
    room.onMessage('gave', (m: GaveMsg) => this.handlers?.gave(m));
    room.onMessage('feed', (m: FeedMsg) => this.handlers?.feed(m));
    room.onMessage('notice', (m: NoticeMsg) => this.handlers?.notice(m));
    room.onLeave(() => {
      clearInterval(this.pingTimer);
      if (!this.leaving) this.handlers?.lost();
    });
    this.pingTimer = window.setInterval(() => this.ping(), 2000);
    this.ping();
  }

  /** Quick Play: a public room with space, or a new one. */
  static async quickPlay(profile: Profile): Promise<NetSession> {
    const room = await new Client(serverUrl()).joinOrCreate('public', { ...profile, version: PROTOCOL_VERSION });
    return new NetSession(room);
  }

  /** A private room; its 5-letter code is the room id. */
  static async create(profile: Profile, settings: Pick<CreateOptions, 'map' | 'arsenal' | 'bots'>): Promise<NetSession> {
    const room = await new Client(serverUrl()).create('private', { ...profile, ...settings, version: PROTOCOL_VERSION });
    return new NetSession(room);
  }

  static async join(code: string, profile: Profile): Promise<NetSession> {
    const room = await new Client(serverUrl()).joinById(normalizeCode(code), { ...profile, version: PROTOCOL_VERSION });
    return new NetSession(room);
  }

  get myId(): string {
    return this.room.sessionId;
  }

  get state(): RoomView {
    return this.room.state as unknown as RoomView;
  }

  /** The first state sync has arrived (we're in the player list). */
  get ready(): boolean {
    return !!this.state?.players?.has(this.myId);
  }

  bind(handlers: NetEvents): void {
    this.handlers = handlers;
  }

  send(type: string, msg?: unknown): void {
    if (!this.leaving) this.room.send(type, msg);
  }

  leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.handlers = null;
    clearInterval(this.pingTimer);
    this.room.leave().catch(() => {});
  }

  private ping(): void {
    try {
      this.room.ping((ms) => (this.rtt += (ms - this.rtt) * 0.3));
    } catch {
      /* not connected yet / closing */
    }
  }
}
