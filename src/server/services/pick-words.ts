/**
 * Choosing which of the words waiting in the queue are worth learning next.
 *
 * The queue is ordered by when things were added, which says nothing about what is worth knowing
 * first. The frequency ranks the deck carries are deliberately not sent: they come from written
 * corpora and are not trusted here, and offering a number as evidence would only anchor the model
 * to it. What is wanted is a judgement about spoken usefulness, so that is all that is asked for.
 */
import OpenAI from 'openai';
import { recordUsage } from './ai-usage.js';
import { parseWordPicks } from './word-picks.js';
import type { Word } from '../../shared/types.js';

const openai = new OpenAI();

const MODEL = 'gpt-5.4';
const MAX_RETRIES = 3;

/**
 * Short on purpose, and not cached: the candidate list is the bulk of every request and lives in
 * the user message, so there is no long shared prefix to cache and nothing to gain from padding
 * one out. This is a button pressed now and then, not a loop over the deck.
 */
const PROMPT = `You are helping someone learning Mandarin Chinese decide what to study next.

You are given a list of words they have queued but not yet started learning, one per line, as "hanzi | pinyin | english".

Choose the ones most worth learning now. What that means, in order of weight:

- Everyday usefulness. A word that comes up in ordinary conversation, or that other words and grammar are built on, beats a word that is merely frequent in writing.
- Frequency in modern spoken Mandarin, as you know it. Judge the word itself; do not assume the order the list is in means anything.
- Breadth. Do not fill the list with near-synonyms or with several words from the same narrow topic. A set that covers different ground teaches more than five ways to say the same thing.

Avoid: literary or classical words, technical and specialist vocabulary, regionalisms, proper nouns, and words whose only use is inside one fixed expression.

Pick exactly {{COUNT}} of them, best first, unless the list is shorter than that — then pick all of it.

Reply with a single JSON object and nothing else, using the hanzi exactly as they were given:
{"hanzi": ["...", "..."]}`;

function candidateLine(word: Word): string {
  return `${word.hanzi} | ${word.pinyin} | ${word.english.join('; ')}`;
}

/**
 * Ask which `count` of `candidates` to learn next. Returns their hanzi, best first, always a
 * subset of what was offered. Throws if no usable reply arrives, as the other AI calls do.
 */
export async function pickWords(
  candidates: Word[],
  count: number,
  signal?: AbortSignal
): Promise<string[]> {
  if (candidates.length === 0) {
    return [];
  }
  const hanzi = candidates.map((word) => word.hanzi);
  const limit = Math.min(count, candidates.length);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await openai.chat.completions.create(
      {
        model: MODEL,
        max_completion_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPT.replace('{{COUNT}}', String(limit)) },
          { role: 'user', content: candidates.map(candidateLine).join('\n') },
        ],
      },
      { signal }
    );

    recordUsage('word-picks', response.usage);
    const content = response.choices[0]?.message?.content;
    const picks = content ? parseWordPicks(content, hanzi, limit) : [];
    if (picks.length > 0) {
      return picks;
    }
    console.warn(`Unusable word picks (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
  }
  throw new Error(`Failed to pick words after ${MAX_RETRIES} attempts`);
}
