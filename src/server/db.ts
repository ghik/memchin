import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Word, Progress, PracticeMode } from '../shared/types.js';

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

  // Initialize schema - frequency_rank is used as the primary key
  db.run(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY,
      hanzi TEXT NOT NULL,
      pinyin TEXT NOT NULL,
      pinyin_numbered TEXT NOT NULL,
      english TEXT NOT NULL,
      hsk_level INTEGER NOT NULL,
      examples TEXT NOT NULL DEFAULT '[]'
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

  db.run(`CREATE INDEX IF NOT EXISTS idx_progress_mode_eligible ON progress(mode, next_eligible);`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_words_frequency ON words(id);`);

  saveDb();
}

export function saveDb(): void {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Word operations
export function getAllWords(): Word[] {
  const stmt = db.prepare('SELECT * FROM words ORDER BY id');
  const rows: any[] = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.map(rowToWord);
}

export function getWordById(id: number): Word | null {
  const stmt = db.prepare('SELECT * FROM words WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return rowToWord(row);
  }
  stmt.free();
  return null;
}

export function insertWord(word: Omit<Word, 'id'>): number {
  db.run(`
    INSERT OR REPLACE INTO words (id, hanzi, pinyin, pinyin_numbered, english, hsk_level, examples)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [
    word.frequencyRank,
    word.hanzi,
    word.pinyin,
    word.pinyinNumbered,
    JSON.stringify(word.english),
    word.hskLevel,
    JSON.stringify(word.examples),
  ]);

  saveDb();
  return word.frequencyRank;
}

export function insertWords(words: Omit<Word, 'id'>[]): void {
  for (const word of words) {
    db.run(`
      INSERT OR REPLACE INTO words (id, hanzi, pinyin, pinyin_numbered, english, hsk_level, examples)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      word.frequencyRank,
      word.hanzi,
      word.pinyin,
      word.pinyinNumbered,
      JSON.stringify(word.english),
      word.hskLevel,
      JSON.stringify(word.examples),
    ]);
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

export function upsertProgress(wordId: number, mode: PracticeMode, bucket: number, nextEligible: string): void {
  const now = new Date().toISOString();

  // Check if exists
  const existing = getProgress(wordId, mode);
  if (existing) {
    db.run(`
      UPDATE progress SET bucket = ?, last_practiced = ?, next_eligible = ?
      WHERE word_id = ? AND mode = ?
    `, [bucket, now, nextEligible, wordId, mode]);
  } else {
    db.run(`
      INSERT INTO progress (word_id, mode, bucket, last_practiced, next_eligible)
      VALUES (?, ?, ?, ?, ?)
    `, [wordId, mode, bucket, now, nextEligible]);
  }
  saveDb();
}

export function getWordsForPractice(mode: PracticeMode, count: number): Word[] {
  const now = new Date().toISOString();

  // First get words that are due for review
  const dueStmt = db.prepare(`
    SELECT w.* FROM words w
    JOIN progress p ON w.id = p.word_id
    WHERE p.mode = ? AND p.next_eligible <= ?
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
    const existingIds = result.map(w => w.id);
    const placeholders = existingIds.length > 0
      ? `AND w.id NOT IN (${existingIds.join(',')})`
      : '';

    const newStmt = db.prepare(`
      SELECT w.* FROM words w
      LEFT JOIN progress p ON w.id = p.word_id AND p.mode = ?
      WHERE p.id IS NULL ${placeholders}
      ORDER BY w.id ASC
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

export function getStats(mode: PracticeMode): { totalWords: number; learned: number; mastered: number; dueForReview: number } {
  const now = new Date().toISOString();
  const totalWords = getWordCount();

  const learnedResult = db.exec(`SELECT COUNT(*) FROM progress WHERE mode = '${mode}'`);
  const learned = (learnedResult[0]?.values[0]?.[0] as number) ?? 0;

  const masteredResult = db.exec(`SELECT COUNT(*) FROM progress WHERE mode = '${mode}' AND bucket >= 7`);
  const mastered = (masteredResult[0]?.values[0]?.[0] as number) ?? 0;

  const dueResult = db.exec(`SELECT COUNT(*) FROM progress WHERE mode = '${mode}' AND next_eligible <= '${now}'`);
  const dueForReview = (dueResult[0]?.values[0]?.[0] as number) ?? 0;

  return { totalWords, learned, mastered, dueForReview };
}

function rowToWord(row: any): Word {
  return {
    id: row.id,
    hanzi: row.hanzi,
    pinyin: row.pinyin,
    pinyinNumbered: row.pinyin_numbered,
    english: JSON.parse(row.english),
    hskLevel: row.hsk_level,
    frequencyRank: row.id, // id is the frequency rank
    examples: JSON.parse(row.examples || '[]'),
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

export function getDb(): SqlJsDatabase {
  return db;
}
