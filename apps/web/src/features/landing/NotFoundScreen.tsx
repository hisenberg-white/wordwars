import { Link } from 'react-router-dom';
import { Button } from '@/ui/Button';
import { Wordmark } from '@/ui/Wordmark';

export function NotFoundScreen() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Wordmark size="md" />
      <p className="font-display text-7xl font-700 text-p1 text-glow-p1">K.O.</p>
      <p className="max-w-sm text-ink-dim">
        This page took a hit it could not recover from.
      </p>
      <Link to="/">
        <Button variant="secondary">Back to the arena</Button>
      </Link>
    </main>
  );
}
