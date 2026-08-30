/**
 * Reading back sentences written to order, kept apart from the call so it can be tested without
 * an API key — the same split as sentence-verdict.ts against grade-sentence.ts.
 */
import { normalizeSentence } from '../../shared/sentence-match.js';
import type { Example } from '../../shared/types.js';

/** The levels that may be asked for; HSK has six and the model is told nothing else exists */
export const HSK_LEVELS = [1, 2, 3, 4, 5, 6];

/**
 * Never throws: an unusable reply is an empty list, and the caller retries. A partly usable one
 * keeps what it can — one malformed sentence out of twenty is not worth another call.
 *
 * Duplicates are dropped on both sides. The model is asked for variety and mostly gives it, but
 * a round that asks the same thing twice looks like the shuffle failed, and two sentences with
 * the same English cannot both be answered.
 */
export function parseGeneratedSentences(raw: string, count: number): Example[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [];
  }

  const entries = (parsed as Record<string, unknown>).sentences;
  if (!Array.isArray(entries)) {
    return [];
  }

  const sentences: Example[] = [];
  const seenHanzi = new Set<string>();
  const seenEnglish = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const { hanzi, pinyin, english } = entry as Record<string, unknown>;
    if (typeof hanzi !== 'string' || typeof pinyin !== 'string' || typeof english !== 'string') {
      continue;
    }
    const sentence: Example = {
      hanzi: hanzi.trim(),
      pinyin: pinyin.trim(),
      english: english.trim(),
    };
    if (sentence.hanzi === '' || sentence.pinyin === '' || sentence.english === '') {
      continue;
    }
    const hanziKey = normalizeSentence(sentence.hanzi);
    const englishKey = normalizeSentence(sentence.english);
    if (seenHanzi.has(hanziKey) || seenEnglish.has(englishKey)) {
      continue;
    }
    seenHanzi.add(hanziKey);
    seenEnglish.add(englishKey);
    sentences.push(sentence);
    if (sentences.length === count) {
      break;
    }
  }
  return sentences;
}
