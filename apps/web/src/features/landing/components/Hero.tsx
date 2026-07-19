import { useNavigate } from 'react-router-dom';
import { Button } from '@/ui/Button';
import { Wordmark } from '@/ui/Wordmark';
import { cn } from '@/ui/cn';

/**
 * A fighter portrait frame.
 *
 * Real sprites arrive in 3.4/5.1. Until then this is an angular frame with a
 * glowing abstract silhouette — stylised rather than a grey placeholder box,
 * because the landing page has to look finished long before the art is.
 */
function FighterPortrait({ side, name }: { side: 'p1' | 'p2'; name: string }) {
  const isP1 = side === 'p1';

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cn(
          'clip-panel relative grid h-40 w-32 place-items-center border sm:h-52 sm:w-44',
          isP1 ? 'border-p1/40' : 'border-p2/40',
        )}
        style={{
          background: isP1
            ? 'linear-gradient(160deg, rgb(255 47 87 / 0.18), transparent 70%)'
            : 'linear-gradient(200deg, rgb(0 224 255 / 0.16), transparent 70%)',
        }}
      >
        {/* Abstract fighter silhouette: head + shoulders, facing inward. */}
        <div
          className={cn('animate-float', isP1 ? 'text-p1' : 'text-p2')}
          style={{ animationDelay: isP1 ? '0s' : '1.4s' }}
        >
          <svg width="72" height="96" viewBox="0 0 72 96" fill="none" aria-hidden>
            <g
              fill="currentColor"
              opacity="0.85"
              transform={isP1 ? undefined : 'translate(72,0) scale(-1,1)'}
            >
              <circle cx="38" cy="20" r="13" />
              <path d="M20 44 L52 38 L60 62 L52 96 L18 96 L14 62 Z" />
              <path d="M52 44 L70 56 L64 64 L48 56 Z" />
            </g>
          </svg>
        </div>

        <div
          aria-hidden
          className="absolute inset-0 opacity-60 blur-2xl"
          style={{
            background: isP1
              ? 'radial-gradient(circle at 50% 60%, rgb(255 47 87 / 0.35), transparent 60%)'
              : 'radial-gradient(circle at 50% 60%, rgb(0 224 255 / 0.3), transparent 60%)',
          }}
        />
      </div>

      <span
        className={cn(
          'font-display text-xs font-600 uppercase tracking-[0.2em]',
          isP1 ? 'text-p1' : 'text-p2',
        )}
      >
        {name}
      </span>
    </div>
  );
}

export function Hero() {
  const navigate = useNavigate();

  return (
    <section className="relative flex flex-col items-center px-6 pb-16 pt-14 text-center sm:pt-20">
      <span className="animate-rise font-display text-[0.7rem] font-600 uppercase tracking-[0.35em] text-p2">
        Competitive Typing Combat
      </span>

      <h1 className="animate-rise mt-6" style={{ animationDelay: '60ms' }}>
        <Wordmark size="xl" />
      </h1>

      <p
        className="animate-rise mt-7 max-w-2xl text-balance text-lg leading-relaxed text-ink-dim sm:text-xl"
        style={{ animationDelay: '120ms' }}
      >
        Two fighters. One sentence. Every word you land is a hit — every typo kills your combo.
        Chain a streak, charge your Ultimate, and end it.
      </p>

      {/* The standoff. States the premise faster than any amount of copy. */}
      <div
        className="animate-rise mt-12 flex items-center justify-center gap-8 sm:gap-16"
        style={{ animationDelay: '180ms' }}
      >
        <FighterPortrait side="p1" name="You" />

        <div className="flex flex-col items-center gap-2">
          <span className="font-display text-4xl font-700 italic text-ink sm:text-6xl">VS</span>
          <span className="font-display text-[0.6rem] uppercase tracking-[0.3em] text-ink-faint">
            First to KO
          </span>
        </div>

        <FighterPortrait side="p2" name="Them" />
      </div>

      <div
        className="animate-rise mt-12 flex flex-col items-center gap-4 sm:flex-row"
        style={{ animationDelay: '240ms' }}
      >
        <Button variant="primary" size="lg" onClick={() => navigate('/play')}>
          Play Now
        </Button>
        <Button variant="secondary" size="lg" onClick={() => navigate('/room')}>
          Private Room
        </Button>
      </div>

      <p className="mt-5 font-display text-[0.65rem] uppercase tracking-[0.25em] text-ink-faint">
        No account · No download · Straight into a fight
      </p>
    </section>
  );
}
