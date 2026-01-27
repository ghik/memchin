// Mapping from tone-marked vowels to numbered format

// prettier-ignore
const TONE_TO_NUMBER: Record<string, [string, number]> = {
  'ā': ['a', 1], 'á': ['a', 2], 'ǎ': ['a', 3], 'à': ['a', 4],
  'ē': ['e', 1], 'é': ['e', 2], 'ě': ['e', 3], 'è': ['e', 4],
  'ī': ['i', 1], 'í': ['i', 2], 'ǐ': ['i', 3], 'ì': ['i', 4],
  'ō': ['o', 1], 'ó': ['o', 2], 'ǒ': ['o', 3], 'ò': ['o', 4],
  'ū': ['u', 1], 'ú': ['u', 2], 'ǔ': ['u', 3], 'ù': ['u', 4],
  'ǖ': ['ü', 1], 'ǘ': ['ü', 2], 'ǚ': ['ü', 3], 'ǜ': ['ü', 4],
};

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
  const r = toNumberedPinyin(input.toLowerCase().trim());
  console.log(`Normalized pinyin: "${input}" -> "${r}"`);
  return r;
}

export function pinyinMatches(input: string, expected: string): boolean {
  console.log(`Comparing pinyin: input="${input}", expected="${expected}"`);
  return normalizePinyin(input) === normalizePinyin(expected);
}

export function englishMatches(input: string, translations: string[]): boolean {
  return translations.some((t) => t.toLowerCase().trim() === input.toLowerCase().trim());
}

export function hanziMatches(input: string, expected: string): boolean {
  return input.trim() === expected.trim();
}
