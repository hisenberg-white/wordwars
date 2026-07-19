import { createStore, useStore } from './createStore';

/**
 * Where the player is in the app.
 *
 * This exists primarily to enforce one product rule structurally: **no ads
 * during combat** (plan §"ADVERTISEMENT"). Rather than trusting every future
 * screen to remember, `AdSlot` reads this and refuses to render itself while a
 * fight is happening. A rule that depends on people remembering it will be
 * broken; a rule enforced by the component cannot be.
 */
export type AppPhase = 'menu' | 'matchmaking' | 'lobby' | 'combat' | 'results';

interface AppPhaseState {
  phase: AppPhase;
}

const store = createStore<AppPhaseState>({ phase: 'menu' });

export const setAppPhase = (phase: AppPhase): void => store.set({ phase });

export const useAppPhase = (): AppPhase => useStore(store).phase;

/** True when advertising must be suppressed. */
export const isCombatPhase = (phase: AppPhase): boolean => phase === 'combat';
