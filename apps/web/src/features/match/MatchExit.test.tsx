import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MatchExit } from './MatchExit';

// `vi.mock` is hoisted above the whole file, so its factory cannot close over
// ordinary consts — `vi.hoisted` lifts these along with it.
const { emit, setInputPaused } = vi.hoisted(() => ({
  emit: vi.fn(),
  setInputPaused: vi.fn(),
}));

vi.mock('@/net/ConnectionManager', () => ({
  connection: {
    get socket() {
      return { emit };
    },
  },
}));
vi.mock('@/net/MatchManager', () => ({ matchManager: { setInputPaused } }));

const show = (live = true) =>
  render(
    <MemoryRouter>
      <MatchExit live={live} />
    </MemoryRouter>,
  );

afterEach(() => {
  cleanup();
  emit.mockClear();
  setInputPaused.mockClear();
});

/**
 * A fight you cannot leave is a trap.
 *
 * There was no back, no cross and no forfeit in a live match — `match:forfeit`
 * existed on the server with nothing in the product ever calling it. A player
 * had to play to the end or close the tab.
 */
describe('getting out of a match', () => {
  it('offers a visible way out', () => {
    show();
    expect(screen.getByRole('button', { name: 'Leave match' })).toBeDefined();
  });

  it('opens the leave menu on Escape', () => {
    show();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Leave match' })).toBeDefined();
  });

  /**
   * Escape is the key a flustered player hits mid-combo, and the only key this
   * game can bind. Quitting straight from it would forfeit matches nobody meant
   * to forfeit, so leaving takes a second deliberate action.
   */
  it('does NOT forfeit on the keypress alone', () => {
    show();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('forfeits only when the player confirms', () => {
    show();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /forfeit and leave/i }));

    expect(emit).toHaveBeenCalledWith('match:forfeit', expect.any(Function));
  });

  it('says plainly that leaving a live match costs the win', () => {
    show(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText(/counts as a forfeit/i)).toBeDefined();
  });

  /** Nothing is forfeited once the fight is already over. */
  it('does not threaten a forfeit after the match has ended', () => {
    show(false);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByText(/counts as a forfeit/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^leave$/i })).toBeDefined();
  });
});

describe('the keyboard while the menu is open', () => {
  /**
   * Typing must not reach the arena through the dialog, or the player attacks
   * blind. Not an exploit: the match clock keeps running server-side.
   */
  it('suspends combat input while open and restores it on close', () => {
    show();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(setInputPaused).toHaveBeenCalledWith(true);

    setInputPaused.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /keep fighting/i }));
    expect(setInputPaused).toHaveBeenCalledWith(false);
  });
});
