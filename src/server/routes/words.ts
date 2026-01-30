import { Router } from 'express';
import { getAllWords, getWordById, getWordCount, getLabelsForWord, addLabelToWord, removeLabelFromWord, getAllLabels, saveDb } from '../db.js';

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

router.post('/:id/labels', (req, res) => {
  const id = parseInt(req.params.id);
  const word = getWordById(id);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }
  const { label } = req.body;
  if (!label || typeof label !== 'string') {
    return res.status(400).json({ error: 'label is required' });
  }
  addLabelToWord(id, label.trim());
  saveDb();
  res.json({ labels: getLabelsForWord(id) });
});

router.delete('/:id/labels/:label', (req, res) => {
  const id = parseInt(req.params.id);
  const word = getWordById(id);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }
  removeLabelFromWord(id, req.params.label);
  saveDb();
  res.json({ labels: getLabelsForWord(id) });
});

export default router;
