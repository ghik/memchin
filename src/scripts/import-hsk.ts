import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllWords, getDb, initDb, insertWords, saveDb, WordToInsert } from '../server/db.js';
import { generateSpeech } from '../server/services/tts.js';
import type { Example } from '../shared/types.js';
import { generateExamples } from './generate-examples.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wordsPath = path.join(__dirname, '../../hsk_words.json');
const audioDir = path.join(__dirname, '../../data/audio');

// Check if all translations are enclosed in brackets (e.g. "[particle]")
function hasTranslatableMeaning(english: string[]): boolean {
  return !english.every((e) => /^\[.*\]$/.test(e.trim()));
}

function audioExists(hanzi: string): boolean {
  return fs.existsSync(path.join(audioDir, `${hanzi}.mp3`));
}

interface WordEntry {
  hanzi: string;
  pinyin: string;
  english: string[];
  categories: string[];
  hskLevel?: number;
  frequencyRank: number;
}

async function importWords(start?: number, end?: number): Promise<void> {
  // Initialize database and schema
  await initDb();
  const db = getDb();

  // @formatter:off
  db.run(`
    CREATE TABLE IF NOT EXISTS words (
      hanzi TEXT PRIMARY KEY,
      pinyin TEXT NOT NULL,
      english TEXT NOT NULL,
      hsk_level INTEGER NOT NULL,
      examples TEXT NOT NULL DEFAULT '[]',
      translatable INTEGER NOT NULL DEFAULT 1,
      rank INTEGER
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hanzi TEXT NOT NULL,
      mode TEXT NOT NULL,
      bucket INTEGER NOT NULL DEFAULT 0,
      last_practiced TEXT,
      next_eligible TEXT,
      FOREIGN KEY (hanzi) REFERENCES words(hanzi),
      UNIQUE(hanzi, mode)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS word_labels (
      hanzi TEXT NOT NULL,
      label TEXT NOT NULL,
      FOREIGN KEY (hanzi) REFERENCES words(hanzi),
      UNIQUE(hanzi, label)
    );
  `);
  // @formatter:on

  db.run(`CREATE INDEX IF NOT EXISTS idx_progress_mode_eligible ON progress(mode, next_eligible);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_words_rank ON words(rank);`);

  saveDb();

  // Get existing words to reuse examples
  const existingWords = getAllWords();
  console.log(`Found ${existingWords.size} existing words in database`);

  // Load all words from JSON
  let entries: WordEntry[] = JSON.parse(fs.readFileSync(wordsPath, 'utf-8'));

  // Sort all words by frequency
  entries.sort((a, b) => a.frequencyRank - b.frequencyRank);

  console.log(`Total words in JSON: ${entries.length}`);

  // Apply start/end filtering if specified (1-indexed)
  const wordOffset = (start ?? 1) - 1;
  if (start !== undefined || end !== undefined) {
    const endIdx = end ?? entries.length;
    entries = entries.slice(wordOffset, endIdx);
    console.log(`Importing words ${wordOffset + 1}-${wordOffset + entries.length} only`);
  }

  if (entries.length === 0) {
    console.log('No words to import.');
    return;
  }

  console.log(`Words to import: ${entries.length}`);

  // Generate examples and save in batches of 25
  const batchSize = 25;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const batchStart = wordOffset + i + 1;
    const batchEnd = wordOffset + Math.min(i + batchSize, entries.length);

    // Split batch into words that need examples vs those that already have them
    const needExamples: WordEntry[] = [];
    const haveExamples = new Map<string, Example[]>();

    for (const entry of batch) {
      const existing = existingWords.get(entry.hanzi);
      if (existing && existing.examples && existing.examples.length > 0) {
        haveExamples.set(entry.hanzi, existing.examples);
      } else {
        needExamples.push(entry);
      }
    }

    console.log(
      `Processing words ${batchStart}-${batchEnd}: ${haveExamples.size} have examples, ${needExamples.length} need generation`
    );

    // Generate examples only for words that need them
    let generatedExamples = new Map<string, Example[]>();
    if (needExamples.length > 0) {
      try {
        const wordsWithLevel = needExamples.map((w) => ({ ...w, hskLevel: w.hskLevel ?? 0 }));
        generatedExamples = await generateExamples(wordsWithLevel);
      } catch (error) {
        console.error(`Failed to generate examples for batch:`, error);
      }
    }

    // Merge existing and generated examples
    const allExamples = new Map([...haveExamples, ...generatedExamples]);

    // Save batch to database
    const words: WordToInsert[] = batch.map((raw) => {
      const wordExamples = allExamples.get(raw.hanzi) || [];
      return {
        hanzi: raw.hanzi,
        pinyin: raw.pinyin,
        english: raw.english,
        hskLevel: raw.hskLevel ?? 0,
        frequencyRank: raw.frequencyRank,
        examples: wordExamples,
        translatable: hasTranslatableMeaning(raw.english),
      };
    });

    insertWords(words);
    console.log(`Saved ${words.length} words to database`);

    // Generate audio only for words that don't have it
    for (const word of words.filter((w) => !audioExists(w.hanzi))) {
      try {
        await generateSpeech(
          word.hanzi,
          word.examples.map((ex) => ex.hanzi)
        );
      } catch (error) {
        console.error(`Failed to generate audio for "${word.hanzi}":`, error);
      }
    }
  }

  console.log(`\nImport complete: ${entries.length} words`);
}

// Parse command line arguments
// Usage: npm run import-hsk [--start=N] [--end=N]
// Examples:
//   npm run import-hsk                         - imports all words
//   npm run import-hsk -- --start=1 --end=100  - imports words 1-100 by frequency
function parseArgs(args: string[]): {
  start?: number;
  end?: number;
} {
  let start: number | undefined;
  let end: number | undefined;

  for (const arg of args) {
    if (arg.startsWith('--start=')) {
      start = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--end=')) {
      end = parseInt(arg.split('=')[1]);
    }
  }

  return { start, end };
}

const { start, end } = parseArgs(process.argv.slice(2));
importWords(start, end).catch(console.error);
