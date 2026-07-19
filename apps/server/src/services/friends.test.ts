import { beforeEach, describe, expect, it } from 'vitest';
import type { UserId } from '@wordwars/shared';
import { createMemoryRepositories, newUserId } from '../db/memory.js';
import type { Repositories } from '../db/repositories.js';
import { FriendService, MAX_PENDING_OUTGOING, type PresenceLookup } from './friends.js';

let repos: Repositories;
let friends: FriendService;

const presence: { online: Set<UserId>; busy: Set<UserId> } = {
  online: new Set(),
  busy: new Set(),
};

const lookup: PresenceLookup = {
  isOnline: (id) => presence.online.has(id),
  activityOf: (id) =>
    presence.busy.has(id) ? 'in-match' : presence.online.has(id) ? 'idle' : null,
};

async function makeUser(username: string) {
  return repos.users.create({
    id: newUserId(),
    email: `${username}@test.dev`,
    username,
    passwordHash: 'x',
    avatarUrl: null,
    countryCode: null,
    xp: 0,
    level: 1,
  });
}

beforeEach(() => {
  repos = createMemoryRepositories();
  friends = new FriendService(repos, lookup);
  presence.online.clear();
  presence.busy.clear();
});

describe('requesting', () => {
  it('creates a pending pair visible from both sides', async () => {
    const a = await makeUser('Ann');
    const b = await makeUser('Bob');

    expect((await friends.request(a.id, 'Bob')).ok).toBe(true);

    expect((await friends.list(a.id))[0]).toMatchObject({
      username: 'Bob',
      status: 'pending-outgoing',
    });
    expect((await friends.list(b.id))[0]).toMatchObject({
      username: 'Ann',
      status: 'pending-incoming',
    });
  });

  it('matches usernames case-insensitively, because people type names not ids', async () => {
    const a = await makeUser('Ann');
    await makeUser('Bob');

    expect((await friends.request(a.id, 'bOb')).ok).toBe(true);
  });

  it('refuses unknown names, self-adds and duplicates', async () => {
    const a = await makeUser('Ann');
    await makeUser('Bob');

    expect(await friends.request(a.id, 'Nobody')).toMatchObject({ error: 'not-found' });
    expect(await friends.request(a.id, 'Ann')).toMatchObject({ error: 'self' });

    await friends.request(a.id, 'Bob');
    expect(await friends.request(a.id, 'Bob')).toMatchObject({ error: 'already-requested' });
  });

  /**
   * Both people have already expressed the same wish. Making either click
   * again is pure ceremony.
   */
  it('auto-accepts when both sides requested each other', async () => {
    const a = await makeUser('Ann');
    const b = await makeUser('Bob');

    await friends.request(a.id, 'Bob');
    await friends.request(b.id, 'Ann');

    expect((await friends.list(a.id))[0]!.status).toBe('accepted');
    expect((await friends.list(b.id))[0]!.status).toBe('accepted');
  });

  /** The anti-spam measure that matters: the limit falls on the SENDER. */
  it('caps outgoing pending requests', async () => {
    const spammer = await makeUser('Spammer');

    for (let i = 0; i < MAX_PENDING_OUTGOING; i += 1) {
      await makeUser(`Target${i}`);
      expect((await friends.request(spammer.id, `Target${i}`)).ok).toBe(true);
    }

    await makeUser('OneMore');
    expect(await friends.request(spammer.id, 'OneMore')).toMatchObject({ error: 'request-limit' });
  });
});

describe('accepting and removing', () => {
  it('makes the friendship symmetric', async () => {
    const a = await makeUser('Ann');
    const b = await makeUser('Bob');

    await friends.request(a.id, 'Bob');
    expect((await friends.accept(b.id, a.id)).ok).toBe(true);

    expect((await friends.list(a.id))[0]!.status).toBe('accepted');
    expect((await friends.list(b.id))[0]!.status).toBe('accepted');
    expect(await friends.canInteract(a.id, b.id)).toBe(true);
  });

  /** Or one player could friend anybody unilaterally. */
  it('refuses to accept your OWN outgoing request', async () => {
    const a = await makeUser('Ann');
    await makeUser('Bob');
    const b = (await repos.users.findByUsername('Bob'))!;

    await friends.request(a.id, 'Bob');

    expect(await friends.accept(a.id, b.id)).toMatchObject({ error: 'no-request' });
  });

  it('refuses to accept a request that was never sent', async () => {
    const a = await makeUser('Ann');
    const b = await makeUser('Bob');

    expect(await friends.accept(a.id, b.id)).toMatchObject({ error: 'no-request' });
  });

  it('removes from both sides', async () => {
    const a = await makeUser('Ann');
    const b = await makeUser('Bob');

    await friends.request(a.id, 'Bob');
    await friends.accept(b.id, a.id);
    await friends.remove(a.id, b.id);

    expect(await friends.list(a.id)).toEqual([]);
    expect(await friends.list(b.id)).toEqual([]);
    expect(await friends.canInteract(a.id, b.id)).toBe(false);
  });

  it('is idempotent when removing someone already gone', async () => {
    const a = await makeUser('Ann');
    const b = await makeUser('Bob');

    expect((await friends.remove(a.id, b.id)).ok).toBe(true);
  });
});

describe('blocking', () => {
  /**
   * A block must not be detectable.
   *
   * Telling a harasser "you are blocked" confirms the target is reachable and
   * invites them to make another account. The request appears to succeed and
   * simply goes nowhere.
   */
  it('is invisible to the person blocked', async () => {
    const victim = await makeUser('Victim');
    const harasser = await makeUser('Harasser');

    await friends.block(victim.id, harasser.id);

    const attempt = await friends.request(harasser.id, 'Victim');
    expect(attempt.ok).toBe(true); // Looks normal to them...
    expect(await friends.list(victim.id)).toHaveLength(1); // ...but only the block row exists.
    expect((await friends.list(victim.id))[0]!.status).toBe('blocked');
  });

  it('severs an existing friendship', async () => {
    const a = await makeUser('Ann');
    const b = await makeUser('Bob');

    await friends.request(a.id, 'Bob');
    await friends.accept(b.id, a.id);
    await friends.block(a.id, b.id);

    expect(await friends.list(b.id)).toEqual([]);
    expect(await friends.canInteract(a.id, b.id)).toBe(false);
    expect(await friends.canInteract(b.id, a.id)).toBe(false);
  });
});

describe('the list is ordered for use', () => {
  /**
   * A friends list in a fighting game exists to start a fight. Sorting
   * alphabetically would bury the one person waiting on you under 200 names.
   */
  it('leads with requests to answer, then friends you can actually fight', async () => {
    const me = await makeUser('Me');
    const asker = await makeUser('Asker');
    const idle = await makeUser('Idle');
    const busy = await makeUser('Busy');
    const away = await makeUser('Away');

    await friends.request(asker.id, 'Me'); // incoming, needs a decision

    for (const other of [idle, busy, away]) {
      await friends.request(me.id, other.username);
      await friends.accept(other.id, me.id);
    }

    presence.online.add(idle.id);
    presence.online.add(busy.id);
    presence.busy.add(busy.id);

    expect((await friends.list(me.id)).map((f) => f.username)).toEqual([
      'Asker', // decision needed
      'Idle', // online and free
      'Busy', // online, mid-match
      'Away', // offline
    ]);
  });

  it('reports live presence only for accepted friends', async () => {
    const me = await makeUser('Me');
    const other = await makeUser('Other');

    await friends.request(me.id, 'Other');
    presence.online.add(other.id);

    // Still only pending — presence would leak that the account is active
    // before they have agreed to share anything.
    expect((await friends.list(me.id))[0]!.online).toBe(false);

    await friends.accept(other.id, me.id);
    expect((await friends.list(me.id))[0]!.online).toBe(true);
    expect((await friends.list(me.id))[0]!.activity).toBe('idle');
  });

  it('drops rows whose account no longer exists', async () => {
    const me = await makeUser('Me');
    await repos.friends.put({
      userId: me.id,
      friendId: newUserId(),
      status: 'accepted',
      outgoing: true,
      createdAt: 0,
    });

    expect(await friends.list(me.id)).toEqual([]);
  });
});

describe('challenge eligibility', () => {
  it('allows only mutual friends', async () => {
    const a = await makeUser('Ann');
    const b = await makeUser('Bob');
    const stranger = await makeUser('Stranger');

    await friends.request(a.id, 'Bob');
    expect(await friends.canInteract(a.id, b.id)).toBe(false); // pending is not enough

    await friends.accept(b.id, a.id);
    expect(await friends.canInteract(a.id, b.id)).toBe(true);
    expect(await friends.canInteract(a.id, stranger.id)).toBe(false);
  });
});
