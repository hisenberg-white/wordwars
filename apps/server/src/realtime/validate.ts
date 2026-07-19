import type { z } from 'zod';
import { type Ack, ackError } from '@wordwars/shared';
import { logger } from '../logger.js';

type AckFn<T> = (r: Ack<T>) => void;

/**
 * Wraps a socket handler so its payload is parsed before the handler runs.
 *
 * Nothing in `realtime/handlers` should ever call `schema.parse` itself — if a
 * handler receives a typed payload, that payload is already trustworthy. The
 * single most likely way to introduce a remote crash into this codebase is a
 * handler that skips validation, so validation is structural rather than a
 * convention people have to remember.
 */
export function validated<S extends z.ZodTypeAny, R>(
  schema: S,
  handler: (payload: z.infer<S>, ack: AckFn<R>) => void | Promise<void>,
): (raw: unknown, ack: AckFn<R>) => void {
  return (raw, ack) => {
    // A malicious or buggy client can omit the ack callback entirely.
    const respond: AckFn<R> = typeof ack === 'function' ? ack : () => {};

    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      respond(ackError('INVALID_PAYLOAD', parsed.error.issues[0]?.message));
      return;
    }

    void Promise.resolve(handler(parsed.data, respond)).catch((err: unknown) => {
      logger.error({ err }, 'Socket handler threw');
      respond(ackError('INTERNAL'));
    });
  };
}

/**
 * Same, for fire-and-forget events with no acknowledgement.
 *
 * `match:word` is the hot path — it fires many times per second per player and
 * must not pay for a round trip. Invalid payloads are dropped and logged at
 * debug rather than reported, because a client that sends a malformed word
 * commit is either buggy or hostile, and neither deserves a reply.
 */
export function validatedVoid<S extends z.ZodTypeAny>(
  schema: S,
  handler: (payload: z.infer<S>) => void,
): (raw: unknown) => void {
  return (raw) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      logger.debug({ issues: parsed.error.issues }, 'Dropped malformed payload');
      return;
    }

    try {
      handler(parsed.data);
    } catch (err) {
      logger.error({ err }, 'Socket handler threw');
    }
  };
}
