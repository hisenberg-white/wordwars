/**
 * Branded identifier types.
 *
 * These are all `string` at runtime with zero overhead, but the compiler
 * refuses to let a RoomId stand in for a MatchId. In a codebase where four
 * different opaque IDs get threaded through the same socket handlers, this
 * catches a whole class of argument-order mistakes for free.
 */

declare const __brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type PlayerId = Brand<string, 'PlayerId'>;
export type UserId = Brand<string, 'UserId'>;
export type GuestId = Brand<string, 'GuestId'>;
export type RoomId = Brand<string, 'RoomId'>;
export type RoomCode = Brand<string, 'RoomCode'>;
export type MatchId = Brand<string, 'MatchId'>;
export type SocketId = Brand<string, 'SocketId'>;

/**
 * Cast helpers. Use these only at trust boundaries — where a raw string first
 * enters the system (socket payload, DB row, URL param). Everywhere else the
 * branded type should already be flowing.
 */
export const asPlayerId = (v: string): PlayerId => v as PlayerId;
export const asUserId = (v: string): UserId => v as UserId;
export const asGuestId = (v: string): GuestId => v as GuestId;
export const asRoomId = (v: string): RoomId => v as RoomId;
export const asRoomCode = (v: string): RoomCode => v.toUpperCase() as RoomCode;
export const asMatchId = (v: string): MatchId => v as MatchId;
export const asSocketId = (v: string): SocketId => v as SocketId;
