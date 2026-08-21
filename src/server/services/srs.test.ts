import { describe, it, expect } from 'vitest';
import { calculateNextEligible, fromStamp, shiftOutOfTheNight, toStamp } from './srs.js';

/** Built from local-time parts, since the night window is expressed in local time */
function at(hour: number, minute = 0): Date {
  return new Date(2026, 7, 21, hour, minute, 0, 0);
}

describe('shiftOutOfTheNight', () => {
  it('leaves waking hours alone', () => {
    for (const hour of [6, 9, 12, 18, 22]) {
      expect(shiftOutOfTheNight(at(hour)).getTime()).toBe(at(hour).getTime());
    }
  });

  it('moves the late evening into the morning', () => {
    expect(shiftOutOfTheNight(at(23, 30)).getHours()).toBe(6);
    expect(shiftOutOfTheNight(at(23, 30)).getMinutes()).toBe(30);
  });

  it('moves the small hours into the afternoon', () => {
    expect(shiftOutOfTheNight(at(3)).getHours()).toBe(10);
    expect(shiftOutOfTheNight(at(5, 59)).getHours()).toBe(12);
  });

  it('never returns a time inside the window', () => {
    for (let hour = 0; hour < 24; hour++) {
      const hourOut = shiftOutOfTheNight(at(hour)).getHours();
      expect(hourOut).toBeGreaterThanOrEqual(6);
      expect(hourOut).toBeLessThan(23);
    }
  });

  it('does not move a time backwards', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(shiftOutOfTheNight(at(hour)).getTime()).toBeGreaterThanOrEqual(at(hour).getTime());
    }
  });
});

describe('stamps', () => {
  it('round-trip as UTC, not local time', () => {
    const date = new Date('2026-08-21T10:52:54.000Z');
    expect(toStamp(date)).toBe('2026-08-21 10:52:54');
    expect(fromStamp('2026-08-21 10:52:54').toISOString()).toBe(date.toISOString());
  });
});

describe('calculateNextEligible', () => {
  it('never schedules into the night, whichever bucket', () => {
    for (let bucket = 0; bucket <= 9; bucket++) {
      for (let run = 0; run < 20; run++) {
        const hour = fromStamp(calculateNextEligible(bucket)).getHours();
        expect(hour).toBeGreaterThanOrEqual(6);
        expect(hour).toBeLessThan(23);
      }
    }
  });
});
