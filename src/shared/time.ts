/**
 * Review times are stored as UTC without a zone marker ("2026-08-21 10:52:54"), which both
 * `new Date` and SQLite's `datetime('now')` agree on only as long as nobody reads the string
 * directly: `new Date("2026-08-21 10:52:54")` takes it for local time, quietly moving it by
 * the offset. Server and client alike go through these.
 */
export function toStamp(date: Date): string {
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');
}

export function fromStamp(stamp: string): Date {
  return new Date(`${stamp.replace(' ', 'T')}Z`);
}
