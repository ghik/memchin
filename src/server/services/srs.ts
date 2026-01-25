import type { PracticeMode } from '../../shared/types.js';
import { upsertProgress, getProgress } from '../db.js';

// Bucket delays in minutes
const BUCKET_DELAYS_MINUTES: Record<number, number> = {
  0: 0,        // Immediate
  1: 1,        // 1 minute
  2: 5,        // 5 minutes
  3: 30,       // 30 minutes
  4: 120,      // 2 hours
  5: 480,      // 8 hours
  6: 1440,     // 1 day
  7: 4320,     // 3 days (mastered)
};

const MAX_BUCKET = 7;

export function calculateNextEligible(bucket: number): string {
  const delayMinutes = BUCKET_DELAYS_MINUTES[bucket] ?? BUCKET_DELAYS_MINUTES[MAX_BUCKET];
  const nextEligible = new Date(Date.now() + delayMinutes * 60 * 1000);
  return nextEligible.toISOString();
}

export function updateProgress(wordId: number, mode: PracticeMode, correct: boolean): void {
  const currentProgress = getProgress(wordId, mode);
  const currentBucket = currentProgress?.bucket ?? 0;

  let newBucket: number;
  if (correct) {
    newBucket = Math.min(currentBucket + 1, MAX_BUCKET);
  } else {
    newBucket = Math.max(currentBucket - 1, 0);
  }

  const nextEligible = calculateNextEligible(newBucket);
  upsertProgress(wordId, mode, newBucket, nextEligible);
}
