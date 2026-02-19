import type { PracticeMode } from '../../shared/types.js';
import { getProgress, upsertProgress } from '../db.js';

// Bucket delays in minutes
const BUCKET_DELAYS_MINUTES = [
  0, // 0: Immediate
  1, // 1: 1 minute
  5, // 2: 5 minutes
  30, // 3: 30 minutes
  4 * 60, // 4: 4 hours
  24 * 60, // 5: 1 day
  3 * 24 * 60, // 6: 3 day
  7 * 24 * 60, // 7: 7 days
  30 * 24 * 60, // 8: 30 days (mastered)
];

export const MAX_BUCKET = BUCKET_DELAYS_MINUTES.length - 1;

export function calculateNextEligible(bucket: number): string {
  const delayMinutes = BUCKET_DELAYS_MINUTES[Math.min(bucket, MAX_BUCKET)];
  // Add ±25% jitter so words from the same session don't all become due at the same time
  const jitter = delayMinutes * (0.75 + Math.random() * 0.5);
  const nextEligible = new Date(Date.now() + jitter * 60 * 1000);
  return nextEligible.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

export function updateProgress(hanzi: string, mode: PracticeMode, correct: boolean, characterMode: boolean): void {
  const currentProgress = getProgress(hanzi, mode);
  const currentBucket = currentProgress?.bucket ?? 0;

  let newBucket: number;
  if (correct) {
    newBucket = Math.min(currentBucket + 1, MAX_BUCKET);
  } else {
    newBucket = 0;
  }

  const nextEligible = calculateNextEligible(newBucket);
  upsertProgress(hanzi, mode, newBucket, nextEligible, characterMode);
}
