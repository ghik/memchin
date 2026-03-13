import { TONE_TO_NUMBER, FINALS, INITIALS, SYLLABLE_PATTERN } from '../../shared/pinyin.js';

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

  const VOWEL_PATTERN = new RegExp(`^(?:${FINALS})`, 'i');

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
      // (e.g. lone consonant), the greedy match took too much
      while (len > 1 && remaining.length > len && !SYLLABLE_PATTERN.test(remaining.slice(len))) {
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
  // Convert to numbered format and strip non-alphanumeric characters
  return toNumberedPinyin(input.toLowerCase().trim()).replace(/[^a-z0-9]/g, '');
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
