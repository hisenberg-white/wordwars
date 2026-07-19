# Load test (plan 5.8)

Answers one question: **how many simultaneous fights can one server process run
before players notice?**

Throughput is the wrong measure for a fighting game. What ruins a match is
_stutter_, and every live match shares one event loop (plan §1.1 D2) — so a
stall does not degrade one fight, it freezes all of them at once. The headline
numbers are therefore **event-loop lag** and the **word → hit round trip**.

## Running

```bash
pnpm --filter @wordwars/server dev          # terminal 1
node tools/loadtest/loadtest.mjs            # terminal 2
```

Options: `--tiers 100,400` · `--seconds 20` · `--wps 2.4` · `--url http://host:4000`

Reads `/metrics`, which is mounted only when the server has a gateway.

## Results (2026-07-19)

Windows 11, 1 dev machine, bots sharing the CPU with the server.

| matches | word→hit p50/p95 | loop p50/p99 |   rss |
| ------: | ---------------: | -----------: | ----: |
|     100 |          42/89ms |      16/44ms | 126MB |
|     200 |         46/161ms |      14/42ms | 162MB |
|     400 |          37/83ms |      16/38ms | 214MB |
|     700 |         54/232ms |      16/64ms | 230MB |
|    1000 |         87/462ms |     35/185ms | 176MB |

**Verified healthy to ~400 concurrent matches** (800 sockets) with loop p99
under 40ms. Marginal at 700. Fails at 1000 on this hardware.

### Reading these numbers honestly

- **The idle floor is ~15ms, not 0.** Windows' timer resolution is ~15.6ms, so
  `monitorEventLoopDelay` reports ~16ms on a completely empty server. Judge lag
  by the p99 above that floor, not by the absolute value.
- **The bots share the CPU with the server.** At 1000 matches the harness is
  driving 2000 sockets from a single Node process and is likely the bottleneck
  itself. The 1000-match row is _not_ evidence the server cannot do 1000 — it is
  evidence this rig cannot measure it. Testing the plan's 1000-match target
  honestly needs load generators on separate machines.
- **`word→hit` includes the 30Hz event batching by design.** A p50 near 33ms is
  the flush interval, not latency the server added. It is what the player's eyes
  experience, which is what we care about.

## What this test already found

Per-match timers were the capacity limit, not per-word work: 200 nearly idle
matches (40 words/sec between them) degraded the loop _more_ than 100 matches
carrying twelve times that traffic. Each match owned three intervals, so 200
matches meant 600 timers and ~8,800 wake-ups a second spent on nothing.

Replacing them with one shared clock **made it worse** — loop p99 at 100 matches
went 24ms → 96ms — because per-match timers had been naturally staggered and a
single shared clock synchronised every match into the same loop iteration.
Sharding the sweep across four slices fixed it and beat the original:

| 100 matches               | 200     | 400        |
| ------------------------- | ------- | ---------- |
| per-match timers: 24ms    | 99ms ✗  | —          |
| shared, unsharded: 96ms ✗ | 121ms ✗ | 177ms ✗    |
| shared + sharded: 44ms    | 42ms    | **38ms** ✓ |

Roughly a 4× capacity improvement, and none of it was predictable from reading
the code. See `apps/server/src/match/MatchScheduler.ts`.
