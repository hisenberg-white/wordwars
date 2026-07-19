import { useState } from 'react';
import { authManager } from '@/net/AuthManager';
import { useAuth } from '@/net/useConnection';
import { AuthDialog } from './AuthDialog';

/**
 * Account state in the nav.
 *
 * Signed-out players see "Sign in" rather than a demand — the game is fully
 * playable without ever touching it (plan §"NO ACCOUNT REQUIRED"), so this is
 * an offer, not a gate.
 */
export function AccountChip() {
  const { user, status, ephemeral } = useAuth();
  const [open, setOpen] = useState(false);

  if (status === 'unknown') return null;

  return (
    <>
      {user ? (
        <button
          type="button"
          onClick={() => authManager.signOut()}
          title={
            ephemeral
              ? 'This server has no database — your account lasts until it restarts'
              : `Signed in as ${user.username}`
          }
          className="clip-notch border border-p2/40 px-4 py-2 font-display text-xs font-600 uppercase tracking-[0.12em] text-p2 transition-colors hover:border-p2"
        >
          Lv {user.level}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-display text-xs font-600 uppercase tracking-[0.12em] text-ink-faint transition-colors hover:text-ink"
        >
          Sign in
        </button>
      )}

      {open && <AuthDialog onClose={() => setOpen(false)} initialMode="login" />}
    </>
  );
}
