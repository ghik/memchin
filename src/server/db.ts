import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ContainingWord, Example, PracticeMode, Progress, Word } from '../shared/types.js';
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

  // Migration: add manual column if missing
  try {
    db.run(`ALTER TABLE words ADD COLUMN manual INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists
  }

  // Migration: add character_mode_only column to progress
  try {
    db.run(`ALTER TABLE progress ADD COLUMN character_mode_only INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists
  }

  // Migration: convert ISO timestamps (2024-01-15T10:30:00.000Z) to SQLite format (2024-01-15 10:30:00)
  db.run(
    `UPDATE progress SET last_practiced = REPLACE(SUBSTR(last_practiced, 1, 19), 'T', ' ') WHERE last_practiced LIKE '%T%'`
  );
  db.run(
    `UPDATE progress SET next_eligible = REPLACE(SUBSTR(next_eligible, 1, 19), 'T', ' ') WHERE next_eligible LIKE '%T%'`
  );

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
export function getAllWords(): Map<string, Word> {
  if (allWords !== null) {
    return allWords;
  }

  const stmt = db.prepare('SELECT * FROM words ORDER BY rank ASC');
  allWords = new Map<string, Word>();
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const word = rowToWord(row);
    allWords.set(word.hanzi, word);
  }
  stmt.free();
  return allWords;
}

export function getWordByHanzi(hanzi: string): Word | undefined {
  return getAllWords().get(hanzi);
}

export function invalidateWordCache(): void {
  allWords = null;
  ambiguousTranslations = null;
}

let allWords: Map<string, Word> | null = null;
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

export interface WordToInsert {
  hanzi: string;
  pinyin: string;
  english: string[];
  hskLevel: number;
  wordFrequencyRank?: number;
  hanziFrequencyRank?: number;
  examples: Example[];
  translatable: boolean;
  categories: string[];
  manual: boolean;
}

export function insertWords(words: WordToInsert[]): void {
  for (const word of words) {
    db.run(
      `
          INSERT INTO words (hanzi, pinyin, english, hsk_level, examples, translatable, rank, hanzi_rank, categories, manual)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(hanzi) DO UPDATE SET
            pinyin = excluded.pinyin,
            english = excluded.english,
            hsk_level = excluded.hsk_level,
            examples = excluded.examples,
            translatable = excluded.translatable,
            rank = excluded.rank,
            hanzi_rank = excluded.hanzi_rank,
            categories = excluded.categories,
            manual = excluded.manual
      `,
      [
        word.hanzi,
        word.pinyin,
        JSON.stringify(word.english),
        word.hskLevel,
        JSON.stringify(word.examples),
        word.translatable ? 1 : 0,
        word.wordFrequencyRank ?? null,
        word.hanziFrequencyRank ?? null,
        JSON.stringify(word.categories),
        word.manual ? 1 : 0,
      ]
    );
  }
  saveDb();
}

export function updateWord(
  hanzi: string,
  pinyin: string,
  english: string[],
  categories: string[]
): void {
  db.run('UPDATE words SET pinyin = ?, english = ?, categories = ? WHERE hanzi = ?', [
    pinyin,
    JSON.stringify(english),
    JSON.stringify(categories),
    hanzi,
  ]);
  saveDb();
  allWords = null;
  ambiguousTranslations = null;
}

export function updateWordExamples(hanzi: string, examples: any[]): void {
  db.run('UPDATE words SET examples = ? WHERE hanzi = ?', [JSON.stringify(examples), hanzi]);
  // Invalidate cache so subsequent reads see the update
  allWords = null;
}

export function getWordCount(): number {
  return queryCount('SELECT COUNT(*) as cnt FROM words', []);
}

// Progress operations
export function getProgress(hanzi: string, mode: PracticeMode): Progress | null {
  const stmt = db.prepare('SELECT * FROM progress WHERE hanzi = ? AND mode = ?');
  stmt.bind([hanzi, mode]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return rowToProgress(row);
  }
  stmt.free();
  return null;
}

export function upsertProgress(
  hanzi: string,
  mode: PracticeMode,
  bucket: number,
  nextEligible: string,
  characterMode: boolean
): void {
  const now = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');
  // character_mode_only tracks "learned in character mode only":
  // - normal practice: always clears the flag (0)
  // - character mode practice: sets flag on insert, preserves existing value on update
  //   (so if already learned normally, stays 0)
  const characterModeUpdate = characterMode
    ? 'character_mode_only = progress.character_mode_only' // keep existing value
    : 'character_mode_only = 0'; // clear flag (learned normally)
  db.run(
    `
        INSERT INTO progress (hanzi, mode, bucket, last_practiced, next_eligible, character_mode_only)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(hanzi, mode) DO
        UPDATE SET
            bucket = excluded.bucket,
            last_practiced = excluded.last_practiced,
            next_eligible = excluded.next_eligible,
            ${characterModeUpdate}
    `,
    [hanzi, mode, bucket, now, nextEligible, characterMode ? 1 : 0]
  );
}

export function deleteProgress(hanzi: string): void {
  db.run('DELETE FROM progress WHERE hanzi = ?', [hanzi]);
  saveDb();
}

// Word query helpers

interface WordFilters {
  rankColumn: string; // 'w.rank' or 'w.hanzi_rank', for ORDER BY
  wordFilter: string; // AND clauses on w.* (translatable, category, rank, character mode)
  progressFilter: string; // AND clauses on p.* (excludes character-mode-only in word mode)
  newWordCondition: string; // WHERE condition for LEFT JOIN queries ('p.id IS NULL' or includes char-mode-only)
}

function getWordFilters(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean
): WordFilters {
  const wordParts: string[] = [];

  if (mode === 'hanzi2english' || mode === 'english2hanzi' || mode === 'english2pinyin') {
    wordParts.push('AND w.translatable = 1');
  }

  if (categories.length > 0) {
    wordParts.push(
      `AND EXISTS (SELECT 1 FROM json_each(w.categories) WHERE value IN (${categories.map(() => '?').join(',')}))`
    );
  }

  const rankColumn = characterMode ? 'w.hanzi_rank' : 'w.rank';
  wordParts.push(`AND ${rankColumn} IS NOT NULL`);

  if (characterMode) {
    wordParts.push(
      'AND EXISTS (SELECT 1 FROM words w2 JOIN progress p2 ON w2.hanzi = p2.hanzi WHERE INSTR(w2.hanzi, w.hanzi) > 0)'
    );
  }

  const wordFilter = wordParts.join(' ');
  const progressFilter = characterMode ? '' : 'AND p.character_mode_only = 0';
  const newWordCondition = characterMode
    ? 'p.id IS NULL'
    : '(p.id IS NULL OR p.character_mode_only = 1)';

  return { rankColumn, wordFilter, progressFilter, newWordCondition };
}

function queryCount(sql: string, params: any[]): number {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const count = stmt.step() ? ((stmt.getAsObject() as any).cnt as number) : 0;
  stmt.free();
  return count;
}

function queryRows<T>(sql: string, params: any[], mapRow: (row: any) => T): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const result: T[] = [];
  while (stmt.step()) {
    result.push(mapRow(stmt.getAsObject()));
  }
  stmt.free();
  return result;
}

function logQuery(sql: string, params: any[], resultCount: number): void {
  const compact = sql.replace(/\s+/g, ' ').trim();
  console.log(`[query] ${compact} | params=${JSON.stringify(params)} | rows=${resultCount}`);
}

function queryWords(sql: string, params: any[]): Word[] {
  const result = queryRows(sql, params, rowToWord);
  logQuery(sql, params, result.length);
  return result;
}

function queryReviewWords(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean,
  count: number,
  dueOnly: boolean,
  random: boolean
): Word[] {
  const f = getWordFilters(mode, categories, characterMode);
  const dueFilter = dueOnly ? "AND p.next_eligible <= datetime('now')" : '';
  const orderBy = random ? 'RANDOM()' : 'p.next_eligible ASC';
  return queryWords(
    `
      SELECT w.* FROM words w JOIN progress p ON w.hanzi = p.hanzi
      WHERE p.mode = ? ${dueFilter} ${f.wordFilter} ${f.progressFilter}
      ORDER BY ${orderBy} LIMIT ?
  `,
    [mode, ...categories, count]
  );
}

function queryNewWords(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean,
  count: number
): Word[] {
  const f = getWordFilters(mode, categories, characterMode);
  return queryWords(
    `
      SELECT w.* FROM words w LEFT JOIN progress p ON w.hanzi = p.hanzi AND p.mode = ?
      WHERE ${f.newWordCondition} ${f.wordFilter}
      ORDER BY ${f.rankColumn} ASC LIMIT ?
  `,
    [mode, ...categories, count]
  );
}

export function getWordsForReview(
  mode: PracticeMode,
  count: number,
  categories: string[],
  characterMode: boolean,
  random: boolean
): Word[] {
  return queryReviewWords(mode, categories, characterMode, count, false, random);
}

export function getNewWords(
  mode: PracticeMode,
  count: number,
  categories: string[],
  characterMode: boolean
): Word[] {
  return queryNewWords(mode, categories, characterMode, count);
}

export function getWordsForPractice(
  mode: PracticeMode,
  count: number,
  categories: string[],
  characterMode: boolean
): Word[] {
  const result = queryReviewWords(mode, categories, characterMode, count, true, false);

  if (result.length < count) {
    result.push(...queryNewWords(mode, categories, characterMode, count - result.length));
  }

  return result;
}

export function getStats(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean
): {
  totalWords: number;
  learned: number;
  mastered: number;
  dueForReview: number;
  buckets: number[];
} {
  const f = getWordFilters(mode, categories, characterMode);
  const baseJoin = `FROM words w JOIN progress p ON w.hanzi = p.hanzi WHERE p.mode = ? ${f.wordFilter} ${f.progressFilter}`;
  const baseParams = [mode, ...categories];

  const totalWords = queryCount(
    `SELECT COUNT(*) as cnt FROM words w WHERE 1=1 ${f.wordFilter}`,
    categories
  );
  const learned = queryCount(`SELECT COUNT(*) as cnt ${baseJoin}`, baseParams);
  const mastered = queryCount(
    `SELECT COUNT(*) as cnt ${baseJoin} AND p.bucket >= ${MAX_BUCKET}`,
    baseParams
  );
  const dueForReview = queryCount(
    `SELECT COUNT(*) as cnt ${baseJoin} AND p.next_eligible <= datetime('now')`,
    baseParams
  );

  const buckets = new Array(MAX_BUCKET + 1).fill(0);
  for (const row of queryRows(
    `SELECT p.bucket, COUNT(*) as cnt ${baseJoin} GROUP BY p.bucket`,
    baseParams,
    (r) => r
  )) {
    buckets[row.bucket as number] = row.cnt as number;
  }

  return { totalWords, learned, mastered, dueForReview, buckets };
}

export function getDueCount(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean
): number {
  const f = getWordFilters(mode, categories, characterMode);
  return queryCount(
    `
      SELECT COUNT(*) as cnt FROM words w JOIN progress p ON w.hanzi = p.hanzi
      WHERE p.mode = ? AND p.next_eligible <= datetime('now') ${f.wordFilter} ${f.progressFilter}
  `,
    [mode, ...categories]
  );
}

// Containing words (for character mode)
export function getLearnedWordsContaining(hanzi: string): ContainingWord[] {
  return queryRows(
    `SELECT DISTINCT w.hanzi, w.pinyin, w.english FROM words w
     JOIN progress p ON w.hanzi = p.hanzi
     WHERE INSTR(w.hanzi, ?) > 0 AND length(w.hanzi) > 1
     ORDER BY w.rank ASC`,
    [hanzi],
    (row) => ({ hanzi: row.hanzi, pinyin: row.pinyin, english: JSON.parse(row.english) })
  );
}

// Category operations
export function getAllCategories(): string[] {
  return queryRows(
    'SELECT DISTINCT value FROM words, json_each(words.categories) ORDER BY value',
    [],
    (row) => row.value as string
  );
}

// Pinyin synonym operations
export function addPinyinSynonym(hanzi: string, synonymPinyin: string): void {
  db.run(`INSERT OR IGNORE INTO pinyin_synonyms (hanzi, synonym_pinyin) VALUES (?, ?)`, [
    hanzi,
    synonymPinyin,
  ]);
  saveDb();
}

export function isPinyinSynonym(hanzi: string, pinyin: string): boolean {
  const stmt = db.prepare(`SELECT 1 FROM pinyin_synonyms WHERE hanzi = ? AND synonym_pinyin = ?`);
  stmt.bind([hanzi, pinyin]);
  const found = stmt.step();
  stmt.free();
  return found;
}

function rowToWord(row: any): Word {
  return {
    hanzi: row.hanzi,
    pinyin: (row.pinyin as string).toLowerCase(),
    english: JSON.parse(row.english),
    hskLevel: row.hsk_level,
    wordFrequencyRank: row.rank ?? undefined,
    hanziFrequencyRank: row.hanzi_rank ?? undefined,
    examples: JSON.parse(row.examples || '[]'),
    translatable: Boolean(row.translatable),
    categories: JSON.parse(row.categories || '[]'),
    manual: Boolean(row.manual),
  };
}

function rowToProgress(row: any): Progress {
  return {
    id: row.id,
    hanzi: row.hanzi,
    mode: row.mode as PracticeMode,
    bucket: row.bucket,
    lastPracticed: row.last_practiced,
    nextEligible: row.next_eligible,
  };
}
