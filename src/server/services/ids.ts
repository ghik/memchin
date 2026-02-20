import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CharacterInfo } from '../../shared/types.js';
import { filterDefinitions, filterEntries, loadCedict } from './cedict.js';
import { stripTones } from './pinyin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const idsPath = path.join(__dirname, '../../../sources/ids.txt');

// IDS operator characters (U+2FF0..U+2FFB) — describe spatial layout, not actual components
const IDS_OPERATORS = new Set('⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻');

let idsMap: Map<string, string[]> | null = null;

/**
 * Load and parse the IDS file.
 * Returns a map from character to its direct components (excluding IDS operators).
 */
export function loadIds(): Map<string, string[]> {
  if (idsMap) return idsMap;
  idsMap = new Map();

  if (!fs.existsSync(idsPath)) return idsMap;

  const data = fs.readFileSync(idsPath, 'utf-8');
  for (const line of data.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;

    const parts = line.split('\t');
    if (parts.length < 3) continue;

    const char = parts[1];

    // IDS entries may have multiple tab-separated variants with regional tags like [G], [TJK].
    // Prefer the variant tagged [G] (mainland China); fall back to the first entry.
    const idsCandidates = parts.slice(2);
    let ids = idsCandidates.find((s) => /\[.*G.*\]/.test(s)) ?? idsCandidates[0];

    // Strip the regional tag suffix (e.g. "[GJ]")
    ids = ids.replace(/\[.*\]$/, '');

    // Extract direct components: all characters in the IDS string that aren't operators
    const components: string[] = [];
    for (const ch of ids) {
      if (!IDS_OPERATORS.has(ch) && ch !== char) {
        components.push(ch);
      }
    }

    if (components.length > 0) {
      idsMap.set(char, components);
    }
  }

  return idsMap;
}

/**
 * Look up a single character in CEDICT, using an optional pinyin hint to disambiguate.
 * Priority: exact pinyin match > toneless match > first filtered entry > first entry.
 */
function lookupChar(char: string, pinyinHint?: string): CharacterInfo {
  const entries = loadCedict().get(char) || [];
  const filtered = filterEntries(entries);
  let matched = filtered.length > 0 ? filtered : entries;

  if (pinyinHint && filtered.length > 1) {
    const exact = filtered.filter((e) => e.pinyin === pinyinHint);
    if (exact.length > 0) {
      matched = exact;
    } else {
      const toneless = stripTones(pinyinHint);
      const approx = filtered.filter((e) => stripTones(e.pinyin) === toneless);
      if (approx.length > 0) {
        matched = approx;
      }
    }
  }

  const entry = matched[0];
  if (!entry) {
    return { hanzi: char, pinyin: '', meaning: '', components: [] };
  }
  return {
    hanzi: char,
    pinyin: entry.pinyin,
    meaning: filterDefinitions(entry.definitions).join(' / '),
    components: [],
  };
}

/**
 * Recursively decompose a character into IDS sub-components.
 */
function decomposeChar(char: string, pinyinHint?: string): CharacterInfo {
  const breakdown = lookupChar(char, pinyinHint);
  const idsComponents = loadIds().get(char);
  if (idsComponents) {
    breakdown.components = idsComponents.map((comp) => decomposeChar(comp));
  }
  return breakdown;
}

/**
 * Decompose a word or character into its parts with meanings, recursively.
 * - Multi-char word: splits into individual characters (with pinyin disambiguation),
 *   each recursively decomposed into IDS sub-components
 * - Single character: recursively splits into IDS sub-components
 */
export function decomposeWord(hanzi: string, wordPinyin?: string): CharacterInfo[] {
  const syllables = wordPinyin ? wordPinyin.split(/\s+/) : [];
  return [...hanzi].map((char, i) => decomposeChar(char, syllables[i]));
}
