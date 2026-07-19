import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopNav } from '@/features/landing/components/TopNav';
import { Panel, PanelLabel } from '@/ui/Panel';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { useAuth } from '@/net/useConnection';
import { authManager } from '@/net/AuthManager';
import { connection } from '@/net/ConnectionManager';
import { API_BASE } from '@/net/serverUrl';

/**
 * Friends.
 *
 * A friends list in a fighting game exists to START A FIGHT. Everything on this
 * screen is arranged around that: the server sorts the list so the people you
 * can play right now are at the top, and the primary action on a row is
 * Challenge — not a profile link, not a message box.
 */

interface Friend {
  userId: string;
  username: string;
  level: number;
  countryCode: string | null;
  status: 'accepted' | 'pending-incoming' | 'pending-outgoing' | 'blocked';
  online: boolean;
  activity: 'idle' | 'in-match' | null;
}

export function FriendsScreen() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (path: string, body?: unknown) => {
    const token = authManager.token();
    if (!token) return null;

    const response = await fetch(`${API_BASE}/api/friends${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const payload = (await response.json()) as
      { friends: Friend[] } | { error: { code: string; message?: string } };

    if ('error' in payload) {
      setError(payload.error.message ?? 'That did not work.');
      return null;
    }

    setError(null);
    setFriends(payload.friends);
    return payload;
  }, []);

  useEffect(() => {
    if (!user) return;
    void call('');

    /*
     * Presence changes while you are looking at the list, so a static snapshot
     * goes stale within seconds — and a friends list that says someone is
     * online when they left is worse than one that says nothing.
     */
    const timer = setInterval(() => void call(''), 15_000);
    return () => clearInterval(timer);
  }, [user, call]);

  if (!user) {
    return (
      <Shell>
        <Panel className="max-w-md p-8 text-center">
          <PanelLabel>Friends</PanelLabel>
          <p className="mt-3 text-sm text-ink-dim">
            Friends need an account on both sides. Make one and you can challenge them directly.
          </p>
        </Panel>
      </Shell>
    );
  }

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || busy) return;

    setBusy(true);
    const result = await call('/request', { username: name.trim() });
    if (result) setName('');
    setBusy(false);
  };

  const challenge = (friend: Friend) => {
    connection.socket?.emit('friend:challenge', { userId: friend.userId }, (result) => {
      if (!result.ok) {
        setError(result.error.detail ?? 'They are not available right now.');
        return;
      }
      // Straight into the room we just made — the challenge is only half the
      // action, and leaving the challenger on this screen would be a dead end.
      void navigate(`/room/${result.data.code}`);
    });
  };

  const incoming = friends.filter((f) => f.status === 'pending-incoming');
  const accepted = friends.filter((f) => f.status === 'accepted');
  const outgoing = friends.filter((f) => f.status === 'pending-outgoing');

  return (
    <Shell>
      <div className="w-full max-w-2xl space-y-6">
        <h1 className="font-display text-3xl font-700 uppercase tracking-[0.2em] text-ink">
          Friends
        </h1>

        <Panel className="p-6">
          <PanelLabel>Add a friend</PanelLabel>
          <form onSubmit={add} className="mt-3 flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Their username"
              className="min-w-0 flex-1 border border-line/60 bg-abyss/60 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-p1/60"
            />
            <Button type="submit" variant="secondary" disabled={busy || !name.trim()}>
              Send
            </Button>
          </form>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </Panel>

        {incoming.length > 0 && (
          <Section label={`Requests (${incoming.length})`}>
            {incoming.map((friend) => (
              <Row key={friend.userId} friend={friend}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void call('/accept', { userId: friend.userId })}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void call('/remove', { userId: friend.userId })}
                >
                  Decline
                </Button>
              </Row>
            ))}
          </Section>
        )}

        <Section label={`Friends (${accepted.length})`}>
          {accepted.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-dim">
              No friends yet. Add someone by username and challenge them directly.
            </p>
          ) : (
            accepted.map((friend) => (
              <Row key={friend.userId} friend={friend}>
                {/* Only an idle friend can actually take a fight right now. */}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={friend.activity !== 'idle'}
                  onClick={() => challenge(friend)}
                >
                  {friend.activity === 'in-match' ? 'Fighting' : 'Challenge'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void call('/remove', { userId: friend.userId })}
                >
                  Remove
                </Button>
              </Row>
            ))
          )}
        </Section>

        {outgoing.length > 0 && (
          <Section label={`Sent (${outgoing.length})`}>
            {outgoing.map((friend) => (
              <Row key={friend.userId} friend={friend}>
                <span className="text-xs text-ink-faint">Pending</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void call('/remove', { userId: friend.userId })}
                >
                  Cancel
                </Button>
              </Row>
            ))}
          </Section>
        )}
      </div>
    </Shell>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Panel className="p-0">
      <div className="border-b border-line/50 px-5 py-3">
        <PanelLabel>{label}</PanelLabel>
      </div>
      <div>{children}</div>
    </Panel>
  );
}

function Row({ friend, children }: { friend: Friend; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line/30 px-5 py-3 last:border-b-0">
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          friend.activity === 'idle' && 'bg-success',
          friend.activity === 'in-match' && 'bg-ultimate',
          !friend.online && 'bg-line-bright',
        )}
        title={friend.activity === 'in-match' ? 'In a match' : friend.online ? 'Online' : 'Offline'}
      />

      <span className="min-w-0 flex-1 truncate text-sm text-ink">{friend.username}</span>
      <span className="shrink-0 text-[0.65rem] text-ink-faint">Lv {friend.level}</span>

      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="flex flex-1 items-start justify-center px-6 py-12">{children}</main>
    </div>
  );
}
