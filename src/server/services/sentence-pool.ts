/**
 * Which example sentences are worth practising translation on, and how to find one again.
 *
 * The policy lives here rather than in db.ts because "words already learned, middle example" is a
 * judgement about what makes a good exercise, not a fact about storage — and because this mode
 * has no database model of its own yet, so keeping every DB touch out of it makes it a clean
 * revert if the shape changes.
 */
import { getAllWords, getLearnedCount, getLearnedHanzi } from '../db.js';
import { usesWord } from '../../shared/sentence-match.js';
import type { Example, SentenceQuestion, SentenceWordInfo, Word } from '../../shared/types.js';

/**
 * The middle example. generate-examples.ts asks for a phrase, then a sentence of 5-12
 * characters, then one of 12-30: the second is the only one that is reliably a whole sentence
 * and still short enough to type.
 */
const EXAMPLE_INDEX = 1;

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
    const example = word.examples[EXAMPLE_INDEX];
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
      hanzi: word.hanzi,
      english,
      word: wordInfo(word),
      reference: { ...example, hanzi },
    });
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
let cachedByHanzi = new Map<string, SentenceQuestion>();

function ensurePool(): void {
  const words = getAllWords();
  const learnedCount = getLearnedCount();
  if (words === cachedFor && learnedCount === cachedLearnedCount) {
    return;
  }
  cachedFor = words;
  cachedLearnedCount = learnedCount;
  cachedPool = buildPool(words.values(), getLearnedHanzi());
  cachedByHanzi = new Map(cachedPool.map((question) => [question.hanzi, question]));
}

export function sentencePool(): SentenceQuestion[] {
  ensurePool();
  return cachedPool;
}

/** The reference for a word, or null when it is not one of the words we practise */
export function referenceFor(hanzi: string): Example | null {
  ensurePool();
  return cachedByHanzi.get(hanzi)?.reference ?? null;
}

/** A round's worth, drawn at random, so nothing repeats inside the round */
export function shuffledPool(count: number): SentenceQuestion[] {
  const questions = [...sentencePool()];
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }
  return questions.slice(0, count);
}
