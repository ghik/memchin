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
  // Handle already-spaced pinyin and apostrophes
  const normalized = pinyin.replace(/['\s]+/g, ' ').trim();
  if (normalized.includes(' ')) {
    return normalized;
  }

  const syllables: string[] = [];
  let remaining = pinyin;

  while (remaining.length > 0) {
    const match = remaining.match(SYLLABLE_PATTERN);
    if (match && match[1]) {
      syllables.push(remaining.slice(0, match[1].length));
      remaining = remaining.slice(match[1].length);
    } else {
      // No match - take one character and continue
      syllables.push(remaining[0]);
      remaining = remaining.slice(1);
    }
  }

  return syllables.join(' ');
}

export function toNumberedPinyin(pinyin: string): string {
  const syllables = pinyin.toLowerCase().split(/\s+/);
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
  // Convert to numbered format for comparison
  return toNumberedPinyin(input.toLowerCase().trim());
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
