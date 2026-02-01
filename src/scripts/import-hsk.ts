import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, insertWords } from '../server/db.js';
import { splitPinyin } from '../server/services/pinyin.js';
import { generateSpeech } from '../server/services/tts.js';
import type { Example } from '../shared/types.js';
import { generateExamples } from './generate-examples.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFrequencyData(): Map<string, number> {
  const freqPath = path.join(__dirname, '../../internet-zh.num.txt');
  const hanziToRank = new Map<string, number>();

  if (fs.existsSync(freqPath)) {
    const data = fs.readFileSync(freqPath, 'utf-8');
    for (const line of data.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const rank = parseInt(parts[0]);
        const hanzi = parts[2];
        hanziToRank.set(hanzi, rank);
      }
    }
  }

  return hanziToRank;
}

const frequencyData = loadFrequencyData();

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

interface RawWord {
  hanzi: string;
  pinyin: string;
  english: string[];
}

interface WordToInsert {
  hanzi: string;
  pinyin: string;
  english: string[];
  hskLevel: number;
  frequencyRank: number;
  examples: Example[];
  translatable: boolean;
}

// Check if all translations are enclosed in parentheses (e.g. "(particle)")
function hasTranslatableMeaning(english: string[]): boolean {
  return !english.every((e) => /^\(.*\)$/.test(e.trim()));
}

// Clean up word variants: take longest prefix of letters, numbers, and spaces
function cleanVariant(text: string): string {
  const match = text.match(/^[\p{L}\p{N}\s]+/u);
  return match ? match[0].trim() : text;
}

async function fetchHskLevel(level: number): Promise<RawWord[]> {
  const url = `https://mandarinbean.com/new-hsk-${level}-word-list/`;
  console.log(`Fetching HSK ${level} from ${url}...`);

  const response = await fetch(url);
  const html = await response.text();

  return parseWordTable(html);
}

function parseWordTable(html: string): RawWord[] {
  const words: RawWord[] = [];

  // Match table rows with 4 columns: number, hanzi, pinyin, english
  const rowRegex =
    /<tr[^>]*>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<\/tr>/gi;

  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const [, num, col2, col3, col4] = match;

    // Skip header rows (check if first column is not a number)
    if (!/^\d+$/.test(num.trim())) {
      continue;
    }

    // Clean up the extracted text and decode HTML entities
    const hanzi = decodeHtmlEntities(col2.trim());
    const pinyin = decodeHtmlEntities(col3.trim());
    const englishText = decodeHtmlEntities(col4.trim());

    // Skip if hanzi doesn't look like Chinese characters
    if (!/[\u4e00-\u9fff]/.test(hanzi)) {
      continue;
    }

    // Parse English translations (split by semicolon)
    const english = englishText
      .split(/[;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (english.length === 0) {
      continue;
    }

    words.push({ hanzi, pinyin, english });
  }

  return words;
}

async function importLevels(
  levels: number[],
  start?: number,
  end?: number,
  skipAudio?: boolean
): Promise<void> {
  // Initialize database first
  await initDb();

  // Collect all words from all levels first
  let allCleanedWords: { hanzi: string; pinyin: string; english: string[]; hskLevel: number }[] =
    [];

  for (const level of levels) {
    try {
      const rawWords = await fetchHskLevel(level);
      console.log(`Found ${rawWords.length} words for HSK ${level}`);

      const cleanedWords = rawWords.map((raw) => ({
        hanzi: cleanVariant(raw.hanzi),
        pinyin: splitPinyin(cleanVariant(raw.pinyin)).toLowerCase(),
        english: raw.english,
        hskLevel: level,
      }));

      allCleanedWords.push(...cleanedWords);
    } catch (error) {
      console.error(`Failed to fetch HSK ${level}:`, error);
    }
  }

  // Sort all words by frequency
  allCleanedWords.sort((a, b) => {
    const rankA = frequencyData.get(a.hanzi) ?? Infinity;
    const rankB = frequencyData.get(b.hanzi) ?? Infinity;
    return rankA - rankB;
  });

  console.log(`Total words fetched: ${allCleanedWords.length}`);

  // Apply start/end filtering if specified (1-indexed)
  const wordOffset = (start ?? 1) - 1;
  if (start !== undefined || end !== undefined) {
    const endIdx = end ?? allCleanedWords.length;
    allCleanedWords = allCleanedWords.slice(wordOffset, endIdx);
    console.log(`Importing words ${wordOffset + 1}-${wordOffset + allCleanedWords.length} only`);
  }

  console.log(`Words to import: ${allCleanedWords.length}`);

  // Generate examples and save in batches of 25
  const batchSize = 25;

  for (let i = 0; i < allCleanedWords.length; i += batchSize) {
    const batch = allCleanedWords.slice(i, i + batchSize);
    const batchStart = wordOffset + i + 1;
    const batchEnd = wordOffset + Math.min(i + batchSize, allCleanedWords.length);
    console.log(`Generating examples for words ${batchStart}-${batchEnd}...`);

    let examples = new Map<string, Example[]>();
    try {
      examples = await generateExamples(batch);
    } catch (error) {
      console.error(`Failed to generate examples for batch:`, error);
    }

    // Save batch to database immediately
    const words: WordToInsert[] = batch.map((raw) => {
      const wordExamples = examples.get(raw.hanzi) || [];
      return {
        hanzi: raw.hanzi,
        pinyin: raw.pinyin,
        english: raw.english,
        hskLevel: raw.hskLevel,
        frequencyRank: frequencyData.get(raw.hanzi) ?? 999999,
        examples: wordExamples,
        translatable: hasTranslatableMeaning(raw.english),
      };
    });

    insertWords(words);
    console.log(`Saved ${words.length} words to database`);

    // Generate audio for each word
    if (!skipAudio) {
      console.log(`Generating audio...`);
      for (const word of words) {
        try {
          await generateSpeech(word.hanzi, word.examples.map((ex) => ex.hanzi));
        } catch (error) {
          console.error(`Failed to generate audio for "${word.hanzi}":`, error);
        }
      }
      console.log(`Generated audio for ${words.length} words`);
    }
  }

  console.log(`\nImport complete: ${allCleanedWords.length} words`);
}

// Parse command line arguments
// Usage: npm run import-hsk [--start=N] [--end=N] [--skip-audio] [levels]
// Examples:
//   npm run import-hsk                  - imports HSK 1 with 3 example sentences per word
//   npm run import-hsk -- 2 3           - imports HSK 2 and 3
//   npm run import-hsk -- --start=451 --end=475 1-6  - imports only words 451-475
//   npm run import-hsk -- --skip-audio 1  - imports without generating audio
function parseArgs(args: string[]): {
  levels: number[];
  start?: number;
  end?: number;
  skipAudio: boolean;
} {
  let start: number | undefined;
  let end: number | undefined;
  let skipAudio = false;
  const levelArgs: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('--start=')) {
      start = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--end=')) {
      end = parseInt(arg.split('=')[1]);
    } else if (arg === '--skip-audio') {
      skipAudio = true;
    } else {
      levelArgs.push(arg);
    }
  }

  const levels = parseLevels(levelArgs);
  return { levels, start, end, skipAudio };
}

function parseLevels(args: string[]): number[] {
  if (args.length === 0) {
    return [1]; // Default to HSK 1 only
  }

  const levels: number[] = [];
  for (const arg of args) {
    if (arg.includes('-') && !arg.startsWith('-')) {
      // Range like "1-6"
      const [start, end] = arg.split('-').map(Number);
      for (let i = start; i <= end; i++) {
        if (i >= 1 && i <= 6) levels.push(i);
      }
    } else if (!arg.startsWith('-')) {
      const level = Number(arg);
      if (level >= 1 && level <= 6) levels.push(level);
    }
  }
  return [...new Set(levels)].sort((a, b) => a - b);
}

const { levels, start, end, skipAudio } = parseArgs(process.argv.slice(2));
console.log(
  `Importing HSK levels: ${levels.join(', ')} with 3 graduated examples per word${skipAudio ? ' (skipping audio)' : ''}`
);
importLevels(levels, start, end, skipAudio).catch(console.error);
