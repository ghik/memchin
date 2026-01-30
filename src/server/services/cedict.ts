import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cedictPath = path.join(__dirname, '../../../cedict_1_0_ts_utf-8_mdbg.txt');

export interface CedictEntry {
  traditional: string;
  simplified: string;
  pinyin: string; // With tone marks
  pinyinNumbered: string; // Original numbered format from CEDICT
  definitions: string[];
}

export interface CharacterBreakdown {
  hanzi: string;
  pinyin: string;
  meaning: string;
}

// Map from simplified hanzi to entries (can have multiple readings)
let cedictMap: Map<string, CedictEntry[]> | null = null;

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

  const lowerLetters = letters.toLowerCase();
  let toneIndex = -1;

  if (lowerLetters.includes('a')) {
    toneIndex = lowerLetters.indexOf('a');
  } else if (lowerLetters.includes('e')) {
    toneIndex = lowerLetters.indexOf('e');
  } else if (lowerLetters.includes('ou')) {
    toneIndex = lowerLetters.indexOf('o');
  } else {
    // Find last vowel
    for (let i = lowerLetters.length - 1; i >= 0; i--) {
      if ('aeiouv'.includes(lowerLetters[i])) {
        toneIndex = i;
        break;
      }
    }
  }

  if (toneIndex === -1) return letters.replace(/v/g, 'ü').replace(/V/g, 'Ü');

  const vowel = lowerLetters[toneIndex];
  const isUpper = letters[toneIndex] === letters[toneIndex].toUpperCase();
  const toneMarked = TONE_MARKS[vowel]?.[tone - 1] ?? vowel;

  let result =
    letters.slice(0, toneIndex) +
    (isUpper ? toneMarked.toUpperCase() : toneMarked) +
    letters.slice(toneIndex + 1);

  // Replace remaining v with ü
  result = result.replace(/v/g, 'ü').replace(/V/g, 'Ü');

  return result;
}

/**
 * Convert numbered pinyin string to tone-marked
 * e.g. "zhong1 guo2" -> "zhōng guó"
 */
function numberedToToneMarked(pinyin: string): string {
  return pinyin
    .split(' ')
    .map((s) => syllableToToneMarked(s))
    .join(' ');
}

/**
 * Load and parse the CEDICT file
 */
export function loadCedict(): Map<string, CedictEntry[]> {
  if (cedictMap) return cedictMap;

  if (!fs.existsSync(cedictPath)) {
    throw new Error(`CEDICT file not found at ${cedictPath}. Download it first.`);
  }

  // First pass: collect all entries, grouping by simplified + pinyin (lowercase)
  const tempMap = new Map<string, CedictEntry>();
  const data = fs.readFileSync(cedictPath, 'utf-8');

  for (let line of data.split('\n')) {
    line = line.replace(/\r$/, ''); // Handle Windows line endings
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') continue;

    // Parse format: Traditional Simplified [pinyin] /def1/def2/.../
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/);
    if (!match) continue;

    const [, traditional, simplified, pinyinNumbered, defStr] = match;
    const definitions = defStr.split('/').filter((d) => d.trim() !== '');
    const pinyin = numberedToToneMarked(pinyinNumbered).toLowerCase();
    const pinyinKey = pinyinNumbered.toLowerCase().replace(/u:/g, 'v');

    // Key for merging: simplified + lowercase pinyin
    const mergeKey = `${simplified}|${pinyinKey}`;

    const existing = tempMap.get(mergeKey);
    if (existing) {
      // Merge definitions
      existing.definitions.push(...definitions);
    } else {
      tempMap.set(mergeKey, {
        traditional,
        simplified,
        pinyin,
        pinyinNumbered: pinyinNumbered.toLowerCase().replace(/u:/g, 'v'),
        definitions,
      });
    }
  }

  // Second pass: group by simplified hanzi
  cedictMap = new Map();
  for (const entry of tempMap.values()) {
    const existing = cedictMap.get(entry.simplified) || [];
    existing.push(entry);
    cedictMap.set(entry.simplified, existing);
  }

  console.log(`Loaded ${cedictMap.size} CEDICT entries`);
  return cedictMap;
}

/**
 * Look up a word in CEDICT
 * Returns the first matching entry, or null if not found
 */
export function lookupWord(hanzi: string): CedictEntry | null {
  const map = loadCedict();
  const entries = map.get(hanzi);
  return entries?.[0] ?? null;
}

/**
 * Check if a definition is only a surname or variant reference
 */
function isSurnameOrVariant(definition: string): boolean {
  return /^surname\s/i.test(definition) ||
    /^(old\s+)?variant\s+of\s/i.test(definition);
}

/**
 * Filter out entries where ALL definitions are just surnames or variants
 */
function filterEntries(entries: CedictEntry[]): CedictEntry[] {
  return entries.filter((entry) =>
    entry.definitions.some((def) => !isSurnameOrVariant(def))
  );
}

/**
 * Get character breakdown for a multi-character word
 * Returns meaning for each individual character
 */
export function getCharacterBreakdown(hanzi: string): CharacterBreakdown[] {
  const map = loadCedict();
  const result: CharacterBreakdown[] = [];

  for (const char of hanzi) {
    const entries = map.get(char);
    const filtered = entries ? filterEntries(entries) : [];
    if (filtered.length > 0) {
      for (const entry of filtered) {
        result.push({
          hanzi: char,
          pinyin: entry.pinyin,
          meaning: entry.definitions.filter((d) => !isSurnameOrVariant(d)).join(' / '),
        });
      }
    } else {
      result.push({
        hanzi: char,
        pinyin: '?',
        meaning: '(not found)',
      });
    }
  }

  return result;
}
