import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, PlayerId } from '@wordwars/shared';
import { PanelLabel } from '@/ui/Panel';
import { cn } from '@/ui/cn';

const MAX_LENGTH = 200;

export function LobbyChat({
  messages,
  selfId,
  onSend,
}: {
  messages: readonly ChatMessage[];
  selfId: PlayerId | null;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  /**
   * Auto-scroll, but only when the player is already at the bottom.
   *
   * Yanking someone back down while they are reading earlier messages is a
   * small betrayal that every chat UI gets wrong at least once.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const send = () => {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
  };

  return (
    <div className="flex h-72 flex-col">
      <PanelLabel>Room chat</PanelLabel>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="mt-3 flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm"
      >
        {messages.length === 0 && (
          <p className="text-xs text-ink-faint">No messages yet. Say hello.</p>
        )}

        {messages.map((m) => (
          <div key={m.id} className="leading-snug">
            {m.system ? (
              <span className="text-xs italic text-ink-faint">{m.text}</span>
            ) : (
              <>
                <span
                  className={cn(
                    'font-display text-xs font-600 uppercase tracking-wide',
                    m.playerId === selfId ? 'text-p1' : 'text-p2',
                  )}
                >
                  {m.nickname}
                </span>
                {/* Rendered as text, never HTML — React escapes this, which is
                    why the server does not mangle messages containing < or &. */}
                <span className="ml-2 break-words text-ink-dim">{m.text}</span>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          maxLength={MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
            // The lobby has no typing gameplay, but Escape should still return
            // focus to the page rather than being swallowed.
            if (e.key === 'Escape') e.currentTarget.blur();
          }}
          placeholder="Say something…"
          aria-label="Chat message"
          className="min-w-0 flex-1 border border-line bg-abyss px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint/60 focus:border-p2"
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim()}
          className="clip-notch border border-line-bright px-4 font-display text-xs font-600 uppercase tracking-wider text-ink-dim transition-colors hover:border-p2 hover:text-ink disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}
