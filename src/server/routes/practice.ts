import { Router } from 'express';
import type {
  PracticeMode,
  PracticeQuestion,
  StartRequest,
  StartResponse,
  AnswerRequest,
  AnswerResponse,
  CompleteRequest,
  CompleteResponse,
  Word,
} from '../../shared/types.js';
import {
  getWordsForPractice,
  getStats,
  saveDb,
  getProgress,
  getWordById,
  isAmbiguousTranslation,
} from '../db.js';
import { updateProgress } from '../services/srs.js';
import { pinyinMatches, englishMatches, hanziMatches } from '../services/pinyin.js';

const router = Router();

function createQuestion(word: Word, mode: PracticeMode): PracticeQuestion {
  const progress = getProgress(word.id, mode);
  const bucket = progress?.bucket ?? null;

  switch (mode) {
    case 'pinyin':
      return {
        word,
        prompt: word.hanzi,
        acceptedAnswers: [word.pinyinNumbered],
        bucket,
      };
    case 'english':
      return {
        word,
        prompt: word.hanzi,
        acceptedAnswers: word.english,
        bucket,
      };
    case 'hanzi':
      return {
        word,
        prompt: word.english.join(', '),
        acceptedAnswers: [word.hanzi],
        bucket,
      };
  }
}

router.post('/start', (req, res) => {
  const { count, mode } = req.body as StartRequest;

  if (!count || !mode) {
    return res.status(400).json({ error: 'count and mode are required' });
  }

  if (!['pinyin', 'english', 'hanzi'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  const words = getWordsForPractice(mode, count);

  if (words.length === 0) {
    return res.status(400).json({ error: 'No words available for practice' });
  }

  const questions = words.map((word) => createQuestion(word, mode));
  const response: StartResponse = { questions };
  res.json(response);
});

router.post('/answer', (req, res) => {
  const { mode, wordId, answer } = req.body as AnswerRequest;

  const word = getWordById(wordId);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }

  let correct: boolean;
  let synonym = false;

  switch (mode) {
    case 'pinyin':
      correct = pinyinMatches(answer, word.pinyin);
      break;
    case 'english':
      correct = englishMatches(answer, word.english);
      break;
    case 'hanzi':
      const isExactMatch = hanziMatches(answer, word.hanzi);
      const isSynonym = !isExactMatch && isAmbiguousTranslation(word.english);
      correct = isExactMatch;
      synonym = isSynonym;
      break;
  }

  const response: AnswerResponse = {
    correct,
    correctAnswers:
      mode === 'hanzi' ? [word.hanzi] : mode === 'pinyin' ? [word.pinyinNumbered] : word.english,
    ...(synonym && { synonym: true }),
  };
  res.json(response);
});

router.post('/complete', (req, res) => {
  const { mode, results } = req.body as CompleteRequest;

  let newWordsLearned = 0;

  for (const result of results) {
    updateProgress(result.wordId, mode, result.correctFirstTry);
    if (result.correctFirstTry) {
      newWordsLearned++;
    }
  }
  saveDb();

  const response: CompleteResponse = {
    wordsReviewed: results.length,
    newWordsLearned,
  };
  res.json(response);
});

router.get('/stats', (req, res) => {
  const modes: PracticeMode[] = ['pinyin', 'english', 'hanzi'];
  const stats = modes.map((mode) => ({
    mode,
    ...getStats(mode),
  }));
  res.json(stats);
});

export default router;
