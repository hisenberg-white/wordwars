/**
 * Minimal class name joiner.
 *
 * Deliberately not `clsx` + `tailwind-merge` — at this size the dependency
 * weight is not justified, and conflicting-class merging is a symptom of
 * component APIs that accept too much styling override in the first place.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
