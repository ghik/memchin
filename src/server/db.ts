import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import type { ContainingWord, Example, MatchMode, PracticeMode, Progress, Word } from '../shared/types.js';
import { MAX_BUCKET } from './services/srs.js';
import {
  splitPinyin,
  stripTones,
  splitPinyinQuery,
  getSyllableTone,
  pinyinCandidateIndices,
  syllableMatchesToken,
} from '../shared/pinyin.js';
import type { PinyinToken } from '../shared/pinyin.js';

const dbPath = path.join(process.env.HOME!, 'Dropbox/memchin/memchin.db');
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

  // Migration: create hanzi_synonyms table
  db.run(`
    CREATE TABLE IF NOT EXISTS hanzi_synonyms (
      hanzi1 TEXT NOT NULL,
      hanzi2 TEXT NOT NULL,
      UNIQUE(hanzi1, hanzi2)
    );
  `);

  // Indexes for character mode queries
  db.run(`CREATE INDEX IF NOT EXISTS idx_words_hanzi_rank ON words(hanzi_rank)`);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_progress_hanzi_charmode ON progress(hanzi, character_mode_only)`
  );

  // Migration: make progress.bucket nullable (schema had NOT NULL DEFAULT 0)
  const progressInfo = db.exec('PRAGMA table_info(progress)');
  const progressCols: any[] = progressInfo[0]?.values ?? [];
  const bucketCol = progressCols.find((r) => r[1] === 'bucket');
  if (bucketCol?.[3] === 1) { // notnull = 1 means NOT NULL constraint present
    const colNames = progressCols.map((r) => r[1] as string);
    const colDefs = progressCols.map((r) => {
      const [, name, type, notnull, dflt, pk] = r;
      if (pk) {
        return `${name} ${type} PRIMARY KEY AUTOINCREMENT`;
      }
      const notNullClause = (notnull && name !== 'bucket') ? ' NOT NULL' : '';
      const defaultClause = dflt != null ? ` DEFAULT ${dflt}` : '';
      return `${name} ${type}${notNullClause}${defaultClause}`;
    }).join(', ');
    db.run(`CREATE TABLE progress_new (${colDefs}, FOREIGN KEY (hanzi) REFERENCES words(hanzi), UNIQUE(hanzi, mode))`);
    db.run(`INSERT INTO progress_new (${colNames.join(', ')}) SELECT ${colNames.join(', ')} FROM progress`);
    db.run('DROP TABLE progress');
    db.run('ALTER TABLE progress_new RENAME TO progress');
    db.run('CREATE INDEX IF NOT EXISTS idx_progress_mode_eligible ON progress(mode, next_eligible)');
    db.run('CREATE INDEX IF NOT EXISTS idx_progress_hanzi_charmode ON progress(hanzi, character_mode_only)');
  }

  // Migration: rename reset_at → queued_at, char_reset_at → char_queued_at
  // (or add char_queued_at fresh if neither old nor new column exists yet)
  const tableInfo = db.exec('PRAGMA table_info(words)');
  const columns: string[] = tableInfo[0]?.values.map((row: any) => row[1] as string) ?? [];

  if (columns.includes('reset_at')) {
    db.run('ALTER TABLE words RENAME COLUMN reset_at TO queued_at');
  }

  if (columns.includes('char_reset_at')) {
    db.run('ALTER TABLE words RENAME COLUMN char_reset_at TO char_queued_at');
  } else if (!columns.includes('char_queued_at')) {
    db.run('ALTER TABLE words ADD COLUMN char_queued_at TEXT');
  }

  if (!columns.includes('mandarinspot_translation')) {
    db.run('ALTER TABLE words ADD COLUMN mandarinspot_translation TEXT');
  }

  // Clear char_queued_at for any chars that have already been practiced (cleanup for bad migrations)
  db.run(`
    UPDATE words SET char_queued_at = NULL
    WHERE char_queued_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = words.hanzi AND p.bucket IS NOT NULL)
  `);

  // Re-queue words that were learned in at least one mode but had queued_at cleared by the old
  // upsertProgress (which unconditionally cleared queued_at on every practice). Now that queued_at
  // is preserved across modes, restore it so these words appear as "new" in modes not yet practiced.
  db.run(`
    UPDATE words SET queued_at = datetime('now')
    WHERE queued_at IS NULL
    AND EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = words.hanzi AND p.bucket IS NOT NULL)
  `);

  // Also restore char_queued_at for individual characters that belong to practiced multi-char words
  // but haven't been learned in character mode yet.
  db.run(`
    UPDATE words SET char_queued_at = datetime('now')
    WHERE char_queued_at IS NULL
    AND length(hanzi) = 1
    AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = words.hanzi AND p.bucket IS NOT NULL)
    AND EXISTS (
      SELECT 1 FROM words w2
      WHERE length(w2.hanzi) > 1
      AND INSTR(w2.hanzi, words.hanzi) > 0
      AND EXISTS (SELECT 1 FROM progress p2 WHERE p2.hanzi = w2.hanzi AND p2.bucket IS NOT NULL)
    )
  `);

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

export function getWordsWithSameEnglish(hanzi: string, englishTranslations: string[]): Word[] {
  const key = normalizedTranslations(englishTranslations);
  const result: Word[] = [];
  for (const word of getAllWords().values()) {
    if (word.hanzi !== hanzi && normalizedTranslations(word.english) === key) {
      result.push(word);
    }
  }
  return result;
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
export function getMaxBucket(hanzi: string): number | null {
  const stmt = db.prepare('SELECT MAX(bucket) as maxBucket FROM progress WHERE hanzi = ?');
  stmt.bind([hanzi]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row.maxBucket as number | null;
  }
  stmt.free();
  return null;
}

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

export function deleteProgress(hanzi: string, mode?: string): void {
  if (mode) {
    db.run('DELETE FROM progress WHERE hanzi = ? AND mode = ?', [hanzi, mode]);
  } else {
    db.run('DELETE FROM progress WHERE hanzi = ?', [hanzi]);
  }
  saveDb();
}

/**
 * Mark all progress rows for a hanzi as character-mode-only, preserving bucket
 * values. Use this to convert word-mode progress on a single-character "word"
 * into character-only progress without losing mastery level.
 */
export function setAllProgressCharacterOnly(hanzi: string): number {
  db.run(
    'UPDATE progress SET character_mode_only = 1 WHERE hanzi = ? AND character_mode_only = 0',
    [hanzi]
  );
  const changes = db.getRowsModified();
  saveDb();
  return changes;
}

export function resetProgressBucket(hanzi: string, mode: string, toCharacterModeOnly = false): void {
  if (toCharacterModeOnly) {
    db.run(
      'UPDATE progress SET bucket = NULL, next_eligible = NULL, character_mode_only = 1 WHERE hanzi = ? AND mode = ?',
      [hanzi, mode]
    );
  } else {
    db.run(
      'UPDATE progress SET bucket = NULL, next_eligible = NULL WHERE hanzi = ? AND mode = ?',
      [hanzi, mode]
    );
  }
  saveDb();
}

export function setQueuedAt(hanzi: string): void {
  const now = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');
  db.run('UPDATE words SET queued_at = ? WHERE hanzi = ?', [now, hanzi]);
}

export function clearQueuedAt(hanzi: string): void {
  db.run('UPDATE words SET queued_at = NULL WHERE hanzi = ?', [hanzi]);
}

export function setCharQueuedAt(hanzi: string): void {
  const now = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');
  db.run(
    `UPDATE words SET char_queued_at = ? WHERE hanzi = ? AND char_queued_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = words.hanzi AND p.bucket IS NOT NULL)`,
    [now, hanzi]
  );
}

export function clearCharQueuedAt(hanzi: string): void {
  db.run('UPDATE words SET char_queued_at = NULL WHERE hanzi = ?', [hanzi]);
}

// Word query helpers

interface WordFilters {
  queueColumn: string; // 'w.queued_at' or 'w.char_queued_at'
  wordFilter: string; // AND clauses on w.*
}

function getWordFilters(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean
): WordFilters {
  const wordParts: string[] = [];

  if (mode === 'english2hanzi' || mode === 'english2pinyin') {
    wordParts.push('AND w.translatable = 1');
  }

  if (categories.length > 0) {
    wordParts.push(
      `AND EXISTS (SELECT 1 FROM json_each(w.categories) WHERE value IN (${categories.map(() => '?').join(',')}))`
    );
  }

  const queueColumn = characterMode ? 'w.char_queued_at' : 'w.queued_at';

  if (characterMode) {
    wordParts.push('AND w.hanzi_rank IS NOT NULL');
  }

  if (!characterMode) {
    wordParts.push(
      'AND NOT EXISTS (SELECT 1 FROM progress p_cm WHERE p_cm.hanzi = w.hanzi AND p_cm.character_mode_only = 1)'
    );
  }

  return { queueColumn, wordFilter: wordParts.join(' ') };
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

function queryWords(sql: string, params: any[]): Word[] {
  return queryRows(sql, params, rowToWord);
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
      WHERE p.mode = ? AND p.bucket IS NOT NULL ${dueFilter} ${f.wordFilter}
      ORDER BY ${orderBy} LIMIT ?
  `,
    [mode, ...categories, count]
  );
}

function queryNewWords(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean,
  count: number,
  offset: number = 0,
  reverse: boolean = false
): Word[] {
  const f = getWordFilters(mode, categories, characterMode);
  const direction = reverse ? 'DESC' : 'ASC';
  return queryWords(
    `
      SELECT w.* FROM words w
      WHERE ${f.queueColumn} IS NOT NULL ${f.wordFilter}
      AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.mode = ? AND p.bucket IS NOT NULL)
      ORDER BY ${f.queueColumn} ${direction} LIMIT ? OFFSET ?
  `,
    [...categories, mode, count, offset]
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
  characterMode: boolean,
  offset: number = 0,
  reverse: boolean = false
): Word[] {
  return queryNewWords(mode, categories, characterMode, count, offset, reverse);
}

export function getUnqueuedWords(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean,
  count: number,
  offset: number = 0
): Word[] {
  const f = getWordFilters(mode, categories, characterMode);
  const rankCol = characterMode ? 'w.hanzi_rank' : 'w.rank';
  return queryWords(
    `
      SELECT w.* FROM words w
      WHERE ${f.queueColumn} IS NULL ${f.wordFilter}
      AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.mode = ? AND p.bucket IS NOT NULL)
      ORDER BY CASE WHEN ${rankCol} IS NULL THEN 1 ELSE 0 END, ${rankCol} ASC LIMIT ? OFFSET ?
    `,
    [...categories, mode, count, offset]
  );
}

export function getUnqueuedWordsCount(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean
): number {
  const f = getWordFilters(mode, categories, characterMode);
  return queryCount(
    `
      SELECT COUNT(*) as cnt FROM words w
      WHERE ${f.queueColumn} IS NULL ${f.wordFilter}
      AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.mode = ? AND p.bucket IS NOT NULL)
    `,
    [...categories, mode]
  );
}


/**
 * Among new (queued, not yet learned) words, find those already learned in other modes.
 * In character mode, finds characters that appear in words learned in any word mode.
 */
export function getLearnedElsewhere(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean
): string[] {
  const f = getWordFilters(mode, categories, characterMode);
  // Base: queued as new, not yet learned in current mode
  const base = `${f.queueColumn} IS NOT NULL ${f.wordFilter}
    AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.mode = ? AND p.bucket IS NOT NULL)`;
  if (characterMode) {
    // Characters that appear in words learned in any word mode
    return queryRows(
      `SELECT DISTINCT w.hanzi FROM words w
       WHERE ${base}
       AND EXISTS (
         SELECT 1 FROM words w2
         JOIN progress p2 ON w2.hanzi = p2.hanzi
         WHERE p2.bucket IS NOT NULL AND p2.character_mode_only = 0
         AND INSTR(w2.hanzi, w.hanzi) > 0
       )`,
      [...categories, mode],
      (row) => row.hanzi as string
    );
  }
  // Words learned in any other mode
  return queryRows(
    `SELECT DISTINCT w.hanzi FROM words w
     WHERE ${base}
     AND EXISTS (
       SELECT 1 FROM progress p2 WHERE p2.hanzi = w.hanzi AND p2.mode != ? AND p2.bucket IS NOT NULL
     )`,
    [...categories, mode, mode],
    (row) => row.hanzi as string
  );
}

export function getNewWordsCount(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean
): number {
  const f = getWordFilters(mode, categories, characterMode);
  return queryCount(
    `SELECT COUNT(*) as cnt FROM words w WHERE ${f.queueColumn} IS NOT NULL ${f.wordFilter}
     AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.mode = ? AND p.bucket IS NOT NULL)`,
    [...categories, mode]
  );
}


export function getStats(
  mode: PracticeMode,
  categories: string[],
  characterMode: boolean
): {
  totalWords: number;
  learned: number;
  dueForReview: number;
  buckets: number[];
  dueBuckets: number[];
  dueByDay: number[];
} {
  const f = getWordFilters(mode, categories, characterMode);
  const baseJoin = `FROM words w JOIN progress p ON w.hanzi = p.hanzi WHERE p.mode = ? AND p.bucket IS NOT NULL ${f.wordFilter}`;
  const baseParams = [mode, ...categories];

  const totalWords = queryCount(
    `SELECT COUNT(*) as cnt FROM words w WHERE 1=1 ${f.wordFilter}`,
    categories
  );
  const learned = queryCount(`SELECT COUNT(*) as cnt ${baseJoin}`, baseParams);
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

  const dueBuckets = new Array(MAX_BUCKET + 1).fill(0);
  for (const row of queryRows(
    `SELECT p.bucket, COUNT(*) as cnt ${baseJoin} AND p.next_eligible <= datetime('now') GROUP BY p.bucket`,
    baseParams,
    (r) => r
  )) {
    dueBuckets[row.bucket as number] = row.cnt as number;
  }

  // Words due in the next 7 days, bucketed by calendar day in server-local time.
  // Overdue items (dayOffset < 0) collapse into today (index 0).
  const dueByDay = new Array(7).fill(0);
  for (const row of queryRows(
    `SELECT
       CAST(julianday(date(p.next_eligible, 'localtime')) - julianday(date('now', 'localtime')) AS INTEGER) AS dayOffset,
       COUNT(*) as cnt
     ${baseJoin} AND date(p.next_eligible, 'localtime') < date('now', '+7 days', 'localtime')
     GROUP BY dayOffset`,
    baseParams,
    (r) => r
  )) {
    const offset = Math.max(0, row.dayOffset as number);
    if (offset < 7) {
      dueByDay[offset] += row.cnt as number;
    }
  }

  return { totalWords, learned, dueForReview, buckets, dueBuckets, dueByDay };
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
      WHERE p.mode = ? AND p.next_eligible <= datetime('now') ${f.wordFilter}   `,
    [mode, ...categories]
  );
}

// Containing words (for character mode)
export function getLearnedWordsContaining(hanzi: string): ContainingWord[] {
  return queryRows(
    `SELECT DISTINCT w.hanzi, w.pinyin, w.english FROM words w
     JOIN progress p ON w.hanzi = p.hanzi
     WHERE INSTR(w.hanzi, ?) > 0 AND length(w.hanzi) > 1 AND p.bucket IS NOT NULL
     ORDER BY w.rank ASC`,
    [hanzi],
    (row) => ({ hanzi: row.hanzi, pinyin: row.pinyin, english: JSON.parse(row.english) })
  );
}

export interface SearchQuery {
  hanzi?: string;
  hanziMode?: MatchMode;
  pinyin?: string;
  pinyinMode?: MatchMode;
  english?: string;
}

export function searchLearnedWords(query: SearchQuery, limit = 50): { word: Word; progress: Progress[] }[] {
  const hanzi = query.hanzi?.trim() ?? '';
  const hanziMode: MatchMode = query.hanziMode ?? 'contains';
  const english = query.english?.trim().toLowerCase() ?? '';
  const pinyin = query.pinyin?.trim() ?? '';
  const pinyinMode: MatchMode = query.pinyinMode ?? 'contains';

  if (!hanzi && !english && !pinyin) {
    return [];
  }

  const pinyinTokens = pinyin ? splitPinyinQuery(pinyin) : [];

  const words = queryWords(
    `SELECT w.* FROM words w
     WHERE EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.bucket IS NOT NULL)`,
    []
  );

  const matched: { word: Word; progress: Progress[] }[] = [];
  for (const word of words) {
    if (matched.length >= limit) {
      break;
    }
    if (matchesSearch(word, hanzi, hanziMode, english, pinyinTokens, pinyinMode)) {
      const progress = queryRows(
        'SELECT * FROM progress WHERE hanzi = ?',
        [word.hanzi],
        rowToProgress
      );
      matched.push({ word, progress });
    }
  }
  matched.sort((a, b) => {
    const lenA = [...a.word.hanzi].length;
    const lenB = [...b.word.hanzi].length;
    if (lenA !== lenB) {
      return lenA - lenB;
    }
    const rankA = a.word.wordFrequencyRank ?? Infinity;
    const rankB = b.word.wordFrequencyRank ?? Infinity;
    return rankA - rankB;
  });
  return matched;
}

export function searchQueuedWords(query: SearchQuery, limit = 50): { word: Word }[] {
  const hanzi = query.hanzi?.trim() ?? '';
  const hanziMode: MatchMode = query.hanziMode ?? 'contains';
  const english = query.english?.trim().toLowerCase() ?? '';
  const pinyin = query.pinyin?.trim() ?? '';
  const pinyinMode: MatchMode = query.pinyinMode ?? 'contains';

  if (!hanzi && !english && !pinyin) {
    return [];
  }

  const pinyinTokens = pinyin ? splitPinyinQuery(pinyin) : [];

  const words = queryWords(
    `SELECT w.* FROM words w
     WHERE (w.queued_at IS NOT NULL OR w.char_queued_at IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.bucket IS NOT NULL)`,
    []
  );

  const matched: { word: Word }[] = [];
  for (const word of words) {
    if (matched.length >= limit) {
      break;
    }
    if (matchesSearch(word, hanzi, hanziMode, english, pinyinTokens, pinyinMode)) {
      matched.push({ word });
    }
  }
  matched.sort((a, b) => {
    const lenA = [...a.word.hanzi].length;
    const lenB = [...b.word.hanzi].length;
    if (lenA !== lenB) {
      return lenA - lenB;
    }
    const rankA = a.word.wordFrequencyRank ?? Infinity;
    const rankB = b.word.wordFrequencyRank ?? Infinity;
    return rankA - rankB;
  });
  return matched;
}

function hanziMatchesSearch(wordHanzi: string, query: string, mode: MatchMode): boolean {
  switch (mode) {
    case 'prefix':
      return wordHanzi.startsWith(query);
    case 'suffix':
      return wordHanzi.endsWith(query);
    case 'exact':
      return wordHanzi === query;
    default:
      return wordHanzi.includes(query);
  }
}

function matchesSearch(
  word: Word,
  hanzi: string,
  hanziMode: MatchMode,
  english: string,
  pinyinTokens: PinyinToken[],
  pinyinMode: MatchMode
): boolean {
  if (hanzi && !hanziMatchesSearch(word.hanzi, hanzi, hanziMode)) {
    return false;
  }
  if (english) {
    const q = english.toLowerCase();
    const matches = word.english.some((e) => {
      const lower = e.toLowerCase();
      const re = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
      return re.test(lower);
    });
    if (!matches) {
      return false;
    }
  }
  if (pinyinTokens.length > 0) {
    const syllables = splitPinyin(word.pinyin).split(' ');
    const candidates = pinyinCandidateIndices(syllables.length, pinyinTokens.length, pinyinMode);
    const found = candidates.some((i) =>
      pinyinTokens.every((tok, j) => syllableMatchesToken(syllables[i + j], tok))
    );
    if (!found) {
      return false;
    }
  }
  return true;
}

// Category operations
export function getAllCategories(): string[] {
  return queryRows(
    'SELECT DISTINCT value FROM words, json_each(words.categories) ORDER BY value',
    [],
    (row) => row.value as string
  );
}

// Hanzi synonym operations (pairs stored normalized: hanzi1 < hanzi2)
export function addHanziSynonym(a: string, b: string): void {
  const [hanzi1, hanzi2] = a < b ? [a, b] : [b, a];
  db.run(`INSERT OR IGNORE INTO hanzi_synonyms (hanzi1, hanzi2) VALUES (?, ?)`, [hanzi1, hanzi2]);
  saveDb();
}

export function isHanziSynonym(a: string, b: string): boolean {
  const [hanzi1, hanzi2] = a < b ? [a, b] : [b, a];
  const stmt = db.prepare(`SELECT 1 FROM hanzi_synonyms WHERE hanzi1 = ? AND hanzi2 = ?`);
  stmt.bind([hanzi1, hanzi2]);
  const found = stmt.step();
  stmt.free();
  return found;
}

export function getHanziSynonymHanzis(hanzi: string): string[] {
  return queryRows(
    `SELECT hanzi2 AS synonym FROM hanzi_synonyms WHERE hanzi1 = ?
     UNION
     SELECT hanzi1 AS synonym FROM hanzi_synonyms WHERE hanzi2 = ?`,
    [hanzi, hanzi],
    (row) => row.synonym as string
  );
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
    queuedAt: row.queued_at ?? undefined,
    charQueuedAt: row.char_queued_at ?? undefined,
    mandarinspotTranslation: row.mandarinspot_translation
      ? JSON.parse(row.mandarinspot_translation)
      : undefined,
  };
}

export interface MandarinspotTranslation {
  pinyin: string[];
  defs: string[];
  traditional?: string;
}

export function setMandarinspotTranslation(
  hanzi: string,
  value: MandarinspotTranslation | null
): void {
  db.run('UPDATE words SET mandarinspot_translation = ? WHERE hanzi = ?', [
    value ? JSON.stringify(value) : null,
    hanzi,
  ]);
  allWords = null;
}

function rowToProgress(row: any): Progress {
  return {
    id: row.id,
    hanzi: row.hanzi,
    mode: row.mode as PracticeMode,
    bucket: row.bucket,
    lastPracticed: row.last_practiced,
    nextEligible: row.next_eligible,
    correctCount: row.correct_count,
    incorrectCount: row.incorrect_count,
  };
}

export function incrementAnswerCounts(
  hanzi: string,
  mode: PracticeMode,
  correct: number,
  incorrect: number
): void {
  db.run(
    `UPDATE progress SET correct_count = correct_count + ?, incorrect_count = incorrect_count + ? WHERE hanzi = ? AND mode = ?`,
    [correct, incorrect, hanzi, mode]
  );
}
