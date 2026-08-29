/**
 * Deciding whether a translation is the reference sentence, character for character.
 *
 * Shared because both sides need the same answer: the client checks locally so an exact match
 * costs no round trip, and the server checks again so the endpoint is honest when called on its
 * own. It is a pure string rule, so it also tests without an API key or a database.
 */

/**
 * Punctuation is not what is being practised, and the examples are not consistent about it:
 * 这是我的猫。 carries a full stop, 我今天很忙 does not, and some have a comma inside them. A
 * learner who wrote the sentence right must not fail on a character they were never shown, so
 * everything that is not a letter or a digit comes out. Han characters are letters (Unicode Lo)
 * and survive; NFKC first folds fullwidth latin and digits onto ASCII, which is where a Chinese
 * keyboard and an English one differ.
 */
const NOT_A_LETTER_OR_DIGIT = /[^\p{L}\p{N}]+/gu;

export function normalizeSentence(text: string): string {
  return text.normalize('NFKC').replace(NOT_A_LETTER_OR_DIGIT, '').toLowerCase();
}

/**
 * Did the learner write the reference sentence? Traditional characters, 的 for 得 and the like
 * are deliberately *not* folded away: those are real differences, and saying so is the grader's
 * job. An empty answer matches nothing, including an empty reference.
 */
export function sentenceMatches(answer: string, reference: string): boolean {
  const normalized = normalizeSentence(answer);
  return normalized !== '' && normalized === normalizeSentence(reference);
}
