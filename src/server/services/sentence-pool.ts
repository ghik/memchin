/**
 * Which example sentences are worth practising translation on, and how to find one again.
 *
 * The policy lives here rather than in db.ts because "the commonest words, middle example" is a
 * judgement about what makes a good exercise, not a fact about storage — and because this mode
 * has no database model of its own yet, so keeping every DB touch out of it makes it a clean
 * revert if the shape changes.
 */
import { getAllWords } from '../db.js';
import { normalizeSentence } from '../../shared/sentence-match.js';
import type { Example, SentenceQuestion, Word } from '../../shared/types.js';

/** Only words a learner meets constantly, so the vocabulary is never the obstacle */
const MAX_RANK = 500;

/**
 * The middle example. generate-examples.ts asks for a phrase, then a sentence of 5-12
 * characters, then one of 12-30: the second is the only one that is reliably a whole sentence
 * and still short enough to type.
 */
const EXAMPLE_INDEX = 1;

/** Pure, so it can be tested against fixtures rather than a database */
export function buildPool(words: Iterable<Word>): SentenceQuestion[] {
  const questions: SentenceQuestion[] = [];
  const seenEnglish = new Set<string>();

  for (const word of words) {
    const rank = word.wordFrequencyRank;
    if (rank === undefined || rank > MAX_RANK) {
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
    // A handful of words illustrate themselves with the same sentence; asking it twice in one
    // pass would look like the shuffle had failed
    const key = normalizeSentence(english);
    if (seenEnglish.has(key)) {
      continue;
    }
    seenEnglish.add(key);
    questions.push({
      hanzi: word.hanzi,
      english,
      reference: { ...example, hanzi },
    });
  }

  return questions;
}

/**
 * The pool is derived from the whole word cache, so rebuild it only when that cache has been
 * replaced underneath us — `invalidateWordCache` nulls it, and a new Map object is the signal.
 */
let cachedFor: Map<string, Word> | null = null;
let cachedPool: SentenceQuestion[] = [];
let cachedByHanzi = new Map<string, SentenceQuestion>();

function ensurePool(): void {
  const words = getAllWords();
  if (words === cachedFor) {
    return;
  }
  cachedFor = words;
  cachedPool = buildPool(words.values());
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

/** The whole pool in a random order, so a session sees everything before it sees a repeat */
export function shuffledPool(): SentenceQuestion[] {
  const questions = [...sentencePool()];
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }
  return questions;
}
