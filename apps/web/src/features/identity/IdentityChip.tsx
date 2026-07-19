import { useState } from 'react';
import { useIdentity } from '@/net/useConnection';
import { NicknameDialog } from './NicknameDialog';

/**
 * The player's name in the nav, click-to-edit.
 *
 * Shown as an editable control rather than static text because the nickname is
 * the one piece of identity a guest owns, and burying it behind a settings page
 * would mean most players never change it. Editing must be reachable in one
 * click, from anywhere before a match.
 */
export function IdentityChip() {
  const { identity, status } = useIdentity();
  const [editing, setEditing] = useState(false);

  if (!identity) {
    return (
      <span className="font-display text-xs uppercase tracking-[0.15em] text-ink-faint">
        {status === 'unknown' ? 'Connecting…' : '—'}
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Change your name"
        className="clip-notch group flex items-center gap-2 border border-line-bright px-4 py-2 transition-colors hover:border-p2"
      >
        <span className="font-display text-xs font-600 uppercase tracking-[0.12em] text-ink">
          {identity.nickname}
        </span>
        <span className="text-ink-faint transition-colors group-hover:text-p2" aria-hidden>
          ✎
        </span>
      </button>

      {editing && <NicknameDialog onClose={() => setEditing(false)} />}
    </>
  );
}
