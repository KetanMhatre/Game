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

Dev-only URL params: `?autoplay=pond|lake|sea` skips the menu, `?time=30` shortens the match.

## Tech stack (and why)

| Piece | Choice | Why |
|---|---|---|
| Rendering | **Three.js** (WebGL) | Small, fast, works on low-end laptops and phones; ~143 KB gzipped total build |
| Language / build | **TypeScript + Vite** | Fast dev loop, relative-path build (`base: './'`) required by CrazyGames |
| Art | Procedural low-poly meshes, flat shading | Zero model/texture downloads → near-instant load (CrazyGames ranks on load time) |
| Audio | WebAudio-synthesized SFX | No audio files; respects SDK mute + ad muting |
| Physics | Custom 2D circle physics on the water plane | Arcade boat feel, no physics-engine weight |
| Portal | **CrazyGames SDK v3** wrapper (`src/sdk/crazygames.ts`) | No-ops outside CrazyGames, so the same build runs anywhere |

## Project layout

```
src/
  main.ts              boot: SDK init → UI → Game
  sdk/crazygames.ts    SDK v3 wrapper (loading, gameplay events, ads, user, data)
  game/
    config.ts          ALL tuning: maps, weapons, speeds, match length
    Game.ts            state machine, loop, camera, scoring, collisions
    Boat.ts            boat entity: input → physics, wave riding, HP
    BoatModel.ts       procedural nutshell boat (matches assets/boat-reference.png)
    Arena.ts           shoreline, terrain, islands, rocks, decor, collision queries
    Water.ts           low-poly animated water shader
    waves.ts           wave function shared by GPU shader and CPU bobbing
    Combat.ts          projectiles, mines, tidal splash, pickup barrels
    Bot.ts             AI: grab barrel → hunt → avoid obstacles → unstick
    Input.ts           keyboard / mouse / touch joystick
    Particles.ts       single InstancedMesh particle system
    Audio.ts           synthesized SFX
  ui/UI.ts             DOM menu, HUD, pause, results
```

## Weapons

| | Weapon | Effect |
|---|---|---|
| 🥥 | Coconut Cannon | 3 shots forward, light aim assist |
| 🐡 | Puffer Torpedo | Homing, 2 damage |
| 🦔 | Urchin Mine | Drop behind you, 2 damage blast |
| 🌊 | Tidal Splash | Shockwave around you, knocks boats back |
| 🫧 | Bubble Shield | 6 s invulnerability |
| 💨 | Turbo Paddle | Speed burst, ramming deals damage |

Boats have 3 hearts. Sink = +1 point. Respawn after 3 s with 2 s of spawn protection.

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
5. Music loop and an optional quality toggle (pixel ratio and particle count) for low-end devices.
