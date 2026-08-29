import { Router } from 'express';
import { gradeSentence } from '../services/grade-sentence.js';
import { referenceFor, shuffledPool } from '../services/sentence-pool.js';
import { SENTENCE_ATTEMPT_OUTCOMES } from '../services/sentence-verdict.js';
import { recordSentenceAttempt } from '../db.js';
import { normalizeSentence, sentenceMatches } from '../../shared/sentence-match.js';
import type {
  SentenceAttemptRequest,
  SentenceGradeRequest,
  SentenceQuestionsResponse,
} from '../../shared/types.js';

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

/**
 * Files one attempt away in the history.
 *
 * Reported by the client rather than written where the grading happens, because only the client
 * knows how an attempt actually ended: an exact answer never reaches the server at all, nor does
 * a skip, and an answer the grader passed can still be handed back for leaving the word out. The
 * question itself is looked up here rather than trusted from the request, so the record says what
 * was really asked.
 */
router.post('/attempt', (req, res) => {
  const { hanzi, answer, outcome, explanation, suggestion } = (req.body ??
    {}) as SentenceAttemptRequest;

  if (typeof hanzi !== 'string' || hanzi.trim() === '') {
    return res.status(400).json({ error: 'hanzi is required' });
  }
  if (typeof answer !== 'string') {
    return res.status(400).json({ error: 'answer is required' });
  }
  if (!SENTENCE_ATTEMPT_OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `Unknown outcome "${outcome}"` });
  }

  const reference = referenceFor(hanzi);
  if (!reference) {
    return res.status(404).json({ error: `No practice sentence for "${hanzi}"` });
  }

  recordSentenceAttempt({
    hanzi,
    english: reference.english,
    // In the form answers are compared against, so a line can be read without normalising it
    // again. Nothing is lost: the reference as written is still a lookup away by hanzi.
    reference: normalizeSentence(reference.hanzi),
    answer,
    outcome,
    ...(typeof explanation === 'string' && explanation !== '' ? { explanation } : {}),
    ...(typeof suggestion === 'string' && suggestion !== '' ? { suggestion } : {}),
  });
  // An empty 204 would make the client's JSON parse fail on a request that in fact succeeded
  res.json({ recorded: true });
});

export default router;
