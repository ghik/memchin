/**
 * A log of every sentence attempted: what was asked, what was written, how it was marked and
 * when. Everything goes in, not just the mistakes — what you got right is half of what a record
 * of practice is for, and a history with the passes missing cannot say whether a sentence is
 * hard or merely rare.
 *
 * Append-only JSON lines rather than a table, because nothing reads it yet and its shape is
 * still a guess. A line costs one append; a row in the deck would cost a rewrite of the whole
 * seven-megabyte database, and would commit to a schema before there is anything to schematise
 * for. Moving these into a table later is a script over a file that is already one record per
 * line; unpicking a wrong table from a live database is not.
 */
import fs from 'fs';
import path from 'path';
import { dataDir } from '../db.js';
import { toStamp } from '../../shared/time.js';
import { SENTENCE_VERDICTS } from './sentence-verdict.js';
import type { SentenceAttemptOutcome } from '../../shared/types.js';

const historyPath = path.join(dataDir, 'sentence-history.jsonl');

/** Built from the verdict set so the two cannot drift apart */
export const SENTENCE_ATTEMPT_OUTCOMES: SentenceAttemptOutcome[] = [
  ...SENTENCE_VERDICTS,
  'missing-word',
  'skipped',
];

export interface SentenceAttempt {
  /** UTC, as everything else in the deck is stored */
  at: string;
  /** The word the sentence was set for */
  hanzi: string;
  english: string;
  /** Normalised, as answers are for comparison — punctuation and case are not the exercise */
  reference: string;
  /** What the learner wrote; empty when they skipped */
  answer: string;
  outcome: SentenceAttemptOutcome;
  /** Absent when nothing graded it: an exact answer, or one handed back or skipped */
  explanation?: string;
  suggestion?: string;
}

/**
 * Best-effort: a failed write must not turn a graded answer into an error the learner sees,
 * since the grading is the thing they asked for and this is a note to ourselves.
 */
export function recordAttempt(attempt: Omit<SentenceAttempt, 'at'>): void {
  const entry: SentenceAttempt = { at: toStamp(new Date()), ...attempt };
  try {
    fs.appendFileSync(historyPath, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error('Could not record the sentence attempt:', error);
  }
}

/** Everything logged so far, oldest first. Nothing reads this yet; it is how the log gets read. */
export function readHistory(): SentenceAttempt[] {
  if (!fs.existsSync(historyPath)) {
    return [];
  }
  const attempts: SentenceAttempt[] = [];
  for (const line of fs.readFileSync(historyPath, 'utf8').split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    try {
      attempts.push(JSON.parse(line) as SentenceAttempt);
    } catch {
      // A line half-written by a kill mid-append costs that line, not the log
    }
  }
  return attempts;
}
