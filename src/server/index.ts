import express from 'express';
import cors from 'cors';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  initDb,
  getAllCategories,
  getDb,
  getWordByHanzi,
  insertWords,
  reloadIfChangedExternally,
  setCharQueuedAt,
  saveDb,
  setHanziRank,
} from './db.js';
import { loadCedict } from './services/cedict.js';
import { loadIds } from './services/ids.js';
import { lookupChar, loadWordFrequencyData } from './services/hanzi-freq.js';
import { describeCharacter } from './services/character-entry.js';
import wordsRouter from './routes/words.js';
import practiceRouter from './routes/practice.js';
import refreshRouter from './routes/refresh.js';
import sentencesRouter from './routes/sentences.js';
import { abortRefresh } from './services/word-refresh.js';
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
        const charInfo = describeCharacter(char);
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
          translatable: charInfo.english.length > 0,
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

/**
 * `tsx watch` kills the server on every file save, and a refresh job dies with it. Take the
 * job down properly first: the AI calls in flight are cancelled and everything it wrote is put
 * back, so the entries are never left half-refreshed. A second signal stops waiting for that,
 * at the price of leaving the entries written so far as the job left them.
 */
function rollBackJobOnShutdown(): void {
  let shuttingDown = false;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGUSR2'] as const) {
    process.on(signal, () => {
      if (shuttingDown) {
        process.exit(1);
      }
      shuttingDown = true;
      void abortRefresh().finally(() => process.exit(0));
    });
  }
}

/**
 * A character that came in as a one-character HSK word has a word rank but no character rank,
 * and character lists sort on the latter — so it sits behind every ranked character, at the
 * end of a list nobody scrolls to. The frequency file knows most of them; the few it does not
 * (traditional forms, say) keep their null and stay at the back, which is where they belong.
 */
function backfillHanziRanks(): void {
  const db = getDb();
  const stmt = db.prepare('SELECT hanzi FROM words WHERE hanzi_rank IS NULL AND length(hanzi) = 1');
  const unranked: string[] = [];
  while (stmt.step()) {
    unranked.push(stmt.getAsObject().hanzi as string);
  }
  stmt.free();

  let ranked = 0;
  for (const hanzi of unranked) {
    const charInfo = lookupChar(hanzi);
    if (charInfo) {
      setHanziRank(hanzi, charInfo.rank);
      ranked++;
    }
  }
  if (ranked > 0) {
    saveDb();
    console.log(`Character migration: filled in the frequency rank of ${ranked} character(s)`);
  }
}

async function main() {
  // Initialize database and data files
  await initDb();
  loadCedict();
  loadIds();
  migrateCharacterEntries();
  backfillHanziRanks();
  rollBackJobOnShutdown();
  console.log('Database and data files initialized');

  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  // Pick up writes made by the scripts while the server was running
  app.use((_req, _res, next) => {
    if (reloadIfChangedExternally()) {
      console.log('Database changed on disk, reloaded');
    }
    next();
  });

  // API routes
  app.use('/api/words', wordsRouter);
  app.use('/api/practice', practiceRouter);
  app.use('/api/refresh', refreshRouter);
  app.use('/api/sentences', sentencesRouter);
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
