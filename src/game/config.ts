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
  bounce: 0.35, // wall / rock restitution
  boatRestitution: 0.3, // boat-vs-boat bounciness
};

export type WeaponId =
  | 'torpedoes'
  | 'broadside'
  | 'mines'
  | 'barrier'
  | 'fakeCrate'
  | 'mortar'
  | 'deckGun'
  | 'maelstrom'
  | 'depthCharges'
  | 'harpoon'
  | 'flail'
  | 'drone';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Key into ui/icons.ts (SVG). Emoji are avoided: newer ones render as boxes on older Windows/ChromeOS. */
  icon: string;
  ammo: number;
  /** Relative chance to roll from a pickup crate. */
  weight: number;
  desc: string;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  torpedoes: { id: 'torpedoes', name: 'Torpedoes', icon: 'torpedoes', ammo: 2, weight: 12, desc: 'Two fast torpedoes that curve toward rivals ahead.' },
  broadside: { id: 'broadside', name: 'Broadside Cannon', icon: 'broadside', ammo: 3, weight: 11, desc: 'Fires cannonballs out of both sides at once.' },
  mines: { id: 'mines', name: 'Naval Mines', icon: 'mines', ammo: 2, weight: 10, desc: 'Drop mines behind you. They blow up on contact.' },
  barrier: { id: 'barrier', name: 'Hydro-Barrier', icon: 'barrier', ammo: 1, weight: 7, desc: 'A bubble shield that blocks all damage for 6 seconds.' },
  fakeCrate: { id: 'fakeCrate', name: 'Fake Crate', icon: 'fakeCrate', ammo: 1, weight: 6, desc: 'A booby-trapped crate. Spot fakes by their red "?".' },
  mortar: { id: 'mortar', name: 'Sea Mortar', icon: 'mortar', ammo: 2, weight: 9, desc: 'Lobs a shell onto the nearest rival ahead.' },
  deckGun: { id: 'deckGun', name: 'Deck Gun', icon: 'deckGun', ammo: 30, weight: 11, desc: 'Hold fire for a rapid stream of bullets.' },
  maelstrom: { id: 'maelstrom', name: 'Maelstrom', icon: 'maelstrom', ammo: 1, weight: 6, desc: 'Opens a whirlpool that drags rivals in.' },
  depthCharges: { id: 'depthCharges', name: 'Depth Charges', icon: 'depthCharges', ammo: 1, weight: 8, desc: 'Three charges sink behind you and explode.' },
  harpoon: { id: 'harpoon', name: 'Harpoon Hook', icon: 'harpoon', ammo: 2, weight: 8, desc: 'Spears a rival and yanks them toward you.' },
  flail: { id: 'flail', name: 'Sea Flail', icon: 'flail', ammo: 1, weight: 6, desc: 'A spiked ball spins around your boat.' },
  drone: { id: 'drone', name: 'Patrol Drone', icon: 'drone', ammo: 1, weight: 6, desc: 'A mini gunboat escorts you and shoots rivals.' },
};

/** Display order in the Arsenal screen. */
export const WEAPON_ORDER: WeaponId[] = [
  'torpedoes', 'broadside', 'mines', 'barrier',
  'fakeCrate', 'mortar', 'deckGun', 'maelstrom',
  'depthCharges', 'harpoon', 'flail', 'drone',
];

// Damage is in hearts (MAX_HP = 3). Fractional damage (Deck Gun, Drone) drains the bar gradually.
export const WEAPON_TUNING = {
  torpedoes: { speed: 30, life: 2.2, turn: 1.0, damage: 1, cooldown: 0.6, knock: 6 },
  broadside: { speed: 30, up: 5, gravity: 14, damage: 1, cooldown: 0.55, knock: 6, cone: 0.7, range: 34 },
  mines: { arm: 0.6, life: 25, damage: 2, trigger: 2.2, blast: 4.5, knock: 9 },
  barrier: { seconds: 6 },
  fakeCrate: { life: 30, damage: 2, blast: 3.2, knock: 10 },
  mortar: { flight: 1.25, gravity: 24, damage: 1.5, blast: 3.8, minRange: 10, maxRange: 42, knock: 8 },
  deckGun: { interval: 0.085, speed: 75, life: 0.45, damage: 0.12, spread: 0.035 },
  // Max 6 s × 0.4 = 2.4 hearts: a whirlpool alone can't sink a full-health boat, it sets up the kill.
  maelstrom: { life: 6, radius: 10, pull: 14.5, swirl: 10, core: 2.6, dps: 0.4, distance: 14 },
  depthCharges: { fuse: 1.0, stagger: 0.22, damage: 1, blast: 4.2, knock: 8 },
  harpoon: { speed: 55, life: 0.7, damage: 1, pull: 38, pullTime: 0.55, stun: 0.8 },
  flail: { seconds: 5, radius: 3.0, spin: 6, damage: 1, hitCooldown: 0.9, knock: 14 },
  drone: { seconds: 10, range: 26, interval: 0.6, damage: 0.2, orbit: 4, orbitSpeed: 1.3 },
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
  skyTop: number;
  /** Also the fog colour, so distant land melts into the sky. */
  skyHorizon: number;
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
    waterShallow: 0x86ead0,
    waterDeep: 0x249a8c,
    skyTop: 0x5fb4f0,
    skyHorizon: 0xd8f1ff,
    sand: 0xead39a,
    grass: 0x84c84c,
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
    waterShallow: 0x74d9f2,
    waterDeep: 0x1a6aa6,
    skyTop: 0x4aa3e8,
    skyHorizon: 0xcfeaff,
    sand: 0xe4cf98,
    grass: 0x6db34a,
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
    waterShallow: 0x5ff0f0,
    waterDeep: 0x0d5aa8,
    skyTop: 0x3c9ef0,
    skyHorizon: 0xc8f0ff,
    sand: 0xf8e4ae,
    grass: 0x9bcf58,
    islandCount: 9,
    rockCount: 12,
    pickupCount: 14,
    decor: 'palm',
    seed: 37,
  },
};

/** Boat trim, flag, motor band, wheel hub and sailor shirt. */
export const PLAYER_COLORS = [0xff4d5e, 0x3fa9ff, 0xffc93c, 0x4cd97b, 0xb765ff, 0xff8c2e, 0xff6fb5, 0x2ad4c9];

export const BOT_NAMES = [
  'Captain Kelp', 'Barnacle Bo', 'Salty Sue', 'Admiral Nut', 'Paddles', 'Cpt. Crunch', 'Driftwood',
  'Mossy', 'Skipper', 'Coral Kid', 'Bilge Rat', 'Gully', 'Splashy', 'Old Oar', 'Shelly', 'Tiny Tide',
];
