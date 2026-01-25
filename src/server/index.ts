import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb } from './db.js';
import wordsRouter from './routes/words.js';
import practiceRouter from './routes/practice.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Initialize database
  await initDb();
  console.log('Database initialized');

  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api/words', wordsRouter);
  app.use('/api/practice', practiceRouter);

  // Serve static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../client')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../client/index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

main().catch(console.error);
