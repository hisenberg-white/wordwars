import { randomUUID } from 'node:crypto';
import { asUserId, type PlayerId, type UserId } from '@wordwars/shared';
import type {
  AchievementRepository,
  LeaderboardRepository,
  StoredAchievement,
  StoredLeaderboard,
  MatchOutcomeForStats,
  MatchRecord,
  MatchRepository,
  Repositories,
  StatsRepository,
  UserRecord,
  UserRepository,
  UserStatsRecord,
} from './repositories.js';

/**
 * In-memory persistence.
 *
 * The backing store for `PERSISTENCE=none`. Everything is lost on restart, and
 * that is stated plainly to the player rather than hidden — the server logs a
 * warning at boot and the UI says accounts are session-only in this mode.
 *
 * This is NOT a mock. It implements the same contract Postgres will, it is
 * what the services are tested against, and it is a genuinely usable runtime
 * for local development and demos. When the Prisma implementation lands, these
 * tests become its conformance suite.
 */

/*
 * Bounded, or a long-running dev server grows without limit.
 *
 * Raised from 200 when leaderboards landed: all-time boards aggregate over this
 * list, so the cap silently truncates them. That is acceptable HERE — this is
 * the no-database mode and its whole contract is that data is disposable — but
 * it is a genuine behavioural difference from Postgres, which aggregates over
 * everything. Stated rather than hidden.
 */
const HISTORY_LIMIT = 5_000;

class MemoryUserRepository implements UserRepository {
  private readonly byId = new Map<UserId, UserRecord>();
  private readonly byEmail = new Map<string, UserId>();
  private readonly byUsername = new Map<string, UserId>();

  async findById(id: UserId): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const id = this.byEmail.get(normalise(email));
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async findByUsername(username: string): Promise<UserRecord | null> {
    const id = this.byUsername.get(normalise(username));
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async create(user: Omit<UserRecord, 'createdAt' | 'lastSeenAt'>): Promise<UserRecord> {
    const now = Date.now();
    const record: UserRecord = { ...user, createdAt: now, lastSeenAt: now };

    this.byId.set(record.id, record);
    // Indexed case-insensitively so `Alice` and `alice` cannot both register —
    // the Postgres schema enforces the same via a unique index.
    this.byEmail.set(normalise(record.email), record.id);
    this.byUsername.set(normalise(record.username), record.id);

    return record;
  }

  async update(id: UserId, patch: Partial<UserRecord>): Promise<UserRecord | null> {
    const existing = this.byId.get(id);
    if (!existing) return null;

    const updated = { ...existing, ...patch, id: existing.id };
    this.byId.set(id, updated);
    return updated;
  }
}

class MemoryStatsRepository implements StatsRepository {
  private readonly byUser = new Map<UserId, UserStatsRecord>();

  async find(userId: UserId): Promise<UserStatsRecord | null> {
    return this.byUser.get(userId) ?? null;
  }

  async apply(userId: UserId, outcome: MatchOutcomeForStats): Promise<UserStatsRecord> {
    const previous = this.byUser.get(userId) ?? blankStats(userId);
    const matches = previous.matches + 1;

    const streak = outcome.won ? previous.currentStreak + 1 : 0;

    const updated: UserStatsRecord = {
      userId,
      matches,
      wins: previous.wins + (outcome.won ? 1 : 0),
      losses: previous.losses + (outcome.won ? 0 : 1),
      currentStreak: streak,
      bestStreak: Math.max(previous.bestStreak, streak),
      totalWords: previous.totalWords + outcome.wordsTyped,
      totalDamage: previous.totalDamage + outcome.damageDealt,
      bestCombo: Math.max(previous.bestCombo, outcome.maxCombo),
      bestWpm: Math.max(previous.bestWpm, outcome.peakWpm),
      // Running means, so a single match cannot swing a long-term average.
      avgWpm: runningMean(previous.avgWpm, previous.matches, outcome.avgWpm),
      avgAccuracyBp: runningMean(previous.avgAccuracyBp, previous.matches, outcome.accuracyBp),
    };

    this.byUser.set(userId, updated);
    return updated;
  }
}

class MemoryMatchRepository implements MatchRepository {
  private readonly matches: MatchRecord[] = [];

  async record(match: MatchRecord): Promise<void> {
    this.matches.unshift(match);
    if (this.matches.length > HISTORY_LIMIT) this.matches.length = HISTORY_LIMIT;
  }

  async since(from: number): Promise<MatchRecord[]> {
    return this.matches.filter((m) => m.startedAt >= from);
  }

  async recentForUser(userId: UserId, limit: number): Promise<MatchRecord[]> {
    return this.matches.filter((m) => m.players.some((p) => p.userId === userId)).slice(0, limit);
  }

  async claimForUser(playerId: PlayerId, userId: UserId): Promise<number> {
    let claimed = 0;

    for (let i = 0; i < this.matches.length; i += 1) {
      const match = this.matches[i]!;
      if (!match.players.some((p) => p.playerId === playerId && p.userId === null)) continue;

      this.matches[i] = {
        ...match,
        players: match.players.map((p) =>
          p.playerId === playerId && p.userId === null ? { ...p, userId } : p,
        ),
      };
      claimed += 1;
    }

    return claimed;
  }
}

class MemoryAchievementRepository implements AchievementRepository {
  private readonly byUser = new Map<UserId, Map<string, StoredAchievement>>();

  async forUser(userId: UserId): Promise<Map<string, StoredAchievement>> {
    // A copy, so a caller mutating the result cannot corrupt the store — the
    // Postgres implementation will naturally return fresh objects, and the two
    // must behave the same.
    return new Map(this.byUser.get(userId) ?? []);
  }

  async save(userId: UserId, records: readonly StoredAchievement[]): Promise<void> {
    const existing = this.byUser.get(userId) ?? new Map<string, StoredAchievement>();
    for (const record of records) existing.set(record.id, record);
    this.byUser.set(userId, existing);
  }
}

class MemoryLeaderboardRepository implements LeaderboardRepository {
  private readonly boards = new Map<string, StoredLeaderboard>();

  async get(key: string): Promise<StoredLeaderboard | null> {
    return this.boards.get(key) ?? null;
  }

  async put(entry: StoredLeaderboard): Promise<void> {
    this.boards.set(entry.key, entry);
  }
}

export function createMemoryRepositories(): Repositories {
  return {
    users: new MemoryUserRepository(),
    stats: new MemoryStatsRepository(),
    matches: new MemoryMatchRepository(),
    achievements: new MemoryAchievementRepository(),
    leaderboards: new MemoryLeaderboardRepository(),
  };
}

export const newUserId = (): UserId => asUserId(randomUUID());

function blankStats(userId: UserId): UserStatsRecord {
  return {
    userId,
    matches: 0,
    wins: 0,
    losses: 0,
    currentStreak: 0,
    bestStreak: 0,
    totalWords: 0,
    totalDamage: 0,
    bestCombo: 0,
    bestWpm: 0,
    avgWpm: 0,
    avgAccuracyBp: 0,
  };
}

/** Incremental mean, so history never has to be re-read to update an average. */
function runningMean(current: number, count: number, next: number): number {
  if (count === 0) return Math.round(next);
  return Math.round((current * count + next) / (count + 1));
}

const normalise = (value: string): string => value.trim().toLowerCase();
