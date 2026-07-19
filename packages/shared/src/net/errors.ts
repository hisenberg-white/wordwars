/**
 * Error codes crossing the wire.
 *
 * Codes, not messages. The client owns the wording so it can localise and so
 * copy changes do not require a server deploy.
 */
export const SOCKET_ERROR_CODES = [
  'INVALID_PAYLOAD',
  'UNAUTHENTICATED',
  'RATE_LIMITED',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_IN_PROGRESS',
  'WRONG_PASSWORD',
  'NOT_HOST',
  'NOT_ENOUGH_PLAYERS',
  'PLAYERS_NOT_READY',
  'ALREADY_IN_ROOM',
  'ALREADY_IN_QUEUE',
  'MATCH_NOT_FOUND',
  'NOT_IN_MATCH',
  'NICKNAME_TAKEN',
  'INTERNAL',
] as const;

export type SocketErrorCode = (typeof SOCKET_ERROR_CODES)[number];

export interface SocketError {
  readonly code: SocketErrorCode;
  /** Developer-facing detail. Never rendered to players verbatim. */
  readonly detail?: string;
}

/**
 * Acknowledgement envelope for request/response style events.
 *
 * Socket.io acks are the right tool for "did my action succeed" — using a
 * separate error event forces the client to correlate responses by hand.
 */
export type Ack<T = void> = { ok: true; data: T } | { ok: false; error: SocketError };

export const ackOk = <T>(data: T): Ack<T> => ({ ok: true, data });

export const ackError = (code: SocketErrorCode, detail?: string): Ack<never> => ({
  ok: false,
  error: detail === undefined ? { code } : { code, detail },
});
