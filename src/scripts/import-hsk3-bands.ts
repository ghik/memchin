import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getWordByHanzi,
  initDb,
  insertWords,
  invalidateWordCache,
  saveDb,
  updateWord,
  WordToInsert,
} from '../server/db.js';
import { loadWordFrequencyData } from '../server/services/hanzi-freq.js';
import { normalizePinyinInput } from '../shared/pinyin.js';
import type { Example } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcesDir = path.join(__dirname, '../../sources');

interface BandEntry {
  hanzi: string;
  pinyin: string;
  english: string[];
}

// Minimal CSV line parser that respects double-quoted fields.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseBandFile(filePath: string): BandEntry[] {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const entries: BandEntry[] = [];

  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (cols.length < 4) {
      continue;
    }
    if (cols[0].trim().toLowerCase() === 'number') {
      continue; // header row
    }
    // Some entries list alternative forms separated by "｜" — take the canonical (first) one.
    const hanzi = cols[1].split('｜')[0].trim();
    const pinyinRaw = cols[2].split('｜')[0].trim();
    if (!hanzi || !pinyinRaw) {
      continue;
    }
    const englishParts = cols[3]
      .split(/[;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (englishParts.length === 0) {
      continue;
    }
    let pinyin: string;
    try {
      pinyin = normalizePinyinInput(pinyinRaw);
    } catch {
      pinyin = pinyinRaw;
    }
    entries.push({ hanzi, pinyin, english: englishParts });
  }

  return entries;
}

async function importBand(filePath: string, category: string): Promise<void> {
  const entries = parseBandFile(filePath);
  console.log(`\n${category}: ${entries.length} entries from ${path.basename(filePath)}`);

  const freq = loadWordFrequencyData();

  let added = 0;
  let tagged = 0;
  let alreadyTagged = 0;
  const newWords: WordToInsert[] = [];

  for (const entry of entries) {
    const existing = getWordByHanzi(entry.hanzi);
    if (existing) {
      const cats = new Set(existing.categories ?? []);
      if (cats.has(category)) {
        alreadyTagged++;
        continue;
      }
      cats.add(category);
      updateWord(entry.hanzi, {
        pinyin: existing.pinyin,
        english: existing.english,
        polish: existing.polish ?? [],
        categories: [...cats],
      });
      tagged++;
      continue;
    }
    const wordFrequencyRank = freq.get(entry.hanzi);
    const isSingleChar = [...entry.hanzi].length === 1;
    newWords.push({
      hanzi: entry.hanzi,
      pinyin: entry.pinyin,
      english: entry.english,
      hskLevel: 0,
      wordFrequencyRank,
      hanziFrequencyRank: isSingleChar ? wordFrequencyRank : undefined,
      examples: [] as Example[],
      translatable: true,
      categories: [category],
      manual: false,
    });
    added++;
  }

  if (newWords.length > 0) {
    insertWords(newWords);
    invalidateWordCache();
  }
  saveDb();

  console.log(`  ${tagged} existing words tagged, ${alreadyTagged} already had the tag, ${added} new words inserted`);
  if (added > 0) {
    console.log(`  (new words have no examples or audio yet — use the regenerate buttons in edit UI as needed)`);
  }
}

async function main(): Promise<void> {
  await initDb();

  const targets: { file: string; category: string }[] = [
    { file: path.join(sourcesDir, 'hsk3-band1.txt'), category: 'hsk3-band1' },
    { file: path.join(sourcesDir, 'hsk3-band2.csv'), category: 'hsk3-band2' },
  ];

  for (const t of targets) {
    if (!fs.existsSync(t.file)) {
      console.warn(`Skipping ${t.category}: file not found at ${t.file}`);
      continue;
    }
    await importBand(t.file, t.category);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
