import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, saveDb, getDb } from '../server/db.js';
import { splitPinyin } from '../server/services/pinyin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadFrequencyData(): Map<string, number> {
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

async function migrate(): Promise<void> {
  await initDb();
  const db = getDb();

  const cols = db.exec('PRAGMA table_info(words)');
  const columnNames = cols[0]?.values.map((row) => row[1]) || [];

  // Migration: add translatable column if missing
  if (!columnNames.includes('translatable')) {
    console.log('Adding translatable column...');
    db.run(`ALTER TABLE words ADD COLUMN translatable INTEGER NOT NULL DEFAULT 1`);
    const stmt = db.prepare('SELECT id, english FROM words');
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const english: string[] = JSON.parse(row.english as string);
      const isParenthetical = english.every((e) => /^\(.*\)$/.test(e.trim()));
      if (isParenthetical) {
        db.run('UPDATE words SET translatable = 0 WHERE id = ?', [row.id]);
      }
    }
    stmt.free();
    console.log('Added translatable column');
  }

  // Migration: add rank column if missing
  if (!columnNames.includes('rank')) {
    console.log('Adding rank column...');
    db.run(`ALTER TABLE words ADD COLUMN rank INTEGER`);

    const frequencyData = loadFrequencyData();
    const stmt = db.prepare('SELECT id, hanzi FROM words');
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const rank = frequencyData.get(row.hanzi as string) ?? 999999;
      db.run('UPDATE words SET rank = ? WHERE id = ?', [rank, row.id]);
    }
    stmt.free();

    // Clear progress since word ordering changed
    db.run('DELETE FROM progress');
    console.log('Added rank column and cleared progress');
  }

  // Migration: split pinyin into syllables
  console.log('Splitting pinyin into syllables...');
  const pinyinStmt = db.prepare('SELECT id, pinyin FROM words');
  let pinyinUpdated = 0;
  while (pinyinStmt.step()) {
    const row = pinyinStmt.getAsObject();
    const oldPinyin = row.pinyin as string;
    // Strip existing spaces and re-split to fix any incorrect splits
    const stripped = oldPinyin.replace(/\s+/g, '');
    const newPinyin = splitPinyin(stripped);
    if (oldPinyin !== newPinyin) {
      db.run('UPDATE words SET pinyin = ? WHERE id = ?', [newPinyin, row.id]);
      pinyinUpdated++;
    }
  }
  pinyinStmt.free();
  console.log(`Updated pinyin for ${pinyinUpdated} words`);

  saveDb();
  console.log('Migration complete');
}

migrate().catch(console.error);
