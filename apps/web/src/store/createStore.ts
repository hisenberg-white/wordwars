import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

/**
 * A minimal external store.
 *
 * Deliberately not zustand (yet). The realtime layer already owns its state in
 * plain classes outside React (plan §1.1 D3), and this exists so UI state
 * follows the same shape rather than introducing a second, competing idea of
 * where state lives. If the store surface grows past this, swapping in zustand
 * is a contained change — the `useStore` call sites stay identical.
 */
export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => state,

    set(patch) {
      const next = { ...state, ...patch };

      // useSyncExternalStore compares snapshots by reference and will loop
      // forever if handed a fresh object for unchanged data.
      const changed = (Object.keys(patch) as Array<keyof T>).some((k) => next[k] !== state[k]);
      if (!changed) return;

      state = next;
      for (const listener of listeners) listener();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
