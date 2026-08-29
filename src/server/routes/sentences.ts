import { Router } from 'express';
import { gradeSentence } from '../services/grade-sentence.js';
import { referenceFor, shuffledPool } from '../services/sentence-pool.js';
import { sentenceMatches } from '../../shared/sentence-match.js';
import type { SentenceGradeRequest, SentenceQuestionsResponse } from '../../shared/types.js';

const router = Router();

/**
 * The whole pool, shuffled. One request per session is what lets the client work through every
 * sentence before repeating one without anything having to be stored.
 */
router.get('/questions', (_req, res) => {
  const response: SentenceQuestionsResponse = { questions: shuffledPool() };
  res.json(response);
});

router.post('/grade', async (req, res) => {
  const { hanzi, answer } = (req.body ?? {}) as SentenceGradeRequest;

  if (typeof hanzi !== 'string' || hanzi.trim() === '') {
    return res.status(400).json({ error: 'hanzi is required' });
  }
  if (typeof answer !== 'string' || answer.trim() === '') {
    return res.status(400).json({ error: 'answer is required' });
  }

  const reference = referenceFor(hanzi);
  if (!reference) {
    return res.status(404).json({ error: `No practice sentence for "${hanzi}"` });
  }

  // The client checks this too, so an exact answer never waits on the network; checking again
  // here keeps the endpoint honest on its own and means nobody is billed for typing the answer
  if (sentenceMatches(answer, reference.hanzi)) {
    return res.json({ verdict: 'correct', explanation: '' });
  }

  try {
    res.json(await gradeSentence(reference.english, reference.hanzi, hanzi, answer.trim()));
  } catch (error) {
    console.error(`Grading failed for "${hanzi}":`, error);
    res.status(500).json({ error: 'Grading failed' });
  }
});

export default router;
