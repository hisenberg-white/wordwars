import { AdSlot } from '@/ui/AdSlot';
import { TopNav } from './components/TopNav';
import { Hero } from './components/Hero';
import { CombatPrimer } from './components/CombatPrimer';
import { RosterPreview } from './components/RosterPreview';
import { SiteFooter } from './components/SiteFooter';

export function LandingScreen() {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />

      {/* Banner sits below the nav, above the fold, and out of the way. It
          removes itself entirely once a match starts — see AdSlot. */}
      <div className="mx-auto w-full max-w-7xl px-6 pt-4">
        <AdSlot placement="nav-banner" />
      </div>

      <main className="flex-1">
        <Hero />
        <CombatPrimer />
        <RosterPreview />
      </main>

      <SiteFooter />
    </div>
  );
}
