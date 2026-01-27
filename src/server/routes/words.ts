import { Router } from 'express';
import { getAllWords, getWordById, getWordCount } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const words = getAllWords();
  res.json({ words, total: words.size });
});

router.get('/count', (req, res) => {
  const count = getWordCount();
  res.json({ count });
});

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const word = getWordById(id);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }
  res.json(word);
});

export default router;
