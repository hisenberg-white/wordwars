import { randomInt } from 'node:crypto';
import { asRoomCode, type RoomCode } from '@wordwars/shared';

/**
 * Room code alphabet.
 *
 * Excludes every ambiguous glyph: I, L, O, S among letters and 0, 1, 5, 8
 * among digits. Room codes get read aloud over voice chat and typed in from a
 * screenshot, and each look-alike pair is a friend who fails to join the room.
 *
 * The cost is nothing — 28^6 is still ~482 million codes, against a live room
 * count we would be delighted to see reach five figures.
 */
const LETTERS = 'ABCDEFGHJKMNPQRTUVWXYZ';
const DIGITS = '234679';
const ALPHABET = LETTERS + DIGITS;

export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_SPACE = ALPHABET.length ** ROOM_CODE_LENGTH;

export function generateRoomCode(): RoomCode {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return asRoomCode(code);
}

/** True if a code could have been produced by us — cheap pre-check on join. */
export function isPlausibleRoomCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((ch) => ALPHABET.includes(ch));
}
