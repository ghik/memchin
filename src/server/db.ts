import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Example, PracticeMode, Progress, Word } from '../shared/types.js';
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
  frequencyRank: number;
  examples: Example[];
  translatable: boolean;
}

export function insertWords(words: WordToInsert[]): void {
  for (const word of words) {
    db.run(
      `
          INSERT INTO words (hanzi, pinyin, english, hsk_level, examples, translatable, rank)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(hanzi) DO UPDATE SET
            pinyin = excluded.pinyin,
            english = excluded.english,
            hsk_level = excluded.hsk_level,
            examples = excluded.examples,
            translatable = excluded.translatable,
            rank = excluded.rank
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

export function updateWordExamples(hanzi: string, examples: any[]): void {
  db.run('UPDATE words SET examples = ? WHERE hanzi = ?', [JSON.stringify(examples), hanzi]);
  // Invalidate cache so subsequent reads see the update
  allWords = null;
}

export function getWordCount(): number {
  const result = db.exec('SELECT COUNT(*) as count FROM words');
  return (result[0]?.values[0]?.[0] as number) ?? 0;
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
  nextEligible: string
): void {
  const now = new Date().toISOString();
  db.run(
    `
        INSERT INTO progress (hanzi, mode, bucket, last_practiced, next_eligible)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(hanzi, mode) DO
        UPDATE SET
            bucket = excluded.bucket,
            last_practiced = excluded.last_practiced,
            next_eligible = excluded.next_eligible
    `,
    [hanzi, mode, bucket, now, nextEligible]
  );
}

export function getWordsForReview(mode: PracticeMode, count: number, label?: string): Word[] {
  const translatableFilter =
    mode === 'hanzi2english' || mode === 'english2hanzi' || mode === 'english2pinyin'
      ? 'AND w.translatable = 1'
      : '';
  const labelJoin = label ? 'JOIN word_labels wl ON w.hanzi = wl.hanzi AND wl.label = ?' : '';
  const params: any[] = label ? [label, mode, count] : [mode, count];

  const stmt = db.prepare(`
      SELECT w.*
      FROM words w
               ${labelJoin}
               JOIN progress p ON w.hanzi = p.hanzi
      WHERE p.mode = ? ${translatableFilter}
      ORDER BY p.next_eligible ASC
          LIMIT ?
  `);
  stmt.bind(params);

  const result: Word[] = [];
  while (stmt.step()) {
    result.push(rowToWord(stmt.getAsObject()));
  }
  stmt.free();
  return result;
}

export function getNewWords(mode: PracticeMode, count: number, label?: string): Word[] {
  const translatableFilter =
    mode === 'hanzi2english' || mode === 'english2hanzi' || mode === 'english2pinyin'
      ? 'AND w.translatable = 1'
      : '';
  const labelJoin = label ? 'JOIN word_labels wl ON w.hanzi = wl.hanzi AND wl.label = ?' : '';
  const params: any[] = label ? [label, mode, count] : [mode, count];

  const stmt = db.prepare(`
      SELECT w.*
      FROM words w
               ${labelJoin}
               LEFT JOIN progress p ON w.hanzi = p.hanzi AND p.mode = ?
      WHERE p.id IS NULL ${translatableFilter}
      ORDER BY w.rank ASC
          LIMIT ?
  `);
  stmt.bind(params);

  const result: Word[] = [];
  while (stmt.step()) {
    result.push(rowToWord(stmt.getAsObject()));
  }
  stmt.free();
  return result;
}

export function getWordsForPractice(mode: PracticeMode, count: number, label?: string): Word[] {
  const now = new Date().toISOString();
  const translatableFilter =
    mode === 'hanzi2english' || mode === 'english2hanzi' || mode === 'english2pinyin'
      ? 'AND w.translatable = 1'
      : '';
  const labelJoin = label ? 'JOIN word_labels wl ON w.hanzi = wl.hanzi AND wl.label = ?' : '';

  // First get words that are due for review
  const dueParams: any[] = label ? [label, mode, now, count] : [mode, now, count];
  const dueStmt = db.prepare(`
      SELECT w.*
      FROM words w
               ${labelJoin}
               JOIN progress p ON w.hanzi = p.hanzi
      WHERE p.mode = ?
        AND p.next_eligible <= ? ${translatableFilter}
      ORDER BY p.next_eligible ASC
          LIMIT ?
  `);
  dueStmt.bind(dueParams);

  const result: Word[] = [];
  while (dueStmt.step()) {
    result.push(rowToWord(dueStmt.getAsObject()));
  }
  dueStmt.free();

  if (result.length < count) {
    // Get new words (no progress record for this mode)
    const existingHanzi = result.map((w) => `'${w.hanzi.replace(/'/g, "''")}'`);
    const placeholders =
      existingHanzi.length > 0 ? `AND w.hanzi NOT IN (${existingHanzi.join(',')})` : '';

    const newParams: any[] = label
      ? [label, mode, count - result.length]
      : [mode, count - result.length];
    const newStmt = db.prepare(`
        SELECT w.*
        FROM words w
                 ${labelJoin}
                 LEFT JOIN progress p ON w.hanzi = p.hanzi AND p.mode = ?
        WHERE p.id IS NULL ${placeholders} ${translatableFilter}
        ORDER BY w.rank ASC
            LIMIT ?
    `);
    newStmt.bind(newParams);

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
  const bucketResult = db.exec(
    `SELECT bucket, COUNT(*) FROM progress WHERE mode = '${mode}' GROUP BY bucket`
  );
  for (const [bucket, count] of bucketResult[0]?.values ?? []) {
    buckets[bucket as number] = count as number;
  }

  return { totalWords, learned, mastered, dueForReview, buckets };
}

// Label operations
export function getLabelsForWord(hanzi: string): string[] {
  const stmt = db.prepare('SELECT label FROM word_labels WHERE hanzi = ? ORDER BY label');
  stmt.bind([hanzi]);
  const labels: string[] = [];
  while (stmt.step()) {
    labels.push(stmt.getAsObject().label as string);
  }
  stmt.free();
  return labels;
}

export function addLabelToWord(hanzi: string, label: string): void {
  db.run('INSERT OR IGNORE INTO word_labels (hanzi, label) VALUES (?, ?)', [hanzi, label]);
}

export function removeLabelFromWord(hanzi: string, label: string): void {
  db.run('DELETE FROM word_labels WHERE hanzi = ? AND label = ?', [hanzi, label]);
}

export function getAllLabels(): string[] {
  const stmt = db.prepare('SELECT DISTINCT label FROM word_labels ORDER BY label');
  const labels: string[] = [];
  while (stmt.step()) {
    labels.push(stmt.getAsObject().label as string);
  }
  stmt.free();
  return labels;
}

function rowToWord(row: any): Word {
  return {
    hanzi: row.hanzi,
    pinyin: (row.pinyin as string).toLowerCase(),
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
    hanzi: row.hanzi,
    mode: row.mode as PracticeMode,
    bucket: row.bucket,
    lastPracticed: row.last_practiced,
    nextEligible: row.next_eligible,
  };
}
