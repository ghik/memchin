import express from 'express';
import cors from 'cors';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb, getAllCategories, getDb, getWordByHanzi, insertWords, setCharQueuedAt } from './db.js';
import { loadCedict } from './services/cedict.js';
import { loadIds } from './services/ids.js';
import { lookupChar, loadWordFrequencyData } from './services/hanzi-freq.js';
import wordsRouter from './routes/words.js';
import practiceRouter from './routes/practice.js';
import type { Example } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERTS_DIR = path.join(__dirname, '../../certs');

// Ensure all component characters of practiced multi-char words exist in the words table
// and have char_queued_at set. This handles words added before character auto-add was implemented.
function migrateCharacterEntries(): void {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT DISTINCT w.hanzi FROM words w
    JOIN progress p ON w.hanzi = p.hanzi
    WHERE length(w.hanzi) > 1 AND p.bucket IS NOT NULL
  `);
  const practicedWords: string[] = [];
  while (stmt.step()) {
    practicedWords.push(stmt.getAsObject().hanzi as string);
  }
  stmt.free();

  const freq = loadWordFrequencyData();
  let added = 0;

  for (const hanzi of practicedWords) {
    for (const char of [...hanzi]) {
      if (!getWordByHanzi(char)) {
        const charInfo = lookupChar(char);
        if (!charInfo) {
          continue;
        }
        insertWords([{
          hanzi: char,
          pinyin: charInfo.pinyin,
          english: charInfo.english,
          hskLevel: 0,
          wordFrequencyRank: freq.get(char),
          hanziFrequencyRank: charInfo.rank,
          examples: [] as Example[],
          translatable: true,
          categories: [],
          manual: true,
        }]);
        added++;
      }
      setCharQueuedAt(char);
    }
  }

  if (added > 0) {
    console.log(`Character migration: added ${added} missing character entries`);
  }
}

async function main() {
  // Initialize database and data files
  await initDb();
  loadCedict();
  loadIds();
  migrateCharacterEntries();
  console.log('Database and data files initialized');

  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api/words', wordsRouter);
  app.use('/api/practice', practiceRouter);
  app.get('/api/categories', (_req, res) => {
    res.json(getAllCategories());
  });

  // Serve audio files
  app.use('/audio', express.static(path.join(__dirname, '../../data/audio')));

  // Serve static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../client')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../client/index.html'));
    });
  }

  const tlsOptions = {
    key: fs.readFileSync(path.join(CERTS_DIR, 'key.pem')),
    cert: fs.readFileSync(path.join(CERTS_DIR, 'cert.pem')),
  };
  https.createServer(tlsOptions, app).listen(PORT, () => {
    console.log(`Server running on https://localhost:${PORT}`);
  });
}

main().catch(console.error);
