import { Router } from 'express';
import { getAllWords, getWordByHanzi, getWordCount, getLabelsForWord, addLabelToWord, removeLabelFromWord, getAllLabels, saveDb } from '../db.js';

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

router.post('/:hanzi/labels', (req, res) => {
  const hanzi = decodeURIComponent(req.params.hanzi);
  const word = getWordByHanzi(hanzi);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }
  const { label } = req.body;
  if (!label || typeof label !== 'string') {
    return res.status(400).json({ error: 'label is required' });
  }
  addLabelToWord(hanzi, label.trim());
  saveDb();
  res.json({ labels: getLabelsForWord(hanzi) });
});

router.delete('/:hanzi/labels/:label', (req, res) => {
  const hanzi = decodeURIComponent(req.params.hanzi);
  const word = getWordByHanzi(hanzi);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }
  removeLabelFromWord(hanzi, req.params.label);
  saveDb();
  res.json({ labels: getLabelsForWord(hanzi) });
});

export default router;
