/**
 * The verdict set and the reply parser, kept apart from the OpenAI call so they can be tested
 * without an API key — `new OpenAI()` throws at module load when the key is missing, which is
 * the same reason homophones.ts sits outside infer-word.ts.
 */
import { normalizeSentence } from '../../shared/sentence-match.js';
import type { SentenceGradeResponse, SentenceVerdict } from '../../shared/types.js';

/** The closed set, interpolated into the prompt so it and this validator cannot drift apart */
export const SENTENCE_VERDICTS: SentenceVerdict[] = ['correct', 'acceptable', 'wrong'];

/**
 * Never throws: an unusable reply is `null`, which the caller retries.
 *
 * Stricter than the word inference parser, which drops labels it does not recognise and keeps
 * the rest. Here the verdict is the single value the screen turns on and the explanation is the
 * entire product of the call, so a reply missing either is worth another attempt rather than
 * being shown as it stands.
 */
export function parseSentenceGrading(raw: string, answer: string): SentenceGradeResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const verdict = obj.verdict;
  if (typeof verdict !== 'string' || !SENTENCE_VERDICTS.includes(verdict as SentenceVerdict)) {
    return null;
  }

  const explanation = typeof obj.explanation === 'string' ? obj.explanation.trim() : '';
  if (explanation === '') {
    return null;
  }

  // "Try 这是我的猫。" when the learner wrote 这是我的猫 is not a correction of anything
  const suggestion = typeof obj.suggestion === 'string' ? obj.suggestion.trim() : '';
  const worthSuggesting =
    suggestion !== '' && normalizeSentence(suggestion) !== normalizeSentence(answer);

  // Anything other than a plain boolean leaves the question to containment rather than
  // guessing, since a wrong answer here nags the learner about a word they did use
  const usesWord = typeof obj.usesWord === 'boolean' ? obj.usesWord : undefined;

  return {
    verdict: verdict as SentenceVerdict,
    explanation,
    ...(worthSuggesting ? { suggestion } : {}),
    ...(usesWord === undefined ? {} : { usesWord }),
  };
}
