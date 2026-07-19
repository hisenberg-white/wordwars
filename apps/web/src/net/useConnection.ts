import { useEffect, useSyncExternalStore } from 'react';
import { connection, type ConnectionSnapshot } from './ConnectionManager';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

/**
 * Subscribes to connection state.
 *
 * `useSyncExternalStore` rather than a context + state: the manager is the
 * source of truth and React is a subscriber. Components re-render only when
 * status, ping or clock offset actually change — not on every heartbeat.
 */
export function useConnection(): ConnectionSnapshot {
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
}

/**
 * Opens the connection for the lifetime of the app.
 *
 * Mount this once, at the root. It deliberately does NOT disconnect on unmount:
 * the socket is app-scoped, and StrictMode's double-mount in development would
 * otherwise tear down a healthy connection immediately after opening it.
 */
export function useConnectionLifecycle(): void {
  useEffect(() => {
    connection.connect(SERVER_URL);
  }, []);
}
