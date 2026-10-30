// Messages and constants shared by the game client and the multiplayer server.
// Keep this file free of browser/Node-only imports: both sides compile it.

export const PROTOCOL_VERSION = 1;
export const ROOM_SIZE = 8;
/** Owned boats send their pose this many times per second. */
export const POSE_HZ = 15;
export const COUNTDOWN_SECONDS = 3.5;
export const RESULTS_SECONDS = 10;
export const MAP_ROTATION = ['pond', 'lake', 'sea'] as const;

/** Sailor ids (keep in sync with SPECIES in src/game/Character.ts). */
export const CHARACTER_IDS = ['otter', 'shark', 'crab', 'walrus', 'octopus', 'seagull', 'hippo', 'frog'];

export type Phase = 'lobby' | 'countdown' | 'playing' | 'results';
export type RoomMode = 'public' | 'private';

/** Sent when joining or creating a room. */
export interface JoinOptions {
  name: string;
  color: number;
  character: string;
  version: number;
}

export interface CreateOptions extends JoinOptions {
  map: string;
  arsenal: string[];
  bots: boolean;
}

// ---------------------------------------------------------------- client → server (relayed to others)

/** Boat flags packed into PoseMsg.f */
export const POSE_ALIVE = 1;
export const POSE_SHIELD = 2;
export const POSE_PROTECT = 4;
export const POSE_STUN = 8;

/** Where a boat is right now. Sent by its owner (the player, or the bot host for bots). */
export interface PoseMsg {
  id: string;
  x: number;
  z: number;
  h: number;
  vx: number;
  vz: number;
  hp: number;
  f: number;
  /** Held weapon id ('' = none), so others see the right mount. */
  w: string;
  /** Steering / throttle, for the sailor's animation. */
  s: number;
  t: number;
}

/**
 * A weapon was used. Every client spawns the same effects from this; each client then
 * only applies damage to the boats it owns. `p` is weapon-specific (see Combat.applyFire).
 */
export interface FireMsg {
  by: string;
  w: string;
  p: number[];
  /** Homing target boat id (torpedoes). */
  t?: string;
  /** Effect id for traps that must be removed everywhere when triggered (mines, fake crates). */
  id?: string;
}

/** A trap (mine / fake crate) was triggered by a boat owned by the sender. */
export interface TrapMsg {
  id: string;
}

/** Ask the server for the weapon in crate `crate` (first come, first served). */
export interface PickupMsg {
  by: string;
  crate: number;
}

/** A boat owned by the sender took damage (for hit effects + health bars elsewhere). */
export interface HitMsg {
  victim: string;
  by: string | null;
  w: string;
  hp: number;
}

/** A boat owned by the sender sank. The server updates the scoreboard and broadcasts a FeedMsg. */
export interface SunkMsg {
  victim: string;
  by: string | null;
  w: string;
}

/** Private room host changes the room settings while in the lobby. */
export interface SettingsMsg {
  map?: string;
  arsenal?: string[];
  bots?: boolean;
}

// ---------------------------------------------------------------- server → clients

export interface GaveMsg {
  by: string;
  crate: number;
  weapon: string;
}

export interface FeedMsg {
  killer: string | null;
  victim: string;
  w: string;
}

export interface NoticeMsg {
  text: string;
}

/** Room codes: 5 letters, no look-alike characters. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 5;
export const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);
