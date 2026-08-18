import OpenAI from 'openai';
import type { InferResponse, InferVerdict } from '../../shared/types.js';

const openai = new OpenAI();

const MODEL = 'gpt-4o';
const MAX_RETRIES = 3;

const VERDICTS: InferVerdict[] = ['ok', 'unnatural', 'invalid'];

/** Parts of speech the model may assign to a single word — matches the labels already in use */
const PARTS_OF_SPEECH = [
  'noun',
  'verb',
  'verb-object compound',
  'adjective',
  'adverb',
  'pronoun',
  'numeral',
  'measure word',
  'conjunction',
  'preposition',
  'particle',
  'interjection',
];

/** Register labels — every input gets at least one of these on top of its structural label */
const REGISTERS = ['casual', 'neutral', 'formal', 'written', 'vernacular', 'vulgar'];

const ALLOWED_CATEGORIES = new Set([
  'sentence',
  'expression',
  ...PARTS_OF_SPEECH,
  ...REGISTERS,
]);

const PROMPT = `You are a Mandarin Chinese lexicographer helping a learner add an entry to their vocabulary deck.

You are given a piece of text the learner typed. It may be a single character, a word, a fixed expression, or a whole sentence.

Do three things:

1. Judge the text. Set "verdict" to exactly one of:
   - "ok" — a real, natural, idiomatic word/expression/sentence that a native speaker would actually produce
   - "unnatural" — understandable and roughly well-formed, but awkward, unidiomatic, stilted, regionally odd, or so rare that learning it is not useful
   - "invalid" — not a real word, nonsensical, ungrammatical, or a string of characters that do not combine into anything meaningful

2. Give the reading and meaning:
   - "pinyin": tone-marked pinyin. Join the syllables of a single word without spaces (diànnǎo), separate distinct words with one space (wǒ hěn xǐhuan nǐ). Never include punctuation, numbers or capital letters.
   - "english": an array of 1-4 short English glosses, most common first — the way a dictionary lists senses. For a sentence, a single natural translation.

3. Label the text. "categories" is an array drawn only from the closed sets below — never invent a label.

   First, one structural label:
   - a full sentence (has a subject and a predicate, or is a complete utterance) => "sentence"
   - a multi-word phrase, fixed expression, chengyu or collocation that is not a full sentence => "expression"
   - a single word (one word, however many characters) => no structural label; instead give every part of speech it commonly functions as, from: ${PARTS_OF_SPEECH.join(', ')}. Many words work as several — list all the common ones, most typical first, and omit rare or archaic uses.
     A separable verb-object compound (离合词) such as 吃饭, 睡觉, 帮忙, 结婚, 见面 — one whose two halves can be split by an aspect marker, measure phrase or modifier (吃了饭, 帮我的忙, 结过婚) — is labelled "verb-object compound" and NOT "verb". Use plain "verb" only for verbs that never split this way.

   Then, the register, from: ${REGISTERS.join(', ')}.
   - "neutral" is the default: usable in ordinary speech and writing alike
   - "casual" for colloquial speech, slang and things you would not write in an essay
   - "formal" for polite, official or ceremonious usage
   - "written" for bookish usage that is rarely spoken
   - "vernacular" for dialectal or strongly regional usage
   - "vulgar" for obscene or offensive usage
   Usually exactly one register applies, but combinations are allowed where they genuinely both hold (for example written + formal, or vernacular + vulgar).

Also set:
   - "notes": one or two sentences. For "ok", a brief usage note (common collocations, what distinguishes it from near-synonyms). For "unnatural" or "invalid", explain precisely what is wrong.
   - "suggestion": if the text is unnatural or invalid and there is an obvious corrected or more idiomatic version, the hanzi of that version. Otherwise null.

If the text is invalid, still fill in "pinyin" with the literal reading of the characters and "english" with a literal, character-by-character rendering, so the learner can see what they actually typed.

Reply with a single JSON object and nothing else:
{"verdict": "...", "pinyin": "...", "english": ["..."], "categories": ["..."], "notes": "...", "suggestion": null}`;

// The Polish glosses come from their own call, prompted entirely in Polish, so they are
// rendered from the Chinese rather than through the English above
const POLISH_PROMPT = `Jesteś leksykografem języka chińskiego i układasz hasło do fiszek dla osoby uczącej się chińskiego.

Dostajesz tekst po chińsku: pojedynczy znak, słowo, wyrażenie stałe albo całe zdanie.

Podaj jego polskie odpowiedniki. Tłumacz prosto z chińskiego, tak jak zrobiłby to słownik chińsko-polski — nie przez angielski.

Zasady:
- od 1 do 4 krótkich odpowiedników, najczęstszy jako pierwszy; dla zdania jedno naturalne tłumaczenie
- każdy odpowiednik to osobne znaczenie hasła, a nie stylistyczny wariant tego samego
- formy słownikowe: czasowniki w bezokoliczniku, rzeczowniki w mianowniku liczby pojedynczej
- gdy polszczyzna dzieli znaczenie inaczej niż chińszczyzna (pary aspektowe, czasowniki ruchu, formy grzecznościowe), trzymaj się podziału polskiego
- bez wyjaśnień, komentarzy, pinyinu i znaków chińskich w odpowiedzi
- jeśli tekst nie jest poprawnym chińskim, podaj dosłowne znaczenia kolejnych znaków

Odpowiedz wyłącznie jednym obiektem JSON:
{"tlumaczenia": ["..."]}`;

function trimmedStrings(values: unknown[]): string[] {
  return values
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

function parseInferResponse(raw: string): InferResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (!VERDICTS.includes(obj.verdict as InferVerdict)) {
    return null;
  }
  if (typeof obj.pinyin !== 'string' || !Array.isArray(obj.english)) {
    return null;
  }
  const english = trimmedStrings(obj.english);
  if (english.length === 0) {
    return null;
  }
  const suggestion = typeof obj.suggestion === 'string' ? obj.suggestion.trim() : '';
  // Anything outside the closed set is dropped rather than pushed into the user's category list
  const categories = Array.isArray(obj.categories)
    ? obj.categories
        .filter((c): c is string => typeof c === 'string')
        .map((c) => c.trim().toLowerCase())
        .filter((c) => ALLOWED_CATEGORIES.has(c))
    : [];
  return {
    verdict: obj.verdict as InferVerdict,
    pinyin: obj.pinyin.trim(),
    english,
    polish: [],
    categories: [...new Set(categories)],
    notes: typeof obj.notes === 'string' ? obj.notes.trim() : '',
    ...(suggestion ? { suggestion } : {}),
  };
}

/** Polish glosses for `text`, asked for on their own. Best-effort: `[]` if the call fails. */
async function inferPolish(text: string): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 512,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: POLISH_PROMPT },
        { role: 'user', content: text },
      ],
    });
    const content = response.choices[0]?.message?.content;
    if (!content) {
      return [];
    }
    const parsed = JSON.parse(content);
    return Array.isArray(parsed?.tlumaczenia) ? trimmedStrings(parsed.tlumaczenia) : [];
  } catch (error) {
    console.error(`Polish inference failed for "${text}":`, error);
    return [];
  }
}

/** Ask the model for the reading, meaning and a naturalness assessment of `text`. */
async function inferMain(text: string): Promise<InferResponse> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await openai.chat.completions.create({
      model: MODEL,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: text },
      ],
    });

    const content = response.choices[0]?.message?.content;
    const result = content ? parseInferResponse(content) : null;
    if (result) {
      return result;
    }
    console.warn(`Unusable inference response (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
  }
  throw new Error(`Failed to get a usable inference after ${MAX_RETRIES} attempts`);
}

export async function inferWord(text: string): Promise<InferResponse> {
  // Independent calls, so the Polish is never coloured by the English glosses
  const [result, polish] = await Promise.all([inferMain(text), inferPolish(text)]);
  return { ...result, polish };
}
