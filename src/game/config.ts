// All gameplay tuning lives here so balancing doesn't require digging through systems.

export const MATCH_SECONDS = 180;
export const BOT_COUNT = 7;
export const MAX_HP = 3;
export const RESPAWN_SECONDS = 3;
export const SPAWN_PROTECTION_SECONDS = 2;
export const PICKUP_RESPAWN_SECONDS = 7;

// Units are roughly metres; the boat is ~2.6 long. Tweak here to change the handling feel.
export const BOAT = {
  radius: 1.25,
  maxSpeed: 11.5, // top paddling speed (u/s). Pond crosses in ~8 s
  reverseSpeed: 4.5,
  accel: 13, // thrust; tapers off near top speed (strong launch, smooth top end)
  reverseAccel: 7,
  brake: 16, // pressing back while still moving forward
  coastDrag: 0.55, // water drag when not paddling: boats glide to a stop
  baseDrag: 0.12, // drag while paddling
  throttleResponse: 6, // how quickly paddling effort ramps up/down
  steerResponse: 7, // how quickly the rudder swings to full lock (keys are on/off; this smooths them)
  turnRate: 2.1, // peak yaw rate, rad/s (~120°/s)
  turnResponse: 6, // yaw inertia: how quickly the hull starts/stops rotating
  lateralGrip: 5.5, // sideways slip decay; lower = more drift
  cornerCarry: 0.6, // share of turn speed-loss recovered while paddling (0 = sim-like scrub, 1 = no loss)
  turboMultiplier: 1.55,
  turboAccel: 2.2,
  bounce: 0.35, // wall / rock restitution
  boatRestitution: 0.3, // boat-vs-boat bounciness
};

export type WeaponId = 'cannon' | 'torpedo' | 'mine' | 'tidal' | 'shield' | 'turbo';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  icon: string;
  ammo: number;
  color: number;
  /** Relative chance to roll from a pickup barrel. */
  weight: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  cannon: { id: 'cannon', name: 'Coconut Cannon', icon: '🥥', ammo: 3, color: 0x8b5a2b, weight: 30 },
  torpedo: { id: 'torpedo', name: 'Puffer Torpedo', icon: '🐡', ammo: 1, color: 0xffcc33, weight: 18 },
  mine: { id: 'mine', name: 'Urchin Mine', icon: '🦔', ammo: 2, color: 0x6a3d9a, weight: 18 },
  tidal: { id: 'tidal', name: 'Tidal Splash', icon: '🌊', ammo: 1, color: 0x4fc3f7, weight: 12 },
  shield: { id: 'shield', name: 'Bubble Shield', icon: '🫧', ammo: 1, color: 0x9be7ff, weight: 10 },
  turbo: { id: 'turbo', name: 'Turbo Paddle', icon: '💨', ammo: 1, color: 0xffffff, weight: 12 },
};

export const WEAPON_TUNING = {
  cannonSpeed: 48,
  cannonLife: 1.3,
  cannonDamage: 1,
  cannonCooldown: 0.35,
  torpedoSpeed: 24,
  torpedoTurn: 2.4,
  torpedoLife: 4,
  torpedoDamage: 2,
  mineArm: 0.6,
  mineLife: 25,
  mineDamage: 2,
  mineRadius: 2.2,
  tidalRadius: 13,
  tidalDamage: 1,
  tidalPush: 17,
  hitKnockback: 5.5, // cannon / torpedo shove
  mineKnockback: 9,
  ramKnockback: 10,
  shieldSeconds: 6,
  turboSeconds: 3,
  turboRamDamage: 1,
};

export type MapId = 'pond' | 'lake' | 'sea';

export interface MapDef {
  id: MapId;
  name: string;
  blurb: string;
  radius: number;
  shoreNoise: number;
  waveAmp: number;
  waterShallow: number;
  waterDeep: number;
  sky: number;
  fog: number;
  sand: number;
  grass: number;
  islandCount: number;
  rockCount: number;
  pickupCount: number;
  decor: 'lily' | 'pine' | 'palm';
  seed: number;
}

export const MAPS: Record<MapId, MapDef> = {
  pond: {
    id: 'pond',
    name: 'Lily Pond',
    blurb: 'Tight & frantic. Calm water, lots of lily pads.',
    radius: 48,
    shoreNoise: 0.12,
    waveAmp: 0.08,
    waterShallow: 0x5fd3b0,
    waterDeep: 0x1f8a78,
    sky: 0xbfe8ff,
    fog: 0xcdeedd,
    sand: 0xc9b37a,
    grass: 0x7fbf4d,
    islandCount: 4,
    rockCount: 8,
    pickupCount: 8,
    decor: 'lily',
    seed: 11,
  },
  lake: {
    id: 'lake',
    name: 'Pine Lake',
    blurb: 'Islands, pines and a mountain breeze.',
    radius: 68,
    shoreNoise: 0.18,
    waveAmp: 0.18,
    waterShallow: 0x4fb7d8,
    waterDeep: 0x1b5f8f,
    sky: 0xa9d8ff,
    fog: 0xb8daf0,
    sand: 0xd8c28c,
    grass: 0x5f9e45,
    islandCount: 7,
    rockCount: 10,
    pickupCount: 11,
    decor: 'pine',
    seed: 23,
  },
  sea: {
    id: 'sea',
    name: 'Coconut Sea',
    blurb: 'Big swells, sandy atolls, open water.',
    radius: 88,
    shoreNoise: 0.1,
    waveAmp: 0.45,
    waterShallow: 0x3cc8e6,
    waterDeep: 0x0e4c8a,
    sky: 0x8fd0ff,
    fog: 0xa6dcf5,
    sand: 0xf0d9a0,
    grass: 0x8cc152,
    islandCount: 9,
    rockCount: 12,
    pickupCount: 14,
    decor: 'palm',
    seed: 37,
  },
};

export const PLAYER_COLORS = [0xff5252, 0x40c4ff, 0xffd740, 0x69f0ae, 0xe040fb, 0xff9100, 0xffffff, 0x536dfe];

export const BOT_NAMES = [
  'Captain Kelp', 'Barnacle Bo', 'Salty Sue', 'Admiral Nut', 'Paddles', 'Cpt. Crunch', 'Driftwood',
  'Mossy', 'Skipper', 'Coral Kid', 'Bilge Rat', 'Gully', 'Splashy', 'Old Oar', 'Shelly', 'Tiny Tide',
];
