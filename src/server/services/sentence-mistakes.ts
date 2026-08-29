/**
 * A log of sentences that came back wrong: what was asked, what was written, and what the
 * grader said about it.
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
import type { SentenceGradeResponse } from '../../shared/types.js';

const mistakesPath = path.join(dataDir, 'sentence-mistakes.jsonl');

export interface SentenceMistake {
  /** UTC, as everything else in the deck is stored */
  at: string;
  /** The word the sentence was set for */
  hanzi: string;
  english: string;
  reference: string;
  /** What the learner wrote */
  answer: string;
  verdict: SentenceGradeResponse['verdict'];
  explanation: string;
  suggestion?: string;
}

/**
 * Best-effort: a failed write must not turn a graded answer into an error the learner sees,
 * since the grading is the thing they asked for and this is a note to ourselves.
 */
export function recordMistake(mistake: Omit<SentenceMistake, 'at'>): void {
  const entry: SentenceMistake = { at: toStamp(new Date()), ...mistake };
  try {
    fs.appendFileSync(mistakesPath, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error('Could not record the sentence mistake:', error);
  }
}

/** Everything logged so far, oldest first. Nothing reads this yet; it is how the log gets read. */
export function readMistakes(): SentenceMistake[] {
  if (!fs.existsSync(mistakesPath)) {
    return [];
  }
  const mistakes: SentenceMistake[] = [];
  for (const line of fs.readFileSync(mistakesPath, 'utf8').split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    try {
      mistakes.push(JSON.parse(line) as SentenceMistake);
    } catch {
      // A line half-written by a kill mid-append costs that line, not the log
    }
  }
  return mistakes;
}
