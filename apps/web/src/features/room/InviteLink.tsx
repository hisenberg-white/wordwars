import { useEffect, useState } from 'react';
import { Button } from '@/ui/Button';
import { PanelLabel } from '@/ui/Panel';

/**
 * The invite surface.
 *
 * Shows the code big and the link small. Both are offered because they serve
 * different moments: the link is what you paste into a group chat, the code is
 * what you read aloud to someone sitting next to you. Forcing one or the other
 * breaks half the ways friends actually get into a room together.
 */
export function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const url = `${window.location.origin}/room/${code}`;

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 1_800);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async (what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(what === 'code' ? code : url);
      setCopied(what);
    } catch {
      // Clipboard is blocked on insecure origins and in some browsers. The
      // code stays selectable on screen, so this is a degraded path rather
      // than a broken one — never surface it as an error.
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <PanelLabel className="text-p2">Room code</PanelLabel>

      <button
        type="button"
        onClick={() => void copy('code')}
        title="Copy code"
        className="clip-panel border border-line-bright bg-abyss px-8 py-4 font-mono text-4xl font-bold tracking-[0.35em] text-ink transition-colors hover:border-p2 sm:text-5xl"
      >
        {code}
      </button>

      <div className="flex items-center gap-2">
        <code className="max-w-[16rem] truncate rounded bg-abyss px-3 py-1.5 text-xs text-ink-dim">
          {url}
        </code>
        <Button variant="secondary" size="sm" onClick={() => void copy('link')}>
          {copied === 'link' ? 'Copied' : 'Copy link'}
        </Button>
      </div>

      <span className="h-4 text-xs text-success">{copied === 'code' ? 'Code copied' : ''}</span>
    </div>
  );
}
