# Nutshell Navy

Browser arena brawler on the water: paddle nutshell boats around a pond, lake or sea, grab floating barrels for weapons, and sink as many rivals as you can in 3 minutes.

Built for **CrazyGames** (HTML5 / WebGL).

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build → dist/
npm run zip        # build + nutshell-navy.zip ready to upload
```

Dev-only URL params: `?autoplay=pond|lake|sea` skips the menu, `?time=30` shortens the match, `?quality=high|low|auto` pins graphics quality.

## Tech stack (and why)

| Piece | Choice | Why |
|---|---|---|
| Rendering | **Three.js** (WebGL) | Small, fast, works on low-end laptops and phones; ~215 KB gzipped total build including fonts |
| Language / build | **TypeScript + Vite** | Fast dev loop, relative-path build (`base: './'`) required by CrazyGames |
| Art | Procedural stylised meshes + canvas-drawn textures | Zero model/image downloads → near-instant load (CrazyGames ranks on load time) |
| Audio | WebAudio-synthesized SFX | No audio files; respects SDK mute + ad muting |
| Physics | Custom 2D circle physics on the water plane | Arcade boat feel, no physics-engine weight |
| Portal | **CrazyGames SDK v3** wrapper (`src/sdk/crazygames.ts`) | No-ops outside CrazyGames, so the same build runs anywhere |

## Graphics

- **Look:** stylised and soft. Smooth shading, a gradient sky with puffy clouds, soft sun shadows that follow the player, and tone mapping that keeps colours bright.
- **Water** (`Water.ts`):
  - Waves have smooth normals computed from the wave function itself.
  - Colour shifts from shallow to deep using a *land-distance field* that each arena builds once per map.
  - Foam lines animate at every shore, island, rock and dock post.
  - Ripples sparkle, the sky reflects at low angles, and the sea map adds crest foam.
- **Static scenery** is merged into a few vertex-coloured meshes per map section (`render/GeoBuilder.ts`), so a whole map costs about 75 draw calls.
- **Sailors** (`Character.ts`): 8 animal species, each about 6 draw calls. They paddle with a kayak paddle, lean into turns, blink, wobble when hit and cheer after a sink.
- **Effects:** soft sprite particles (`Particles.ts`) for fire, smoke, splashes and debris, plus a foam wake ribbon behind every boat (`Wake.ts`).
- **Quality** (pause menu, Graphics: Auto/High/Low):
  - Auto starts high on desktop and one step lower on phones.
  - If the frame rate stays under 45 fps, it lowers the resolution and the shadow quality, and finally turns shadows off.
- **UI:** chunky outlined panels, the bundled *Lilita One* and *Fredoka* fonts, and inline SVG icons. There are no emoji because newer ones render as boxes on older Windows and ChromeOS.

## Project layout

```
src/
  main.ts              boot: SDK init → UI → Game
  sdk/crazygames.ts    SDK v3 wrapper (loading, gameplay events, ads, user, data)
  game/
    config.ts          ALL tuning: maps, weapons, speeds, match length
    Game.ts            state machine, loop, camera, lights/shadows, quality, menu showcase, scoring
    Boat.ts            boat entity: input → physics, wave riding, HP, name tag
    BoatModel.ts       nutshell boat (matches assets/boat-reference.png) + bubble shield
    Character.ts       animal sailors (8 species) and their animation
    Arena.ts           shoreline, terrain, islands, props, decor batching, collisions, land-distance field
    Water.ts           stylised water shader (foam, depth colour, sparkle)
    Sky.ts             gradient sky dome + clouds
    Wake.ts            foam wake ribbons
    waves.ts           wave function shared by GPU shader and CPU bobbing
    Models.ts          weapon, crate, drone and whirlpool models
    Combat.ts          weapon dispatch, aim assist, damage/blast helpers, crates, arsenal pool
    weapons/           one class per live weapon object: bullets, projectiles (torpedo, cannonball,
                       mortar, harpoon), traps (mine, fake crate, depth charge), specials (maelstrom, flail, drone)
    Bot.ts             AI: grab barrel → hunt → avoid obstacles → unstick
    Input.ts           keyboard / mouse / touch joystick
    Particles.ts       soft sprite particles (normal + glow layers)
    Audio.ts           synthesized SFX
    render/            GeoBuilder (mesh merging), procedural textures, shared materials
  ui/UI.ts             DOM menu, HUD, pause, results
  ui/icons.ts          SVG icon set
  assets/fonts/        Lilita One + Fredoka (SIL Open Font License)
```

## Weapons

Weapons come from floating "?" crates. Players can choose which weapons crates may roll on the **Arsenal** screen (menu → Arsenal), using All ON, All OFF and Randomize.

| Weapon | Effect | Damage |
|---|---|---|
| Torpedoes | 2 fast torpedoes per shot, gently homing (2 shots) | 1 each |
| Broadside Cannon | Cannonballs arc out of **both sides**, aim-assisted at rivals alongside (3 volleys) | 1 |
| Naval Mines | Horned mine with blinking beacon, dropped behind. Arms after 0.6 s. Safe for its owner for 1.5 s (2 mines) | 2 |
| Hydro-Barrier | Hexagon bubble: blocks damage, knockback and hooks for 6 s | – |
| Fake Crate | Looks like a pickup (tell: pink "?" with a dark-red outline). Explodes on whoever grabs it. Gullible bots fall for it | 2 |
| Sea Mortar | High-arc shell onto the nearest rival ahead, with a red landing marker (2 shells) | 1.5 area |
| Deck Gun | Hold fire: 30 tracer rounds from a spinning gatling | 0.12 per bullet |
| Maelstrom | Whirlpool that pulls rivals in, spins them and drains health in its core for 6 s | up to 2.4 |
| Depth Charges | 3 charges sink behind you, then erupt as geysers | 1 each |
| Harpoon Hook | Spears a rival, yanks them toward you and stuns their controls for 0.8 s (2 shots) | 1 |
| Sea Flail | Spiked ball on a chain spins around your boat for 5 s | 1 per hit |
| Patrol Drone | Mini gunboat circles you for 10 s, shooting rivals within 26 units | 0.2 per bullet |

Boats have 3 hearts. Fractional damage drains the bar smoothly. Sink = +1 point. Respawn after 3 s with 2 s of spawn protection. The held weapon shows on the boat: a gatling, harpoon launcher, mortar tube, side cannons or torpedo tubes, otherwise a small bow cannon. All numbers are in `WEAPON_TUNING` in `src/game/config.ts`.

## CrazyGames integration checklist

Already done:
- [x] SDK v3 script tag in `index.html`, `CrazyGames.init()` on boot
- [x] `loadingStart` / `loadingStop` around boot
- [x] `gameplayStart` when a match starts or resumes, `gameplayStop` on pause, match end and menu
- [x] `happytime()` when the player wins a match
- [x] Midgame ad between matches (Play again / Change waters), with game paused and audio muted during the ad
- [x] Respects the portal's `muteAudio` setting
- [x] Uses the CrazyGames username when the player is logged in
- [x] Saves progress through the SDK data module (falls back to localStorage)
- [x] Relative asset paths, no external links, keyboard and touch controls
- [x] Arrow keys and Space don't scroll the iframe

Before submitting:
- [ ] Test with the CrazyGames SDK QA tool: upload `dist/` to the Developer Portal preview, which serves it in `crazygames` environment
- [ ] Add cover art (CrazyGames asks for 1920×1080, 800×450 and 800×1200 covers) and a gameplay video
- [ ] Optional: rewarded ad (`CrazyGames.rewardedAd()` is ready). For example "watch an ad to start with a weapon"

## Roadmap

1. **Online multiplayer**: [Colyseus](https://colyseus.io) (Node) authoritative server, with rooms of 8 and bots filling empty slots. Boats are already driven only through a plain `BoatInput` object (`Boat.ts`), so clients send inputs and the server runs the same `Boat`/`Combat` simulation. Use CrazyGames `inviteLink` / instant multiplayer for party invites.
2. Artist-made GLB boat. Swap the meshes in `BoatModel.ts` and keep the +Z-forward orientation.
3. Cosmetics and XP: unlockable hulls, sailors and flags, saved through the SDK data module.
4. More maps (river delta, frozen lake with ice floes, swamp with whirlpools).
5. Music loop.

## Credits

- Fonts: [Lilita One](https://fonts.google.com/specimen/Lilita+One) and [Fredoka](https://fonts.google.com/specimen/Fredoka), both under the SIL Open Font License 1.1. They're bundled in `src/assets/fonts/`, and the license allows them in commercial games.
