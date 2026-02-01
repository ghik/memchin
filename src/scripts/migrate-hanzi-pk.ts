import { initDb, saveDb, getDb } from '../server/db.js';

async function migrateHanziPk(): Promise<void> {
  await initDb();
  const db = getDb();

  // Check if migration is needed: does 'words' table have an 'id' column?
  const cols = db.exec('PRAGMA table_info(words)');
  const columnNames = cols[0]?.values.map((row) => row[1]) || [];

  if (!columnNames.includes('id')) {
    console.log('Migration not needed: words table already uses hanzi as primary key.');
    return;
  }

  console.log('Migrating to hanzi-based primary key...');

  // All in a single transaction
  db.run('BEGIN TRANSACTION');

  try {
    // 1. Create new tables with hanzi-based schema
    db.run(`
      CREATE TABLE words_new (
        hanzi TEXT PRIMARY KEY,
        pinyin TEXT NOT NULL,
        english TEXT NOT NULL,
        hsk_level INTEGER NOT NULL,
        examples TEXT NOT NULL DEFAULT '[]',
        translatable INTEGER NOT NULL DEFAULT 1,
        rank INTEGER
      )
    `);

    db.run(`
      CREATE TABLE progress_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hanzi TEXT NOT NULL,
        mode TEXT NOT NULL,
        bucket INTEGER NOT NULL DEFAULT 0,
        last_practiced TEXT,
        next_eligible TEXT,
        FOREIGN KEY (hanzi) REFERENCES words_new(hanzi),
        UNIQUE(hanzi, mode)
      )
    `);

    db.run(`
      CREATE TABLE word_labels_new (
        hanzi TEXT NOT NULL,
        label TEXT NOT NULL,
        FOREIGN KEY (hanzi) REFERENCES words_new(hanzi),
        UNIQUE(hanzi, label)
      )
    `);

    // 2. Copy data
    db.run(`
      INSERT INTO words_new (hanzi, pinyin, english, hsk_level, examples, translatable, rank)
      SELECT hanzi, pinyin, english, hsk_level, examples, translatable, rank
      FROM words
    `);

    db.run(`
      INSERT INTO progress_new (id, hanzi, mode, bucket, last_practiced, next_eligible)
      SELECT p.id, w.hanzi, p.mode, p.bucket, p.last_practiced, p.next_eligible
      FROM progress p
      JOIN words w ON p.word_id = w.id
    `);

    db.run(`
      INSERT INTO word_labels_new (hanzi, label)
      SELECT w.hanzi, wl.label
      FROM word_labels wl
      JOIN words w ON wl.word_id = w.id
    `);

    // 3. Drop old tables, rename new ones
    db.run('DROP TABLE word_labels');
    db.run('DROP TABLE progress');
    db.run('DROP TABLE words');

    db.run('ALTER TABLE words_new RENAME TO words');
    db.run('ALTER TABLE progress_new RENAME TO progress');
    db.run('ALTER TABLE word_labels_new RENAME TO word_labels');

    // 4. Recreate indexes
    db.run('CREATE INDEX IF NOT EXISTS idx_progress_mode_eligible ON progress(mode, next_eligible)');
    db.run('CREATE INDEX IF NOT EXISTS idx_words_rank ON words(rank)');

    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }

  saveDb();
  console.log('Migration complete: words table now uses hanzi as primary key.');
}

migrateHanziPk().catch(console.error);
