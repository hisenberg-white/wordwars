import { useState } from 'react';
import {
  PASSWORD_ERROR_MESSAGE,
  validateEmail,
  validatePassword,
  validateUsername,
  NICKNAME_ERROR_MESSAGE,
} from '@wordwars/shared';
import { authManager } from '@/net/AuthManager';
import { identity } from '@/net/IdentityManager';
import { useAuth, useIdentity } from '@/net/useConnection';
import { Button } from '@/ui/Button';
import { Panel, PanelLabel } from '@/ui/Panel';
import { cn } from '@/ui/cn';

type Mode = 'register' | 'login';

/**
 * Sign up or sign in.
 *
 * Defaults to REGISTER, because the overwhelmingly common case is a guest who
 * just finished a match and wants to keep it. Someone returning already knows
 * where the login tab is; a first-timer should not have to find it.
 *
 * Pre-fills the username with the guest name they have been playing under, so
 * the account feels like a continuation rather than a fresh start.
 */
export function AuthDialog({
  onClose,
  initialMode = 'register',
}: {
  onClose: () => void;
  initialMode?: Mode;
}) {
  const { status, error } = useAuth();
  const { identity: guest } = useIdentity();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState(guest?.nickname ?? '');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const emailError = touched && validateEmail(email) ? 'That does not look like an email.' : null;
  const usernameProblem = validateUsername(username);
  const usernameError =
    touched && mode === 'register' && usernameProblem
      ? NICKNAME_ERROR_MESSAGE[usernameProblem]
      : null;
  const passwordProblem = validatePassword(password);
  const passwordError =
    touched && mode === 'register' && passwordProblem
      ? PASSWORD_ERROR_MESSAGE[passwordProblem]
      : null;

  const busy = status === 'working';
  const blocked =
    mode === 'register'
      ? Boolean(validateEmail(email) || usernameProblem || passwordProblem)
      : email.length === 0 || password.length === 0;

  const submit = async () => {
    setTouched(true);
    if (blocked || busy) return;

    const ok =
      mode === 'register'
        ? await authManager.register({
            email,
            username,
            password,
            // Hands the server the guest identity so the matches already
            // played become the first entries in this account's history.
            ...(identity.storedToken ? { guestToken: identity.storedToken } : {}),
          })
        : await authManager.login(email, password);

    if (ok) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === 'register' ? 'Create an account' : 'Sign in'}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-void/85 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <Panel className="w-full max-w-md p-7" onClick={(e) => e.stopPropagation()}>
        <div className="flex gap-1">
          {(['register', 'login'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'clip-tab px-5 py-2 font-display text-xs font-600 uppercase tracking-[0.15em] transition-colors',
                mode === m ? 'bg-raised text-ink' : 'text-ink-dim hover:text-ink',
              )}
            >
              {m === 'register' ? 'Create account' : 'Sign in'}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-4">
          <Field label="Email" error={emailError}>
            <input
              type="email"
              value={email}
              autoFocus
              autoComplete="email"
              onChange={(e) => {
                setEmail(e.target.value);
                setTouched(true);
              }}
              className={inputClass}
            />
          </Field>

          {mode === 'register' && (
            <Field label="Fighter name" error={usernameError}>
              <input
                value={username}
                autoComplete="username"
                onChange={(e) => {
                  setUsername(e.target.value);
                  setTouched(true);
                }}
                className={inputClass}
              />
            </Field>
          )}

          <Field label="Password" error={passwordError}>
            <input
              type="password"
              value={password}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              onChange={(e) => {
                setPassword(e.target.value);
                setTouched(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              className={inputClass}
            />
          </Field>
        </div>

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Not now
          </Button>
          <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Working…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </Button>
        </div>

        {mode === 'register' && (
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            Your guest matches come with you. Nothing you have played is lost.
          </p>
        )}
      </Panel>
    </div>
  );
}

const inputClass =
  'w-full border border-line bg-abyss px-4 py-2.5 text-ink outline-none transition-colors focus:border-p2';

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <PanelLabel>{label}</PanelLabel>
      <div className="mt-1.5">{children}</div>
      <span className="mt-1 block h-4 text-xs text-danger">{error ?? ''}</span>
    </div>
  );
}
