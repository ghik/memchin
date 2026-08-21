import { describe, it, expect } from 'vitest';
import { fromStamp, toStamp } from './time.js';

describe('fromStamp', () => {
  it('reads a stored stamp as UTC, not as local time', () => {
    expect(fromStamp('2026-08-21 10:52:54').toISOString()).toBe('2026-08-21T10:52:54.000Z');
  });

  it('is the inverse of toStamp', () => {
    const date = new Date('2026-12-31T23:00:00.000Z');
    expect(fromStamp(toStamp(date)).getTime()).toBe(date.getTime());
  });

  it('does not drift when the machine is not on UTC', () => {
    // Whatever the local offset, a stamp names one instant, so the gap between two stamps an
    // hour apart is an hour — the property the due-time display was getting wrong.
    const early = fromStamp('2026-08-21 10:00:00');
    const late = fromStamp('2026-08-21 11:00:00');
    expect(late.getTime() - early.getTime()).toBe(3_600_000);
  });
});
