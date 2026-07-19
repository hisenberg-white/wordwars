import type { PlayerId, UserId } from '@wordwars/shared';

/**
 * Persistence boundary.
 *
 * Every read and write the game does goes through one of these interfaces, and
 * nothing above this layer knows whether the data lives in Postgres or in a
 * Map. That matters for two reasons:
 *
 *   1. **It unblocks development.** `PERSISTENCE=none` has been the documented
 *      no-Docker mode since 1.6; the in-memory implementation makes that a
 *      first-class runtime rather than a stub, so accounts, stats and
 *      leaderboards can be built and tested before Postgres exists.
 *   2. **It keeps Prisma out of the game logic.** Services depend on these
 *      interfaces, so swapping the backing store is one wiring change and no
 *      rewrites — and every service stays unit-testable without a database.
 */

export interface UserRecord {
  readonly id: UserId;
  readonly email: string;
  readonly username: string;
  readonly passwordHash: string;
  readonly avatarUrl: string | null;
  readonly countryCode: string | null;
  readonly xp: number;
  readonly level: number;
  readonly createdAt: number;
  readonly lastSeenAt: number;
}

export interface UserStatsRecord {
  readonly userId: UserId;
  readonly matches: number;
  readonly wins: number;
  readonly losses: number;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly totalWords: number;
  readonly totalDamage: number;
  readonly bestCombo: number;
  readonly bestWpm: number;
  readonly avgWpm: number;
  readonly avgAccuracyBp: number;
}

export interface MatchRecord {
  readonly id: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly winnerId: PlayerId | null;
  readonly players: ReadonlyArray<{
    readonly playerId: PlayerId;
    readonly userId: UserId | null;
    readonly nickname: string;
    readonly isWinner: boolean;
    readonly damageDealt: number;
    readonly wordsTyped: number;
    readonly wordsMissed: number;
    readonly accuracyBp: number;
    readonly avgWpm: number;
    readonly peakWpm: number;
    readonly maxCombo: number;
    readonly ultimatesUsed: number;
  }>;
}

export interface UserRepository {
  findById(id: UserId): Promise<UserRecord | null>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findByUsername(username: string): Promise<UserRecord | null>;
  create(user: Omit<UserRecord, 'createdAt' | 'lastSeenAt'>): Promise<UserRecord>;
  update(id: UserId, patch: Partial<UserRecord>): Promise<UserRecord | null>;
}

export interface StatsRepository {
  find(userId: UserId): Promise<UserStatsRecord | null>;
  /** Applied atomically at match end; creates the row on first match. */
  apply(userId: UserId, outcome: MatchOutcomeForStats): Promise<UserStatsRecord>;
}

/** The slice of a match result the stats pipeline needs. */
export interface MatchOutcomeForStats {
  readonly won: boolean;
  readonly wordsTyped: number;
  readonly damageDealt: number;
  readonly maxCombo: number;
  readonly avgWpm: number;
  readonly peakWpm: number;
  readonly accuracyBp: number;
}

export interface MatchRepository {
  record(match: MatchRecord): Promise<void>;
  /** Most recent matches for a user, newest first. `offset` pages backwards. */
  recentForUser(userId: UserId, limit: number, offset?: number): Promise<MatchRecord[]>;
  /** Total matches on record for a user, so a history page can show its size. */
  countForUser(userId: UserId): Promise<number>;
  /**
   * Reassigns a guest's past matches to a newly created account.
   *
   * This is what makes "play first, register later" more than a slogan: the
   * matches someone played as a guest become the first entries in their
   * history rather than being thrown away (plan §"OPTIONAL ACCOUNT SYSTEM").
   */
  claimForUser(playerId: PlayerId, userId: UserId): Promise<number>;
  /**
   * Every match started at or after `from`, for leaderboard materialisation.
   *
   * Deliberately NOT on the request path — this is what the scheduled job
   * reads. In Postgres it is an indexed range scan feeding a GROUP BY; the
   * point of materialising is that nobody waits on it.
   */
  since(from: number): Promise<MatchRecord[]>;
}

/**
 * One direction of a friendship.
 *
 * Directed rows rather than one shared row: "who are my friends" is the query
 * this system answers a hundred times more often than any other, and a directed
 * row makes it a single indexed lookup instead of an OR across two columns.
 * Accepting a request writes the mirror row, so an accepted friendship is
 * always two rows and always symmetric.
 */
export interface FriendshipRecord {
  readonly userId: UserId;
  readonly friendId: UserId;
  readonly status: 'pending' | 'accepted' | 'blocked';
  /** True on the row belonging to whoever sent the request. */
  readonly outgoing: boolean;
  readonly createdAt: number;
}

export interface FriendRepository {
  /** Every row owned by this user, in any status. */
  forUser(userId: UserId): Promise<FriendshipRecord[]>;
  find(userId: UserId, friendId: UserId): Promise<FriendshipRecord | null>;
  put(record: FriendshipRecord): Promise<void>;
  remove(userId: UserId, friendId: UserId): Promise<void>;
}

export interface StoredLeaderboard {
  readonly key: string;
  readonly json: string;
  readonly computedAt: number;
}

/**
 * Materialised boards.
 *
 * Stored as computed JSON rather than rows to be re-ranked on read: the whole
 * reason boards are precomputed is that reading one should be a single lookup
 * no matter how many matches exist behind it.
 */
export interface LeaderboardRepository {
  get(key: string): Promise<StoredLeaderboard | null>;
  put(entry: StoredLeaderboard): Promise<void>;
}

export interface StoredAchievement {
  readonly id: string;
  readonly progress: number;
  readonly unlockedAt: number | null;
}

export interface AchievementRepository {
  forUser(userId: UserId): Promise<Map<string, StoredAchievement>>;
  save(userId: UserId, records: readonly StoredAchievement[]): Promise<void>;
}

export interface Repositories {
  readonly users: UserRepository;
  readonly stats: StatsRepository;
  readonly matches: MatchRepository;
  readonly achievements: AchievementRepository;
  readonly leaderboards: LeaderboardRepository;
  readonly friends: FriendRepository;
}
