import { Router } from 'express';
import { getAllWords, getWordByHanzi, getWordCount } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const words = getAllWords();
  res.json({ words, total: words.size });
});

router.get('/count', (req, res) => {
  const count = getWordCount();
  res.json({ count });
});

router.get('/:hanzi', (req, res) => {
  const hanzi = decodeURIComponent(req.params.hanzi);
  const word = getWordByHanzi(hanzi);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }
  res.json(word);
});

export default router;
