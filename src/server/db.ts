import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import type {
  ContainingWord,
  Example,
  MatchMode,
  PracticeAttempt,
  PracticeAttemptOutcome,
  PracticeMode,
  Progress,
  SentenceAttempt,
  SentenceAttemptOutcome,
  Word,
} from '../shared/types.js';
import { toStamp } from '../shared/time.js';
import { normalizeSentence } from '../shared/sentence-match.js';
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
/** Where the deck lives, and with it anything else worth keeping alongside it */
export const dataDir = path.dirname(dbPath);

let db: SqlJsDatabase;
let sql: Awaited<ReturnType<typeof initSqlJs>>;
/** Identity of the database file as this process last saw it, to spot outside writes */
let dbFileStamp = '';

function fileStamp(): string {
  if (!fs.existsSync(dbPath)) {
    return '';
  }
  const stats = fs.statSync(dbPath);
  return `${stats.mtimeMs}:${stats.size}`;
}

/**
 * The whole database lives in memory here, so a script writing to the file is invisible until
 * it is read again. Called before serving a request: if the file moved on under us, load it
 * and drop the caches built from the old contents.
 */
export function reloadIfChangedExternally(): boolean {
  const stamp = fileStamp();
  if (stamp === '' || stamp === dbFileStamp) {
    return false;
  }
  db = new sql.Database(fs.readFileSync(dbPath));
  dbFileStamp = stamp;
  invalidateWordCache();
  return true;
}

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs();
  sql = SQL;

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

  // Migration: create sentence_attempts table
  //
  // No foreign key on hanzi: this is a record of what happened, and it should outlive a word
  // being taken out of the deck. Nor does it reference the example it was set from — examples
  // are rewritten in place by regenerate-examples, so the question is stored as it was asked.
  db.run(`
    CREATE TABLE IF NOT EXISTS sentence_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      hanzi TEXT NOT NULL,
      english TEXT NOT NULL,
      reference TEXT NOT NULL,
      answer TEXT NOT NULL,
      outcome TEXT NOT NULL,
      explanation TEXT,
      suggestion TEXT
    );
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sentence_attempts_hanzi ON sentence_attempts(hanzi)`);

  // Migration: create practice_attempts table
  //
  // Every answer, retries and all, alongside the scheduling it fed into: the bucket the word was
  // in when it was answered, and when it came due once the round had been marked.
  db.run(`
    CREATE TABLE IF NOT EXISTS practice_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      mode TEXT NOT NULL,
      hanzi TEXT NOT NULL,
      bucket INTEGER,
      answer TEXT NOT NULL,
      outcome TEXT NOT NULL,
      next_eligible TEXT NOT NULL
    );
  `);
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_practice_attempts_hanzi ON practice_attempts(hanzi, mode)`
  );

  // Migration: create generated_sentences table
  //
  // Sentences written to order are kept so that a mistake on one can be practised again: the
  // history names a question by what was asked, and without the sentence on record there is
  // nothing left to ask. `normalized` is the form the history stores its reference in, so the
  // two can be joined without normalising in SQL, and it is unique — the same sentence written
  // twice is the same exercise, and should inherit rather than duplicate its history.
  db.run(`
    CREATE TABLE IF NOT EXISTS generated_sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      levels TEXT NOT NULL,
      hanzi TEXT NOT NULL,
      pinyin TEXT NOT NULL,
      english TEXT NOT NULL,
      normalized TEXT NOT NULL
    );
  `);
  db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_generated_sentences_normalized
     ON generated_sentences(normalized)`
  );

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

  if (!columns.includes('polish')) {
    db.run('ALTER TABLE words ADD COLUMN polish TEXT');
  }

  // Labels inferred by the AI, kept apart from the user's own categories so their
  // provenance stays visible
  if (!columns.includes('ai_categories')) {
    db.run('ALTER TABLE words ADD COLUMN ai_categories TEXT');
  }

  // The AI's usage note for the word
  if (!columns.includes('ai_notes')) {
    db.run('ALTER TABLE words ADD COLUMN ai_notes TEXT');
  }

  // AI-inferred English glosses, kept apart from the curated ones
  if (!columns.includes('ai_english')) {
    db.run('ALTER TABLE words ADD COLUMN ai_english TEXT');
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
  dbFileStamp = fileStamp();
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

/**
 * The AI's glosses and labels are only worth storing when they add something the curated
 * list lacks, so drop the ones already there (and any repeats among themselves), comparing
 * case-insensitively.
 */
function newValuesOnly(inferred: string[], curated: string[]): string[] {
  const seen = new Set(curated.map((value) => value.trim().toLowerCase()));
  const kept: string[] = [];
  for (const value of inferred) {
    const key = value.trim().toLowerCase();
    if (key === '' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    kept.push(value.trim());
  }
  return kept;
}

export interface WordToInsert {
  hanzi: string;
  pinyin: string;
  english: string[];
  polish?: string[];
  hskLevel: number;
  wordFrequencyRank?: number;
  hanziFrequencyRank?: number;
  examples: Example[];
  translatable: boolean;
  categories: string[];
  aiCategories?: string[];
  aiEnglish?: string[];
  aiNotes?: string;
  manual: boolean;
}

export function insertWords(words: WordToInsert[]): void {
  for (const word of words) {
    db.run(
      `
          INSERT INTO words (hanzi, pinyin, english, polish, hsk_level, examples, translatable, rank, hanzi_rank, categories, ai_categories, ai_english, ai_notes, manual)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(hanzi) DO UPDATE SET
            pinyin = excluded.pinyin,
            english = excluded.english,
            hsk_level = excluded.hsk_level,
            examples = excluded.examples,
            translatable = excluded.translatable,
            rank = excluded.rank,
            hanzi_rank = excluded.hanzi_rank,
            categories = excluded.categories,
            ai_categories = COALESCE(excluded.ai_categories, words.ai_categories),
            ai_english = COALESCE(excluded.ai_english, words.ai_english),
            ai_notes = COALESCE(excluded.ai_notes, words.ai_notes),
            manual = excluded.manual
      `,
      [
        word.hanzi,
        word.pinyin,
        JSON.stringify(word.english),
        JSON.stringify(word.polish ?? []),
        word.hskLevel,
        JSON.stringify(word.examples),
        word.translatable ? 1 : 0,
        word.wordFrequencyRank ?? null,
        word.hanziFrequencyRank ?? null,
        JSON.stringify(word.categories),
        word.aiCategories ? JSON.stringify(newValuesOnly(word.aiCategories, word.categories)) : null,
        word.aiEnglish ? JSON.stringify(newValuesOnly(word.aiEnglish, word.english)) : null,
        word.aiNotes || null,
        word.manual ? 1 : 0,
      ]
    );
  }
  saveDb();
  // Invalidate so lookups right after an insert (e.g. queueing the characters of a
  // freshly added word) can see the new rows
  allWords = null;
  ambiguousTranslations = null;
}

export interface WordUpdate {
  pinyin: string;
  english: string[];
  polish: string[];
  categories: string[];
  /** Omit to leave the stored AI labels untouched */
  aiCategories?: string[];
  /** Omit to leave the stored AI glosses untouched */
  aiEnglish?: string[];
  /** Omit to leave the stored AI usage note untouched */
  aiNotes?: string;
}

export function updateWord(
  hanzi: string,
  update: WordUpdate,
  // Bulk callers pass false and call saveDb() themselves: every save rewrites the whole file
  save = true
): void {
  const columns = ['pinyin = ?', 'english = ?', 'polish = ?', 'categories = ?'];
  const values: (string | null)[] = [
    update.pinyin,
    JSON.stringify(update.english),
    JSON.stringify(update.polish),
    JSON.stringify(update.categories),
  ];
  if (update.aiCategories) {
    columns.push('ai_categories = ?');
    values.push(JSON.stringify(newValuesOnly(update.aiCategories, update.categories)));
  }
  if (update.aiEnglish) {
    columns.push('ai_english = ?');
    values.push(JSON.stringify(newValuesOnly(update.aiEnglish, update.english)));
  }
  if (update.aiNotes !== undefined) {
    columns.push('ai_notes = ?');
    values.push(update.aiNotes || null);
  }
  db.run(`UPDATE words SET ${columns.join(', ')} WHERE hanzi = ?`, [...values, hanzi]);
  if (save) {
    saveDb();
  }
  allWords = null;
  ambiguousTranslations = null;
}

/** The columns a refresh job writes, so an aborted one can put them back as they were */
const REFRESHED_COLUMNS = [
  'pinyin',
  'english',
  'polish',
  'categories',
  'ai_categories',
  'ai_english',
  'ai_notes',
  'examples',
];

export interface WordSnapshot {
  hanzi: string;
  values: (string | null)[];
}

/** What `hanzi` looks like now, in the columns a refresh job touches */
export function snapshotWord(hanzi: string): WordSnapshot | null {
  const stmt = db.prepare(`SELECT ${REFRESHED_COLUMNS.join(', ')} FROM words WHERE hanzi = ?`);
  stmt.bind([hanzi]);
  const row = stmt.step() ? (stmt.getAsObject() as Record<string, string | null>) : null;
  stmt.free();
  return row ? { hanzi, values: REFRESHED_COLUMNS.map((column) => row[column] ?? null) } : null;
}

/** Puts snapshotted entries back. The caller saves. */
export function restoreWords(snapshots: WordSnapshot[]): void {
  const assignments = REFRESHED_COLUMNS.map((column) => `${column} = ?`).join(', ');
  for (const snapshot of snapshots) {
    db.run(`UPDATE words SET ${assignments} WHERE hanzi = ?`, [...snapshot.values, snapshot.hanzi]);
  }
  invalidateWordCache();
}

/** Characters imported as HSK words carry a word rank but no character rank */
export function setHanziRank(hanzi: string, rank: number): void {
  db.run('UPDATE words SET hanzi_rank = ? WHERE hanzi = ?', [rank, hanzi]);
  invalidateWordCache();
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

/**
 * Inverse of setAllProgressCharacterOnly: clear the character-mode-only flag
 * so existing char-mode progress also counts as word-mode progress.
 */
export function setAllProgressWordMode(hanzi: string): number {
  db.run(
    'UPDATE progress SET character_mode_only = 0 WHERE hanzi = ? AND character_mode_only = 1',
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

// These run one row at a time inside loops, so they patch the cached word rather than
// dropping the cache — a full rebuild per call would be O(n) per queued character.
function patchCachedWord(hanzi: string, patch: Partial<Word>): void {
  const cached = allWords?.get(hanzi);
  if (cached) {
    Object.assign(cached, patch);
  }
}

export function setQueuedAt(hanzi: string): void {
  const now = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '');
  db.run('UPDATE words SET queued_at = ? WHERE hanzi = ?', [now, hanzi]);
  patchCachedWord(hanzi, { queuedAt: now });
}

export function clearQueuedAt(hanzi: string): void {
  db.run('UPDATE words SET queued_at = NULL WHERE hanzi = ?', [hanzi]);
  patchCachedWord(hanzi, { queuedAt: undefined });
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
  // The UPDATE is conditional, so read back what actually landed
  if (allWords?.has(hanzi)) {
    const stmt = db.prepare('SELECT char_queued_at FROM words WHERE hanzi = ?');
    stmt.bind([hanzi]);
    if (stmt.step()) {
      patchCachedWord(hanzi, {
        charQueuedAt: (stmt.getAsObject().char_queued_at as string | null) ?? undefined,
      });
    }
    stmt.free();
  }
}

export function clearCharQueuedAt(hanzi: string): void {
  db.run('UPDATE words SET char_queued_at = NULL WHERE hanzi = ?', [hanzi]);
  patchCachedWord(hanzi, { charQueuedAt: undefined });
}

// Word query helpers

// A word's own categories and its AI-inferred ones are both filterable, so every
// category predicate runs over the union of the two columns
const ALL_CATEGORY_VALUES = `
      SELECT value FROM json_each(w.categories)
      UNION ALL
      SELECT value FROM json_each(COALESCE(w.ai_categories, '[]'))`;

interface WordFilters {
  queueColumn: string; // 'w.queued_at' or 'w.char_queued_at'
  wordFilter: string; // AND clauses on w.*
}

function getWordFilters(
  mode: PracticeMode,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean
): WordFilters {
  const wordParts: string[] = [];

  if (mode === 'english2hanzi' || mode === 'english2pinyin') {
    wordParts.push('AND w.translatable = 1');
  }

  if (categories.length > 0) {
    wordParts.push(
      `AND EXISTS (SELECT 1 FROM (${ALL_CATEGORY_VALUES}) WHERE value IN (${categories.map(() => '?').join(',')}))`
    );
  }

  if (excludedCategories.length > 0) {
    wordParts.push(
      `AND NOT EXISTS (SELECT 1 FROM (${ALL_CATEGORY_VALUES}) WHERE value IN (${excludedCategories.map(() => '?').join(',')}))`
    );
  }

  const queueColumn = characterMode ? 'w.char_queued_at' : 'w.queued_at';

  if (characterMode) {
    // What character mode means is a single character — not one the frequency file happens to
    // rank. Characters that came in as HSK words carry no hanzi_rank, and ranking them was
    // never the point: it only hid them from the queue they had been added to.
    wordParts.push('AND length(w.hanzi) = 1');
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
  excludedCategories: string[],
  characterMode: boolean,
  count: number,
  dueOnly: boolean,
  random: boolean
): Word[] {
  const f = getWordFilters(mode, categories, excludedCategories, characterMode);
  const dueFilter = dueOnly ? "AND p.next_eligible <= datetime('now')" : '';
  const orderBy = random ? 'RANDOM()' : 'p.next_eligible ASC';
  return queryWords(
    `
      SELECT w.* FROM words w JOIN progress p ON w.hanzi = p.hanzi
      WHERE p.mode = ? AND p.bucket IS NOT NULL ${dueFilter} ${f.wordFilter}
      ORDER BY ${orderBy} LIMIT ?
  `,
    [mode, ...categories, ...excludedCategories, count]
  );
}

function queryNewWords(
  mode: PracticeMode,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean,
  count: number,
  offset: number = 0,
  reverse: boolean = false
): Word[] {
  const f = getWordFilters(mode, categories, excludedCategories, characterMode);
  const direction = reverse ? 'DESC' : 'ASC';
  return queryWords(
    `
      SELECT w.* FROM words w
      WHERE ${f.queueColumn} IS NOT NULL ${f.wordFilter}
      AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.mode = ? AND p.bucket IS NOT NULL)
      ORDER BY ${f.queueColumn} ${direction} LIMIT ? OFFSET ?
  `,
    [...categories, ...excludedCategories, mode, count, offset]
  );
}

export function getWordsForReview(
  mode: PracticeMode,
  count: number,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean,
  random: boolean
): Word[] {
  return queryReviewWords(mode, categories, excludedCategories, characterMode, count, false, random);
}

export function getNewWords(
  mode: PracticeMode,
  count: number,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean,
  offset: number = 0,
  reverse: boolean = false
): Word[] {
  return queryNewWords(mode, categories, excludedCategories, characterMode, count, offset, reverse);
}

export function getUnqueuedWords(
  mode: PracticeMode,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean,
  count: number,
  offset: number = 0
): Word[] {
  const f = getWordFilters(mode, categories, excludedCategories, characterMode);
  const rankCol = characterMode ? 'w.hanzi_rank' : 'w.rank';
  return queryWords(
    `
      SELECT w.* FROM words w
      WHERE ${f.queueColumn} IS NULL ${f.wordFilter}
      AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.mode = ? AND p.bucket IS NOT NULL)
      ORDER BY CASE WHEN ${rankCol} IS NULL THEN 1 ELSE 0 END, ${rankCol} ASC LIMIT ? OFFSET ?
    `,
    [...categories, ...excludedCategories, mode, count, offset]
  );
}

export function getUnqueuedWordsCount(
  mode: PracticeMode,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean
): number {
  const f = getWordFilters(mode, categories, excludedCategories, characterMode);
  return queryCount(
    `
      SELECT COUNT(*) as cnt FROM words w
      WHERE ${f.queueColumn} IS NULL ${f.wordFilter}
      AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.mode = ? AND p.bucket IS NOT NULL)
    `,
    [...categories, ...excludedCategories, mode]
  );
}


/**
 * Among new (queued, not yet learned) words, find those already learned in other modes.
 * In character mode, finds characters that appear in words learned in any word mode.
 */
export function getLearnedElsewhere(
  mode: PracticeMode,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean
): string[] {
  const f = getWordFilters(mode, categories, excludedCategories, characterMode);
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
      [...categories, ...excludedCategories, mode],
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
    [...categories, ...excludedCategories, mode, mode],
    (row) => row.hanzi as string
  );
}

export function getNewWordsCount(
  mode: PracticeMode,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean
): number {
  const f = getWordFilters(mode, categories, excludedCategories, characterMode);
  return queryCount(
    `SELECT COUNT(*) as cnt FROM words w WHERE ${f.queueColumn} IS NOT NULL ${f.wordFilter}
     AND NOT EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.mode = ? AND p.bucket IS NOT NULL)`,
    [...categories, ...excludedCategories, mode]
  );
}


export function getStats(
  mode: PracticeMode,
  categories: string[],
  excludedCategories: string[],
  characterMode: boolean
): {
  totalWords: number;
  learned: number;
  dueForReview: number;
  buckets: number[];
  dueBuckets: number[];
  dueByDay: number[];
} {
  const f = getWordFilters(mode, categories, excludedCategories, characterMode);
  const baseJoin = `FROM words w JOIN progress p ON w.hanzi = p.hanzi WHERE p.mode = ? AND p.bucket IS NOT NULL ${f.wordFilter}`;
  const baseParams = [mode, ...categories, ...excludedCategories];

  const totalWords = queryCount(
    `SELECT COUNT(*) as cnt FROM words w WHERE 1=1 ${f.wordFilter}`,
    [...categories, ...excludedCategories]
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
  excludedCategories: string[],
  characterMode: boolean
): number {
  const f = getWordFilters(mode, categories, excludedCategories, characterMode);
  return queryCount(
    `
      SELECT COUNT(*) as cnt FROM words w JOIN progress p ON w.hanzi = p.hanzi
      WHERE p.mode = ? AND p.next_eligible <= datetime('now') ${f.wordFilter}   `,
    [mode, ...categories, ...excludedCategories]
  );
}

/**
 * Every word learned as a word, in any mode. A null bucket is a row that exists without the word
 * having been learned; a character-mode-only row is a character learned as a piece of other
 * words rather than as a word in its own right, and a word may hold both kinds of row, so it is
 * the presence of a word-mode one that counts. The count and the set have to agree on all this,
 * which is why the condition is written once.
 */
const LEARNED_AS_A_WORD =
  'FROM progress WHERE bucket IS NOT NULL AND COALESCE(character_mode_only, 0) = 0';

export function getLearnedHanzi(): Set<string> {
  return new Set(
    queryRows(`SELECT DISTINCT hanzi ${LEARNED_AS_A_WORD}`, [], (row) => row.hanzi as string)
  );
}

/** How many there are, cheaply — enough to notice that the set has changed */
export function getLearnedCount(): number {
  return queryCount(`SELECT COUNT(DISTINCT hanzi) as cnt ${LEARNED_AS_A_WORD}`, []);
}

/**
 * The sentences whose last word on the matter was a failure: answered wrong, or skipped.
 *
 * A sentence is identified by itself — the normalised form the history stores — and not by any
 * word. Most came from a word's examples and some were written to order, and one that two words
 * both illustrate is still one sentence: what was failed was producing it, which has nothing to
 * do with what it was filed under. Identifying it this way is also what lets the rows written
 * before questions had ids count, and what drops a regenerated example off the list, since that
 * is a different sentence wearing the same name.
 *
 * "Last word" ignores a `missing-word` turn-back: that is the exercise handing the answer back
 * to be written again, not a verdict on it, and the attempt that follows is the one that counts.
 */
export function getSentencesNeedingReview(): string[] {
  return queryRows(
    `SELECT DISTINCT a.reference FROM sentence_attempts a
     WHERE a.outcome IN ('wrong', 'skipped')
       AND a.id = (SELECT MAX(b.id) FROM sentence_attempts b
                   WHERE b.reference = a.reference AND b.outcome <> 'missing-word')`,
    [],
    (row) => row.reference as string
  );
}

/**
 * Files a round of written sentences and hands back what they are known by afterwards.
 *
 * A sentence already on record keeps its row rather than gaining a second one: it is the same
 * exercise, and sharing the row is what lets it carry the history of having been failed before.
 */
export function saveGeneratedSentences(
  sentences: Example[],
  levels: number[]
): { id: number; sentence: Example }[] {
  const at = toStamp(new Date());
  const levelList = levels.join(',');
  const saved: { id: number; sentence: Example }[] = [];
  for (const sentence of sentences) {
    const normalized = normalizeSentence(sentence.hanzi);
    if (normalized === '') {
      continue;
    }
    db.run(
      `INSERT OR IGNORE INTO generated_sentences (at, levels, hanzi, pinyin, english, normalized)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [at, levelList, sentence.hanzi, sentence.pinyin, sentence.english, normalized]
    );
    // Read back rather than taking the insert's rowid: the row may be one that was already
    // there, which is the point of INSERT OR IGNORE here
    const [id] = queryRows(
      'SELECT id FROM generated_sentences WHERE normalized = ?',
      [normalized],
      (row) => row.id as number
    );
    if (id !== undefined) {
      saved.push({ id, sentence });
    }
  }
  saveDb();
  return saved;
}

/** Every written sentence there has ever been, in the form a new one is compared against */
export function getGeneratedNormalized(): Set<string> {
  return new Set(
    queryRows('SELECT normalized FROM generated_sentences', [], (row) => row.normalized as string)
  );
}

/** The latest few, to show the model what it has already written */
export function getRecentGeneratedEnglish(limit: number): string[] {
  return queryRows(
    'SELECT english FROM generated_sentences ORDER BY id DESC LIMIT ?',
    [limit],
    (row) => row.english as string
  );
}

export function getGeneratedSentence(id: number): Example | null {
  const rows = queryRows(
    'SELECT hanzi, pinyin, english FROM generated_sentences WHERE id = ?',
    [id],
    (row) => ({
      hanzi: row.hanzi as string,
      pinyin: row.pinyin as string,
      english: row.english as string,
    })
  );
  return rows[0] ?? null;
}

/** The written sentences last answered wrong or skipped, joined on the same normalised form */
export function getGeneratedSentencesNeedingReview(): { id: number; sentence: Example }[] {
  return queryRows(
    `SELECT g.id, g.hanzi, g.pinyin, g.english FROM generated_sentences g
     WHERE EXISTS (
       SELECT 1 FROM sentence_attempts a
       WHERE a.reference = g.normalized
         AND a.outcome IN ('wrong', 'skipped')
         AND a.id = (SELECT MAX(b.id) FROM sentence_attempts b
                     WHERE b.reference = a.reference AND b.outcome <> 'missing-word'))`,
    [],
    (row) => ({
      id: row.id as number,
      sentence: {
        hanzi: row.hanzi as string,
        pinyin: row.pinyin as string,
        english: row.english as string,
      },
    })
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

function sortMatches<T extends { word: Word }>(matches: T[]): T[] {
  matches.sort((a, b) => {
    const lenA = [...a.word.hanzi].length;
    const lenB = [...b.word.hanzi].length;
    if (lenA !== lenB) {
      return lenA - lenB;
    }
    const rankA = a.word.wordFrequencyRank ?? Infinity;
    const rankB = b.word.wordFrequencyRank ?? Infinity;
    return rankA - rankB;
  });
  return matches;
}

export function searchLearnedWords(query: SearchQuery, limit = 500): { word: Word; progress: Progress[] }[] {
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
    if (matchesSearch(word, hanzi, hanziMode, english, pinyinTokens, pinyinMode)) {
      const progress = queryRows(
        'SELECT * FROM progress WHERE hanzi = ?',
        [word.hanzi],
        rowToProgress
      );
      matched.push({ word, progress });
    }
  }
  return sortMatches(matched).slice(0, limit);
}

export function searchQueuedWords(query: SearchQuery, limit = 500): { word: Word }[] {
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
    if (matchesSearch(word, hanzi, hanziMode, english, pinyinTokens, pinyinMode)) {
      matched.push({ word });
    }
  }
  return sortMatches(matched).slice(0, limit);
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
/**
 * Learned entries in the order the given practice queue would bring them up, soonest first.
 * Applies the same filters as practice itself, so the head of the list is what you would
 * actually see next in that mode.
 */
export function getLearnedWordsByReviewOrder(mode: PracticeMode, characterMode: boolean): Word[] {
  const filters = getWordFilters(mode, [], [], characterMode);
  return queryWords(
    `SELECT w.* FROM words w JOIN progress p ON w.hanzi = p.hanzi
     WHERE p.mode = ? AND p.bucket IS NOT NULL ${filters.wordFilter}
     ORDER BY p.next_eligible ASC`,
    [mode]
  );
}

export function getAllCategories(): string[] {
  return queryRows(
    `SELECT value FROM words, json_each(words.categories)
     UNION
     SELECT value FROM words, json_each(COALESCE(words.ai_categories, '[]'))
     ORDER BY value`,
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

/** Replaces the full set of synonyms of `hanzi` with `synonyms`. */
export function setHanziSynonyms(hanzi: string, synonyms: string[]): void {
  const wanted = new Set(synonyms);
  for (const existing of getHanziSynonymHanzis(hanzi)) {
    if (wanted.has(existing)) {
      continue;
    }
    const [hanzi1, hanzi2] = hanzi < existing ? [hanzi, existing] : [existing, hanzi];
    db.run(`DELETE FROM hanzi_synonyms WHERE hanzi1 = ? AND hanzi2 = ?`, [hanzi1, hanzi2]);
  }
  for (const synonym of wanted) {
    const [hanzi1, hanzi2] = hanzi < synonym ? [hanzi, synonym] : [synonym, hanzi];
    db.run(`INSERT OR IGNORE INTO hanzi_synonyms (hanzi1, hanzi2) VALUES (?, ?)`, [hanzi1, hanzi2]);
  }
  saveDb();
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

/**
 * Files one attempt at a sentence. Everything is kept, passes included: a record of practice
 * with the right answers missing cannot say whether a sentence is hard or merely rare.
 */
export function recordSentenceAttempt(attempt: Omit<SentenceAttempt, 'at'>): void {
  db.run(
    `INSERT INTO sentence_attempts (at, hanzi, english, reference, answer, outcome, explanation, suggestion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      toStamp(new Date()),
      attempt.hanzi,
      attempt.english,
      attempt.reference,
      attempt.answer,
      attempt.outcome,
      attempt.explanation ?? null,
      attempt.suggestion ?? null,
    ]
  );
  saveDb();
}

/**
 * Files a round's worth of answers. Deliberately does not save: the caller is writing the
 * progress these attempts produced in the same request, and one rewrite of the file covers both.
 */
export function recordPracticeAttempts(attempts: PracticeAttempt[]): void {
  for (const attempt of attempts) {
    db.run(
      `INSERT INTO practice_attempts (at, mode, hanzi, bucket, answer, outcome, next_eligible)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        attempt.at,
        attempt.mode,
        attempt.hanzi,
        attempt.bucket,
        attempt.answer,
        attempt.outcome,
        attempt.nextEligible,
      ]
    );
  }
}

/** Every answer logged so far, oldest first. Nothing reads this yet; it is how it gets read. */
export function getPracticeAttempts(hanzi?: string): PracticeAttempt[] {
  return queryRows(
    `SELECT * FROM practice_attempts ${hanzi ? 'WHERE hanzi = ?' : ''} ORDER BY at ASC, id ASC`,
    hanzi ? [hanzi] : [],
    (row) => ({
      at: row.at,
      mode: row.mode as PracticeMode,
      hanzi: row.hanzi,
      bucket: row.bucket === null ? null : (row.bucket as number),
      answer: row.answer,
      outcome: row.outcome as PracticeAttemptOutcome,
      nextEligible: row.next_eligible,
    })
  );
}

/** Every attempt logged so far, oldest first. Nothing reads this yet; it is how it gets read. */
export function getSentenceAttempts(hanzi?: string): SentenceAttempt[] {
  return queryRows(
    `SELECT * FROM sentence_attempts ${hanzi ? 'WHERE hanzi = ?' : ''} ORDER BY at ASC, id ASC`,
    hanzi ? [hanzi] : [],
    (row) => ({
      at: row.at,
      hanzi: row.hanzi,
      english: row.english,
      reference: row.reference,
      answer: row.answer,
      outcome: row.outcome as SentenceAttemptOutcome,
      ...(row.explanation ? { explanation: row.explanation as string } : {}),
      ...(row.suggestion ? { suggestion: row.suggestion as string } : {}),
    })
  );
}

function rowToWord(row: any): Word {
  return {
    hanzi: row.hanzi,
    pinyin: (row.pinyin as string).toLowerCase(),
    english: JSON.parse(row.english),
    polish: row.polish ? JSON.parse(row.polish) : [],
    hskLevel: row.hsk_level,
    wordFrequencyRank: row.rank ?? undefined,
    hanziFrequencyRank: row.hanzi_rank ?? undefined,
    examples: JSON.parse(row.examples || '[]'),
    translatable: Boolean(row.translatable),
    categories: JSON.parse(row.categories || '[]'),
    aiCategories: JSON.parse(row.ai_categories || '[]'),
    aiEnglish: JSON.parse(row.ai_english || '[]'),
    aiNotes: row.ai_notes ?? undefined,
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
