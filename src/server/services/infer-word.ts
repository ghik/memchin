import { openai } from './openai.js';
import { notesAreAboutAHomophone } from './homophones.js';
import { recordUsage } from './ai-usage.js';
import type { InferResponse, InferVerdict } from '../../shared/types.js';

const MODEL = 'gpt-5.4';
const MAX_RETRIES = 3;

/**
 * OpenAI caches the repeated prefix of a prompt by itself, at a fraction of the price, but
 * only once the prompt is long enough: measured against gpt-5.4, nothing under 1792 tokens is
 * cached at all, and above that the cached prefix grows in steps of 1024 (1792, 2816, 3840...).
 * Both prompts below are sized to clear a step with a little room to spare — the English one
 * runs about 3000 tokens and the Polish one about 1900 — so shortening either of them costs
 * more than the tokens it saves. `prompt_cache_key` keeps each kind of call on one cache.
 */

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

/**
 * Register labels. Every input gets exactly one from the formality scale, optionally a medium
 * (spoken/written) and the marked registers on top of that.
 */
const FORMALITY = ['colloquial', 'neutral', 'formal'];
const REGISTERS = [...FORMALITY, 'spoken', 'written', 'vernacular', 'crude', 'vulgar'];

const ALLOWED_CATEGORIES = new Set([
  'sentence',
  'expression',
  'bound morpheme',
  ...PARTS_OF_SPEECH,
  ...REGISTERS,
]);

const PROMPT = `You are a Mandarin Chinese lexicographer helping a learner add an entry to their vocabulary deck.

You are given a piece of text the learner typed. It may be a single character, a word, a fixed expression, or a whole sentence.

Everything you write must be about that exact text. Chinese is full of homophones, and a single character shares its reading with many others: 章 (chapter) is not 张 (the measure word for flat things), 干 is not 甘, 是 is not 事. Never borrow a sense, an example or a usage note from a similar-looking or similar-sounding character. Before you answer, check that you have not mixed the text up with another character that has the same or a similar pronunciation — look at the character itself, not only at how it sounds, and make sure the senses, compounds and examples you give belong to it rather than to its homophone.

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
   - "english": an array of 1-4 short English glosses, most common first — the way a dictionary lists senses. For a sentence, one gloss per reading: the translation a native speaker takes out of context first, then every other reading the Chinese genuinely allows, each as its own entry in the array — never merged into one string with a slash or a parenthetical. Tense is the usual source of these, since Chinese does not mark it: 我今天开车去公司 gets both "I'm driving to the office today" and "I drove to the office today". Whenever a sentence has more than one reading, the note must say what it leaves unmarked and what would pin it down (a 了, a 每天, a 正在). For a character that only lives inside compounds, gloss the meaning it contributes and name a compound it appears in, e.g. "bat (in 蝙蝠)".
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
     A separable verb-object compound (离合词) such as 吃饭, 睡觉, 帮忙, 结婚, 见面 — the verb first and its own object second, so that an aspect marker, measure phrase or modifier can be dropped in between them (吃了饭, 帮我的忙, 结过婚) — is labelled "verb-object compound" and NOT "verb". The order is what counts: a compound built the other way round, with the noun in front (面试, 笔试, 手写, 心疼, 自杀), is a plain "verb" no matter how verb-like its second half, and so is any verb that never splits (喜欢, 认识, 决定). Whenever you use this label, the note must show the word actually split, because that is the whole payoff: anything that attaches to the verb — aspect markers, duration and frequency phrases, resultative and potential complements, modifiers of the object — sits between the two halves and never after the word (睡了一个小时的觉, 见过一次面, 睡不着觉, 帮不上忙; 睡觉了一个小时 and 见面过一次 are wrong). Reduplication likewise doubles the verb half only (散散步, 帮帮忙). Where the word cannot be split — before a 得-complement, and as an alternative for durations — the verb has to be copied instead (睡觉睡得很晚, 睡觉睡了一个小时), so say which of the two a learner needs.

   Then the register. Two independent choices, plus two marked labels.

   How formal it is — exactly one of ${FORMALITY.join(', ')}, never omitted, not for sentences, not for expressions, not for text you judged unnatural:
   - "colloquial" for everyday speech and chat: slang, fillers, things you would not put in an essay
   - "neutral" is the default: at home in ordinary speech and ordinary writing alike
   - "formal" for polite, official, ceremonious or technical usage

   Which medium it belongs to — add "spoken" or "written" only when the word genuinely leans one way:
   - "spoken" for 口语 that is said but seldom written: sentence-final particles, fillers, greetings, spoken-only shortenings
   - "written" for 书面语 that is read but seldom said: bookish connectives, chengyu in prose, documentary vocabulary
   - add neither when it is equally usual in speech and in writing
   This is independent of formality: a polite greeting is formal and spoken, chat slang is colloquial and written.

   Add "vernacular" for dialectal or strongly regional usage.

   Then, at most one label for how coarse the word is. These two are mutually exclusive, and both sit on top of the formality label rather than replacing it:
   - "vulgar" only for language that genuinely offends. The test is narrow: is the word itself a swear word, a slur, or explicit sexual or scatological language used to shock or insult? 操, 傻逼, 牛逼, 混蛋, 屁话 pass it.
   - "crude" for words that are coarse or earthy but not offensive — bodily functions and body parts in blunt everyday terms, cheerfully rough slang. Fine among friends, out of place in front of a teacher or a client. 屌丝, 放屁, 拉屎, 尿尿, 屁股 belong here.
   Most words get neither. When a word is merely informal, that is what "colloquial" is for; reach for "crude" only when a learner would actually be caught out using it in polite company, and for "vulgar" only when it would cause offence.

   If the verdict is "invalid" there is nothing to label: return an empty "categories" array.

Also set:
   - "notes": one or two sentences, written in English (Chinese examples inside them are welcome). For a character that cannot stand alone as a word, say so plainly and list the common compounds it appears in — that is the most useful thing a learner can be told about it. For "ok", a brief usage note (common collocations, what distinguishes it from near-synonyms). For "unnatural" or "invalid", explain precisely what is wrong.
   - "suggestion": if the text is unnatural or invalid and there is an obvious corrected or more idiomatic version, the hanzi of that version. Otherwise null.

If the text is invalid, still fill in "pinyin" with the literal reading of the characters and "english" with a literal, character-by-character rendering, so the learner can see what they actually typed.

Reply with a single JSON object and nothing else:
{"verdict": "...", "pinyin": "...", "english": ["..."], "categories": ["..."], "notes": "...", "suggestion": null}

Worked examples of the expected output.

Input 睡觉:
{"verdict": "ok", "pinyin": "shuìjiào", "english": ["to sleep", "to go to bed"], "categories": ["verb-object compound", "neutral"], "notes": "Separable, so durations and complements go inside — 睡了一个小时的觉, 睡不着觉, 睡个好觉 — or the verb is copied before a 得-complement: 睡觉睡得很晚, never 睡觉得很晚. 入睡 is narrower and means specifically to fall asleep.", "suggestion": null}

Input 我今天开车去公司:
{"verdict": "ok", "pinyin": "wǒ jīntiān kāichē qù gōngsī", "english": ["I'm driving to the office today", "I drove to the office today"], "categories": ["sentence", "neutral"], "notes": "Nothing in the sentence marks time, so both readings stand: a 了 at the end would report it as done, 正在 or 每天 would settle it the other way. 开车 here says how the speaker gets there, and 去公司 is the point of it.", "suggestion": null}

Input 吃饭:
{"verdict": "ok", "pinyin": "chīfàn", "english": ["to eat", "to have a meal"], "categories": ["verb-object compound", "neutral"], "notes": "Separable, so a duration or a count goes inside — 吃了一个小时的饭, 吃过两次饭 — and before a 得-complement the verb is copied: 吃饭吃得很快. 吃饭了 reports a change of state ('we have eaten', or as a call, 'food is ready'), while 吃了饭 sets up whatever comes next.", "suggestion": null}

Input 一带一路:
{"verdict": "ok", "pinyin": "yīdàiyīlù", "english": ["the Belt and Road Initiative"], "categories": ["expression", "formal", "written"], "notes": "A fixed policy term, short for 丝绸之路经济带和21世纪海上丝绸之路. It belongs to news, policy and business writing rather than conversation.", "suggestion": null}

Input 你吃了吗:
{"verdict": "ok", "pinyin": "nǐ chī le ma", "english": ["Have you eaten?"], "categories": ["sentence", "colloquial", "spoken"], "notes": "A stock greeting as much as a real question, especially among older speakers; an answer about food is not always expected.", "suggestion": null}

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
- od 1 do 4 krótkich odpowiedników, najczęstszy jako pierwszy; dla zdania po jednym tłumaczeniu na każde możliwe odczytanie: najpierw to, które native speaker wybierze bez kontekstu, potem każde inne, na które chiński naprawdę pozwala, jako osobna pozycja listy — nigdy sklejone ukośnikiem ani wariantem w nawiasie. Chiński nie oznacza czasu, a polszczyzna wymusza dodatkowo wybór aspektu, więc 我今天开车去公司 to zarówno "Dziś jadę samochodem do firmy", jak i "Dziś pojechałem samochodem do firmy"
- każdy odpowiednik to osobne znaczenie hasła, a nie stylistyczny wariant tego samego
- formy słownikowe: czasowniki w bezokoliczniku, rzeczowniki w mianowniku liczby pojedynczej
- aspekt: chiński go nie wyraża, więc domyślnie podawaj czasownik niedokonany ("jeść", "pisać", "uczyć się"). Formę dokonaną wybierz tylko wtedy, gdy sam chiński wyraz mówi o rezultacie albo o zakończeniu czynności (吃完 to "zjeść", 学会 to "nauczyć się", 到 to "dotrzeć"). Nie podawaj obu form tego samego czasownika jako dwóch pozycji
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

Dla 我今天开车去公司:
{"tlumaczenia": ["Dziś jadę samochodem do firmy", "Dziś pojechałem samochodem do firmy"]}

Dla 结婚:
{"tlumaczenia": ["ożenić się", "wyjść za mąż", "brać ślub"]}

Dla 麻烦:
{"tlumaczenia": ["kłopot", "sprawiać kłopot", "uciążliwy"]}

Dla 上班:
{"tlumaczenia": ["iść do pracy", "pracować", "być w pracy"]}

Dla 吃完:
{"tlumaczenia": ["zjeść", "skończyć jeść"]}

Dla 一带一路:
{"tlumaczenia": ["Inicjatywa Pasa i Szlaku", "Nowy Jedwabny Szlak"]}

Zwróć uwagę na 结婚 i 麻烦: tam, gdzie polszczyzna dzieli znaczenie drobniej niż chiński — inaczej dla mężczyzny i dla kobiety, osobno rzeczownik, czasownik i przymiotnik — wypisz te znaczenia osobno, bo uczący się musi wiedzieć, którego słowa użyć. Odwrotnie, gdy to chiński jest drobniejszy, jedno polskie słowo w zupełności wystarczy.

Zwróć uwagę, jak w tych przykładach dobrane są odpowiedniki: rejestr zgadza się z chińskim oryginałem (wulgarne z wulgarnym, urzędowe z urzędowym), czasowniki stoją w bezokoliczniku, a kolejne pozycje to naprawdę różne znaczenia, a nie synonimy tego samego. Nazwy własne i terminy przekładaj utrwalonym polskim odpowiednikiem, jeśli taki istnieje. Nie dodawaj rodzajników, przypisów ani znaków chińskich.

Typowe błędy, których masz unikać:
- kalki z angielskiego: nie tłumacz przez angielski odpowiednik, tylko wprost z chińskiego
- doklejanie tytułów i zwrotów grzecznościowych, których nie ma w oryginale (老师 to "nauczyciel", nie "pan profesor")
- mieszanie odczytów wieloznacznego znaku: trzymaj się jednego, najczęstszego odczytania i jego znaczeń
- podawanie kilku wariantów stylistycznych tego samego znaczenia zamiast osobnych znaczeń ("iść", "pójść", "chodzić" to jedna pozycja, nie trzy) — to nie dotyczy zdań wieloznacznych: tam różne odczytania czasu czy aspektu są osobnymi pozycjami, bo znaczą co innego
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
async function inferPolish(text: string, signal?: AbortSignal): Promise<string[]> {
  try {
    const response = await openai.chat.completions.create(
      {
        model: MODEL,
        max_completion_tokens: 2048,
        response_format: { type: 'json_object' },
        // The Polish system prompt is the same on every call, so it is worth caching; the key
        // keeps these requests together, away from the English ones with their own prefix
        prompt_cache_key: 'memchin-infer-polish',
        messages: [
          { role: 'system', content: POLISH_PROMPT },
          { role: 'user', content: text },
        ],
      },
      { signal }
    );
    recordUsage('polish', response.usage);
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
async function inferMain(text: string, signal?: AbortSignal): Promise<InferResponse> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await openai.chat.completions.create(
      {
        model: MODEL,
        max_completion_tokens: 4096,
        response_format: { type: 'json_object' },
        prompt_cache_key: 'memchin-infer-main',
        messages: [
          { role: 'system', content: PROMPT },
          { role: 'user', content: text },
        ],
      },
      { signal }
    );

    recordUsage('main', response.usage);
    const content = response.choices[0]?.message?.content;
    const result = content ? parseInferResponse(content) : null;
    if (result && notesAreAboutAHomophone(text, result.notes)) {
      console.warn(`Inference for "${text}" reads as being about a homophone, retrying...`);
      continue;
    }
    if (result) {
      return result;
    }
    console.warn(`Unusable inference response (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
  }
  throw new Error(`Failed to get a usable inference after ${MAX_RETRIES} attempts`);
}

export async function inferWord(text: string, signal?: AbortSignal): Promise<InferResponse> {
  // Independent calls, so the Polish is never coloured by the English glosses
  const [result, polish] = await Promise.all([inferMain(text, signal), inferPolish(text, signal)]);
  return { ...result, polish };
}
