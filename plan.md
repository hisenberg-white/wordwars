# WordWars — Implementation Plan

> A competitive multiplayer **fighting game** where typing is the controller.
> Not a typing test. Not a typing race. A fighting game.

This document is the build contract. Every phase below is written so it can be
picked up cold and executed without re-deriving decisions.

---

## STATUS — read this first

> **Any new session: start here.** Work the first unchecked box in the current
> phase. Tick boxes as they land. Do not rebuild anything already ticked.

**Current phase: Phase 3 — The Game.** 3.1–3.10 complete; 3.11 gate PARTIALLY met.

> Phase 3 is the point of the whole project. Everything so far exists to deliver
> two players into a countdown; 3.1–3.11 is the fight. Re-read §0 (The One Rule)
> and §5 (Combat Design) before starting 3.1 — the numbers there are the design,
> not placeholders.

Quick start:

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm dev                 # server :4000, web :5173
pnpm lint && pnpm typecheck && pnpm test
```

### Phase 1 — Foundation

- [x] 1.1 Monorepo skeleton (pnpm workspaces + Turborepo, shared tsconfig/eslint/prettier)
      → root `package.json` (ESM), `pnpm-workspace.yaml`, `turbo.json`,
      `packages/config` (eslint flat config + 3 tsconfigs), prettier, git init.
      `exactOptionalPropertyTypes` is ON everywhere except React (noise > signal there).
- [x] 1.2 `packages/shared` — socket event contract + core types
      → branded IDs; `domain/{player,content,combat,match,room}`;
      `net/{payloads,errors,contract}`. Zod schemas are the source of truth for
      every inbound payload — TS types are `z.infer`'d so they cannot drift.
      Consumed as TS source (no build step). Typecheck + lint clean.
      → NOTE: wire compaction of `CombatEvent` (plan §7.2 tuple encoding) is
      deferred to 3.3, where it can be measured instead of guessed. It slots in
      behind a codec at one boundary; no call sites change.
- [x] 1.3 Server — Express + Socket.io + Zod env config + Pino logging + health check
      → `apps/server`: env validated at boot (fails loudly), pino (pretty in dev),
      express + helmet + cors, `/health` (liveness) and `/health/ready` (readiness,
      kept separate on purpose), typed Socket.io gateway, `validated()` wrapper so
      no handler can skip Zod, per-socket token-bucket rate limiting applied as a
      catch-all, graceful shutdown. Build via tsup (bundles shared). 6 tests pass.
      → Every socket is assigned a provisional identity in `io.use()` before any
      handler runs, so `SocketData` is never partially populated. Real guest
      naming + token reclamation replaces it in 2.2.
      → `PERSISTENCE=none` is the documented no-Docker dev mode.
- [x] 1.4 Web — Vite + React + Tailwind shell with dark game theme + design tokens
      → `apps/web`: Vite 6, React 19, Tailwind v4 (CSS-first `@theme`), react-router,
      self-hosted fonts (no CDN). `ui/` primitives: Button, Panel, Wordmark,
      Backdrop, cn. Landing + 404 shells. Typecheck, lint, build all clean.
      → **Design system decided here — everything downstream inherits it:**
      the palette is built on the 1v1 RIVALRY. `--color-p1` crimson = you,
      `--color-p2` cyan = them. Gold (`--color-ultimate`) is reserved for the
      Ultimate and must never be used as a generic highlight. Angular
      `clip-path` panels, not rounded corners — that one shape choice is what
      separates "game" from "web app".
      → Fonts: Chakra Petch (display/esports), Inter (reading), JetBrains Mono
      (reserved for the typing band — fixed advance width stops reflow as the
      player types).
      → NOTE: React 19 rather than the plan's React 18 — current stable, and the
      ref-as-prop change removes forwardRef boilerplate across `ui/`.
      → NOT visually verified — no browser tooling in that session. Compilation of
      `@theme` into real utilities was asserted by grepping the built CSS.
      **Someone should eyeball this in a browser before Phase 2 styling builds on it.**
- [x] 1.5 Socket round-trip proven end to end (client connects, echoes, shows status)
      → `web/src/net/ConnectionManager.ts` — plain class OUTSIDE React, exposed via
      `useSyncExternalStore`. This is the reference implementation of D3: network
      data lands in mutable state, only coarse changes reach React. Phase 3's
      keystroke path follows this exact shape, so it isn't invented under pressure.
      → Built on the heartbeat rather than an echo: gives ping AND the NTP-style
      clock offset. `connection.serverNow()` is what the match countdown will use —
      two players' machine clocks differ by seconds, so a raw `Date.now()`
      countdown would visibly start the fight at different moments per screen.
      → Ping is a MEDIAN of the last 5 samples; one stalled packet shouldn't make a
      healthy connection look bad for 15s. Colour-coded <60 / <150 / above.
      → 7 gateway integration tests (real HTTP server, real gateway, real WebSocket,
      no mocks) covering identity assignment, heartbeat, malformed-payload
      rejection, and rate limiting. 13 tests total, all green.
      → Verified: server + web run together; polling handshake correctly 400s,
      confirming websocket-only enforcement.
      → STILL UNVERIFIED IN A BROWSER (no browser tooling): the React wiring of
      ConnectionBadge. Server half is proven by tests.
- [x] 1.6 Docker compose (Postgres + Redis) + Prisma schema v1 — _written, optional in dev_
      → `docker/docker-compose.yml`: Postgres 16 + Redis 7 only. The app runs on the
      host via `pnpm dev` — a bind-mounted Node container has slow file watching
      and worse debugging on Windows/macOS.
      → Redis persistence deliberately DISABLED (`--save '' --appendonly no`): it
      holds queues/presence/adapter state, all reconstructible. An fsync stall
      would add latency to matchmaking; losing it on restart costs one re-queue.
      → Postgres locale pinned to C so `ORDER BY` on names matches across machines.
      → `apps/server/prisma/schema.prisma` — 18 models. Two rules drive it:
      (1) a guest is a first-class player — `MatchPlayer` has optional userId AND
      guestId with denormalised nickname/characterSlug, so a guest's match history
      survives them and is claimable on registration via `GuestSession.claimedByUserId`;
      (2) read-heavy data is denormalised — `UserStats` makes a profile one row read,
      `LeaderboardEntry` is materialised, NOT a view over MatchPlayer (that query
      gets slower exactly as the game gets more popular).
      → Accuracy stored as basis points (int), not float — exact aggregation.
      → `prisma validate` passes. `@prisma/client` deliberately NOT yet a dependency;
      added in Phase 4 when something actually queries.
      → DEFERRED: app Dockerfiles + prod compose profile → Phase 5.9 with the
      deployment guide. Maintaining them through 4 phases of churn buys nothing now.
- [x] 1.7 CI — lint + typecheck + test
      → `.github/workflows/ci.yml`: format:check → lint → typecheck → test → build →
      prisma validate. Concurrency group cancels superseded runs. pnpm version comes
      from `packageManager` so CI and local can't drift.
      → Whole sequence was executed locally and passes end to end.
      → `.prettierignore` excludes `*.prisma` (Prisma has its own formatter and the
      two fight); repo formatted with `pnpm format`.

**→ PHASE 1 COMPLETE. Next session starts at 2.1.**
Before building on it, someone with a browser should run `pnpm dev` and eyeball
http://localhost:5173 — the design system (1.4) and ConnectionBadge (1.5) are
compile-verified and test-verified but never actually looked at.

### Phase 2 — Getting Two Humans Into A Fight

- [x] 2.1 Landing page (hero, nav, footer, ad slot)
      → `features/landing/`: TopNav (sticky, blurred), Hero, CombatPrimer,
      RosterPreview, SiteFooter. Roster/arena lists are driven from
      `@wordwars/shared` (`CHARACTERS` / `ARENAS` metadata added there), so adding
      a fighter is a one-line catalogue change.
      → **Hero is a VS standoff, not a SaaS hero.** Two angular portrait frames facing
      inward with a giant VS between them — the layout states the premise before
      anyone reads a word. Silhouettes are inline SVG, stylised rather than grey
      boxes, so the page looks finished long before real sprites exist (3.4/5.1).
      → Copy is written as CONSEQUENCES, not features ("Every word is a strike", not
      "real-time typing engine"). Roster section says outright that fighters have
      identical stats — players should never wonder if a character is a
      competitive choice.
      → **`AdSlot` enforces "no ads during combat" structurally**, not by convention:
      it reads `store/appPhase` and returns null while `phase === 'combat'`. A
      future screen cannot accidentally opt in. 8 tests lock this, including the
      case a static check would miss — an ad already on screen when a fight starts.
      → `store/createStore.ts` — tiny external store + `useStore`, same shape as
      ConnectionManager so UI state and network state share one idea of where
      state lives. Swapping in zustand later leaves call sites unchanged.
      → Unbuilt destinations render `ComingSoonScreen` naming the plan step that
      replaces them (see `app/routes.tsx`), rather than disabled buttons that make
      a front page feel dead. An unreplaced placeholder is self-documenting debt.
      → Web test harness set up (vitest + jsdom + testing-library). 21 tests total
      across the repo, all green; full CI sequence passes; all routes serve 200.
      → STILL NOT VISUALLY VERIFIED — no browser tooling. Structure and behaviour are
      tested; appearance is not.
- [x] 2.2 Guest identity (generated names, editable, signed token)
      → **Tokens are stateless HMAC-signed, not server-side sessions.** A guest must
      survive a refresh, a server restart, AND being routed to a different process.
      A session store would need sticky routing or a Redis lookup per connect —
      and Redis is optional until Phase 4. One HMAC buys all three properties.
      Payload = {playerId, nickname, expiresAt}; signature verified with
      `timingSafeEqual`. Every failure mode returns the same `null` (telling an
      attacker _which_ half of their guess was wrong gains them information and
      gains us nothing — client recovery is identical either way).
      → It IS a bearer credential: whoever holds it is that guest. Correct trade for
      a throwaway identity with no purchases attached, and the reason 4.1 gets real
      auth rather than an extension of this.
      → `guest:init` does establish / restore / rename in ONE event — they're the same
      operation with different inputs, and collapsing them removes a race where a
      client renames before its identity exists. Always reissues the token, since
      the nickname is inside the signed payload.
      → An invalid or expired token silently issues a fresh identity rather than
      erroring. Coming back after a fortnight should feel like a normal visit.
      → **Guest names are deliberately NOT unique.** Enforcing it would put a shared
      registry on the matchmaking hot path and produce `RapidWolf_4817` fallbacks,
      to solve a problem that barely exists — two guests only meet inside one match.
      Registered usernames stay unique; that constraint lives on the User table.
      → `validateNickname` lives in shared, so client-side instant feedback and
      server-side enforcement can never disagree. RESERVED_NICKNAMES blocks
      impersonation only (admin/mod/system) — normalised for case AND separators,
      so `A_d_m_i_n` is caught. Not a profanity filter; that's a moderation
      problem with a moderation solution (Report table already exists).
      → Names generated with `crypto.randomInt`, not `Math.random()` — a fleet
      restarting together would otherwise hand out correlated names.
      → Client: `IdentityManager` (same external-store pattern as ConnectionManager),
      localStorage persistence, re-announces on EVERY connect (a reconnect after a
      server restart lands on a process that never heard of this player). Storage
      failures are non-fatal — private browsing still gets you a fight.
      → `IdentityChip` in nav is click-to-edit; the dialog waits for server
      confirmation before closing, so a rejected name shows the reason instead of
      silently reverting.
      → 52 tests total. Live end-to-end verified against the real server process:
      generated → renamed → survived reconnect on a NEW socket with the same
      playerId → reserved name rejected.
- [x] 2.3 Matchmaking queue + "Searching…" screen
      → `MatchmakingService` knows NOTHING about sockets — takes entries, hands back
      pairings via callback. The failure modes here (player queued twice, paired
      player left in queue, pairing with self) produce ghost matches rather than
      crashes, so they need unit tests without a network. 11 tests.
      → **Pairing is strict FIFO, no skill matching.** With guests there is no skill
      signal to match on — rating needs accounts + history (Phase 4). FIFO also
      gives the fairest waits, which matters far more than match quality while the
      player base is small.
      → `RoomRegistry` built here (matchmaking must put the pair somewhere); 2.4 adds
      private-room features on top. Host = first to join; on host leave it passes to
      the longest-present member (arbitrary but STABLE — everyone computes the same
      answer with no negotiation round). Empty rooms self-destruct so codes aren't
      held hostage. Internal `LiveRoom` ≠ wire `RoomState`, so a password hash
      cannot leak by someone adding a field to a shared interface.
      → **Room codes exclude I/L/O/S/0/1/5/8.** Codes get read aloud and typed from
      screenshots; every look-alike is a friend who fails to join. 28^6 ≈ 482M is
      still ample. Test asserts no look-alike is ever emitted.
      → Pairing lives in the gateway, not the handler — it needs BOTH sockets, and a
      per-socket handler only ever has one.
      → Disconnect cleanup on both queue AND room. If a player vanishes between
      queueing and pairing, the survivor is REQUEUED rather than dropped into a
      room with a ghost.
      → Searching screen shows a real elapsed counter (a moving number reads as
      progress; a spinner reads as broken after ~4s) and rotates combat tips, so a
      first-timer learns accuracy-beats-speed BEFORE losing a match to it.
      Elapsed time ticks in the COMPONENT, not the store — a 1Hz counter must not
      re-render every matchmaking subscriber.
      → `OpponentFound` VS reveal: naming the opponent turns an anonymous queue into
      a person to beat.
      → 79 tests. Live-verified: two clients queued → same room → each told about
      the other.
      → **OPEN PRODUCT QUESTION:** with no players online, a real user waits forever.
      Needs bots or a training fallback before any public launch. Flagged, not
      solved — it's a product decision, not a technical one.
- [x] 2.4 Private rooms (create, code, share link, join)
      → `room:create` / `room:join` / `room:leave`; client `RoomManager`,
      `RoomEntryScreen` (create + join side by side, no tab — a player is either
      hosting or invited, and making either click a tab first buys nothing),
      `RoomScreen` at `/room/:code`, `InviteLink`.
      → Invite offers BOTH code and link: the link is what you paste in a group
      chat, the code is what you read aloud to someone next to you. Forcing one
      breaks half the ways friends actually get into a room.
      → **Password is verified BEFORE detaching the player from their current room** —
      a wrong guess must not cost you the seat you already had. Integration test
      covers exactly this.
      → Joining while already in a room MOVES you rather than erroring; clicking a
      friend's link from inside another room should work, not dead-end.
      → Rejoining your own room is a no-op (a refresh on an invite link lands there).
      → **SECURITY BUG FOUND AND FIXED BY A TEST:** `Buffer.from('zz','hex')` returns
      an EMPTY buffer rather than throwing. A malformed stored hash therefore
      decoded to zero length, scrypt was asked for a zero-length key, and
      `timingSafeEqual(<empty>,<empty>)` returned TRUE — a stored value that
      accepts EVERY password. Fixed with a strict hex + non-empty guard;
      8 malformed-input cases now locked down.
      → Room passwords use node's built-in scrypt, NOT argon2: a room password is a
      short-lived secret shared deliberately with friends, not an account
      credential, and adding a native module complicates every install and Docker
      image. Real user auth (4.1) gets argon2id and must not reuse this.
      → **TYPECHECK CAUGHT WHAT TESTS COULD NOT:** socket.io-client does not infer
      `Ack<T>` through `emitWithAck`, so those results were `any` — every
      assertion on them was silently unchecked. Added a typed `joinRoom` helper to
      restore real coverage. Worth remembering when adding socket tests.
      → 107 tests. Live-verified 11 checks end to end: create, join by code,
      host notified, room-full refusal, spectator past the cap, hasPassword
      reporting, and all three password paths.
- [x] 2.5 Lobby (player cards, character select, arena preview, ready, chat, ping)
      → Server: `room:character` / `room:ready` / `room:chat` / `room:kick`, system
      chat messages on join/leave/kick, `RoomRegistry.canStart()`.
      → Client `features/room/lobby/`: ArenaBanner, PlayerCard + EmptySlot,
      CharacterPicker, LobbyChat, LobbyScreen. `game/arenaTheme.ts` gives every
      arena a colour identity — placeholder art, but the REAL art should match
      these, not the reverse: picking "Volcano" from an orange lobby must not
      land you somewhere blue.
      → **Laid out as a versus screen, not a settings form.** Arena banner on top,
      fighters facing each other with VS between, roster below. A glance should
      show a fight about to happen.
      → **Ping broadcasts are throttled by a 25ms threshold** (`setPing` returns
      whether it's worth telling anyone). Pings jitter constantly; broadcasting
      every sample would push a full room snapshot to every client several times
      a second to move a number nobody watches that closely.
      → Chat is delivered VERBATIM — no server-side escaping. React renders it as
      text, so escaping server-side would only mangle legitimate messages
      containing `<` or `&`. A test pins this so nobody "fixes" it later.
      → Chat auto-scrolls only when already pinned to the bottom; yanking someone
      back down while they're reading is a small betrayal every chat gets wrong once.
      → Client chat history capped at 100 — unbounded array in a long-lived lobby
      is a slow leak.
      → Spectators can't ready up and are excluded from `canStart`, so they can
      never hold a match hostage. Invite panel hides once the room is full.
      → **TEST RACE FOUND AND FIXED:** `once('room:state')` captured in-flight
      snapshots from the previous action. Replaced with predicate-based
      `waitForState` — necessary now that ping updates also trigger broadcasts,
      and it would only have got flakier. Use the predicate form for all future
      room-state tests.
      → 123 tests. Live-verified 9 checks with three clients: create, join
      announcement, character broadcast, both-ready, verbatim chat, spectator
      seating, spectator ready ignored, non-host kick refused, host kick works.
- [x] 2.6 Host settings panel + 3-2-1-FIGHT countdown
      → **CONTRACT CHANGE: `RoomState.countdown` → `countdownEndsAt` (absolute server
      timestamp).** Ticking a counter server-side would mean a broadcast per second
      — jittery, wasteful, and still WRONG, because the number would land at
      different moments on each screen. Sending the deadline once and animating
      client-side against `connection.serverNow()` (the clock offset from 1.5) means
      both players see "3" at the same instant. Server broadcasts exactly twice:
      countdown start, and match begin.
      → `CountdownOverlay` animates on rAF, scaling each number down as its second
      elapses so it lands with impact rather than appearing like a clock.
      → **Countdown aborts whenever the room stops being startable** — un-ready,
      leave, or disconnect. Without this the timer still fires and the survivor is
      dropped into a fight against nobody. Three tests + a live check that no ghost
      `in-match` transition follows an abort.
      → **Changing settings un-readies everyone.** Otherwise a host readies the room
      under one ruleset, silently swaps it, and starts — "ready" has to mean "ready
      for THESE rules".
      → Random arena is resolved BEFORE the count, so both clients are told the same
      stage rather than each rolling their own.
      → **Quick match skips the lobby entirely** — server auto-starts the countdown
      1.8s after pairing (enough for the opponent reveal to land). Both players
      already committed by pressing Play Now; a ready-up against a stranger they
      can't talk to only invites someone to leave.
      → **TYPE BUG CAUGHT BY typecheck:** spreading a Zod `.partial()` patch would let
      a key present-but-undefined blank a real setting (arena, round count). Fixed
      with `definedOnly` + a `DefinedPartial<T>` mapped type — `Partial<T>` is NOT
      enough under `exactOptionalPropertyTypes`, since its values keep `| undefined`.
      → `RealtimeContext.onMatchBegin` is **the seam Phase 3 plugs into** — fires the
      instant the count hits zero. 3.3 replaces the no-op with MatchEngine
      construction. Nothing before it needs to change.
      → 134 tests. Live-verified 11 checks: settings broadcast, partial update
      preserving other fields, un-ready on rules change, absolute deadline
      (2999ms out), match begins at 3019ms, abort on leave, no ghost match,
      quick-match auto-countdown reaching the fight.

**→ PHASE 2 COMPLETE. Next session starts at 3.1 (`packages/engine`).**
Two humans can now go from the landing page to the start of a fight, by
matchmaking or by invite link. Phase 3 builds the fight itself.

### Phase 3 — The Game

- [x] 3.1 `packages/engine` — combat math + unit tests (§5.2)
      → Pure, deterministic, zero runtime deps (`@wordwars/shared` is a devDep —
      types only, erased at build). ESLint rules BAN `Date.now()` and
      `Math.random()` inside the package: those are the two ways determinism
      quietly stops being true, and a desync is far harder to notice than a
      failed lint.
      → **90 tests, 100% coverage — statements, branches, functions, lines.**
      → **TWO PLAN NUMBERS WERE WRONG — both caught by simulating before coding.**
      → WRONG #1: the tempo bonus was INERT. §5.2's `clamp(1.6 - dt/400, ...)` put
      the whole useful curve between 100-300ms per word, i.e. 200-600 WPM. Every
      human from 40 to 200 WPM sat permanently on the 0.85 floor, so "faster hits
      harder" never fired for anyone and was just a flat 15% penalty on the entire
      player base. Divisor corrected to 1600, which spreads the curve across
      50-150 WPM where players actually live. A test now asserts the curve
      discriminates across that range so it cannot silently die again.
      → WRONG #2: 1000 HP made the top combo tier UNREACHABLE. Simulation showed
      ~19s matches over ~23 words, so combo 35 (the 2.40x tier) could never be
      reached and the plan's own "60-90s" target was impossible. Raised to 4000 HP:
      ~56s even matches, ~70 words, peak combo ~39.
      → Also retuned: Ultimate charge is now `2.5 + combo*0.18` (was
      `4 + combo*0.35`, which simulated to ~6.5 Ultimates per match — a move meant
      to freeze time and make spectators gasp was neither rare nor cinematic). Now
      ~2 per player. Ultimate damage `260 + 6*combo`, roughly 4-5x a normal hit and
      ~10% of a health bar.
      → **RNG is position-addressed, not sequential** — `hash(seed, slot, wordIndex)`.
      The single most important architectural call in the engine. A normal seeded
      PRNG yields its Nth value only after N-1 draws, but the client predicts ONLY
      its own words while the server interleaves both players — they would consume
      the stream in different orders and disagree about crits. Hashing by position
      means any value computes in isolation, in any order, on any machine. Tested
      explicitly: a fighter's rolls are identical whether or not the opponent acts.
      → Determinism test (plan §10): same seed + same inputs produce byte-identical
      events.
      → Word index must arrive in order — the anti-cheat floor. Without it a client
      replays word 7 forever and lands unlimited hits.
      → A word is scored at the combo held BEFORE the strike, not after.
      → Ultimates ignore crits: a cinematic finisher that sometimes did 1.8x more
      would make the game's biggest moment feel arbitrary.
      → `impactWeight` is separate from damage — a chip hit and a heavy hit can do
      similar numbers at different combo tiers but must not FEEL the same.
      → `constants.ts` is the tuning file for the 3.11 gate; every value carries its
      rationale, because a bare number nobody understands is one nobody dares change.

- [x] 3.2 InputEngine (§4)
      → `apps/web/src/input/InputEngine.ts` — the gamepad, not a text field.
      35 unit tests driven through REAL `KeyboardEvent` dispatch on a real
      EventTarget, so modifier handling and `preventDefault` are actually exercised
      rather than assumed.
      → No `<input>`, no `<textarea>`, no `contentEditable`: a real form field
      brings autocorrect, autofill, spellcheck and IME composition, every one of
      which mangles words or inserts characters the player never typed.
      → The keystroke timestamp is the FIRST statement in the handler, before any
      branching, so our own dispatch cost never pollutes the timing data the server
      judges tempo and cheating by.
      → Timings are sent as inter-key DELTAS, never absolute times — the server has
      no use for the player's wall clock and we have no business collecting it.
      Capped at 64 to match the payload schema.
      → `dirty` is STICKY: backspace repairs the text but not the record. Free
      repair keeps the flow, the combo pays the cost (§4.2).
      → **Empty space commits are ignored.** Without that guard, holding the
      spacebar marches through the whole text at the key-repeat rate, burning every
      word as a miss and losing the match without a single character typed.
      → `preventDefault` on space (page scrolls under the player) and backspace
      (browser navigates back mid-match). Ctrl/Meta/Alt combos pass through
      untouched — trapping Ctrl+R or Cmd+Tab would strand the player in the page.
      → Sentence boundaries are invisible: words live in one flat list with global
      indices, so there is no pause and combat never stops.
      → **`typingToCombat.test.ts` proves the premise end to end** — 9 integration
      tests wiring the real InputEngine to the real combat engine with synthetic
      keystrokes: a typed word damages the opponent, combos build, a typo breaks the
      combo without self-damage, a repaired word still costs it, faster and longer
      words hit harder, an Ultimate charges and fires, and a knockout is reached by
      typing alone. This is the first proof that typing IS the controller.
      → 52 web tests total.
- [x] 3.3 Server MatchEngine — tick loop, validation, sentence streaming, batching
      → `packages/content` — word banks by difficulty, chosen so the text READS like
      combat ("strike", "riposte", "devastating"). A fighting game whose words are
      "the quick brown fox" is a typing test in costume. `code` difficulty attacks
      accuracy rather than length: brackets and the shift key are where combos die.
      → Sentences are generated deterministically from `(seed, index)`, same hash
      approach as the engine RNG. A match is therefore fully reproducible from its
      seed: a reconnecting client can be handed byte-identical text without the
      server storing any, and a reported match can be replayed later.
      → `ServerMatch` owns its own timers and engine state entirely in-process
      (D2). Events flush at 30Hz, snapshots at 10Hz, tick at 4Hz. A KO flushes
      IMMEDIATELY rather than waiting up to 33ms — the one event that must never
      arrive late.
      → **Server receipt time is used for tempo, NOT the client's timestamp.** This
      deviates from plan §7.4 deliberately: it removes an entire cheat vector (a
      client cannot claim to have typed faster than it did) at the cost of network
      jitter in the bonus. That cost is small — constant latency shifts both
      arrivals equally and cancels out of the GAP; only jitter remains, tens of ms
      against a 400-1200ms scale. Client timings are still collected, but used
      EXCLUSIVELY for cheat heuristics, never for damage.
      → Damage is scored from the server's own word at that index, so a client
      cannot inflate it by claiming to have typed something longer.
      → Text is streamed two sentences ahead of the furthest player. The player must
      never see the end of the text; running out mid-combo would stall the one place
      the game promises never to stall.
      → `CheatMonitor` flags, never punishes. A fast typist wrongly kicked is a
      player lost forever; a cheat that finishes one match before review costs
      nothing. Thresholds sit beyond human capability, not at its edge.
      → **REAL BUG FOUND BY A TEST:** the sustained-rate window measured elapsed
      time from the first record but counted THAT record's characters too,
      inflating measured WPM by ~11% — enough to flag a legitimate 215 WPM typist
      as a cheat. Fixed by excluding the first record's chars.
      → Disconnect mid-match awards the win rather than freezing the fight. The
      20-second reconnect grace (§7.3) lands in 3.10; until then a forfeit beats
      the survivor typing into a match that will never end.
      → Client `MatchManager` runs a LOCAL copy of the engine for prediction: a
      committed word resolves immediately so the animation fires on the same frame
      as the keystroke, and the server's authoritative events arrive ms later.
      Prediction covers only OUR OWN attacks — the opponent's words are unknown, so
      there is nothing to predict and everything to get wrong.
      → 169 server tests + 21 content tests. **Live-verified over real sockets:** two
      clients matched, same seed, identical text, 134 events in 81 batches (batching
      confirmed), 78 snapshots, ultimate fired, KO delivered, both clients agreed on
      the winner, per-fighter stats correct — and the 770 WPM bot script was
      correctly flagged `sustained-rate` while the match still completed.
- [x] 3.4 Phaser arena scene + procedural fighters
      → `game/bus.ts` is the React <-> Phaser boundary and the ONLY way anything
      crosses. Phaser never imports React; React never reaches into a scene. That
      separation is what makes D3 enforceable — combat events reach the renderer at
      30Hz without a single component re-rendering. A throwing listener is isolated
      so one broken FX handler cannot also freeze the HUD.
      → `ProceduralFighter` implements a `FighterView` interface that is **the swap
      point for real art (§6.3)**. Nothing outside that file knows how a fighter is
      drawn, so phase 5.1 replaces geometry with spritesheets in one file and no
      game logic. That boundary is what makes "fun before pretty" a sequencing
      choice rather than a rewrite.
      → Body parts are SEPARATE game objects specifically so they tween
      independently: an attack is the torso driving forward while the arm swings
      through on a different easing. One tween on one object is a slide; two on two
      objects is a strike. Idle has a subliminal breathing bob — a perfectly still
      fighter reads as a frozen game.
      → Ultimate has a real wind-up: pull back and swell for 380ms, then commit in
      130ms. The anticipation is what sells it.
      → A miss still animates. Silence on a mistake reads as dropped input rather
      than a missed swing.
      → `Backdrop` generates three parallax silhouette layers procedurally from an
      arena `profile` (jagged / blocky / spiky / smooth / flat), drawn ONCE into
      textures rather than per frame. A backdrop that costs frame budget is stealing
      it from the fight.
      → Skyline geometry was EXTRACTED to `game/silhouette.ts` so it can be tested
      without a canvas: out-of-bounds points do not crash, they just make an arena
      look subtly wrong forever with nobody able to say why. 35 tests pin bounds,
      determinism, full-width coverage, per-layer variation and per-profile
      distinctness.
      → Test asserts every arena's accent colour MATCHES between the CSS lobby
      preview and the Phaser renderer — picking Volcano from an orange lobby must
      not land you somewhere blue.
      → Phaser input is DISABLED (`keyboard: false`). The InputEngine owns the
      keyboard (§4.1); letting Phaser also bind it would double-handle every key.
      No physics either — every motion is an authored tween, so a physics step
      would be pure overhead.
      → **Phaser 4** (not the plan's Phaser 3 — 4 is current). Typecheck passes
      against its types, which is what confirms the APIs used actually exist.
      → Lazy-loaded via dynamic import + a manual chunk. VERIFIED: `index.html` does
      not reference phaser; landing page ships 338KB, the 1.6MB engine chunk is
      fetched only when a match starts.
      → 135 web tests.
      → **NOT VISUALLY VERIFIED — no browser tooling.** Types, geometry, bus wiring
      and bundle splitting are all tested; whether it actually LOOKS good on screen
      is unknown. This is the largest unverified surface in the project so far.
- [x] 3.5 FX — attacks, hits, crits, combos, ultimate cinematic, KO
      → **Split so the design decisions are testable.** `fx/effects.ts` decides what
      a hit LOOKS like and returns pure `EffectSpec[]`; `FxLayer` only draws them.
      `fx/choreography.ts` decides who animates and when. Both are pure, so claims
      like "a crit is unmistakably bigger", "a ranged attack travels before it
      lands", "an Ultimate dwarfs a crit" fail a test if broken — instead of being
      discovered by eye three phases later. 37 tests across the two.
      → **FX size on `weight`, not damage.** The engine keeps them separate (§3.1)
      precisely so a long word always LANDS heavily even when its damage number is
      small early in a match. A test pins this: high weight + low damage must out-FX
      low weight + high damage.
      → A crit gets its OWN shockwave and its own colour, not merely a bigger
      version of the normal burst — distinguishable at a glance rather than on
      comparison.
      → Ranged attacks (fireball/arrow/laser/magic) spawn a projectile and DELAY the
      impact until it arrives; melee lands immediately. Tested per attack kind.
      → Ultimate is staged in three beats — charge aura at the caster, beam across,
      then a shockwave — so it reads as an event rather than a big punch. Test
      asserts the aura precedes the impact and total lifetime exceeds 800ms.
      → A miss is small, drab, and anchored to the player who ERRED. It must be
      legible without competing with a hit for attention; a test asserts it is
      smaller than even the lightest hit and never uses the fighter's colour.
      → Combo flourishes start at tier 2. Flourishing on every early combo would
      make the later ones mean nothing.
      → combo-tier / ultimate-ready / rage produce NO animation cue — they change
      how a fighter glows, not what they are doing. Interrupting a swing to play an
      idle pose because a tier ticked over would make the fight stutter.
      → Reactions are DELAYED (70ms melee, 420ms ultimate). A target that flinches
      the instant the attacker starts moving reads as two unrelated animations; the
      offset is what makes it read as cause and effect.
      → All FX objects are pre-allocated pools with round-robin cursors — zero
      allocation in the hot path (§6.4). A GC pause during a long combo is a dropped
      frame at exactly the moment the player is most invested.
      → 172 web tests.
      → STILL NOT VISUALLY VERIFIED. The design layer is now well covered by tests;
      the drawing layer is not, and cannot be without a browser.
- [x] 3.6 HUD — HP bars, combo counter, ultimate meter, text band
      → **The D3 promise is now PROVEN, not asserted.** `MatchHud` renders its
      structure once and never re-renders during a match; every update is pushed
      into children through registered callbacks, and each child writes its own DOM
      through refs. `TypingBand.test.tsx` holds a reference to a character element,
      fires a burst of keystrokes, and asserts the SAME node survives — if a
      keystroke ever caused a React render the subtree would be replaced and the
      identity would change. Also asserts 200 keystrokes add zero DOM nodes.
      → `hudModel.ts` is pure and tested (17 tests). The interesting behaviour is
      RECONCILIATION: predicted damage lands instantly, the 10Hz snapshot corrects
      any drift, and the server always wins. Prediction removes latency from the
      FEEL; it never argues with the result. A HUD that drifts is a player who
      thinks they won.
      → HP bar has two layers — a fast fill that snaps and a slow ghost that drains
      a beat behind. The GAP between them is the hit: you see how much you just
      lost, not merely where you ended up. Ghost catches up on a CSS transition, so
      it costs no JS per frame.
      → Combo counter is hidden below 2 ("COMBO x1" on every word would make the
      number meaningless) and SCALES with tier, so a 40-combo is physically larger
      than a 6-combo — the player reads momentum without parsing a number. Pop is
      retriggered by class-removal + forced reflow, otherwise consecutive hits at
      the same tier would not animate.
      → Ultimate meter is gold, and gold is used for nothing else in the product
      (1.4 rule). The colour itself is the signal.
      → Typing band: only the ACTIVE word is split per character; the rest are
      plain text nodes. Per keystroke it touches one `data-state` attribute per
      character and nothing else. Rebuilds once per WORD, not per keystroke.
      → Character states are styled by CSS attribute selectors rather than
      Tailwind classes — one attribute write beats swapping class lists per char.
      → Cursor is a solid underline, NOT a blinking caret: a blink is an animation
      the eye tracks, and anything pulling attention off the fighters works against
      the game.
      → **§0 compliance, deliberately:** no WPM, no accuracy %, no progress bar, no
      match timer anywhere in the HUD. Progress is the opponent's HP going down.
      Band sits low and thin so the fighters own the frame.
      → 201 web tests.
- [x] 3.7 Game feel — hit stop, screen shake, damage numbers
      → **REAL BUG FOUND AND FIXED: prediction was double-applying damage.** The
      client resolves its own word locally for instant feedback, then the server
      sends its authoritative copy of the SAME attack — both flowed through
      `combat:events`, so the HP bar double-dropped and snapped back on the next
      snapshot, and the player would have eaten two hit-stops and two damage
      numbers for one word. Wiring prediction to a HUD in 3.6 is what exposed it.
      → Fixed with `net/eventReconciler.ts`, pure and tested (15 tests). The rule:
      OUR actions render from the prediction (server copy dropped as a duplicate),
      the OPPONENT's render from the server (we never predict them), and
      match-ending events ALWAYS come from the server whoever caused them — a
      predicted KO would end the fight on screen for a match still being played if
      local and server disagreed by a single point of damage. A test asserts each
      action is rendered exactly once across both halves.
      → `feel/impact.ts` is pure and tested (18 tests). Hit-stop escalates
      jab < heavy < crit < ultimate < knockout — that hierarchy IS the point; if a
      crit did not out-punch a jab, impacts would read as noise rather than
      escalation.
      → **A miss gets NO hit-stop.** Freezing on a mistake punishes the player
      twice — once by breaking the combo, again by interrupting the flow they are
      rebuilding. The cost of a miss is the combo and only the combo (§5.3).
      → `combineFeel` takes the MAXIMUM across a batch, never the sum. Two hits in
      one 33ms flush freezing for the total is how a game becomes a slideshow at
      exactly the moment it should feel fastest.
      → **Shake is capped hard (0.012).** Feel must never cost legibility in a game
      where reading IS the input — an uncapped shake makes a late-match Ultimate
      unreadable while the player is still expected to type through it.
      → **CALIBRATION BUG CAUGHT BY A TEST:** shake originally referenced 12% of a
      health bar, so a typical early hit (~30 of 4000 damage) produced NO shake at
      all — the game felt flat for the first third of every match, precisely when a
      new player decides whether they like it. Reference lowered to 4%; regression
      test pins it.
      → `prefers-reduced-motion` suppresses shake from day one rather than waiting
      for the settings panel in 5.5 — shake is the one effect that can make a
      player physically unwell. Hit-stop still applies, since a freeze is not motion.
      → `HitStop` zeroes tween/timer timescales rather than pausing the scene, so
      the frame keeps drawing — a still frame IS the effect. Recovery uses
      `window.setTimeout` deliberately: scheduling on the clock we just stopped
      would freeze the game permanently.
      → Damage numbers pop, arc and fade from a pool. A number travelling in a
      straight line reads as UI; one thrown on an arc reads as debris from the hit.
      → 234 web tests.
- [x] 3.8 Audio + SFX
      → **Fully synthesised, no audio files.** Same reasoning as the procedural
      fighters (§6.3): waiting on an audio pass would mean taking a SILENT game
      through the 3.11 playtest gate, and a silent fighting game feels broken in a
      way no amount of animation fixes. Real samples swap in behind the same
      `VOICES` interface in phase 5.
      → Every voice is a filtered noise burst (the crack) plus a pitched
      oscillator (the body) — which is how real impact sounds are built, and why
      these read as hits rather than beeps. Voices are spread across the spectrum
      so a busy exchange stays legible: impacts mid, crits bright, Ultimate sweeps
      through, miss low where nothing else lives.
      → `audio/soundFor.ts` is pure and tested (19 tests). **The combo pitch ladder**
      is the best idea in this step: each clean hit is voiced slightly higher than
      the last, so a streak audibly CLIMBS — the player hears their momentum before
      they have time to read the counter. Capped at 1.6×, because uncapped a
      40-combo ends somewhere between shrill and inaudible.
      → **Ducking is the point, not the volume** (§5.5 "Silence sells impact").
      Ducking escalates none → crit → ultimate → KO. Pulling the floor out from
      under a big hit lands harder than raising its own volume ever could. Routine
      hits never duck, or the mix would pump constantly.
      → A miss has its OWN low, dull voice — never a quieter impact. In a fast
      exchange the player's eyes are on the next word, so they must be able to tell
      a mistake from a weak hit by ear alone.
      → Keystrokes whisper (gain 0.1 vs ~0.6 for a hit). In a game where every word
      is an attack, the WORD is the loud event; prominent key clicks would turn the
      mix into a keyboard recording and bury the combat.
      → Keystroke ticks fire only when typed length GREW — otherwise holding
      backspace to clear a word sounds like a drum roll. Tested.
      → `AudioContext` is created lazily and unlocked on the first pointer/key
      event anywhere in the document, so the player never sees a "click to enable
      audio" prompt — that is asking them to fix a problem they did not create.
      Every audio failure path is swallowed: the fight is fully playable in silence.
      → Audio rides the SAME event stream as the renderer, so a hit sound can never
      fire without a visible hit.
      → 261 web tests.
      → DEFERRED: music. Procedural music is a large lift likely to sound bad;
      real tracks land in phase 5 alongside the art. The `master` bus already
      exists for it.
- [x] 3.9 Victory/defeat screen + rematch
      → **This is the one screen where WPM and accuracy are ALLOWED** (§0). During
      combat they turn the game into a typing test; afterwards they are exactly what
      a player wants — the story of how the fight was won. Stat rows are ordered by
      what DECIDED the match rather than what is easiest to compute, so accuracy
      leads: it is the thing players under-rate and the thing that actually wins.
      → Stats are shown side by side with the better value highlighted, which turns
      a table into a scoreboard — the player sees WHERE they lost, not just that
      they did.
      → Verdict leads at full size, numbers follow. A player wants to know whether
      they won before they want to know their WPM.
      → **Rematch is a mutual vote, not a host command.** After a close match the
      loser deserves an equal say. Votes are BROADCAST so each side can see the
      other is still there and still willing — a button giving no feedback until
      both press it is a button people give up on. The opponent's pending vote
      changes the label to "Accept rematch" and adds a line, because "Rematch" and
      "someone is waiting for you" are different levels of urgency.
      → Agreeing to a rematch auto-readies both players. Making them click twice
      after already saying yes is a step that only loses people.
      → **BUG CAUGHT WHILE WIRING:** the room flips to `post-match` the instant a KO
      lands, and `RoomScreen`/`PlayScreen` only rendered the arena for `in-match` —
      so the results screen would have VANISHED before the player read a single
      number. Both now treat post-match as arena-owned.
      → Results are layered OVER the still-running arena rather than replacing it,
      so the KO animation and victory pose stay visible behind the numbers.
      → Guest account prompt appears only AFTER a match, never before or during —
      the promise is that gameplay is never blocked behind a login. Deliberately a
      small line of text, not a modal: a modal would stand between the player and
      the rematch button, which is the one thing we most want them to press.
      → 175 server + 261 web tests. Live-verified 11 checks end to end: match ends,
      both clients agree on the winner, stats populate, room enters post-match, a
      one-sided vote is visible to the opponent, mutual agreement starts a fresh
      countdown, votes clear, players auto-ready, and a SECOND match actually begins.
- [x] 3.10 Reconnect + forfeit
      → **A disconnect PAUSES the fight for 20s instead of ending it.** An instant
      forfeit punishes the wrong person about half the time: the player whose train
      went into a tunnel did not choose to quit, and the one left standing did not
      earn the win. 20s survives a WiFi hiccup, a laptop lid or a phone switching to
      mobile data; past ~30s waiting stops feeling like suspense and starts feeling
      like being stood up.
      → **This is the payoff for making guest sessions stateless and signed in 2.2.**
      A reconnecting socket arrives anonymous — the token is the only thing proving
      it belongs to a match in progress. `guest:init` now fires a reattach hook once
      an identity is RESTORED (not when one is issued).
      → The dropped player KEEPS their seat, marked absent rather than removed.
      Removing them would destroy the room they are trying to return to. Required a
      `byPlayer` index on RoomRegistry so a new socket can find its way back.
      → **Paused time is subtracted from the match clock.** Without it a 20s
      disconnect advances elapsed by 20s — pushing the fight toward sudden death and
      corrupting every WPM figure on the results screen, for something neither
      player did. `submitWord` uses the corrected clock too, so the first word back
      does not show a 20-second gap and tank the returning player's tempo bonus.
      → Timers STOP while paused rather than the match merely ignoring input: a
      frozen room does not need ten snapshots a second describing nothing, and
      leaving the tick loop running would let Rage engage during a pause.
      → Pending events are flushed BEFORE freezing, so the last hits before the drop
      are not stranded in the buffer for the whole pause.
      → Words submitted during a pause are dropped. The surviving player must not
      keep landing hits on an opponent who cannot fight back — and client-side the
      input is DETACHED, not just ignored, or they would build a buffer of words
      that all land the instant play resumes.
      → `match:resumed` carries EVERY sentence issued so far (regenerated from the
      seed — the server stores none of it) plus the authoritative snapshot. The
      client rebuilds its input engine and `seek()`s to the word index the SERVER
      says it reached, not the start of the text it was just re-sent.
      → `PausedOverlay` counts down against `serverNow()`. The countdown is the
      point: without it the survivor stares at a frozen fight with no idea whether
      to wait or leave — and a player who does not know what is happening leaves.
      → 183 server tests. **Live-verified 13 checks:** survivor notified, player
      named, deadline given, NO instant forfeit, typing into a pause lands nothing,
      identity restored from token, `match:resumed` delivered with 3 sentences and a
      full snapshot, word position restored (wordIndex=3), HP restored (3734), and
      play genuinely continues afterwards.

**→ PHASE 3 IS CODE-COMPLETE. Only the 3.11 playtest gate remains.**

- [~] 3.11 **GATE: 20 internal playtest matches. Tune §5.2 before Phase 4.**
  → **PARTIALLY DONE. The measurable half is complete; the subjective half is
  NOT and still blocks Phase 4.**
  → `packages/engine/src/balance.test.ts` — 17 tests running thousands of
  matches through the REAL engine and asserting the design's own claims. A
  failure there is a design failure, not a code failure.
  → **BUG #1 — the game contradicted its own marketing.** A matchmaking tip read
  "Accuracy beats raw speed. Every time." Simulation shows accuracy wins up to
  about a 50% speed gap and then loses. That crossover is CORRECT design (if
  accuracy always won, speed would be worthless and the game would become
  slow-and-careful), so the COPY was fixed rather than the game. A test now
  pins the crossover so it cannot drift silently.
  → **BUG #2 — beginner matches ran 189 SECONDS.** Measured across skill levels:
  beginner 189s / casual 127s / average 96s / good 59s / strong 38s / elite 28s.
  A 6.7× spread, with a three-minute slog inflicted on exactly the players most
  likely to give up on the game.
  → Root cause was NOT the ramp being too gentle — it was the `RAGE_HP_FRACTION`
  gate. Rage engaged at the threshold and then SWITCHED OFF the moment either
  fighter dropped below 40%, i.e. precisely when a long match most needed to
  end. Two rounds of steepening the tiers barely moved the number (189 → 176s)
  because the gate kept disabling them.
  → Gate REMOVED. Rage is symmetric — both fighters deal more damage — so it
  never hands the win to whoever is ahead, and a trailing player closes a gap
  faster under it, not slower. The comeback argument that justified the gate
  does not survive contact with the fact that it applies to both sides.
  → Result: beginner 189→**105s**, casual 127→**86s**, average 96→**74s**, and
  good/strong/elite completely UNTOUCHED (they finish before 60s and never see
  Rage). Spread narrowed 6.7× → 3.8×.
  → Rage is now four steep tiers from 60s (2.5× / 5× / 9× / 15×) and purely
  time-based.
  → 574 tests across the repo, all green.

      **STILL OUTSTANDING — this is what blocks Phase 4:**
      Nobody has played it. "Is it fun", "does it look right", and "does hit-stop
      feel good" cannot be simulated. Run `pnpm dev`, open two tabs, create a
      private room, and play ~20 matches. Tune `packages/engine/src/constants.ts` —
      every value there carries its reasoning.

### Phase 4 — Progression

- [x] 4.1 Auth + guest→user upgrade
      → **Built behind a repository seam, which is what unblocked it.** Docker is
      not installed, so Phase 4 would otherwise have stalled at step one. Every read
      and write now goes through `db/repositories.ts`; `db/memory.ts` implements it
      for `PERSISTENCE=none`. That is a real runtime, not a mock — services are
      tested against it, and when the Prisma implementation lands these tests become
      its conformance suite.
      → **scrypt at OWASP parameters, NOT argon2id** (a deliberate deviation from the
      plan). Every argon2 package for Node is a native module: a toolchain at install
      time, a heavier Docker image, and breakage on any platform without a prebuilt
      binary. scrypt is memory-hard, ships with Node, and is OWASP-approved at
      N=2^17/r=8 (~128MB, ~100ms per hash). Cost is lowered under NODE_ENV=test —
      the suite ran 25s at production cost, now 2.9s, through the identical code path.
      → **Login gives the same answer AND the same timing** whether the account is
      unknown or the password is wrong. A different message would let anyone
      enumerate registered addresses; the service hashes even when no user was found
      so a stopwatch cannot undo the message's discretion. Both are tested.
      → **Registration adopts the guest's match history.** The client hands over its
      signed guest token and the server reassigns those matches to the new account.
      Without this the results-screen prompt ("create an account to keep your
      stats") would be a lie. A forged token claims nothing, and another guest's
      matches are never touched — both tested.
      → Password rules are LENGTH-based (10 min) with no composition requirements.
      Composition rules reliably produce `Password1!` and push people toward reuse;
      length is what actually costs an attacker. A short common-password list blocks
      the trivial cases.
      → Same `Buffer.from(...,'hex')` guards as the room-password path — the empty-
      buffer bug found in 2.4 would have been identical here.
      → Account tokens reuse the guest-token signing scheme, so there is ONE
      verification path to get right rather than two.
      → `AuthManager` is kept SEPARATE from `IdentityManager`: the guest token is
      what lets a dropped player rejoin a match, and it must keep working whether or
      not anyone has registered. Merging them would couple "can I reconnect" to
      "am I logged in".
      → UI: `AuthDialog` defaults to REGISTER (the common case is a guest who just
      finished a match) and pre-fills the username with their guest name, so an
      account feels like a continuation. `AccountChip` in the nav offers sign-in
      rather than demanding it.
      → 214 server tests (31 new). Live-verified 14 checks: 201 on register,
      ephemeral flag surfaced, password never echoed, duplicate email/username
      refused, weak and reserved input refused, login works, wrong password and
      unknown account give identical errors, /me resolves and rejects correctly.
      → **NOT DONE: the Prisma implementation.** Accounts are lost on restart, the
      server warns about it at boot, and the UI says so on hover. Needs Docker.
- [x] 4.2 Profile + stats pipeline + XP/levels
      → `services/progression.ts` is pure and tested (16 tests). Two rules shape
      every number:
      → **A loss must still pay.** The base award (60) is the LARGEST single
      component — larger than the win bonus (45) — because a player who loses and
      gains nothing has been told the last ninety seconds were worthless, and they
      do not queue again. Tested: a loss earns more than 60% of a win.
      → **Performance beats outcome.** A clean, high-combo LOSS out-earns a sloppy
      WIN. That points the incentive at playing well rather than at farming weak
      opponents. Tested directly.
      → Accuracy XP scales from an 80% floor rather than from zero — rewarding the
      gap between 40% and 60% would be paying for flailing. Combo XP is capped so
      one freak streak cannot out-earn a whole match of solid play.
      → Level curve `200 × (n-1)^1.6`: level 2 lands after ~2 matches so a new
      player sees progress immediately; level 10 takes ~40. Tests pin both ends,
      plus monotonicity and self-consistency with the thresholds.
      → **Match results are recorded AFTER `match:end` is broadcast, never before.**
      The results screen must appear the instant the fight ends — making both
      players wait on a database write to see who won would put storage latency in
      front of the most satisfying moment in the product. A failed write is logged
      and swallowed: losing a stats row is a bad day for one profile, throwing would
      take down room teardown with it.
      → **A signed-in player keeps their GUEST playerId.** That id is what rooms,
      matches and reconnection are keyed on; swapping it at sign-in would drop
      somebody out of their own match. The account only decides where results are
      ATTRIBUTED. `guest:init` now optionally carries an account token, so identity
      is still established through ONE event rather than two that can disagree.
      → Guests' matches are recorded too (null userId) — they are real matches that
      appear in history and are adopted on registration (4.1).
      → Profile is ONE row read plus a bounded history query. The stats are
      denormalised precisely so this never becomes an aggregate over every match a
      player has ever fought (§1.6) — that query gets slower exactly as the game
      gets more popular.
      → Signed-out profile reads as an INVITATION, not a wall: it says what an
      account buys rather than demanding one on principle.
      → 230 server tests. **Live-verified 16 checks** with two real accounts playing
      a real match: account name used as identity, not flagged as guest, match
      counted, win/loss recorded, 43 words and combo 43 captured, 210 XP and a
      level-up, history with the opponent named — and the LOSER still earned 60 XP.
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
  _optional in dev_ — server runs in `PERSISTENCE=none` mode. Phases 2 and 3
  need no database. Install Docker Desktop before Phase 4.

---

## 0. The One Rule

Before writing any feature, answer: **does this make the match more fun to play or
to watch?** If the honest answer is "it makes typing more measurable" — cut it.

Concrete consequences of that rule, decided up front:

| Temptation                          | Decision                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| Show WPM live during combat         | **No.** WPM is a post-match stat. During combat the player sees HP, combo, ultimate charge. |
| Show accuracy % live                | **No.** Accuracy is expressed as _combo surviving or breaking_.                             |
| Big centered text box               | **No.** Text is a thin band low on screen; the fighters own the frame.                      |
| Caret / cursor / underline styling  | Minimal. The feedback is the _character on screen swinging a sword_.                        |
| Progress bar of sentence completion | **No.** Progress is expressed as the opponent's HP dropping.                                |
| Countdown timer on the match        | **No.** The match ends by KO. (Sudden-death ramp instead — see §5.4.)                       |

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
The client fires the attack animation the instant _it_ detects a correct word.
The server independently validates and computes damage, then broadcasts the HP
delta. HP bars are server-driven; animations are client-predicted. This is what
makes it feel instant while staying cheat-resistant. Mispredictions (server
rejects a word) resolve as a "blocked" animation, which reads as legitimate
combat rather than a glitch.

**D2 — Match state lives in one Node process, not in Redis.**
A match is a 60Hz-ish stateful object with sub-100ms latency requirements.
Round-tripping to Redis per keystroke is wasteful. Both sockets of a match are
pinned to one process (matchmaking assigns the match to the process that will
own it; the Redis adapter routes). Redis holds only _where_ a match lives.
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

> ⚠️ **The block below is the ORIGINAL design sketch and contains two numbers
> that were proven wrong in step 3.1** (tempo divisor, and HP). It is kept for
> the reasoning around it. **The authoritative, simulated values live in
> `packages/engine/src/constants.ts`** — tune there, not here.

```
HP                      = 1000 per fighter   // ← WRONG: 4000. See 3.1.
baseDamage(word)        = 18 + 4 * clamp(len - 3, 0, 9)      // 18..54
comboMultiplier(c)      = c <  5  -> 1.00
                          c < 10  -> 1.25
                          c < 20  -> 1.55
                          c < 35  -> 1.90
                          c >= 35 -> 2.40
tempoBonus(dt)          = clamp(1.6 - dt / 400ms, 0.85, 1.35)  // ← WRONG: /1600. See 3.1.
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
backwards — the losing player should get _more_ game, not less. Combo loss is a
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
- **Screen shake:** proportional to damage, capped, and _disableable_ in settings.
- **Damage numbers:** pop, arc, fade. Crits are bigger and a different color.
- **Chip vs. real damage:** HP bar has a fast red layer and a slow white "ghost"
  layer that drains behind it. Legible at a glance from across a room.
- **Anticipation on ultimate:** ~400ms of wind-up, time freeze, camera push in,
  opponent gets a visible "brace" pose. Spectators should gasp.
- **Audio ducks** during ultimates. Silence sells impact.

---

## 6. Rendering Layer

### 6.1 Split of responsibility

| Layer                | Owns                                                           |
| -------------------- | -------------------------------------------------------------- |
| Phaser canvas (z-0)  | arena parallax, fighters, FX, damage numbers, camera, hit stop |
| React overlay (z-10) | HP bars, combo counter, ultimate meter, name plates, text band |
| React (full screen)  | everything outside `PHASE_COMBAT`                              |

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

This ordering means the game is _fun_ before it is _pretty_, which is the only
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

_Exit: `docker compose up` gives a running app; a socket round-trip is visible._

- pnpm workspaces, Turborepo, shared tsconfig/eslint/prettier presets.
- Vite + React + Tailwind app shell with dark game theme + design tokens.
- Express + Socket.io server, Zod-validated env config, Pino logging.
- Postgres + Redis in compose; Prisma schema v1 + first migration.
- `packages/shared` typed socket contract; both ends compile against it.
- Health checks, graceful shutdown, CI running lint + typecheck + tests.

### Phase 2 — Getting Two Humans Into A Fight

_Exit: two browsers, one click each, both land in a synced lobby and count down._

- Landing page (hero, animated background, Play Now, nav, footer, ad slot).
- Guest identity: generated names (`RapidWolf`), editable, persisted to
  localStorage + signed server token.
- Matchmaking: Redis queue, pairing, process assignment, "Searching…" screen
  with cancel.
- Private rooms: create, code, shareable link, join, host transfer, kick.
- Lobby: player cards, character select, arena preview, ready-up, chat, ping,
  full host settings panel, 3-2-1-FIGHT countdown.

### Phase 3 — The Game

_Exit: a full match is playable end to end and is actually fun. Playtest gate._

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

_Exit: registered users have a reason to come back tomorrow._

- Auth (email+password, argon2, JWT access + refresh), guest→user upgrade that
  preserves the just-finished match.
- Post-match "Save your progress" prompt.
- Profile, stats aggregation pipeline, XP/levels.
- Achievements engine (event-driven, evaluated server-side on match end).
- Leaderboards: global / country / weekly / monthly / season / friends.
- Friends, match history.

### Phase 5 — Production Polish

_Exit: shippable._

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

| Risk                                                  | Mitigation                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| It ends up feeling like a typing test with decoration | Phase 3 playtest gate; §0 rules enforced in review                   |
| Art scope stalls the project                          | Procedural fighters first, sprites swapped later behind an interface |
| React rerenders tank framerate                        | Event-bus architecture + dev render counter + CI perf test           |
| Matches desync between clients                        | Pure engine + seeded RNG + determinism test                          |
| Fast legitimate typists get flagged as cheaters       | Flag-and-review, never auto-disconnect                               |
| Redis becomes the match bottleneck                    | Match state stays in-process (D2); Redis is discovery only           |
| Leaderboard queries melt under load                   | Materialized + Redis-cached, never live                              |

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

```
