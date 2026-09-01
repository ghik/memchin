import { Router } from 'express';
import { generateSentences } from '../services/generate-sentences.js';
import { HSK_LEVELS } from '../services/generated-sentences.js';
import { gradeSentence } from '../services/grade-sentence.js';
import {
  anyQuestionFor,
  poolCounts,
  shuffledPool,
  writtenQuestion,
} from '../services/sentence-pool.js';
import {
  countUnpractisedGeneratedByLevel,
  getUnpractisedGeneratedSentences,
  saveGeneratedSentences,
} from '../db.js';
import { SENTENCE_ATTEMPT_OUTCOMES } from '../services/sentence-verdict.js';
import { generateSpeech } from '../services/tts.js';
import { recordSentenceAttempt } from '../db.js';

import { normalizeSentence } from '../../shared/sentence-match.js';
import type {
  GenerateSentencesRequest,
  SentenceAttemptRequest,
  SentenceGradeRequest,
  SentenceQuestionsResponse,
} from '../../shared/types.js';

const router = Router();

const DEFAULT_ROUND = 20;
/** A round longer than this is not a round; the cap is what keeps one request bounded */
const MAX_ROUND = 200;
/** Generated rounds are written in one call, and the wait grows with the number asked for */
const MAX_GENERATED_ROUND = 30;

/** How much material each choice offers, for the screen that asks what to practise */
router.get('/pool-size', (_req, res) => {
  res.json({ ...poolCounts(), written: countUnpractisedGeneratedByLevel() });
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
  const response: SentenceQuestionsResponse = {
    questions: shuffledPool(count, req.query.long === 'true', req.query.review === 'true'),
  };
  res.json(response);
});

/**
 * A round of sentences at chosen HSK levels, with nothing to do with the deck.
 *
 * Drawn first from the ones already written and never answered, and only then from the model,
 * for as many as are still wanted. Sentences are kept rather than thrown away after the round —
 * one answered wrong is a sentence to come back to like any other — and keeping them is what
 * makes most rounds a query rather than a wait.
 */
router.post('/generate', async (req, res) => {
  const { count, levels } = (req.body ?? {}) as GenerateSentencesRequest;

  if (!Number.isInteger(count) || count < 1 || count > MAX_GENERATED_ROUND) {
    return res
      .status(400)
      .json({ error: `count must be a whole number between 1 and ${MAX_GENERATED_ROUND}` });
  }
  if (
    !Array.isArray(levels) ||
    levels.length === 0 ||
    !levels.every((level) => HSK_LEVELS.includes(level))
  ) {
    return res.status(400).json({ error: `levels must be some of ${HSK_LEVELS.join(', ')}` });
  }

  try {
    const chosen = [...new Set(levels)].sort();
    const questions = getUnpractisedGeneratedSentences(chosen, count).map(writtenQuestion);
    if (questions.length < count) {
      const fresh = await generateSentences(count - questions.length, chosen);
      questions.push(...saveGeneratedSentences(fresh, chosen).map(writtenQuestion));
    }
    const response: SentenceQuestionsResponse = { questions };
    res.json(response);
  } catch (error) {
    console.error('Generating sentences failed:', error);
    res.status(500).json({ error: 'Could not write the sentences' });
  }
});

/**
 * Makes sure the reference has been spoken, so the client can play it.
 *
 * On demand rather than with the round: most of a round is never reached, and a sentence is only
 * worth the synthesis once its answer is in. The file is named by the sentence, as a word's is by
 * the word, so nothing else has to remember where it went.
 *
 * No pinyin is sent with it. A word's audio uses a phoneme tag to pin the exact reading, but a
 * sentence wants the voice's own phrasing and tone sandhi, which that would override.
 */
router.post('/audio', async (req, res) => {
  const { id } = (req.body ?? {}) as { id?: string };
  const question = typeof id === 'string' ? anyQuestionFor(id) : null;
  if (!question) {
    return res.status(404).json({ error: `No practice sentence "${id}"` });
  }

  try {
    await generateSpeech(question.reference.hanzi);
    res.json({ hanzi: question.reference.hanzi });
  } catch (error) {
    console.error(`Could not speak "${question.reference.hanzi}":`, error);
    res.status(500).json({ error: 'Could not generate the audio' });
  }
});

router.post('/grade', async (req, res) => {
  const { id, answer } = (req.body ?? {}) as SentenceGradeRequest;

  if (typeof id !== 'string' || id.trim() === '') {
    return res.status(400).json({ error: 'id is required' });
  }
  if (typeof answer !== 'string' || answer.trim() === '') {
    return res.status(400).json({ error: 'answer is required' });
  }

  const question = anyQuestionFor(id);
  if (!question) {
    return res.status(404).json({ error: `No practice sentence "${id}"` });
  }

  try {
    const { reference, hanzi } = question;
    res.json(await gradeSentence(reference.english, reference.hanzi, hanzi ?? '', answer.trim()));
  } catch (error) {
    console.error(`Grading failed for "${id}":`, error);
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
  const { id, answer, outcome, explanation, suggestion } = (req.body ??
    {}) as SentenceAttemptRequest;

  if (typeof id !== 'string' || id.trim() === '') {
    return res.status(400).json({ error: 'id is required' });
  }
  if (typeof answer !== 'string') {
    return res.status(400).json({ error: 'answer is required' });
  }
  if (!SENTENCE_ATTEMPT_OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `Unknown outcome "${outcome}"` });
  }

  const question = anyQuestionFor(id);
  if (!question) {
    return res.status(404).json({ error: `No practice sentence "${id}"` });
  }
  const { reference } = question;

  recordSentenceAttempt({
    // Empty for a sentence written to order: there is no word it was set for
    hanzi: question.hanzi ?? '',
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
