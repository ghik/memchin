import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { PracticeMode, Progress, Word } from '../shared/types.js';
import { MAX_BUCKET } from './services/srs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../../data/memchin.db');
const dataDir = path.dirname(dbPath);

let db: SqlJsDatabase;

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs();

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Initialize schema
  // @formatter:off
  db.run(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY,
      hanzi TEXT NOT NULL,
      pinyin TEXT NOT NULL,
      pinyin_numbered TEXT NOT NULL,
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
      word_id INTEGER NOT NULL,
      mode TEXT NOT NULL,
      bucket INTEGER NOT NULL DEFAULT 0,
      last_practiced TEXT,
      next_eligible TEXT,
      FOREIGN KEY (word_id) REFERENCES words(id),
      UNIQUE(word_id, mode)
    );
  `);
  // @formatter:on

  db.run(`CREATE INDEX IF NOT EXISTS idx_progress_mode_eligible ON progress(mode, next_eligible);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_words_rank ON words(rank);`);

  saveDb();
}

export function getDb() {
  return db;
}

export function saveDb(): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Word operations
export function getAllWords(): Map<number, Word> {
  if (allWords !== null) {
    return allWords;
  }

  const stmt = db.prepare('SELECT * FROM words ORDER BY id');
  allWords = new Map<number, Word>();
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const word = rowToWord(row);
    allWords.set(word.id, word);
  }
  stmt.free();
  return allWords;
}

export function getWordById(id: number): Word {
  return getAllWords().get(id)!;
}

let allWords: Map<number, Word> | null = null;
let ambiguousTranslations: Set<string> | null = null;

function normalizedTranslations(englishTranslations: string[]): string {
  return englishTranslations.join('|').toLowerCase().trim();
}

function loadAmbiguousTranslations(): void {
  const foundTranslations = new Set<string>();
  ambiguousTranslations = new Set<string>();

  for (const word of getAllWords().values()) {
    const translations = normalizedTranslations(word.english);
    if (foundTranslations.has(translations)) {
      ambiguousTranslations.add(translations);
    } else {
      foundTranslations.add(translations);
    }
  }
}

export function isAmbiguousTranslation(englishTranslations: string[]): boolean {
  if (!ambiguousTranslations) {
    loadAmbiguousTranslations();
  }
  return ambiguousTranslations!.has(normalizedTranslations(englishTranslations));
}

export function insertWords(words: Omit<Word, 'id' | 'breakdown'>[]): void {
  for (const word of words) {
    db.run(
      `
          INSERT INTO words (hanzi, pinyin, english, hsk_level, examples, translatable, rank)
          VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        word.hanzi,
        word.pinyin,
        JSON.stringify(word.english),
        word.hskLevel,
        JSON.stringify(word.examples),
        word.translatable ? 1 : 0,
        word.frequencyRank,
      ]
    );
  }
  saveDb();
}

export function getWordCount(): number {
  const result = db.exec('SELECT COUNT(*) as count FROM words');
  return (result[0]?.values[0]?.[0] as number) ?? 0;
}

// Progress operations
export function getProgress(wordId: number, mode: PracticeMode): Progress | null {
  const stmt = db.prepare('SELECT * FROM progress WHERE word_id = ? AND mode = ?');
  stmt.bind([wordId, mode]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return rowToProgress(row);
  }
  stmt.free();
  return null;
}

export function upsertProgress(
  wordId: number,
  mode: PracticeMode,
  bucket: number,
  nextEligible: string
): void {
  const now = new Date().toISOString();
  db.run(
    `
        INSERT INTO progress (word_id, mode, bucket, last_practiced, next_eligible)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(word_id, mode) DO
        UPDATE SET
            bucket = excluded.bucket,
            last_practiced = excluded.last_practiced,
            next_eligible = excluded.next_eligible
    `,
    [wordId, mode, bucket, now, nextEligible]
  );
}

export function getWordsForPractice(mode: PracticeMode, count: number): Word[] {
  const now = new Date().toISOString();
  const translatableFilter = mode === 'english' ? 'AND w.translatable = 1' : '';

  // First get words that are due for review
  const dueStmt = db.prepare(`
      SELECT w.*
      FROM words w
               JOIN progress p ON w.id = p.word_id
      WHERE p.mode = ?
        AND p.next_eligible <= ? ${translatableFilter}
      ORDER BY p.next_eligible ASC
          LIMIT ?
  `);
  dueStmt.bind([mode, now, count]);

  const result: Word[] = [];
  while (dueStmt.step()) {
    result.push(rowToWord(dueStmt.getAsObject()));
  }
  dueStmt.free();

  if (result.length < count) {
    // Get new words (no progress record for this mode)
    const existingIds = result.map((w) => w.id);
    const placeholders = existingIds.length > 0 ? `AND w.id NOT IN (${existingIds.join(',')})` : '';

    const newStmt = db.prepare(`
        SELECT w.*
        FROM words w
                 LEFT JOIN progress p ON w.id = p.word_id AND p.mode = ?
        WHERE p.id IS NULL ${placeholders} ${translatableFilter}
        ORDER BY w.rank ASC
            LIMIT ?
    `);
    newStmt.bind([mode, count - result.length]);

    while (newStmt.step()) {
      result.push(rowToWord(newStmt.getAsObject()));
    }
    newStmt.free();
  }

  return result;
}

export function getStats(mode: PracticeMode): {
  totalWords: number;
  learned: number;
  mastered: number;
  dueForReview: number;
  buckets: number[];
} {
  const now = new Date().toISOString();
  const totalWords = getWordCount();

  const learnedResult = db.exec(`SELECT COUNT(*)
                                 FROM progress
                                 WHERE mode = '${mode}'`);
  const learned = (learnedResult[0]?.values[0]?.[0] as number) ?? 0;

  const masteredResult = db.exec(`SELECT COUNT(*)
                                  FROM progress
                                  WHERE mode = '${mode}'
                                    AND bucket >= ${MAX_BUCKET}`);
  const mastered = (masteredResult[0]?.values[0]?.[0] as number) ?? 0;

  const dueResult = db.exec(`SELECT COUNT(*)
                             FROM progress
                             WHERE mode = '${mode}'
                               AND next_eligible <= '${now}'`);
  const dueForReview = (dueResult[0]?.values[0]?.[0] as number) ?? 0;

  const buckets = new Array(MAX_BUCKET + 1).fill(0);
  const bucketResult = db.exec(`SELECT bucket, COUNT(*) FROM progress WHERE mode = '${mode}' GROUP BY bucket`);
  for (const [bucket, count] of bucketResult[0]?.values ?? []) {
    buckets[bucket as number] = count as number;
  }

  return { totalWords, learned, mastered, dueForReview, buckets };
}

function rowToWord(row: any): Word {
  return {
    id: row.id,
    hanzi: row.hanzi,
    pinyin: row.pinyin,
    english: JSON.parse(row.english),
    hskLevel: row.hsk_level,
    frequencyRank: row.rank ?? 999999,
    examples: JSON.parse(row.examples || '[]'),
    translatable: Boolean(row.translatable),
  };
}

function rowToProgress(row: any): Progress {
  return {
    id: row.id,
    wordId: row.word_id,
    mode: row.mode as PracticeMode,
    bucket: row.bucket,
    lastPracticed: row.last_practiced,
    nextEligible: row.next_eligible,
  };
}
