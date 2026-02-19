// Mapping from tone-marked vowels to numbered format

// prettier-ignore
const TONE_TO_NUMBER: Record<string, [string, number]> = {
  'ā': ['a', 1], 'á': ['a', 2], 'ǎ': ['a', 3], 'à': ['a', 4],
  'ē': ['e', 1], 'é': ['e', 2], 'ě': ['e', 3], 'è': ['e', 4],
  'ī': ['i', 1], 'í': ['i', 2], 'ǐ': ['i', 3], 'ì': ['i', 4],
  'ō': ['o', 1], 'ó': ['o', 2], 'ǒ': ['o', 3], 'ò': ['o', 4],
  'ū': ['u', 1], 'ú': ['u', 2], 'ǔ': ['u', 3], 'ù': ['u', 4],
  'ǖ': ['v', 1], 'ǘ': ['v', 2], 'ǚ': ['v', 3], 'ǜ': ['v', 4],
};

// Vowel character classes for regex
const A = '[aāáǎà]';
const E = '[eēéěè]';
const I = '[iīíǐì]';
const O = '[oōóǒò]';
const U = '[uūúǔù]';
const V = '[üǖǘǚǜv]'; // ü can be written as v

// All possible pinyin finals (vowel combinations)
// prettier-ignore
const FINALS = [
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
const INITIALS = '(?:zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])';

// Complete syllable pattern (match at start of string)
const SYLLABLE_PATTERN = new RegExp(`^(${INITIALS}?(?:${FINALS}))`, 'i');

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
      if (len > 1 && remaining[len - 1]?.toLowerCase() === 'n'
        && remaining[len]?.toLowerCase() !== 'g'
        && VOWEL_PATTERN.test(remaining.slice(len))) {
        len--;
      }
      // If syllable ends in 'r' (er final) and next char starts a vowel,
      // the 'r' belongs to the next syllable as an initial
      if (len > 1 && remaining[len - 1]?.toLowerCase() === 'r'
        && VOWEL_PATTERN.test(remaining.slice(len))) {
        len--;
      }
      // General backtrack: if remaining can't start a valid syllable
      // (e.g. lone consonant), the greedy match took too much
      while (len > 1 && remaining.length > len
        && !SYLLABLE_PATTERN.test(remaining.slice(len))) {
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
  const match = syllable.match(/^([a-z:]+)([1-5])?$/);
  if (!match) return syllable;

  let [, letters, toneStr] = match;
  const tone = toneStr ? parseInt(toneStr) : 5;

  // Replace ü representation
  letters = letters.replace(/u:/g, 'v');

  if (tone === 5) {
    // Neutral tone - just replace v with ü
    return letters.replace(/v/g, 'ü');
  }

  // Find the vowel to add tone mark to (following standard rules)
  // 1. If there's an 'a' or 'e', put tone on it
  // 2. If there's 'ou', put tone on 'o'
  // 3. Otherwise, put tone on the last vowel
  let toneIndex = -1;

  if (letters.includes('a')) {
    toneIndex = letters.indexOf('a');
  } else if (letters.includes('e')) {
    toneIndex = letters.indexOf('e');
  } else if (letters.includes('ou')) {
    toneIndex = letters.indexOf('o');
  } else {
    // Find last vowel
    for (let i = letters.length - 1; i >= 0; i--) {
      if ('aeiouv'.includes(letters[i])) {
        toneIndex = i;
        break;
      }
    }
  }

  if (toneIndex === -1) return letters.replace(/v/g, 'ü');

  const vowel = letters[toneIndex];
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
