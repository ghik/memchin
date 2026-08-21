import type { PracticeMode } from '../../shared/types.js';
import { getProgress, upsertProgress } from '../db.js';

// Bucket delays in minutes
const BUCKET_DELAYS_MINUTES = [
  0, // Immediate
  5, // 5 minutes
  30, // 30 minutes
  4 * 60, // 4 hours
  24 * 60, // 1 day
  3 * 24 * 60, // 3 day
  7 * 24 * 60, // 7 days
  14 * 24 * 60, // 14 days
  30 * 24 * 60, // 30 days
  60 * 24 * 60, // 60 days
];

export const MAX_BUCKET = BUCKET_DELAYS_MINUTES.length - 1;

/** Nothing should come due between these hours, local time */
const NIGHT_START_HOUR = 23;
const NIGHT_END_HOUR = 6;
const NIGHT_SHIFT_HOURS = 7;

function isNight(date: Date): boolean {
  const hour = date.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

/**
 * Moves a time that lands in the night past it, so nothing falls due while the learner is
 * asleep and greets them as a backlog in the morning.
 *
 * The window is seven hours wide and the shift is seven hours, so one pass normally clears it;
 * the loop is for the clocks going back, where seven hours of elapsed time advance the local
 * clock by only six and can leave 23:00 at 05:00. Each pass moves absolute time forward, so it
 * always terminates.
 */
export function shiftOutOfTheNight(date: Date): Date {
  const shifted = new Date(date);
  while (isNight(shifted)) {
    shifted.setTime(shifted.getTime() + NIGHT_SHIFT_HOURS * 60 * 60 * 1000);
  }
  return shifted;
}

/**
 * Timestamps are stored as UTC without a zone marker ("2026-08-21 10:52:54"), which `new Date`
 * would otherwise read as local time. Everything that touches the column goes through these.
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

export function calculateNextEligible(bucket: number): string {
  const delayMinutes = BUCKET_DELAYS_MINUTES[Math.min(bucket, MAX_BUCKET)];
  // Add ±25% jitter so words from the same session don't all become due at the same time
  const jitter = delayMinutes * (0.75 + Math.random() * 0.5);
  return toStamp(shiftOutOfTheNight(new Date(Date.now() + jitter * 60 * 1000)));
}

export function updateProgress(
  hanzi: string,
  mode: PracticeMode,
  correct: boolean,
  characterMode: boolean
): void {
  const currentProgress = getProgress(hanzi, mode);
  const currentBucket = currentProgress?.bucket ?? 0;

  const isDue =
    !currentProgress?.nextEligible || new Date(currentProgress.nextEligible) <= new Date();

  if (!isDue && correct) {
    return;
  }

  let newBucket: number;
  if (correct) {
    newBucket = Math.min(currentBucket + 1, MAX_BUCKET);
  } else {
    newBucket = 0;
  }

  const nextEligible = calculateNextEligible(newBucket);
  upsertProgress(hanzi, mode, newBucket, nextEligible, characterMode);
}
