import OpenAI from 'openai';
import type { InferResponse, InferVerdict } from '../../shared/types.js';

const openai = new OpenAI();

const MODEL = 'gpt-5.4';
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
  'bound morpheme',
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

   A single character that modern Mandarin does not use on its own is still "ok" — never mark a
   character "unnatural" or "invalid" merely because it only appears inside compounds. Judge it as
   the morpheme it is: "invalid" is reserved for characters that are not real characters at all.
   Label such a character "bound morpheme" (see the label rules below).

2. Give the reading and meaning:
   - "pinyin": tone-marked pinyin. Join the syllables of a single word without spaces (diànnǎo), separate distinct words with one space (wǒ hěn xǐhuan nǐ). Never include punctuation, numbers or capital letters.
   - "english": an array of 1-4 short English glosses, most common first — the way a dictionary lists senses. For a sentence, a single natural translation. For a character that only lives inside compounds, gloss the meaning it contributes and name a compound it appears in, e.g. "bat (in 蝙蝠)".
     Write the glosses in English. Never drop the Chinese word into an English phrase ("to嫁 into a family", "to摘 off" are wrong; write "to marry into a family", "to pick off"). The only Chinese that belongs in a gloss is a compound named in brackets, as in "bat (in 蝙蝠)".
     Leave out senses that only record a personal name: 王 is "king", not "surname Wang"; 李 is "plum", not "surname Li"; 张 is "to stretch" and a measure word, not "surname Zhang". Give a name sense only when the character has no other meaning in modern Mandarin (赵, 郑), and say which kind of name it is. Place names, country names and other proper nouns are fine to keep.

3. Label the text. "categories" is an array drawn only from the closed sets below — never invent a label.

   First, one structural label:
   - a full sentence (has a subject and a predicate, or is a complete utterance) => "sentence"
   - a multi-word phrase, fixed expression, chengyu or collocation that is not a full sentence => "expression"
   - a single word (one word, however many characters) => no structural label; instead give every part of speech it commonly functions as, from: ${PARTS_OF_SPEECH.join(', ')}. Many words work as several — list all the common ones, most typical first, and omit rare or archaic uses.
     Add "bound morpheme" as well if the character is not normally used as a standalone word in
     modern Mandarin and appears essentially only inside compounds (蝠, 榄, 瑚, 葡). Keep the parts of
     speech alongside it, describing the meaning it contributes. Do not use this label for
     characters that do stand alone as words, even when they are also common in compounds (好, 电,
     水, 行) — the test is whether a native speaker could use the character by itself.
     A separable verb-object compound (离合词) such as 吃饭, 睡觉, 帮忙, 结婚, 见面 — one whose two halves can be split by an aspect marker, measure phrase or modifier (吃了饭, 帮我的忙, 结过婚) — is labelled "verb-object compound" and NOT "verb". Use plain "verb" only for verbs that never split this way.

   Then the register, from: ${REGISTERS.join(', ')}. Every input gets one, including sentences, expressions and text you judged unnatural — a register label is never optional.
   - "neutral" is the default: usable in ordinary speech and writing alike
   - "casual" for colloquial speech, slang and things you would not write in an essay
   - "formal" for polite, official or ceremonious usage
   - "written" for bookish usage that is rarely spoken
   - "vernacular" for dialectal or strongly regional usage
   - "vulgar" for obscene or offensive usage
   Usually exactly one register applies, but combinations are allowed where they genuinely both hold (for example written + formal, or vernacular + vulgar).

   If the verdict is "invalid" there is nothing to label: return an empty "categories" array.

Also set:
   - "notes": one or two sentences, written in English (Chinese examples inside them are welcome). For a character that cannot stand alone as a word, say so plainly and list the common compounds it appears in — that is the most useful thing a learner can be told about it. For "ok", a brief usage note (common collocations, what distinguishes it from near-synonyms). For "unnatural" or "invalid", explain precisely what is wrong.
   - "suggestion": if the text is unnatural or invalid and there is an obvious corrected or more idiomatic version, the hanzi of that version. Otherwise null.

If the text is invalid, still fill in "pinyin" with the literal reading of the characters and "english" with a literal, character-by-character rendering, so the learner can see what they actually typed.

Reply with a single JSON object and nothing else:
{"verdict": "...", "pinyin": "...", "english": ["..."], "categories": ["..."], "notes": "...", "suggestion": null}

Worked examples of the expected output.

Input 睡觉:
{"verdict": "ok", "pinyin": "shuìjiào", "english": ["to sleep", "to go to bed"], "categories": ["verb-object compound", "neutral"], "notes": "Separable, so it splits in real use: 睡了觉, 睡个好觉. 入睡 is narrower and means specifically to fall asleep.", "suggestion": null}

Input 一带一路:
{"verdict": "ok", "pinyin": "yīdàiyīlù", "english": ["the Belt and Road Initiative"], "categories": ["expression", "formal"], "notes": "A fixed policy term, short for 丝绸之路经济带和21世纪海上丝绸之路. It belongs to news, policy and business writing rather than conversation.", "suggestion": null}

Input 你吃了吗:
{"verdict": "ok", "pinyin": "nǐ chī le ma", "english": ["Have you eaten?"], "categories": ["sentence", "casual"], "notes": "A stock greeting as much as a real question, especially among older speakers; an answer about food is not always expected.", "suggestion": null}

Input 他给我打了一个电话昨天:
{"verdict": "unnatural", "pinyin": "tā gěi wǒ dǎ le yī gè diànhuà zuótiān", "english": ["He called me yesterday"], "categories": ["sentence", "neutral"], "notes": "Understandable, but 昨天 is stranded at the end. A time expression belongs before the verb phrase.", "suggestion": "他昨天给我打了一个电话"}

Input 蝠 (a character that never stands alone):
{"verdict": "ok", "pinyin": "fú", "english": ["bat (in 蝙蝠)"], "categories": ["noun", "bound morpheme", "neutral"], "notes": "Not a standalone word in modern Mandarin: 蝠 appears essentially only in 蝙蝠 (bat), so it is worth learning as part of that compound.", "suggestion": null}

Input 睡书:
{"verdict": "invalid", "pinyin": "shuì shū", "english": ["sleep book"], "categories": [], "notes": "Not a word. 睡 takes 觉 as its object in 睡觉, but it does not combine with 书 this way.", "suggestion": "看书"}`;

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
- tekst niezręczny albo z błędem gramatycznym przetłumacz mimo to normalnie, zgodnie z tym, co autor chciał powiedzieć (dla 他给我打了一个电话昨天 poprawnie będzie "Wczoraj do mnie zadzwonił."); dosłowne znaczenia kolejnych znaków podawaj wyłącznie wtedy, gdy tekst w ogóle nie układa się w żadną sensowną całość

Odpowiedz wyłącznie jednym obiektem JSON:
{"tlumaczenia": ["..."]}

Przykłady poprawnych odpowiedzi.

Dla 睡觉:
{"tlumaczenia": ["spać", "iść spać", "kłaść się spać"]}

Dla 电脑:
{"tlumaczenia": ["komputer"]}

Dla 马马虎虎:
{"tlumaczenia": ["tak sobie", "byle jak", "niedbale"]}

Dla 阁下:
{"tlumaczenia": ["wasza ekscelencja", "jaśnie pan", "szanowny pan"]}

Dla 牛逼:
{"tlumaczenia": ["zajebisty", "wymiatający", "kozacki"]}

Dla 请问洗手间在哪里:
{"tlumaczenia": ["Przepraszam, gdzie jest toaleta?"]}

Dla 一带一路:
{"tlumaczenia": ["Inicjatywa Pasa i Szlaku", "Nowy Jedwabny Szlak"]}

Zwróć uwagę, jak w tych przykładach dobrane są odpowiedniki: rejestr zgadza się z chińskim oryginałem (wulgarne z wulgarnym, urzędowe z urzędowym), czasowniki stoją w bezokoliczniku, a kolejne pozycje to naprawdę różne znaczenia, a nie synonimy tego samego. Nazwy własne i terminy przekładaj utrwalonym polskim odpowiednikiem, jeśli taki istnieje. Nie dodawaj rodzajników, przypisów ani znaków chińskich.

Typowe błędy, których masz unikać:
- kalki z angielskiego: nie tłumacz przez angielski odpowiednik, tylko wprost z chińskiego
- doklejanie tytułów i zwrotów grzecznościowych, których nie ma w oryginale (老师 to "nauczyciel", nie "pan profesor")
- mieszanie odczytów wieloznacznego znaku: trzymaj się jednego, najczęstszego odczytania i jego znaczeń
- podawanie kilku wariantów stylistycznych tego samego znaczenia zamiast osobnych znaczeń ("iść", "pójść", "chodzić" to jedna pozycja, nie trzy)
- tłumaczenie chińskich klasyfikatorów i partykuł osobnym polskim słowem, gdy polszczyzna ich nie wyraża — opisz wtedy funkcję jednym krótkim określeniem
- zbyt książkowe słownictwo przy słowach potocznych i odwrotnie: rejestr polskiego odpowiednika ma odpowiadać rejestrowi chińskiego
- podawanie znaczeń, które mówią tylko tyle, że znak bywa nazwiskiem albo imieniem: 王 to "król", a nie "nazwisko Wang"; 李 to "śliwka", a nie "nazwisko Li". Znaczenie "nazwisko" albo "imię" podaj wyłącznie wtedy, gdy znak nie ma we współczesnym chińskim żadnego innego znaczenia (赵, 郑). Nazwy geograficzne i inne nazwy własne są w porządku

Dla pojedynczego znaku, który sam w sobie jest morfemem, podaj znaczenia, jakie ten znak wnosi do złożeń — na przykład dla 电: {"tlumaczenia": ["elektryczność", "prąd", "porazić prądem"]}.

Wiele znaków nie występuje samodzielnie i pojawia się wyłącznie w złożeniach. Nie wymyślaj wtedy samodzielnego polskiego słowa na siłę: podaj znaczenie, które znak wnosi, a jeśli trzeba, dopisz w nawiasie złożenie, w którym występuje — na przykład dla 蝠: {"tlumaczenia": ["nietoperz (w 蝙蝠)"]}.

Dla przysłowia lub chengyu podaj utrwalony polski odpowiednik, jeśli istnieje, a w przeciwnym razie zwięzłe znaczenie — na przykład dla 入乡随俗: {"tlumaczenia": ["kiedy wejdziesz między wrony, musisz krakać jak i one", "dostosować się do miejscowych zwyczajów"]}.

Zwróć wyłącznie ten obiekt JSON, bez żadnego tekstu przed ani po nim.`;

/**
 * The model occasionally substitutes the Chinese word for the English one it is glossing
 * ("to嫁 into a family"). A hanzi welded to a latin letter gives it away — but only outside
 * brackets, where the notes legitimately write things like "(in 蝙蝠)" or "(in V着)".
 */
const HANZI_IN_A_WORD = /[A-Za-z][\u3400-\u9fff]|[\u3400-\u9fff][A-Za-z]/;

function isMalformedGloss(gloss: string): boolean {
  return HANZI_IN_A_WORD.test(gloss.replace(/\([^)]*\)/g, ' '));
}

function trimmedStrings(values: unknown[]): string[] {
  return values
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v !== '' && !isMalformedGloss(v));
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
      max_completion_tokens: 2048,
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
      max_completion_tokens: 4096,
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
