import { lookupChar } from './hanzi-freq.js';
import { lookupFiltered, lookupWord } from './cedict.js';

export interface CharacterEntry {
  pinyin: string;
  english: string[];
  /** Only the frequency list ranks characters; CEDICT does not */
  rank?: number;
}

/**
 * What is known about a single character, for adding it as an entry of its own.
 *
 * The frequency list is the better source — a rank and a short gloss — but it only covers
 * common characters, and a rare one is exactly the sort that turns up inside a word the learner
 * is adding. CEDICT then gives at least the reading, and often a definition. A character it
 * merely cross-references, as it does 腼 ("used in 腼腆"), has no gloss of its own to offer;
 * that is worth recording about the character, not a reason to leave it out of the deck.
 */
export function describeCharacter(char: string): CharacterEntry | null {
  const ranked = lookupChar(char);
  if (ranked) {
    return { pinyin: ranked.pinyin, english: ranked.english, rank: ranked.rank };
  }

  const entries = lookupFiltered(char);
  const reading = entries[0]?.pinyin ?? lookupWord(char)?.pinyin;
  if (!reading) {
    return null;
  }
  return { pinyin: reading, english: entries.flatMap((entry) => entry.definitions).slice(0, 4) };
}
