# Nutshell Navy

Browser arena brawler on the water: steer motorised nutshell boats around a pond, lake or sea, grab floating crates for weapons, and sink as many rivals as you can in 3 minutes. Play online (quick play or private rooms with friends) or offline against bots.

Built for **CrazyGames** (HTML5 / WebGL).

## Run

```bash
npm install
npm run dev        # game: http://localhost:5173

# second terminal: the multiplayer server (only needed for online play)
cd server && npm install && npm run dev     # ws://localhost:2567

npm run build      # production build → dist/
npm run zip        # build + nutshell-navy.zip ready to upload
```

Dev-only URL params: `?autoplay=pond|lake|sea` skips the menu, `?time=30` shortens a solo match, `?quality=high|low|auto` pins graphics quality, `?room=ABCDE` joins that private room. `MATCH_SECONDS=30 npm run dev` (in `server/`) shortens online matches.

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
- **Sailors** (`Character.ts`): 8 original big-head cartoon characters: Pip the Otter, Chomp the Shark, Snips the Crab, Gus the Walrus, Inka the Octopus, Gale the Seagull, Bubba the Hippo and Hopper the Frog.
  - **Look:** an oversized head sitting right on the boat, bulging googly eyes, a wide open grin, black rubber-hose arms and white puffy gloves gripping a ship's wheel that turns as you steer. A small outboard motor at the stern drives the boat.
  - **Animation:** the wheel turns with the rudder and the arms follow the gloves; pupils dart toward the turn; the wheel jerks when hit; after a sink, the sailor hops and spins the wheel all the way round.
  - **Cost:** about 7 draw calls each. A new character is one entry in `SPECIES`, built with the `HeadKit` helpers.
- **Effects:** soft sprite particles (`Particles.ts`) for fire, smoke, splashes and debris, plus a foam wake ribbon behind every boat (`Wake.ts`).
- **Quality** (pause menu, Graphics: Auto/High/Low):
  - Auto starts high on desktop and one step lower on phones.
  - If the frame rate stays under 45 fps, it lowers the resolution and the shadow quality, and finally turns shadows off.
- **UI:** chunky outlined panels, the bundled *Lilita One* and *Fredoka* fonts, and inline SVG icons. There are no emoji because newer ones render as boxes on older Windows and ChromeOS.

## Multiplayer

The flow follows the usual kart-brawler pattern:

- **PLAY ONLINE (Quick Play):** joins a public room with free seats, or opens a new one. Matches start right away and run back to back: 3 minutes, 10 s of results, then the next map in the rotation (pond → lake → sea). You can join mid-match (with spawn protection). Bots fill every empty seat and step aside as real players arrive (8 boats per room).
- **Create Room:** a private room with a 5-letter code (no look-alike letters). The host picks the waters, the arsenal and bots on/off in the room lobby, then presses START. After each match everyone returns to the lobby. Share the code, or the **Invite link** (a CrazyGames invite link on CrazyGames, `?room=CODE` elsewhere).
- **Join Room:** type the code, or open an invite link to go straight in.
- **Practice offline:** the original solo mode against bots, no server needed.

**How it works.** The server (`server/`, [Colyseus](https://colyseus.io)) is the referee and a relay. It runs the phases and the timer, keeps score, hands out crate weapons (first come, first served), fills seats with bots and moves the host role if the host leaves. Each player's browser simulates their own boat; one player per room (the *bot host*) also simulates the bots. Boats send their position 15 times a second, and other screens draw them 110 ms in the past, blending between updates so movement looks smooth. Every shot is planned once by the shooter (aim, target, spread), sent to everyone, and replayed identically on every screen, fast-forwarded by the network delay. Each screen applies damage, knockback, stuns and pulls only to its own boats, so **what you see hit you is what hurts you**. The victim's screen then reports hits and sinkings, and the server scores them.

- **Shared code:** `shared/protocol.ts` (messages and constants, used by both sides). The server also imports `src/game/config.ts`, so weapon weights, match length and colours stay in sync.
- **Versioning:** bump `PROTOCOL_VERSION` whenever messages change. Old clients are told to refresh instead of joining with a mismatched protocol.
- **Load time:** the client's networking code (`src/net/NetSession.ts`, about 56 KB gzipped) loads only when a player first goes online.

### Deploying the server

CrazyGames serves the game over HTTPS, so the server needs a public **`wss://`** address.

1. Host it anywhere that runs a long-lived Node process with WebSockets (Fly.io, Render, Railway, a small VPS behind Caddy/nginx, or Colyseus Cloud). One small instance handles many rooms.
   - **Docker:** from the repo root, run `docker build -f server/Dockerfile -t nutshell-navy-server .`. The container listens on `PORT` (default 2567).
   - **Without Docker:** `cd server && npm ci && npm start`.
2. Put the address in `.env` as `VITE_GAME_SERVER_URL=wss://your-server.example.com`, then `npm run build` / `npm run zip`. Without it, the game connects to port 2567 on the same host it's served from, which is what you want in local development and LAN tests.
3. Testing with friends on your Wi-Fi: run `npm run dev` and the server, then open `http://<your-computer's-LAN-IP>:5173` on the other devices.

### Share a test link with friends (Cloudflare quick tunnel)

No account or deploy needed. The link lasts while these keep running, and you get a new link each time.

```bash
cd server && npm run dev                        # terminal 1: game server
npm run build && npx vite preview --port 4173   # terminal 2: the game (production build)
cloudflared tunnel --url http://localhost:4173  # terminal 3: prints https://<random>.trycloudflare.com
```

Online play goes through the same link (`/net` is forwarded to the game server, see `vite.config.ts`). Install cloudflared once with `brew install cloudflared`. Google sign-in only works on that link after you add its domain under Firebase → Authentication → Authorized domains. Guest play and email sign-in work without that.

## Project layout

```
shared/protocol.ts     messages + constants shared by game and server
server/                Colyseus server: index.ts (entry), NutshellRoom.ts (match flow, relay, scoring), state.ts
src/
  main.ts              boot: SDK init → UI → Game (+ auto-join from invite links)
  net/NetSession.ts    client connection: quick play / create / join, message wiring, ping
  sdk/crazygames.ts    SDK v3 wrapper (loading, gameplay events, ads, user, data)
  game/
    config.ts          ALL tuning: maps, weapons, speeds, match length
    Game.ts            state machine, loop, camera, lights/shadows, quality, menu showcase, scoring, online rounds
    Boat.ts            boat entity: input → physics, wave riding, HP, name tag, network poses + interpolation
    BoatModel.ts       nutshell boat (matches assets/boat-reference.png) + bubble shield
    Character.ts       big-head cartoon sailors (8 characters) and their animation
    Arena.ts           shoreline, terrain, islands, props, decor batching, collisions, land-distance field
    Water.ts           stylised water shader (foam, depth colour, sparkle)
    Sky.ts             gradient sky dome + clouds
    Wake.ts            foam wake ribbons
    waves.ts           wave function shared by GPU shader and CPU bobbing
    Models.ts          weapon, crate, drone and whirlpool models
    Combat.ts          shot planning/replay, aim assist (with lag lead), damage/blast helpers, crates, arsenal pool
    weapons/           one class per live weapon object: bullets, projectiles (torpedo, cannonball,
                       mortar, harpoon), traps (mine, fake crate, depth charge), specials (maelstrom, flail, drone)
    Bot.ts             AI: grab barrel → hunt → avoid obstacles → unstick
    Input.ts           keyboard / mouse / touch joystick
    Particles.ts       soft sprite particles (normal + glow layers)
    Audio.ts           synthesized SFX
    render/            GeoBuilder (mesh merging), procedural textures, shared materials
  ui/UI.ts             DOM menu, room lobby, join/connecting dialogs, HUD, pause, results
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

## Accounts (Firebase)

Login is **optional**. Guests play instantly with progress saved on the device. Signing in with Google or email and password adds a cloud save at `players/{uid}` in Firestore, holding the captain name, stats (wins, best sinks, matches, total sinks) and preferences (sailor, colour, map, arsenal, graphics). The first time someone signs in, their guest progress is merged into the account.

- **Code:** `src/services/firebase.ts` (lazy loader) and `src/services/Account.ts` (auth and cloud save). `src/ui/AccountPanel.ts` holds the menu button and the "Captain's Log" screen.
- **Load time:** Firebase (Auth and Firestore Lite) is loaded with dynamic imports *after* the game starts, so it adds nothing to the first load (about 90 KB gzipped, downloaded in the background).
- **Without `.env` keys** the account button is hidden and the game runs guest-only.

### One-time Firebase setup

1. Copy `.env.example` to `.env` and fill in the web app config (Project settings → Your apps).
2. **Authentication → Sign-in method:** enable **Email/Password** and **Google**. Google needs a project support email.
3. **Authentication → Settings → Authorized domains:** `localhost` is there by default. Add every domain the game is served from, such as your CrazyGames preview/game domain and any custom domain. Google sign-in fails with "unauthorized domain" otherwise.
4. **Firestore Database:** create the database, then publish the rules in `firestore.rules`. Either paste them in the console's Rules tab or run `firebase deploy --only firestore:rules`. The rules let each player read and write only their own save.
5. Optional: in Google Cloud console → APIs & Services → Credentials, restrict the browser API key to your domains.

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
- [x] Multiplayer invites: `inviteLink` for the room's invite link, `getInviteParam('roomId')` to join from an invite, the portal invite button while in a private lobby, and instant multiplayer (straight into Quick Play)

Before submitting:
- [ ] Deploy the multiplayer server and build with `VITE_GAME_SERVER_URL` set (see Deploying the server)
- [ ] Test with the CrazyGames SDK QA tool: upload `dist/` to the Developer Portal preview, which serves it in `crazygames` environment
- [ ] Add cover art (CrazyGames asks for 1920×1080, 800×450 and 800×1200 covers) and a gameplay video
- [ ] Optional: rewarded ad (`CrazyGames.rewardedAd()` is ready). For example "watch an ad to start with a weapon"

## Roadmap

1. Multiplayer polish: reconnect after a short drop (`allowReconnection`), kick idle players, and region servers if players spread worldwide.
2. Artist-made GLB boat. Swap the meshes in `BoatModel.ts` and keep the +Z-forward orientation.
3. Cosmetics and XP: unlockable hulls, sailors and flags, saved through the SDK data module.
4. More maps (river delta, frozen lake with ice floes, swamp with whirlpools).
5. Music loop.

## Credits

- Fonts: [Lilita One](https://fonts.google.com/specimen/Lilita+One) and [Fredoka](https://fonts.google.com/specimen/Fredoka), both under the SIL Open Font License 1.1. They're bundled in `src/assets/fonts/`, and the license allows them in commercial games.
