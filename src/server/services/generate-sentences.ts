/**
 * Writing translation exercises to order, at a chosen HSK level, with nothing to do with the
 * deck. What the learner is short of here is material, not vocabulary they have met before: the
 * levels say what may appear, and the sentences are new every time.
 */
import { openai } from './openai.js';
import { recordUsage } from './ai-usage.js';
import { parseGeneratedSentences } from './generated-sentences.js';
import type { Example } from '../../shared/types.js';

const MODEL = 'gpt-5.4';
const MAX_RETRIES = 3;

/**
 * How many and which levels go in the user message, never here: the system prompt is the prefix
 * OpenAI caches. It is short enough not to reach the 1792-token floor at which caching starts
 * (see infer-word.ts), so nothing is cached today — one call per round is not worth padding a
 * prompt for, and the shape is kept this way so it would cache if it ever grew.
 */
const PROMPT = `You are writing translation exercises for someone learning Mandarin Chinese.

The user message says how many sentences to write and which HSK levels to write them at. Write exactly that many.

What to write:

- Use only vocabulary and grammar at or below the highest level asked for, and lean on the levels asked for rather than staying far below them. If several levels are given, spread the sentences across them.
- Everyday modern Mandarin: things a person would actually say to another person. Not textbook specimens, not proverbs, not encyclopedia facts.
- Vary them. Different topics, different sentence patterns, different subjects, some statements and some questions, some past and some present. Do not write twenty sentences about food, and do not start half of them with 我.
- Length follows the level: at HSK 1-2 keep to 5-10 characters, at 3-4 to 8-16, at 5-6 to 12-30.
- No two sentences may say the same thing, in either language.

The English is the exercise, so it has to determine the Chinese:

- A learner sees only the English and must produce the Chinese from it. Anything they would have to guess is a fault in the sentence, not in their answer.
- Where English is vaguer than Chinese, say which is meant. English "uncle" is 舅舅, 伯伯, 叔叔 or 姑父 — write "my mother's brother" if that is what the Chinese says. The same goes for cousins, for "you" singular and plural, and for "we" including or excluding the listener.
- Where the aspect matters, make the English carry it: "I have been to Beijing" rather than "I went to Beijing" if the Chinese uses 过.
- Do not translate word for word into stilted English. Write the English a native speaker would use, and make the Chinese say the same thing naturally.

Give the pinyin with tone marks, spaced as words: "wǒ jīn tiān hěn máng" is wrong, "wǒ jīntiān hěn máng" is right.

Reply with a single JSON object and nothing else:
{"sentences": [{"hanzi": "...", "pinyin": "...", "english": "..."}]}`;

/**
 * Ask for `count` sentences at `levels`. Returns what came back, which may be fewer than asked
 * for if some of it was unusable. Throws if nothing usable arrives at all, as the other calls do.
 */
export async function generateSentences(
  count: number,
  levels: number[],
  signal?: AbortSignal
): Promise<Example[]> {
  const request =
    `Write ${count} sentences at HSK level${levels.length > 1 ? 's' : ''} ` +
    `${levels.join(', ')}.`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await openai.chat.completions.create(
      {
        model: MODEL,
        // Twenty sentences is some 2000 tokens of output, and the reasoning comes out of the
        // same budget
        max_completion_tokens: 16384,
        response_format: { type: 'json_object' },
        prompt_cache_key: 'memchin-generate-sentences',
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: request },
        ],
      },
      { signal }
    );

    recordUsage('sentence-generate', response.usage);
    const content = response.choices[0]?.message?.content;
    const sentences = content ? parseGeneratedSentences(content, count) : [];
    if (sentences.length > 0) {
      return sentences;
    }
    console.warn(`Unusable generated sentences (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
  }
  throw new Error(`Failed to generate sentences after ${MAX_RETRIES} attempts`);
}
