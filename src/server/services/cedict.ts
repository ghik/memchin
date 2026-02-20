import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { CedictEntry } from '../../shared/types.js';
import { numberedToToneMarked } from './pinyin.js';

export type { CedictEntry } from '../../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cedictPath = path.join(__dirname, '../../../sources/cedict_1_0_ts_utf-8_mdbg.txt');

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
    const definitions = defStr
      .split('/')
      .flatMap((d) => d.split(';'))
      .map((d) => d.trim())
      .filter((d) => d !== '');
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
 * Look up a word in CEDICT, filtering out non-translation entries and definitions.
 * Returns entries with only useful definitions (actual meanings, not cross-references).
 */
export function lookupFiltered(hanzi: string): CedictEntry[] {
  const map = loadCedict();
  const entries = map.get(hanzi) || [];
  const filtered = filterEntries(entries);
  return filtered.map((entry) => ({
    ...entry,
    definitions: filterDefinitions(entry.definitions),
  }));
}

/**
 * Check if a definition is a cross-reference, variant note, or other non-translation.
 * These are metadata about the character rather than actual meanings.
 */
function isNonTranslation(definition: string): boolean {
  return (
    /^surname\s/i.test(definition) ||
    /^(old\s+)?variant\s+of\s/i.test(definition) ||
    /^see\s+(also\s+)?[^\s]/i.test(definition) ||
    /^erhua variant\s+of\s/i.test(definition) ||
    /^also written\s/i.test(definition) ||
    /^(Japanese|Korean) variant\s+of\s/i.test(definition) ||
    /^(also|formerly)\s+written\s/i.test(definition) ||
    /^same as\s/i.test(definition) ||
    /^(old|ancient)\s+name\s+for\s/i.test(definition) ||
    /^another name for\s/i.test(definition) ||
    /^used in\s/i.test(definition) ||
    /^(abbr|short)\.\s+for\s/i.test(definition) ||
    /^abbreviation\s+(of|for)\s/i.test(definition) ||
    /^CL:/i.test(definition) ||
    /^Taiwan pr\.\s/i.test(definition) ||
    /^also pr\.\s/i.test(definition)
  );
}

/**
 * Filter out entries where ALL definitions are non-translations.
 */
export function filterEntries(entries: CedictEntry[]): CedictEntry[] {
  return entries.filter((entry) => entry.definitions.some((def) => !isNonTranslation(def)));
}

/**
 * Shorten verbose definitions (e.g. radical descriptions with Kangxi references).
 */
function shortenDefinition(def: string): string {
  // "ice" radical in Chinese characters (Kangxi radical 15), occurring in ... → "ice" radical
  // radical in Chinese characters (Kangxi radical 2) → radical
  return def.replace(/(\bradical)\b.*$/i, '$1');
}

/**
 * Filter individual definitions within an entry, removing non-translations.
 * Returns the filtered definitions, or the originals if all would be removed.
 */
export function filterDefinitions(definitions: string[]): string[] {
  const useful = definitions.filter((d) => !isNonTranslation(d));
  const defs = useful.length > 0 ? useful : definitions;
  return defs.map(shortenDefinition);
}

