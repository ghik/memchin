import { Router } from 'express';
import { gradeSentence } from '../services/grade-sentence.js';
import { referenceFor, sentencePool, shuffledPool } from '../services/sentence-pool.js';
import { SENTENCE_ATTEMPT_OUTCOMES } from '../services/sentence-verdict.js';
import { recordSentenceAttempt } from '../db.js';
import { normalizeSentence } from '../../shared/sentence-match.js';
import type {
  SentenceAttemptRequest,
  SentenceGradeRequest,
  SentenceQuestionsResponse,
} from '../../shared/types.js';

const router = Router();

const DEFAULT_ROUND = 20;
/** A round longer than this is not a round; the cap is what keeps one request bounded */
const MAX_ROUND = 200;

/** How much material there is, for the screen that asks how much of it to do */
router.get('/pool-size', (_req, res) => {
  res.json({ total: sentencePool().length });
});

/**
 * A round's worth, shuffled. Drawn here rather than filtered on the client so a round costs only
 * what it asks for: the pool runs to thousands of sentences and sending all of them would be
 * paying megabytes for questions the round never reaches.
 */
router.get('/questions', (req, res) => {
  const count = Number(req.query.count ?? DEFAULT_ROUND);
  if (!Number.isInteger(count) || count < 1 || count > MAX_ROUND) {
    return res
      .status(400)
      .json({ error: `count must be a whole number between 1 and ${MAX_ROUND}` });
  }
  const response: SentenceQuestionsResponse = { questions: shuffledPool(count) };
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
