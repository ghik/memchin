/**
 * Where sentences written to order are kept while they are being answered.
 *
 * A question from the deck is found again by looking it up in the pool. A generated one exists
 * nowhere else, so grading and the history would have nothing to resolve its id against — and
 * taking the reference from the client instead would mean grading an answer against whatever the
 * client said the question was. So the server keeps them, in memory, for as long as they might
 * still be answered.
 *
 * In memory and not in the deck because they are meant to be used once: a restart loses a round
 * in flight, which costs the grading of the sentences left in it and nothing else.
 */
import type { Example, SentenceQuestion } from '../../shared/types.js';

/** A few rounds' worth. The oldest go first, and a round in progress is never among them. */
const MAX_REMEMBERED = 500;

const remembered = new Map<string, SentenceQuestion>();
let nextId = 0;

export function rememberGenerated(sentences: Example[]): SentenceQuestion[] {
  const questions = sentences.map((sentence) => ({
    id: `hsk-${++nextId}`,
    english: sentence.english,
    reference: sentence,
    long: false,
  }));
  for (const question of questions) {
    remembered.set(question.id, question);
  }
  while (remembered.size > MAX_REMEMBERED) {
    const oldest = remembered.keys().next();
    if (oldest.done) {
      break;
    }
    remembered.delete(oldest.value);
  }
  return questions;
}

export function generatedQuestion(id: string): SentenceQuestion | null {
  return remembered.get(id) ?? null;
}
