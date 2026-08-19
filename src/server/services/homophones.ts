/**
 * Keeping an entry about the character it is supposed to be about. Chinese has far more
 * syllables reused than a learner's dictionary can hide, and a model asked about 章 will
 * sometimes answer about 张 — the check for that lives here, away from the AI calls, so it
 * can be tested without one.
 */
import { characterReadings } from './cedict.js';

/**
 * Homophone drift: the model sometimes answers about a character that sounds like the one it
 * was given (章 answered as 张). The tell is notes that mention the input nowhere and talk
 * about something that sounds like it instead. Notes citing other characters are perfectly
 * normal otherwise — near-synonyms, what to say instead — so only a shared reading counts.
 */
export function notesAreAboutAHomophone(text: string, notes: string): boolean {
  const cited = notes.match(/[\u3400-\u9fff]/g);
  if (!cited) {
    return false;
  }
  const characters = new Set([...text]);
  if (cited.some((character) => characters.has(character))) {
    return false;
  }
  const readings = new Set(
    [...characters].flatMap((character) => [...characterReadings(character)])
  );
  return cited.some((character) =>
    [...characterReadings(character)].some((reading) => readings.has(reading))
  );
}
