import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
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
import { getWordsForPractice, getStats } from '../db.js';
import { updateProgress } from '../services/srs.js';
import { pinyinMatches, englishMatches, hanziMatches, toNumberedPinyin } from '../services/pinyin.js';

const router = Router();

// In-memory session storage (for simplicity)
const sessions = new Map<string, { mode: PracticeMode; questions: PracticeQuestion[] }>();

function createQuestion(word: Word, mode: PracticeMode): PracticeQuestion {
  switch (mode) {
    case 'pinyin':
      return {
        word,
        prompt: word.hanzi,
        acceptedAnswers: [word.pinyin, word.pinyinNumbered],
      };
    case 'english':
      return {
        word,
        prompt: word.hanzi,
        acceptedAnswers: word.english,
      };
    case 'hanzi':
      return {
        word,
        prompt: word.english.join(' / '),
        acceptedAnswers: [word.hanzi],
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

  const questions = words.map(word => createQuestion(word, mode));
  const sessionId = uuidv4();

  sessions.set(sessionId, { mode, questions });

  // Clean up old sessions (keep last 100)
  if (sessions.size > 100) {
    const keys = Array.from(sessions.keys());
    for (let i = 0; i < keys.length - 100; i++) {
      sessions.delete(keys[i]);
    }
  }

  const response: StartResponse = { sessionId, questions };
  res.json(response);
});

router.post('/answer', (req, res) => {
  const { sessionId, wordId, answer } = req.body as AnswerRequest;

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const question = session.questions.find(q => q.word.id === wordId);
  if (!question) {
    return res.status(404).json({ error: 'Word not in session' });
  }

  let correct: boolean;
  switch (session.mode) {
    case 'pinyin':
      correct = pinyinMatches(answer, question.word.pinyin);
      break;
    case 'english':
      correct = englishMatches(answer, question.word.english);
      break;
    case 'hanzi':
      correct = hanziMatches(answer, question.word.hanzi);
      break;
  }

  const response: AnswerResponse = {
    correct,
    correctAnswers: question.acceptedAnswers,
  };
  res.json(response);
});

router.post('/complete', (req, res) => {
  const { sessionId, results } = req.body as CompleteRequest;

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  let newWordsLearned = 0;

  for (const result of results) {
    updateProgress(result.wordId, session.mode, result.correctFirstTry);
    if (result.correctFirstTry) {
      newWordsLearned++;
    }
  }

  sessions.delete(sessionId);

  const response: CompleteResponse = {
    wordsReviewed: results.length,
    newWordsLearned,
  };
  res.json(response);
});

router.get('/stats', (req, res) => {
  const modes: PracticeMode[] = ['pinyin', 'english', 'hanzi'];
  const stats = modes.map(mode => ({
    mode,
    ...getStats(mode),
  }));
  res.json(stats);
});

export default router;
