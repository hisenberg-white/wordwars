import { describe, expect, it, vi } from 'vitest';
import { asPlayerId, type CharacterId, type GameMode, type PlayerId } from '@wordwars/shared';
import { MatchmakingService, type Pairing, type QueueEntry } from './MatchmakingService.js';

function entry(name: string, queuedAt = Date.now()): QueueEntry {
  const playerId = asPlayerId(name);
  return {
    playerId,
    identity: {
      playerId,
      nickname: name,
      isGuest: true,
      level: 1,
      avatarUrl: null,
      countryCode: null,
    },
    characterId: 'ninja' as CharacterId,
    mode: '1v1' as GameMode,
    queuedAt,
  };
}

function service() {
  const pairings: Pairing[] = [];
  const svc = new MatchmakingService((p) => pairings.push(p));
  return { svc, pairings };
}

const ids = (p: Pairing): PlayerId[] => p.players.map((e) => e.playerId);

describe('MatchmakingService', () => {
  it('holds a lone player in the queue', () => {
    const { svc, pairings } = service();

    expect(svc.join(entry('alice'))).toBe(true);

    expect(pairings).toHaveLength(0);
    expect(svc.isQueued(asPlayerId('alice'))).toBe(true);
    expect(svc.queueSize('1v1')).toBe(1);
  });

  it('pairs the second player immediately', () => {
    const { svc, pairings } = service();

    svc.join(entry('alice'));
    svc.join(entry('bob'));

    expect(pairings).toHaveLength(1);
    expect(ids(pairings[0]!)).toEqual([asPlayerId('alice'), asPlayerId('bob')]);
  });

  /**
   * The failure this guards: a paired player left in the queue gets matched
   * again into a second, ghost match while already fighting.
   */
  it('empties the queue when a pairing completes', () => {
    const { svc } = service();

    svc.join(entry('alice'));
    svc.join(entry('bob'));

    expect(svc.queueSize('1v1')).toBe(0);
    expect(svc.totalQueued).toBe(0);
    expect(svc.isQueued(asPlayerId('alice'))).toBe(false);
    expect(svc.isQueued(asPlayerId('bob'))).toBe(false);
  });

  it('pairs in FIFO order so the longest wait goes first', () => {
    const { svc, pairings } = service();

    svc.join(entry('first', 1_000));
    svc.join(entry('second', 2_000));
    svc.join(entry('third', 3_000));
    // 'first' and 'second' pair; 'third' waits.
    svc.join(entry('fourth', 4_000));

    expect(pairings).toHaveLength(2);
    expect(ids(pairings[0]!)).toEqual([asPlayerId('first'), asPlayerId('second')]);
    expect(ids(pairings[1]!)).toEqual([asPlayerId('third'), asPlayerId('fourth')]);
  });

  it('refuses a duplicate join and never pairs a player with themselves', () => {
    const { svc, pairings } = service();

    expect(svc.join(entry('alice'))).toBe(true);
    expect(svc.join(entry('alice'))).toBe(false);

    expect(pairings).toHaveLength(0);
    expect(svc.queueSize('1v1')).toBe(1);
  });

  it('removes a player who leaves', () => {
    const { svc, pairings } = service();

    svc.join(entry('alice'));
    expect(svc.leave(asPlayerId('alice'))).toBe(true);

    expect(svc.queueSize('1v1')).toBe(0);
    expect(svc.isQueued(asPlayerId('alice'))).toBe(false);

    // Someone joining now must wait, not pair with the departed player.
    svc.join(entry('bob'));
    expect(pairings).toHaveLength(0);
  });

  it('reports leaving as a no-op for a player who was not queued', () => {
    const { svc } = service();
    expect(svc.leave(asPlayerId('nobody'))).toBe(false);
  });

  it('records how long the waiting player waited', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);

    const { svc, pairings } = service();
    svc.join(entry('alice', 10_000));

    vi.setSystemTime(13_500);
    svc.join(entry('bob', 13_500));

    expect(pairings[0]?.waitedMs).toBe(3_500);
    vi.useRealTimers();
  });

  describe('wait estimates', () => {
    it('is near-instant when someone is already waiting', () => {
      const { svc } = service();
      svc.join(entry('alice'));

      expect(svc.estimateWaitMs('1v1')).toBeLessThan(1_000);
    });

    it('falls back to a conservative default with no history', () => {
      const { svc } = service();
      expect(svc.estimateWaitMs('1v1')).toBeGreaterThanOrEqual(1_000);
    });

    it('reflects observed waits once matches have been made', () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const { svc } = service();
      for (let i = 0; i < 5; i += 1) {
        const start = i * 100_000;
        vi.setSystemTime(start);
        svc.join(entry(`a${i}`, start));
        vi.setSystemTime(start + 6_000);
        svc.join(entry(`b${i}`, start + 6_000));
      }

      // Queue is empty again, so the estimate comes from history.
      expect(svc.estimateWaitMs('1v1')).toBe(6_000);
      vi.useRealTimers();
    });
  });
});
