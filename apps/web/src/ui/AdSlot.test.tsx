import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdSlot } from './AdSlot';
import { setAppPhase, type AppPhase } from '@/store/appPhase';

/**
 * The phase store lives outside React, so a change to it updates any mounted
 * subscriber. Wrapping in `act` is what tells React the update was deliberate —
 * without it every test logs a warning, and warnings people learn to ignore are
 * worse than no warnings at all.
 */
const goToPhase = (phase: AppPhase) => act(() => setAppPhase(phase));

/**
 * These tests exist to protect a PRODUCT rule, not an implementation detail.
 *
 * "Ads never appear during gameplay" (plan §"ADVERTISEMENT") is the kind of
 * promise that erodes quietly — someone adds a HUD banner two phases from now
 * and nobody notices until players do. Encoding it here means breaking it
 * breaks the build.
 */

// Runs before the library's auto-cleanup (hooks unwind last-registered-first),
// so the component is still mounted and this reset must be act-wrapped too.
afterEach(() => goToPhase('menu'));

describe('AdSlot', () => {
  it('renders outside gameplay', () => {
    render(<AdSlot placement="nav-banner" />);

    expect(screen.getByLabelText('Advertisement')).toBeInTheDocument();
  });

  it('renders nothing during combat', () => {
    goToPhase('combat');
    const { container } = render(<AdSlot placement="nav-banner" />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByLabelText('Advertisement')).not.toBeInTheDocument();
  });

  /** The case a static check would miss: an ad already on screen when the fight starts. */
  it('removes itself when a match starts while it is on screen', () => {
    const { container } = render(<AdSlot placement="nav-banner" />);
    expect(screen.getByLabelText('Advertisement')).toBeInTheDocument();

    goToPhase('combat');

    expect(container).toBeEmptyDOMElement();
  });

  it.each<AppPhase>(['menu', 'matchmaking', 'lobby', 'results'])(
    'is permitted during the %s phase',
    (phase) => {
      goToPhase(phase);
      render(<AdSlot placement="nav-banner" />);

      expect(screen.getByLabelText('Advertisement')).toBeInTheDocument();
    },
  );

  it('can be dismissed by the player', async () => {
    render(<AdSlot placement="nav-banner" />);

    await userEvent.setup().click(screen.getByLabelText('Dismiss advertisement'));

    expect(screen.queryByLabelText('Advertisement')).not.toBeInTheDocument();
  });
});
