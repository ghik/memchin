// Shared pinyin constants and validation

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
 * Convert tone-marked pinyin to numbered format.
 * e.g. "nǐ hǎo" -> "ni3hao3"
 */
export function toNumberedPinyin(pinyin: string): string {
  return pinyin
    .toLowerCase()
    .split(' ')
    .map((syllable) => {
      let s = syllable;
      let tone = 0;
      for (const [marked, [plain, t]] of Object.entries(TONE_TO_NUMBER)) {
        if (s.includes(marked)) {
          s = s.replaceAll(marked, plain);
          tone = t;
        }
      }
      return tone > 0 ? `${s}${tone}` : s;
    })
    .join('');
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
