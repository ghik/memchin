/**
 * Writing translation exercises to order, at a chosen HSK level, with nothing to do with the
 * deck. What the learner is short of here is material, not vocabulary they have met before: the
 * levels say what may appear, and the sentences are new every time.
 */
import { openai } from './openai.js';
import { recordUsage } from './ai-usage.js';
import { parseGeneratedSentences } from './generated-sentences.js';
import { getGeneratedNormalized, getRecentGeneratedEnglish } from '../db.js';
import { normalizeSentence } from '../../shared/sentence-match.js';
import type { Example } from '../../shared/types.js';

const MODEL = 'gpt-5.4';
const MAX_RETRIES = 3;

/**
 * Asked the same thing twice, the model writes much the same sentences: left to itself it
 * gravitates to 你今天忙吗 and 我姐姐在银行工作 every time. Naming a few situations at random is
 * what makes one round differ from the next, and it costs a line of the request.
 */
const SITUATIONS = [
  'at home with family',
  'at work or in an office',
  'at school or studying',
  'shopping for clothes',
  'buying food at a market',
  'ordering in a restaurant',
  'cooking or eating at home',
  'travelling by train or plane',
  'taking a taxi or the underground',
  'asking for or giving directions',
  'seeing a doctor, or being ill',
  'exercise and sport',
  'weather and the seasons',
  'hobbies and free time',
  'music, films or television',
  'reading and books',
  'the internet, phones and computers',
  'money, paying and prices',
  'making plans to meet someone',
  'a birthday or a holiday',
  'moving house, or a room and its furniture',
  'pets and animals',
  'the neighbours, or someone next door',
  'a job interview or looking for work',
  'losing something, or looking for it',
  'being late, or waiting for someone',
  'apologising, or thanking someone',
  'asking a favour',
  'giving advice or an opinion',
  'a disagreement or a complaint',
  'childhood and memories',
  'plans for next year',
  'the post office, the bank or an office errand',
  'a hotel or somewhere to stay',
  'photographs and taking pictures',
  'cleaning, tidying or fixing something',
  'gardens, parks and being outdoors',
  'languages and learning them',
  'news and what is going on',
  'sleep, being tired, getting up',
];

/** How many of the recent ones the model is shown, so the request stays short */
const AVOID_SHOWN = 40;
/** How many situations one round is pointed at */
const SITUATIONS_PER_ROUND = 6;

function pickSituations(): string[] {
  const shuffled = [...SITUATIONS];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, SITUATIONS_PER_ROUND);
}

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

The request names some situations to write about, and may list sentences already written for this learner. Spread the sentences across the situations given. Do not write any of the listed sentences again, and do not write a near-variant of one — a different name or number in the same sentence is the same sentence.

Give the pinyin with tone marks, spaced as words: "wǒ jīn tiān hěn máng" is wrong, "wǒ jīntiān hěn máng" is right.

Reply with a single JSON object and nothing else:
{"sentences": [{"hanzi": "...", "pinyin": "...", "english": "..."}]}`;

/** One call. Returns what came back, which may be fewer than asked for if some was unusable. */
async function askForSentences(
  count: number,
  levels: number[],
  avoid: string[],
  signal?: AbortSignal
): Promise<Example[]> {
  const request =
    `Write ${count} sentences at HSK level${levels.length > 1 ? 's' : ''} ` +
    `${levels.join(', ')}.\n\n` +
    `Situations: ${pickSituations().join('; ')}.` +
    (avoid.length > 0 ? `\n\nAlready written, do not repeat:\n${avoid.join('\n')}` : '');

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

/** A second ask is worth it when the first came back mostly familiar; a third is not */
const FRESHNESS_ATTEMPTS = 2;

/**
 * Ask for `count` sentences at `levels` that have not been written before.
 *
 * The situations and the list of what to avoid are what keep the model off its favourites, and
 * this is the guarantee behind them: anything already on record is dropped whatever the model
 * does. A round can come back short rather than repeat itself, which is the better failure —
 * the learner is here for sentences they have not seen.
 */
export async function generateSentences(
  count: number,
  levels: number[],
  signal?: AbortSignal
): Promise<Example[]> {
  const seen = getGeneratedNormalized();
  const avoid = getRecentGeneratedEnglish(AVOID_SHOWN);
  const fresh: Example[] = [];

  for (let attempt = 0; attempt < FRESHNESS_ATTEMPTS && fresh.length < count; attempt++) {
    const batch = await askForSentences(count - fresh.length, levels, avoid, signal);
    for (const sentence of batch) {
      const normalized = normalizeSentence(sentence.hanzi);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      fresh.push(sentence);
    }
  }
  return fresh;
}
