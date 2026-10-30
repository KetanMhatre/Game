import { schema, t } from '@colyseus/schema';

// Room state, synced to every client automatically (~20 times/s, only what changed).
// High-frequency boat positions are NOT here: they travel as relayed messages instead.

export const PlayerState = schema(
  {
    id: t.string().default(''),
    name: t.string().default(''),
    color: t.number().default(0),
    character: t.string().default('otter'),
    kills: t.number().default(0),
    deaths: t.number().default(0),
    isBot: t.boolean().default(false),
    /** Spawn point index for the current round. */
    spawn: t.number().default(0),
  },
  'PlayerState',
);
export type PlayerState = InstanceType<typeof PlayerState>;

export const GameState = schema(
  {
    phase: t.string().default('lobby'),
    map: t.string().default('pond'),
    /** Comma-separated weapon ids crates can roll. */
    arsenal: t.string().default(''),
    bots: t.boolean().default(true),
    isPrivate: t.boolean().default(false),
    code: t.string().default(''),
    /** Private rooms: who can change settings and press Start. */
    hostId: t.string().default(''),
    /** The client that simulates the bots (any connected player). */
    botHostId: t.string().default(''),
    /** Increments every match, so clients know to set up a fresh round. */
    round: t.number().default(0),
    countdown: t.number().default(0),
    timeLeft: t.number().default(0),
    resultsLeft: t.number().default(0),
    players: t.map(PlayerState),
    /** Crates that have been picked up and haven't respawned yet (key = crate index). */
    taken: t.map('boolean'),
  },
  'GameState',
);
export type GameState = InstanceType<typeof GameState>;
