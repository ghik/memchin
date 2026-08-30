/**
 * Which example sentences are worth practising translation on, and how to find one again.
 *
 * The policy lives here rather than in db.ts because "the example sentences of words already
 * learned" is a judgement about what makes a good exercise, not a fact about storage — and
 * because this mode has no database model of its own yet, so keeping every DB touch out of it
 * makes it a clean revert if the shape changes.
 */
import { getAllWords, getLearnedCount, getLearnedHanzi, getSentencesNeedingReview } from '../db.js';
import { normalizeSentence, usesWord } from '../../shared/sentence-match.js';
import type { SentenceQuestion, SentenceWordInfo, Word } from '../../shared/types.js';

/**
 * generate-examples.ts asks for a phrase, then a sentence of 5-12 characters, then one of 12-30.
 * The first is not a sentence; the other two are, and both are worth translating — the middle
 * one always, the long one when the learner asks for the harder material.
 */
const MEDIUM_EXAMPLE = 1;
const LONG_EXAMPLE = 2;

/** Only what is shown with the answer, so the pool stays small */
function wordInfo(word: Word): SentenceWordInfo {
  return { english: word.english, aiEnglish: word.aiEnglish ?? [] };
}

/**
 * Pure, so it can be tested against fixtures rather than a database.
 *
 * `learned` is what bounds the pool. Frequency used to, and it was the wrong measure: of the
 * words actually learned, most sit outside any reasonable rank cap, so ranking by corpus
 * frequency threw away the vocabulary the learner had gone to the trouble of learning.
 *
 * It holds words learned as words. A character learned only in character mode was learned as a
 * piece of other words, and asking for a sentence built around it asks for a word that was never
 * studied as one.
 */
export function buildPool(words: Iterable<Word>, learned: Set<string>): SentenceQuestion[] {
  const questions: SentenceQuestion[] = [];

  for (const word of words) {
    if (!learned.has(word.hanzi)) {
      continue;
    }
    for (const index of [MEDIUM_EXAMPLE, LONG_EXAMPLE]) {
      const example = word.examples[index];
      if (!example) {
        continue;
      }
      const english = example.english?.trim() ?? '';
      const hanzi = example.hanzi?.trim() ?? '';
      // Examples can be regenerated at any time, so a malformed one must not reach the screen
      if (english === '' || hanzi === '') {
        continue;
      }
      // A handful of examples never use the word they were written for — 起来 illustrated by
      // 他七点起床. They are fine sentences and useless exercises, and keeping them would make the
      // answer unpassable once an answer is required to contain the word
      if (!usesWord(hanzi, word.hanzi)) {
        continue;
      }
      // A sentence shared by two words is kept under both: the same English asked twice is the
      // same English practising a different word each time, which is worth answering twice
      questions.push({
        id: `${word.hanzi}#${index}`,
        hanzi: word.hanzi,
        english,
        word: wordInfo(word),
        reference: { ...example, hanzi },
        long: index === LONG_EXAMPLE,
      });
    }
  }

  return questions;
}

/**
 * The pool is derived from the word cache and from what has been learned, so it is rebuilt when
 * either moves: `invalidateWordCache` nulls the cache and a new Map object is the signal, and a
 * word learned or reset changes the count. Counting is cheap; fetching every learned hanzi to
 * compare is not, which is why the count stands in for the set.
 */
let cachedFor: Map<string, Word> | null = null;
let cachedLearnedCount = -1;
let cachedPool: SentenceQuestion[] = [];
let cachedById = new Map<string, SentenceQuestion>();

function ensurePool(): void {
  const words = getAllWords();
  const learnedCount = getLearnedCount();
  if (words === cachedFor && learnedCount === cachedLearnedCount) {
    return;
  }
  cachedFor = words;
  cachedLearnedCount = learnedCount;
  cachedPool = buildPool(words.values(), getLearnedHanzi());
  cachedById = new Map(cachedPool.map((question) => [question.id, question]));
}

/** Every question there is, both lengths. Which of them a round draws on is the round's choice. */
export function sentencePool(): SentenceQuestion[] {
  ensurePool();
  return cachedPool;
}

/**
 * The question an answer is answering, or null if it is not one we set. By id rather than by
 * word, since a word has a sentence of each length and they are different exercises.
 */
export function questionFor(id: string): SentenceQuestion | null {
  ensurePool();
  return cachedById.get(id) ?? null;
}

/** How the history names a question: the word it was set for and the sentence it asked for */
function reviewKey(hanzi: string, reference: string): string {
  return `${hanzi}\u0000${normalizeSentence(reference)}`;
}

/**
 * The questions last answered wrong or skipped. Not cached with the pool: the pool changes when
 * words are learned, this changes with every answer, and filtering a few thousand questions
 * against a set costs nothing next to the query that built it.
 */
export function reviewPool(): SentenceQuestion[] {
  const failed = new Set(
    getSentencesNeedingReview().map(({ hanzi, reference }) => reviewKey(hanzi, reference))
  );
  // Every question in the pool belongs to a word; only generated ones do not, and those are
  // never in it
  return sentencePool().filter((question) =>
    failed.has(reviewKey(question.hanzi ?? '', question.reference.hanzi))
  );
}

/** How much material each choice offers, for the screen that asks what to practise */
export function poolCounts(): { medium: number; long: number; review: number } {
  const pool = sentencePool();
  const long = pool.filter((question) => question.long).length;
  return { medium: pool.length - long, long, review: reviewPool().length };
}

/**
 * A round's worth, drawn at random, so nothing repeats inside the round.
 *
 * Reviewing ignores the length: what is being asked for is the sentences that went wrong, and
 * which tier one of them came from is not why it went wrong.
 */
export function shuffledPool(
  count: number,
  includeLong: boolean,
  onlyReview: boolean
): SentenceQuestion[] {
  const questions = onlyReview
    ? reviewPool()
    : sentencePool().filter((question) => includeLong || !question.long);
  const shuffled = [...questions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
