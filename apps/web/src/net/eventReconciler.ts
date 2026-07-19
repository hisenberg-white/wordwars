import type { CombatEvent, PlayerId } from '@wordwars/shared';

/**
 * Decides which combat events the renderer should actually see.
 *
 * **This exists because prediction and authority produce the SAME event
 * twice.** The client resolves its own word locally so the attack animates on
 * the keystroke frame (plan §1.1 D1); milliseconds later the server sends its
 * authoritative copy of that identical attack. Rendering both applies the
 * damage twice — the HP bar visibly double-drops and then snaps back when the
 * 10Hz snapshot corrects it, and the player eats two hit-stops and sees two
 * damage numbers for one word.
 *
 * The rule that resolves it is simple, because the client predicts exactly one
 * thing and nothing else:
 *
 *   - **Our own actions** are rendered from the PREDICTION. The server's copy
 *     is dropped as a duplicate; snapshots still correct any drift.
 *   - **The opponent's actions** are rendered from the SERVER. We never
 *     predict them — we have no idea what they are typing.
 *   - **Match-ending events** always come from the server, whoever caused
 *     them. Deciding a match is not the client's business.
 */

/** Events the client resolves locally and must not re-apply from the server. */
const PREDICTED_TYPES: ReadonlySet<CombatEvent['type']> = new Set([
  'attack',
  'miss',
  'ultimate',
  'combo-tier',
  'ultimate-ready',
]);

function actorOf(event: CombatEvent): PlayerId | null {
  return 'actor' in event ? event.actor : null;
}

/**
 * Filters a locally predicted batch.
 *
 * A knockout is withheld even when our own prediction produces one: if the
 * local engine and the server disagree by a single point of damage, a
 * predicted KO would end the fight on screen for a match still being played.
 */
export function filterPredicted(events: readonly CombatEvent[]): CombatEvent[] {
  return events.filter((event) => event.type !== 'knockout');
}

/** Filters an authoritative batch, dropping what we already showed. */
export function filterServer(
  events: readonly CombatEvent[],
  selfId: PlayerId | null,
): CombatEvent[] {
  if (!selfId) return [...events];

  return events.filter((event) => {
    if (!PREDICTED_TYPES.has(event.type)) return true;
    return actorOf(event) !== selfId;
  });
}
