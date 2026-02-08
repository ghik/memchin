import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { numberedToToneMarked, stripTones } from './pinyin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cedictPath = path.join(__dirname, '../../../sources/cedict_1_0_ts_utf-8_mdbg.txt');

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
 * Uses the word's pinyin to select the correct CEDICT reading for each character.
 * Matching priority: exact pinyin match (with tones) > toneless match > all entries.
 */
export function getCharacterBreakdown(hanzi: string, wordPinyin?: string): CharacterBreakdown[] {
  const map = loadCedict();
  const result: CharacterBreakdown[] = [];
  const syllables = wordPinyin ? wordPinyin.split(/\s+/) : [];

  const chars = [...hanzi];
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const entries = map.get(char);
    const filtered = entries ? filterEntries(entries) : [];

    if (filtered.length === 0) {
      result.push({ hanzi: char, pinyin: '?', meaning: '(not found)' });
      continue;
    }

    const charPinyin = syllables[i];
    let matched: CedictEntry[] = filtered;

    if (charPinyin) {
      // Try exact match (with tones)
      const exact = filtered.filter((e) => e.pinyin === charPinyin);
      if (exact.length > 0) {
        matched = exact;
      } else {
        // Fallback: match ignoring tones
        const toneless = stripTones(charPinyin);
        const approx = filtered.filter((e) => stripTones(e.pinyin) === toneless);
        if (approx.length > 0) {
          matched = approx;
        }
      }
    }

    for (const entry of matched) {
      result.push({
        hanzi: char,
        pinyin: entry.pinyin,
        meaning: entry.definitions.filter((d) => !isSurnameOrVariant(d)).join(' / '),
      });
    }
  }

  return result;
}
