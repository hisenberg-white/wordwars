# WordWars — Implementation Plan

> A competitive multiplayer **fighting game** where typing is the controller.
> Not a typing test. Not a typing race. A fighting game.

This document is the build contract. Every phase below is written so it can be
picked up cold and executed without re-deriving decisions.

---

## STATUS — read this first

> **Any new session: start here.** Work the first unchecked box in the current
> phase. Tick boxes as they land. Do not rebuild anything already ticked.

**Current phase: Phase 1 — Foundation**

### Phase 1 — Foundation
- [ ] 1.1 Monorepo skeleton (pnpm workspaces + Turborepo, shared tsconfig/eslint/prettier)
- [ ] 1.2 `packages/shared` — socket event contract + core types
- [ ] 1.3 Server — Express + Socket.io + Zod env config + Pino logging + health check
- [ ] 1.4 Web — Vite + React + Tailwind shell with dark game theme + design tokens
- [ ] 1.5 Socket round-trip proven end to end (client connects, echoes, shows status)
- [ ] 1.6 Docker compose (Postgres + Redis) + Prisma schema v1 — *written, optional in dev*
- [ ] 1.7 CI — lint + typecheck + test

### Phase 2 — Getting Two Humans Into A Fight
- [ ] 2.1 Landing page (hero, nav, footer, ad slot)
- [ ] 2.2 Guest identity (generated names, editable, signed token)
- [ ] 2.3 Matchmaking queue + "Searching…" screen
- [ ] 2.4 Private rooms (create, code, share link, join)
- [ ] 2.5 Lobby (player cards, character select, arena preview, ready, chat, ping)
- [ ] 2.6 Host settings panel + 3-2-1-FIGHT countdown

### Phase 3 — The Game
- [ ] 3.1 `packages/engine` — combat math + unit tests (§5.2)
- [ ] 3.2 InputEngine (§4)
- [ ] 3.3 Server MatchEngine — tick loop, validation, sentence streaming, batching
- [ ] 3.4 Phaser arena scene + procedural fighters
- [ ] 3.5 FX — attacks, hits, crits, combos, ultimate cinematic, KO
- [ ] 3.6 HUD — HP bars, combo counter, ultimate meter, text band
- [ ] 3.7 Game feel — hit stop, screen shake, damage numbers
- [ ] 3.8 Audio + SFX
- [ ] 3.9 Victory/defeat screen + rematch
- [ ] 3.10 Reconnect + forfeit
- [ ] 3.11 **GATE: 20 internal playtest matches. Tune §5.2 before Phase 4.**

### Phase 4 — Progression
- [ ] 4.1 Auth + guest→user upgrade
- [ ] 4.2 Profile + stats pipeline + XP/levels
- [ ] 4.3 Achievements engine
- [ ] 4.4 Leaderboards
- [ ] 4.5 Friends + match history

### Phase 5 — Production Polish
- [ ] 5.1 Character spritesheets swapped in
- [ ] 5.2 Full arena set (weather, lighting, reactive events)
- [ ] 5.3 Admin panel
- [ ] 5.4 Ads (guarded against combat phase)
- [ ] 5.5 Settings (volumes, quality, accessibility)
- [ ] 5.6 Spectator mode
- [ ] 5.7 Best-of-3/5 rounds
- [ ] 5.8 Load test to 1000 concurrent matches
- [ ] 5.9 Docs

### Environment notes (as of setup)
- Node 24.12.0, npm 11.10.0, git 2.45.1. Windows 11.
- pnpm via `corepack enable` (no global install).
- **Docker not installed.** Compose files are written but Postgres/Redis are
  *optional in dev* — server runs in `PERSISTENCE=none` mode. Phases 2 and 3
  need no database. Install Docker Desktop before Phase 4.

---

## 0. The One Rule

Before writing any feature, answer: **does this make the match more fun to play or
to watch?** If the honest answer is "it makes typing more measurable" — cut it.

Concrete consequences of that rule, decided up front:

| Temptation | Decision |
|---|---|
| Show WPM live during combat | **No.** WPM is a post-match stat. During combat the player sees HP, combo, ultimate charge. |
| Show accuracy % live | **No.** Accuracy is expressed as *combo surviving or breaking*. |
| Big centered text box | **No.** Text is a thin band low on screen; the fighters own the frame. |
| Caret / cursor / underline styling | Minimal. The feedback is the *character on screen swinging a sword*. |
| Progress bar of sentence completion | **No.** Progress is expressed as the opponent's HP dropping. |
| Countdown timer on the match | **No.** The match ends by KO. (Sudden-death ramp instead — see §5.4.) |

A spectator with the text band cropped out must still be able to tell who is winning.
That is the acceptance test for the whole visual layer.

---

## 1. Architecture Overview

```
┌───────────────────────────────────────────────────────────────┐
│ Browser                                                       │
│                                                               │
│  React (shell, menus, HUD)      Phaser 3 (arena, fighters)    │
│         │                              ▲                      │
│         │  zustand store               │ EventBus (mitt)      │
│         └──────────┬───────────────────┘                      │
│                    │                                          │
│           InputEngine (raw keydown, NOT a React input)        │
│                    │                                          │
└────────────────────┼──────────────────────────────────────────┘
                     │ socket.io (WebSocket only, binary-ish JSON)
┌────────────────────┼──────────────────────────────────────────┐
│ Node API/Realtime (horizontally scaled, stateless per-process)│
│   ├── REST (Express)  auth, profile, leaderboard, admin       │
│   └── Realtime (Socket.io + Redis adapter)                    │
│         ├── MatchmakingService   (Redis sorted-set queue)     │
│         ├── RoomRegistry         (Redis hash + pub/sub)       │
│         └── MatchEngine          (authoritative, in-process,  │
│                                   one tick loop per match)    │
├───────────────────────────────────────────────────────────────┤
│ PostgreSQL (Prisma)        Redis (queue, rooms, presence,     │
│ durable: users, matches,          rate limits, socket adapter)│
│ stats, leaderboard                                            │
└───────────────────────────────────────────────────────────────┘
```

### 1.1 Load-bearing decisions

**D1 — Authoritative server, optimistic client animation.**
The client fires the attack animation the instant *it* detects a correct word.
The server independently validates and computes damage, then broadcasts the HP
delta. HP bars are server-driven; animations are client-predicted. This is what
makes it feel instant while staying cheat-resistant. Mispredictions (server
rejects a word) resolve as a "blocked" animation, which reads as legitimate
combat rather than a glitch.

**D2 — Match state lives in one Node process, not in Redis.**
A match is a 60Hz-ish stateful object with sub-100ms latency requirements.
Round-tripping to Redis per keystroke is wasteful. Both sockets of a match are
pinned to one process (matchmaking assigns the match to the process that will
own it; the Redis adapter routes). Redis holds only *where* a match lives.
This is the difference between "scales to thousands" and "dies at 200".

**D3 — React never re-renders on keystrokes.**
The typing engine writes to a mutable store and emits on an event bus. Phaser
reads it. React subscribes only to coarse state (HP buckets, combo tier changes,
phase transitions). A keystroke causing a React render is a bug, and there is a
dev-mode render counter to catch it.

**D4 — Deterministic seeded RNG per match.**
Crits, arena event timings, and damage variance come from a seeded PRNG whose
seed the server sends at match start. Both clients compute the same visuals
without extra packets, and the server remains the source of truth.

**D5 — Characters and arenas are cosmetic, forever.**
No stats, no unlock-to-win. This is a hard architectural boundary: the combat
engine has no access to the cosmetic layer. Enforced by module boundaries —
`packages/engine` may not import from `packages/cosmetics`.

---

## 2. Repository Layout

Monorepo: **pnpm workspaces + Turborepo**.

```
WordWars/
├─ apps/
│  ├─ web/                    # React + Vite + Tailwind + Phaser
│  │  ├─ src/
│  │  │  ├─ app/              # routing, providers, error boundaries
│  │  │  ├─ features/         # feature-sliced
│  │  │  │  ├─ landing/
│  │  │  │  ├─ matchmaking/
│  │  │  │  ├─ room/          # create, lobby, settings, chat
│  │  │  │  ├─ match/         # HUD, typing band, results
│  │  │  │  ├─ profile/
│  │  │  │  ├─ leaderboard/
│  │  │  │  └─ settings/
│  │  │  ├─ game/             # Phaser layer (see §6)
│  │  │  │  ├─ scenes/
│  │  │  │  ├─ entities/
│  │  │  │  ├─ fx/
│  │  │  │  ├─ arenas/
│  │  │  │  └─ bus.ts
│  │  │  ├─ net/              # socket client, reconnect, typed emitters
│  │  │  ├─ input/            # InputEngine
│  │  │  ├─ store/            # zustand slices
│  │  │  ├─ ui/               # design system primitives
│  │  │  └─ audio/
│  │  └─ public/
│  ├─ server/                 # Express + Socket.io
│  │  └─ src/
│  │     ├─ http/             # REST controllers, middleware
│  │     ├─ realtime/         # gateway, handlers, rooms
│  │     ├─ match/            # MatchEngine, tick loop, lifecycle
│  │     ├─ matchmaking/
│  │     ├─ services/         # user, stats, leaderboard, achievement
│  │     ├─ db/               # prisma client, repositories
│  │     ├─ redis/
│  │     └─ config/
│  └─ admin/                  # (Phase 5) React admin panel
├─ packages/
│  ├─ shared/                 # types, socket event contracts, zod schemas
│  ├─ engine/                 # PURE combat + typing logic, zero I/O
│  ├─ content/                # word banks, character/arena manifests
│  └─ config/                 # eslint, tsconfig, tailwind presets
├─ docker/
├─ docs/
└─ plan.md
```

### 2.1 Why `packages/engine` is separate and pure

The combat math runs **identically** on client (prediction) and server
(authority). It must be a pure, dependency-free, fully unit-tested module.
No `Date.now()` inside it — time is injected. No randomness — the seeded PRNG is
injected. This makes it trivially testable and makes desync bugs findable.

```ts
// packages/engine — the whole public surface
export function createMatchState(config: MatchConfig): MatchState;
export function applyWordAttempt(s: MatchState, e: WordAttempt): MatchDelta;
export function tick(s: MatchState, nowMs: number): MatchDelta;
export function isTerminal(s: MatchState): boolean;
```

---

## 3. Tech Stack (locked)

**Frontend:** React 18, TypeScript (strict), Vite, TailwindCSS, Phaser 3,
Framer Motion (UI only — never for combat FX), zustand, TanStack Query (REST),
socket.io-client, Howler (audio).

**Backend:** Node 20, Express 4, Socket.io 4, TypeScript (strict), Zod
(validation at every boundary), Prisma, Pino (logging), Vitest.

**Data:** PostgreSQL 16, Redis 7.

**Infra:** Docker + Docker Compose (dev + prod profiles), GitHub Actions CI.

**Testing:** Vitest (unit — engine at 100% branch coverage), Playwright (E2E:
two browser contexts playing a real match against each other).

---

## 4. The Typing Input Engine

This is the controller. It must feel like a fighting game input, not a form.

### 4.1 Capture

- Global `keydown` listener on `document`, attached only during `PHASE_COMBAT`.
- **No `<input>`, no `<textarea>`, no `contentEditable`.** Prevents mobile
  autocorrect, IME weirdness, browser autofill, and accidental form semantics.
  (Mobile support later adds a deliberately hidden input — a Phase 6 concern.)
- `preventDefault()` on space and backspace so the page never scrolls or navigates.
- Every keystroke stamped with `performance.now()` at capture time, before any
  processing, so latency in our own code doesn't pollute timing data.

### 4.2 Word model

Text is pre-split server-side into words. State per word: `pending | active | correct | missed`.

- Typing the correct character advances the cursor.
- Typing a wrong character marks the word **dirty** immediately (visual: the
  character flashes red, the fighter's swing aborts into a stumble).
- **Backspace is allowed** — you may repair a dirty word before the space.
  A repaired word still counts as **missed** for combo purposes but does not
  block progress. Rationale: hard-blocking is frustrating; free repair is
  cheap. Cost the combo, not the flow.
- `Space` commits the word.
  - Clean word → `correct` → **attack fires**.
  - Dirty word → `missed` → **combo resets, whiff animation**.
- Trailing sentence word commits on space or when the sentence is exhausted.
- When a sentence is finished, the server immediately streams the next one.
  **There is no "round complete" pause.** Combat is continuous.

### 4.3 Anti-cheat signals (collected, not enforced client-side)

Every commit sends: `wordIndex`, `charTimings[]` (deltas, ms), `dirty` flag.
Server rejects/flags on:
- inter-key delta < 8ms sustained (superhuman),
- zero-variance timing (bot-perfect rhythm — check stddev floor),
- word committed before the server sent that sentence,
- commit rate exceeding ~240 WPM sustained over a 10-word window.

Flagged matches are recorded but **not** instantly disconnected — false positives
on fast legitimate typists are worse than a slow ban pipeline. Store the evidence,
review async, exclude from leaderboards on high confidence.

---

## 5. Combat Design (the actual game)

### 5.1 Core loop

```
correct word ──▶ attack ──▶ damage ──▶ opponent HP down ──▶ hit reaction
     │
     └─▶ combo++ ──▶ multiplier tier up ──▶ ultimate charge up
mistyped word ──▶ whiff ──▶ combo = 0 ──▶ self stagger (visual only)
ultimate ready ──▶ next word glows ──▶ type it ──▶ cinematic ultimate
```

### 5.2 Numbers (v1 tuning — designed for ~60–90 second matches)

```
HP                      = 1000 per fighter
baseDamage(word)        = 18 + 4 * clamp(len - 3, 0, 9)      // 18..54
comboMultiplier(c)      = c <  5  -> 1.00
                          c < 10  -> 1.25
                          c < 20  -> 1.55
                          c < 35  -> 1.90
                          c >= 35 -> 2.40
tempoBonus(dt)          = clamp(1.6 - dt / 400ms, 0.85, 1.35)  // faster = harder
critChance              = 0.07 + 0.003 * combo   (cap 0.25)
critMultiplier          = 1.8
damage = round(baseDamage * comboMultiplier * tempoBonus * (crit ? 1.8 : 1))
```

**Ultimate:**
```
charge += 4 + combo * 0.35   per correct word   (cap 100)
charge -= 15                 on a miss          (floor 0)
ultimateDamage = 140 + 2.2 * combo   (crit cannot apply)
```
Ultimate consumes the charge and fires on the **next correctly typed word**,
which is rendered gold and slightly longer. No extra keybind — typing remains
the only input.

**Design intent behind these numbers:** ~25–35 successful words to KO an
opponent from full. A player on a 35+ combo with good tempo does roughly
2.5–3× the DPS of a sloppy player, which is decisive but not instant —
a comeback stays possible until roughly 200 HP.

### 5.3 Why mistakes cost combo and not HP

Self-damage on typos makes a bad player's match end faster, which is exactly
backwards — the losing player should get *more* game, not less. Combo loss is a
sharp, self-inflicted, comprehensible penalty that expresses itself as
"my damage went from 54 to 18", and it lets skill compound without punishing
learning.

### 5.4 Sudden death

If both fighters are above 400 HP at 90 seconds, a **Rage** modifier ramps in:
all damage ×1.5, ×2 at 120s. The arena visibly darkens and the music shifts.
Matches always end, and they end climactically rather than on a timer.

### 5.5 Feel details that matter more than they look like they should

- **Hit stop:** 60–90ms freeze on impact, longer (140ms) on crit and ultimate.
  This single detail is most of the difference between "web animation" and "game".
- **Screen shake:** proportional to damage, capped, and *disableable* in settings.
- **Damage numbers:** pop, arc, fade. Crits are bigger and a different color.
- **Chip vs. real damage:** HP bar has a fast red layer and a slow white "ghost"
  layer that drains behind it. Legible at a glance from across a room.
- **Anticipation on ultimate:** ~400ms of wind-up, time freeze, camera push in,
  opponent gets a visible "brace" pose. Spectators should gasp.
- **Audio ducks** during ultimates. Silence sells impact.

---

## 6. Rendering Layer

### 6.1 Split of responsibility

| Layer | Owns |
|---|---|
| Phaser canvas (z-0) | arena parallax, fighters, FX, damage numbers, camera, hit stop |
| React overlay (z-10) | HP bars, combo counter, ultimate meter, name plates, text band |
| React (full screen) | everything outside `PHASE_COMBAT` |

They communicate exclusively through the event bus (`game/bus.ts`). Phaser never
imports React; React never reaches into Phaser scene internals.

### 6.2 Phaser scenes

`BootScene` → `PreloadScene` → `ArenaScene` (+ `FXScene` on top, +
`UICameraScene` for shake-immune elements).

### 6.3 Assets — the realistic plan

Hand-drawn 10-character animation sets are not happening in the first pass, and
pretending otherwise stalls the project. Staging:

1. **Phase 3 (playable):** procedural fighters — layered geometric shapes,
   skeletal tweens, heavy particle/FX work. Deliberately stylized (think
   silhouette-and-neon), not placeholder-ugly. FX carry the impact.
2. **Phase 5:** swap in real spritesheets behind a stable `Fighter` interface.
   `entities/Fighter.ts` exposes `play(anim)`; the renderer behind it is
   swappable without touching game logic.

This ordering means the game is *fun* before it is *pretty*, which is the only
order that works.

### 6.4 Performance budget

- 60 FPS on a 2019 mid-range laptop, integrated graphics.
- Particle pools pre-allocated; zero allocation in the hot path.
- Arena parallax layers as single textures, not tilemaps.
- `will-change` and GPU compositing on the React HUD; HUD updates via direct
  style writes on refs at ≤30Hz, not React state.
- Perf HUD in dev showing FPS, draw calls, React render count.

---

## 7. Networking Contract

Transport: Socket.io, `transports: ['websocket']` only (no long-poll fallback —
it degrades combat feel to the point of not being worth supporting).

### 7.1 Events (typed in `packages/shared`)

**Client → Server**
```
guest:init          { nickname? }
mm:join             { mode }
mm:leave            {}
room:create         { settings }
room:join           { code, password? }
room:update         { settings }         // host only
room:ready          { ready }
room:chat           { text }
room:start          {}                   // host only
match:word          { matchId, wordIndex, dirty, timings[] }
match:heartbeat     { clientTime }
match:rematch       {}
```

**Server → Client**
```
room:state          { room }             // full snapshot on change
match:start         { matchId, seed, config, fighters, arena, firstSentence }
match:sentence      { index, words[] }   // streamed ahead of need
match:event         { events[] }         // batched at 30Hz — see below
match:state         { hp, combos, ults, tick }   // reconciliation, 10Hz
match:end           { winner, stats, xp }
room:error          { code, message }
```

### 7.2 Batching

`match:event` is flushed on a 33ms timer, not per-keystroke. A frantic exchange
produces ~30 packets/sec/match rather than ~600. Each event is compact:
`[type, actor, damage, flags]`. Target under 2 KB/s per client.

### 7.3 Reconnect

- Socket carries a signed `sessionToken` (guest or user).
- On disconnect the match **pauses for up to 20s** with a visible
  "Opponent reconnecting…" overlay and countdown.
- Reconnect replays a full `match:state` snapshot + current sentence.
- Timeout → the remaining player wins by forfeit; the match is recorded but
  excluded from ranked stats if the disconnect was in the first 15 seconds.

### 7.4 Latency handling

- Damage is applied on **server receipt**, using the client's reported
  inter-key timings only for the tempo bonus (clamped, so lying gains ≤35%
  and gets flagged).
- Ping shown in lobby and as a small HUD dot. Above 150ms, warn the player.
- No rollback netcode. It is not needed: neither player can interrupt the
  other's actions, so there is nothing to roll back. This is a huge
  simplification and it is worth stating explicitly so nobody "fixes" it later.

---

## 8. Data Model (Prisma sketch)

```prisma
User        id, email?, username, passwordHash?, avatar, country, xp, level,
            createdAt, lastSeenAt, isBanned, role
GuestSession id, nickname, token, createdAt, expiresAt
Match       id, mode, arenaId, roundCount, startedAt, endedAt, winnerId?,
            isRanked, flagged
MatchPlayer matchId, userId?, guestId?, characterId, hpRemaining, damageDealt,
            wordsTyped, accuracy, avgWpm, peakWpm, maxCombo, ultimatesUsed, placement
Room        id, code, hostId, settingsJson, isPublic, passwordHash?, createdAt
Character   id, slug, name, rarity, spriteManifest, isActive
Arena       id, slug, name, theme, manifest, isActive
Skin        id, characterId, slug, name, rarity
Ownership   userId, itemType, itemId, acquiredAt
Friendship  userId, friendId, status, createdAt
UserStats   userId (1:1), matches, wins, losses, draws, totalWords, totalTimeMs,
            bestCombo, bestWpm, avgAccuracy, favoriteCharacterId, favoriteArenaId
Achievement id, slug, name, description, icon, criteriaJson
UserAchievement userId, achievementId, unlockedAt, progress
Season      id, name, startsAt, endsAt
SeasonRank  seasonId, userId, mmr, tier, wins, losses
LeaderboardEntry  scope, period, userId, score, rank, computedAt
AdSlot      id, placement, html, isActive, startsAt, endsAt
Report      id, reporterId, targetId, matchId?, reason, status
```

Leaderboards are **materialized** into `LeaderboardEntry` by a cron job and
cached in Redis. Never computed live — that query will not survive scale.

---

## 9. Build Phases

Each phase ends in something runnable and demoable. No phase is "infrastructure
only" beyond Phase 1.

### Phase 1 — Foundation
*Exit: `docker compose up` gives a running app; a socket round-trip is visible.*
- pnpm workspaces, Turborepo, shared tsconfig/eslint/prettier presets.
- Vite + React + Tailwind app shell with dark game theme + design tokens.
- Express + Socket.io server, Zod-validated env config, Pino logging.
- Postgres + Redis in compose; Prisma schema v1 + first migration.
- `packages/shared` typed socket contract; both ends compile against it.
- Health checks, graceful shutdown, CI running lint + typecheck + tests.

### Phase 2 — Getting Two Humans Into A Fight
*Exit: two browsers, one click each, both land in a synced lobby and count down.*
- Landing page (hero, animated background, Play Now, nav, footer, ad slot).
- Guest identity: generated names (`RapidWolf`), editable, persisted to
  localStorage + signed server token.
- Matchmaking: Redis queue, pairing, process assignment, "Searching…" screen
  with cancel.
- Private rooms: create, code, shareable link, join, host transfer, kick.
- Lobby: player cards, character select, arena preview, ready-up, chat, ping,
  full host settings panel, 3-2-1-FIGHT countdown.

### Phase 3 — The Game
*Exit: a full match is playable end to end and is actually fun. Playtest gate.*
- `packages/engine`: combat math, fully unit tested against §5.2.
- InputEngine per §4.
- Server MatchEngine: tick loop, validation, sentence streaming, batching,
  terminal detection.
- Phaser arena scene, procedural fighters, full FX set: attacks, hits, crits,
  combos, ultimate cinematic, KO.
- HUD: HP bars w/ ghost layer, combo counter, ultimate meter, text band.
- Hit stop, screen shake, damage numbers, audio + SFX.
- Victory / defeat screen with match stats and rematch.
- Reconnect + forfeit handling.
- **Gate: play 20 matches internally. If it isn't fun, tune §5.2 before Phase 4.**

### Phase 4 — Progression
*Exit: registered users have a reason to come back tomorrow.*
- Auth (email+password, argon2, JWT access + refresh), guest→user upgrade that
  preserves the just-finished match.
- Post-match "Save your progress" prompt.
- Profile, stats aggregation pipeline, XP/levels.
- Achievements engine (event-driven, evaluated server-side on match end).
- Leaderboards: global / country / weekly / monthly / season / friends.
- Friends, match history.

### Phase 5 — Production Polish
*Exit: shippable.*
- Real character spritesheets swapped in behind the `Fighter` interface.
- Full arena set with weather, lighting, combat-reactive events.
- Admin panel: users, content, ads, reports, announcements.
- AdSense integration (outside gameplay only — enforced by a render guard that
  refuses to mount ad components while `phase === COMBAT`).
- Settings: volumes, typing sounds, graphics quality tiers, reduced motion,
  colorblind palettes, FPS counter, language.
- Spectator mode.
- Best-of-3/5 round flow.
- Load test to 1000 concurrent matches; optimize.
- Docs: README, architecture, DB diagram, socket events, REST API, deployment,
  Docker, developer guide.

### Phase 6+ — Expansion (architected for, not built)
2v2 / 4v4 / FFA / 1v4 boss, tournaments, ranked MMR, training mode vs. bots,
clans, mobile layout, Electron, Steam.

---

## 10. Testing Strategy

- **Engine:** exhaustive unit tests. Combo tiers, crit boundaries, ultimate
  charge/consume, terminal conditions, damage rounding. 100% branch coverage —
  this is the one place that non-negotiably deserves it.
- **Determinism test:** same seed + same input log → identical state on client
  and server. This catches desync before players do.
- **Socket contract:** integration tests booting a real server + two clients.
- **E2E:** Playwright drives two browser contexts through matchmaking into a
  real match to KO.
- **Perf regression:** headless FPS measurement in CI on a scripted match.
- **Load:** artillery/k6 script simulating N concurrent matches with realistic
  keystroke cadence.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| It ends up feeling like a typing test with decoration | Phase 3 playtest gate; §0 rules enforced in review |
| Art scope stalls the project | Procedural fighters first, sprites swapped later behind an interface |
| React rerenders tank framerate | Event-bus architecture + dev render counter + CI perf test |
| Matches desync between clients | Pure engine + seeded RNG + determinism test |
| Fast legitimate typists get flagged as cheaters | Flag-and-review, never auto-disconnect |
| Redis becomes the match bottleneck | Match state stays in-process (D2); Redis is discovery only |
| Leaderboard queries melt under load | Materialized + Redis-cached, never live |

---

## 12. Definition of Done for v1

- Two strangers can go from opening the URL to a finished KO in under 30 seconds,
  with no signup.
- A spectator who cannot see the text can tell who is winning.
- 60 FPS on mid-range hardware.
- The server never trusts a client-reported damage number.
- A disconnect does not ruin the match.
- Someone plays a fifth match without being asked to.

That last one is the real test.
```
