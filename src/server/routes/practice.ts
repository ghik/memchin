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
  getWordsForReview,
  getNewWords,
  getStats,
  saveDb,
  getProgress,
  getWordByHanzi,
  isAmbiguousTranslation,
  getLabelsForWord,
} from '../db.js';
import { updateProgress } from '../services/srs.js';
import { pinyinMatches, englishMatches, hanziMatches, toNumberedPinyin } from '../services/pinyin.js';
import { getCharacterBreakdown } from '../services/cedict.js';

const router = Router();

function enrichWord(word: Word): Word {
  return {
    ...word,
    breakdown: getCharacterBreakdown(word.hanzi, word.pinyin),
    labels: getLabelsForWord(word.hanzi),
  };
}

function createQuestion(word: Word, mode: PracticeMode): PracticeQuestion {
  const progress = getProgress(word.hanzi, mode);
  const bucket = progress?.bucket ?? null;
  const wordWithBreakdown = enrichWord(word);

  switch (mode) {
    case 'hanzi2pinyin':
      return {
        word: wordWithBreakdown,
        prompt: word.hanzi,
        acceptedAnswers: [toNumberedPinyin(word.pinyin)],
        bucket,
      };
    case 'hanzi2english':
      return {
        word: wordWithBreakdown,
        prompt: word.hanzi,
        acceptedAnswers: word.english,
        bucket,
      };
    case 'english2hanzi':
      return {
        word: wordWithBreakdown,
        prompt: word.english.join(', '),
        acceptedAnswers: [word.hanzi],
        bucket,
      };
    case 'english2pinyin':
      return {
        word: wordWithBreakdown,
        prompt: word.english.join(', '),
        acceptedAnswers: [toNumberedPinyin(word.pinyin)],
        bucket,
      };
  }
}

router.post('/start', (req, res) => {
  const { count, mode, wordSelection, label } = req.body as StartRequest;

  if (!count || !mode) {
    return res.status(400).json({ error: 'count and mode are required' });
  }

  if (!['hanzi2pinyin', 'hanzi2english', 'english2hanzi', 'english2pinyin'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }

  let words: Word[];
  switch (wordSelection) {
    case 'new':
      words = getNewWords(mode, count, label);
      break;
    case 'review':
      words = getWordsForReview(mode, count, label);
      break;
    default:
      words = getWordsForPractice(mode, count, label);
      break;
  }

  if (words.length === 0) {
    return res.status(400).json({ error: 'No words available for practice' });
  }

  const questions = words.map((word) => createQuestion(word, mode));
  const response: StartResponse = { questions };
  res.json(response);
});

router.post('/answer', (req, res) => {
  const { mode, hanzi, answer } = req.body as AnswerRequest;

  const word = getWordByHanzi(hanzi);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }

  let correct: boolean;
  let synonym = false;

  switch (mode) {
    case 'hanzi2pinyin':
      correct = pinyinMatches(answer, word.pinyin);
      break;
    case 'hanzi2english':
      correct = englishMatches(answer, word.english);
      break;
    case 'english2hanzi':
      const isExactMatch = hanziMatches(answer, word.hanzi);
      const isSynonym = !isExactMatch && isAmbiguousTranslation(word.english);
      correct = isExactMatch;
      synonym = isSynonym;
      break;
    case 'english2pinyin':
      correct = pinyinMatches(answer, word.pinyin);
      break;
  }

  const response: AnswerResponse = {
    correct,
    correctAnswers:
      mode === 'english2hanzi' ? [word.hanzi] : (mode === 'hanzi2pinyin' || mode === 'english2pinyin') ? [toNumberedPinyin(word.pinyin)] : word.english,
    synonym,
  };
  res.json(response);
});

router.post('/complete', (req, res) => {
  const { mode, results } = req.body as CompleteRequest;

  let newWordsLearned = 0;

  for (const result of results) {
    updateProgress(result.hanzi, mode, result.correctFirstTry);
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
  const modes: PracticeMode[] = ['hanzi2pinyin', 'hanzi2english', 'english2hanzi', 'english2pinyin'];
  const stats = modes.map((mode) => ({
    mode,
    ...getStats(mode),
  }));
  res.json(stats);
});

export default router;
