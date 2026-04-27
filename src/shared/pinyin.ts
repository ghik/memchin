// Shared pinyin constants, parsing, and matching

import type { MatchMode } from './types.js';

// Mapping from tone-marked vowels to numbered format
// prettier-ignore
export const TONE_TO_NUMBER: Record<string, [string, number]> = {
  'ā': ['a', 1], 'á': ['a', 2], 'ǎ': ['a', 3], 'à': ['a', 4],
  'ē': ['e', 1], 'é': ['e', 2], 'ě': ['e', 3], 'è': ['e', 4],
  'ī': ['i', 1], 'í': ['i', 2], 'ǐ': ['i', 3], 'ì': ['i', 4],
  'ō': ['o', 1], 'ó': ['o', 2], 'ǒ': ['o', 3], 'ò': ['o', 4],
  'ū': ['u', 1], 'ú': ['u', 2], 'ǔ': ['u', 3], 'ù': ['u', 4],
  'ǖ': ['v', 1], 'ǘ': ['v', 2], 'ǚ': ['v', 3], 'ǜ': ['v', 4],
};

// Vowel character classes for regex
export const A = '[aāáǎà]';
export const E = '[eēéěè]';
export const I = '[iīíǐì]';
export const O = '[oōóǒò]';
export const U = '[uūúǔù]';
export const V = '[üǖǘǚǜv]'; // ü can be written as v

// All possible pinyin finals (vowel combinations)
// prettier-ignore
export const FINALS = [
  // Complex finals first (longer matches)
  `${I}${A}ng`, `${I}${A}${O}`, `${I}${A}n`, `${I}${O}ng`, `${U}${A}ng`, `${U}${A}${I}`, `${U}${A}n`,
  `${I}${A}`, `${I}${E}`, `${I}${U}`, `${I}ng`, `${I}n`,
  `${U}${A}`, `${U}${O}`, `${U}${E}`, `${U}${I}`, `${U}n`, `${U}ng`,  // ue for jue/que/xue/yue
  `${V}${E}`, `${V}${A}n`, `${V}n`,
  `${A}ng`, `${A}${I}`, `${A}${O}`, `${A}n`,
  `${E}ng`, `${E}${I}`, `${E}n`, `${E}r`,
  `${O}ng`, `${O}${U}`,
  `${A}`, `${E}`, `${I}`, `${O}`, `${U}`, `${V}`,
].join('|');

// Initial consonants (zh, ch, sh must come before z, c, s)
export const INITIALS = '(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])';

// Complete syllable pattern (match at start of string)
export const SYLLABLE_PATTERN = new RegExp(`^(${INITIALS}?(?:${FINALS}))`, 'i');

/**
 * Strip tone marks from pinyin, returning plain lowercase letters
 * e.g. "zhōng" -> "zhong", "lǜ" -> "lv"
 */
export function stripTones(pinyin: string): string {
  return [...pinyin]
    .map((ch) => {
      const entry = TONE_TO_NUMBER[ch];
      return entry ? entry[0] : ch === 'ü' ? 'v' : ch;
    })
    .join('');
}

/**
 * Get the tone number (1-5) of a tone-marked pinyin syllable.
 */
export function getSyllableTone(syllable: string): number {
  const nfd = syllable.normalize('NFD');
  if (nfd.includes('\u0304')) {
    return 1; // macron ā
  }
  if (nfd.includes('\u0301')) {
    return 2; // acute á
  }
  if (nfd.includes('\u030c')) {
    return 3; // caron ǎ
  }
  if (nfd.includes('\u0300')) {
    return 4; // grave à
  }
  return 5; // neutral (no mark)
}

// --- Pinyin search / matching ---

export interface PinyinToken {
  base: string;
  tone: number | null; // null = match any tone
}

export function parsePinyinToken(t: string): PinyinToken {
  const m = t.match(/^(.*?)([1-5])$/);
  if (m) {
    return { base: stripTones(m[1]), tone: parseInt(m[2], 10) };
  }
  const stripped = stripTones(t);
  if (stripped !== t.toLowerCase()) {
    return { base: stripped, tone: getSyllableTone(t) };
  }
  return { base: stripped, tone: null };
}

/**
 * Split a pinyin search query into tokens, handling concatenated syllables
 * with optional tone numbers. Supports spaces and apostrophes as separators.
 * e.g. "xiangxin4" -> [{base:'xiang',tone:null}, {base:'xin',tone:4}]
 */
export function splitPinyinQuery(input: string): PinyinToken[] {
  const tokens = input.split(/[\s']+/);
  const result: PinyinToken[] = [];
  for (const token of tokens) {
    let remaining = token.toLowerCase();
    while (remaining.length > 0) {
      const match = remaining.match(SYLLABLE_PATTERN);
      if (match && match[1]) {
        let len = match[1].length;
        const afterSyllable = remaining.slice(len);
        let tone: number | null = null;
        const toneMatch = afterSyllable.match(/^([1-5])/);
        if (toneMatch) {
          tone = parseInt(toneMatch[1], 10);
        }
        const syllable = remaining.slice(0, len);
        const parsed = parsePinyinToken(syllable);
        if (tone !== null) {
          parsed.tone = tone;
          len += 1;
        }
        result.push(parsed);
        remaining = remaining.slice(len);
      } else {
        remaining = remaining.slice(1);
      }
    }
  }
  return result;
}

export function pinyinCandidateIndices(syllableCount: number, tokenCount: number, mode: MatchMode): number[] {
  if (tokenCount > syllableCount) {
    return [];
  }
  switch (mode) {
    case 'prefix':
      return [0];
    case 'suffix':
      return [syllableCount - tokenCount];
    case 'exact':
      return tokenCount === syllableCount ? [0] : [];
    default:
      return Array.from({ length: syllableCount - tokenCount + 1 }, (_, i) => i);
  }
}

export function syllableMatchesToken(stored: string, tok: PinyinToken): boolean {
  const base = stripTones(stored);
  if (base !== tok.base) {
    return false;
  }
  if (tok.tone !== null && getSyllableTone(stored) !== tok.tone) {
    return false;
  }
  return true;
}

// --- Syllable splitting ---

const VOWEL_PATTERN = new RegExp(`^(?:${FINALS})`, 'i');

/**
 * Split pinyin string into separate syllables
 * e.g. "zhīdào" -> "zhī dào"
 */
export function splitPinyin(pinyin: string): string {
  // Handle apostrophes by replacing with spaces, then split each token
  const normalized = pinyin.replace(/['\s]+/g, ' ').trim();
  if (normalized.includes(' ')) {
    return normalized.split(' ').map(splitPinyin).join(' ');
  }

  const syllables: string[] = [];
  let remaining = pinyin;

  while (remaining.length > 0) {
    const match = remaining.match(SYLLABLE_PATTERN);
    if (match && match[1]) {
      let len = match[1].length;
      // If syllable ends in 'n' (not 'ng') and next char starts a vowel,
      // the 'n' belongs to the next syllable as an initial
      if (
        len > 1 &&
        remaining[len - 1]?.toLowerCase() === 'n' &&
        remaining[len]?.toLowerCase() !== 'g' &&
        VOWEL_PATTERN.test(remaining.slice(len))
      ) {
        len--;
      }
      // If syllable ends in 'ng' and remaining starts with a vowel,
      // check if 'g' should be the initial of the next syllable instead
      // e.g. "fànguǎn" → "fàn guǎn" not "fàng uǎn"
      if (
        len > 2 &&
        remaining[len - 2]?.toLowerCase() === 'n' &&
        remaining[len - 1]?.toLowerCase() === 'g' &&
        remaining.length > len &&
        VOWEL_PATTERN.test(remaining.slice(len)) &&
        SYLLABLE_PATTERN.test(remaining.slice(len - 1))
      ) {
        len--;
      }
      // If syllable ends in 'r' (er final) and next char starts a vowel,
      // the 'r' belongs to the next syllable as an initial
      if (
        len > 1 &&
        remaining[len - 1]?.toLowerCase() === 'r' &&
        VOWEL_PATTERN.test(remaining.slice(len))
      ) {
        len--;
      }
      // General backtrack: if remaining can't start a valid syllable
      // (e.g. lone consonant), the greedy match took too much.
      // Exception: if the only thing left is an erhua 'r' (optionally preceded by a
      // tone digit) and no shorter match would leave a single clean syllable as the
      // entire remainder, treat 'r' as an erhua suffix and stop backtracking.
      while (len > 1 && remaining.length > len && !SYLLABLE_PATTERN.test(remaining.slice(len))) {
        if (/^[1-5]?r$/i.test(remaining.slice(len))) {
          // Only stop if no backtrack position yields a complete single syllable
          const hasCleanBacktrack = Array.from({ length: len - 1 }, (_, i) => i + 1).some((l) => {
            const after = remaining.slice(l);
            const m = after.match(SYLLABLE_PATTERN);
            return m && m[1].length === after.length;
          });
          if (!hasCleanBacktrack) {
            break;
          }
        }
        len--;
      }
      syllables.push(remaining.slice(0, len));
      remaining = remaining.slice(len);
    } else {
      // No match - take one character and continue
      syllables.push(remaining[0]);
      remaining = remaining.slice(1);
    }
  }

  return syllables.join(' ');
}

// --- Conversion and normalization ---

export function toNumberedPinyin(pinyin: string): string {
  const syllables = splitPinyin(pinyin.toLowerCase()).split(/\s+/);
  return syllables
    .map((syllable) => {
      let tone = 5; // neutral tone
      let result = '';

      for (const char of syllable) {
        if (TONE_TO_NUMBER[char]) {
          const [base, t] = TONE_TO_NUMBER[char];
          result += base;
          tone = t;
        } else {
          result += char;
        }
      }

      return tone === 5 ? result : result + tone;
    })
    .join('');
}

export function normalizePinyin(input: string): string {
  return toNumberedPinyin(input.toLowerCase().trim()).replace(/[^a-z0-9]/g, '');
}

/**
 * Convert tone-marked pinyin to the format expected by Google Cloud TTS SSML
 * `<phoneme alphabet="pinyin" ph="...">` — space-separated syllables with an
 * explicit tone digit (5 for neutral) and ü written as v.
 * e.g. "zhōng guó" -> "zhong1 guo2", "de" -> "de5", "lǜ" -> "lv4"
 */
export function toSsmlPinyin(pinyin: string): string {
  return splitPinyin(pinyin.toLowerCase())
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .map((syllable) => {
      let tone = 5;
      let result = '';
      for (const char of syllable) {
        const entry = TONE_TO_NUMBER[char];
        if (entry) {
          result += entry[0];
          tone = entry[1];
        } else if (char === 'ü') {
          result += 'v';
        } else {
          result += char;
        }
      }
      return result + tone;
    })
    .join(' ');
}

export function pinyinMatches(input: string, expected: string): boolean {
  return normalizePinyin(input) === normalizePinyin(expected);
}

export function englishMatches(input: string, translations: string[]): boolean {
  return translations.some((t) => t.toLowerCase().trim() === input.toLowerCase().trim());
}

export function hanziMatches(input: string, expected: string): boolean {
  return input.trim() === expected.trim();
}

/**
 * Check if an answer is synonymous with the expected pinyin.
 * For multi-character words, tolerates:
 * - missing tone number on the last syllable (e.g. "wei1xiao" for "wei1xiao4")
 * - extra tone number on a neutral-tone last syllable (e.g. "dong1xi1" for "dong1xi")
 */
export function lastNeutralToneMismatch(
  normalizedAnswer: string,
  normalizedExpected: string
): boolean {
  return (
    normalizedAnswer === normalizedExpected.replace(/[1-4]$/, '') ||
    normalizedAnswer.replace(/[1-4]$/, '') === normalizedExpected
  );
}

// Mapping from numbered pinyin to tone marks
const TONE_MARKS: Record<string, string[]> = {
  a: ['ā', 'á', 'ǎ', 'à', 'a'],
  e: ['ē', 'é', 'ě', 'è', 'e'],
  i: ['ī', 'í', 'ǐ', 'ì', 'i'],
  o: ['ō', 'ó', 'ǒ', 'ò', 'o'],
  u: ['ū', 'ú', 'ǔ', 'ù', 'u'],
  v: ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'], // ü written as v in CEDICT
};

/**
 * Convert numbered pinyin syllable to tone-marked pinyin
 * e.g. "zhong1" -> "zhōng", "lv4" -> "lǜ"
 */
function syllableToToneMarked(syllable: string): string {
  const match = syllable.match(/^([a-zA-Z:]+)([1-5])?$/);
  if (!match) return syllable;

  let [, letters, toneStr] = match;
  const tone = toneStr ? parseInt(toneStr) : 5;

  // Replace ü representation
  letters = letters.replace(/u:/g, 'v').replace(/U:/g, 'V');

  if (tone === 5) {
    // Neutral tone - just replace v with ü
    return letters.replace(/v/g, 'ü').replace(/V/g, 'Ü');
  }

  // Find the vowel to add tone mark to (following standard rules)
  // 1. If there's an 'a' or 'e', put tone on it
  // 2. If there's 'ou', put tone on 'o'
  // 3. Otherwise, put tone on the last vowel
  const lower = letters.toLowerCase();
  let toneIndex = -1;

  if (lower.includes('a')) {
    toneIndex = lower.indexOf('a');
  } else if (lower.includes('e')) {
    toneIndex = lower.indexOf('e');
  } else if (lower.includes('ou')) {
    toneIndex = lower.indexOf('o');
  } else {
    // Find last vowel
    for (let i = lower.length - 1; i >= 0; i--) {
      if ('aeiouv'.includes(lower[i])) {
        toneIndex = i;
        break;
      }
    }
  }

  if (toneIndex === -1) return letters.replace(/v/g, 'ü').replace(/V/g, 'Ü');

  const vowel = lower[toneIndex];
  const toneMarked = TONE_MARKS[vowel]?.[tone - 1] ?? vowel;

  let result = letters.slice(0, toneIndex) + toneMarked + letters.slice(toneIndex + 1);

  // Replace remaining v with ü
  result = result.replace(/v/g, 'ü');

  return result;
}

/**
 * Convert numbered pinyin string to tone-marked
 * e.g. "zhong1 guo2" -> "zhōng guó"
 */
export function numberedToToneMarked(pinyin: string): string {
  return pinyin
    .split(' ')
    .map((s) => syllableToToneMarked(s))
    .join(' ');
}

/**
 * Normalize pinyin input to tone-marked form, handling both numbered and tone-marked input.
 * Preserves spaces that were present in the original input but not those inserted for conversion.
 * e.g. "huo3che1zhan4" -> "huǒchēzhàn"
 *      "huo3che1 zhan4" -> "huǒchē zhàn"
 *      "huǒchē zhàn" -> "huǒchē zhàn"
 */
export function normalizePinyinInput(pinyin: string): string {
  if (!/[1-5]/.test(pinyin)) {
    return splitPinyin(pinyin);
  }
  return pinyin
    .split(/\s+/)
    .map((token) => numberedToToneMarked(token.replace(/([1-5])(?=[a-zA-Z])/g, '$1 ')).replace(/\s+/g, ''))
    .join(' ');
}

/**
 * Validate that a string contains only valid pinyin syllables.
 * Accepts tone-marked (zhōng) or numbered (zhong1) pinyin.
 * Tokens are split on spaces and apostrophes.
 */
export function validatePinyin(input: string): boolean {
  const normalized = input.replace(/['\s]+/g, ' ').trim();
  if (!normalized) return false;

  const tokens = normalized.split(' ');
  for (const token of tokens) {
    let remaining = token;
    while (remaining.length > 0) {
      const match = remaining.match(SYLLABLE_PATTERN);
      if (!match || !match[1]) return false;
      remaining = remaining.slice(match[1].length);
      // Allow optional trailing tone number [1-4] after each syllable
      const toneMatch = remaining.match(/^[1-4]/);
      if (toneMatch) {
        remaining = remaining.slice(1);
      }
      // Allow erhua suffix "r" (e.g. hui4r, nar) when it's not the start of its own syllable
      if (/^r/i.test(remaining)) {
        const afterR = remaining.slice(1);
        if (afterR.length === 0 || SYLLABLE_PATTERN.test(afterR)) {
          remaining = afterR;
        }
      }
    }
  }

  return true;
}
