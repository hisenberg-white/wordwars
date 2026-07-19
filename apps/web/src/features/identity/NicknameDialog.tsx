import { useEffect, useRef, useState } from 'react';
import { NICKNAME_ERROR_MESSAGE, NICKNAME_MAX, validateNickname } from '@wordwars/shared';
import { renameSelf, useIdentity } from '@/net/useConnection';
import { Button } from '@/ui/Button';
import { Panel, PanelLabel } from '@/ui/Panel';
import { Overlay } from '@/ui/Overlay';

/**
 * Nickname editor.
 *
 * Validates locally as the player types using the SAME rule the server
 * enforces (`validateNickname` from shared), so feedback is instant and never
 * contradicts the eventual answer. The server still re-validates — this is a
 * convenience, not a trust boundary.
 */
export function NicknameDialog({ onClose }: { onClose: () => void }) {
  const { identity, status, error } = useIdentity();
  const [value, setValue] = useState(identity?.nickname ?? '');
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);

  const problem = validateNickname(value);
  const localError = touched && problem ? NICKNAME_ERROR_MESSAGE[problem] : null;

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  // Close once the server confirms the new name. Waiting for confirmation
  // rather than closing optimistically means a rejected name keeps the dialog
  // open with the reason attached, instead of silently reverting behind the
  // player's back.
  useEffect(() => {
    if (submittedRef.current && status === 'ready' && !error) onClose();
  }, [status, error, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = () => {
    setTouched(true);
    if (problem) return;
    submittedRef.current = true;
    renameSelf(value.trim());
  };

  return (
    <Overlay onClose={onClose} label="Change your name">
      <Panel className="w-full max-w-md p-6">
        <PanelLabel className="text-p2">Your fighter name</PanelLabel>

        <input
          ref={inputRef}
          value={value}
          autoFocus
          maxLength={NICKNAME_MAX}
          onChange={(e) => {
            setValue(e.target.value);
            setTouched(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          className="mt-4 w-full border border-line bg-abyss px-4 py-3 font-display text-lg tracking-wide text-ink outline-none transition-colors focus:border-p2"
        />

        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-xs text-danger">{localError ?? error ?? ' '}</span>
          <span className="shrink-0 text-xs text-ink-faint">
            {value.trim().length}/{NICKNAME_MAX}
          </span>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={problem !== null || status === 'renaming'}
          >
            {status === 'renaming' ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Panel>
    </Overlay>
  );
}
