import express, { Router } from 'express';
import type {
  AnswerRequest,
  AnswerResponse,
  CompleteRequest,
  CompleteResponse,
  PracticeMode,
  PracticeQuestion,
  StartRequest,
  StartResponse,
  Word,
} from '../../shared/types.js';
import {
  addHanziSynonym,
  getDueCount,
  getHanziSynonymHanzis,
  getLearnedWordsContaining,
  getNewWords,
  getNewWordsCount,
  getProgress,
  getStats,
  getUnqueuedWords,
  getUnqueuedWordsCount,
  getWordByHanzi,
  getWordsForReview,
  incrementAnswerCounts,
  getWordsWithSameEnglish,
  isAmbiguousTranslation,
  isHanziSynonym,
  saveDb,
} from '../db.js';
import { getLearnedElsewhere, setQueuedAt, setCharQueuedAt, upsertProgress } from '../db.js';
import { calculateNextEligible, updateProgress } from '../services/srs.js';
import {
  hanziMatches,
  lastNeutralToneMismatch,
  normalizePinyin,
  pinyinMatches,
  toNumberedPinyin,
} from '../../shared/pinyin.js';
import { decomposeWord } from '../services/ids.js';
import { assessPronunciation, isSpeechAssessAvailable } from '../services/speech-assess.js';

const router = Router();

function enrichWord(word: Word): Word {
  return {
    ...word,
    breakdown: decomposeWord(word.hanzi, word.pinyin),
  };
}

function createQuestion(word: Word, mode: PracticeMode, characterMode: boolean): PracticeQuestion {
  const progress = getProgress(word.hanzi, mode);
  const bucket = progress?.bucket ?? null;
  const wordWithBreakdown = enrichWord(word);
  const containingWords = characterMode ? getLearnedWordsContaining(word.hanzi) : [];

  switch (mode) {
    case 'hanzi2pinyin':
      return {
        word: wordWithBreakdown,
        prompt: word.hanzi,
        acceptedAnswers: [toNumberedPinyin(word.pinyin)],
        bucket,
        containingWords,
      };
    case 'english2hanzi':
      return {
        word: wordWithBreakdown,
        prompt: word.english.join(', '),
        acceptedAnswers: [word.hanzi],
        bucket,
        containingWords,
      };
    case 'english2pinyin':
      return {
        word: wordWithBreakdown,
        prompt: word.english.join(', '),
        acceptedAnswers: [toNumberedPinyin(word.pinyin)],
        bucket,
        containingWords,
      };
  }
}

router.post('/start', (req, res) => {
  const { count, mode, wordSelection, categories, characterMode, hanziList } =
    req.body as StartRequest;

  if (
    !mode ||
    !['hanzi2pinyin', 'english2hanzi', 'english2pinyin'].includes(mode)
  ) {
    return res.status(400).json({ error: 'Valid mode is required' });
  }

  let words: Word[];

  if (hanziList && hanziList.length > 0) {
    words = hanziList.map((h) => getWordByHanzi(h)).filter((w): w is Word => w !== undefined);
  } else {
    if (!count) {
      return res.status(400).json({ error: 'count is required' });
    }
    switch (wordSelection) {
      case 'review':
        words = getWordsForReview(mode, count, categories, characterMode, false);
        break;
      case 'random':
        words = getWordsForReview(mode, count, categories, characterMode, true);
        break;
    }
  }

  if (words.length === 0) {
    return res.status(400).json({ error: 'No words available for practice' });
  }

  const questions = words.map((word) => createQuestion(word, mode, characterMode));
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
    case 'hanzi2pinyin': {
      correct = pinyinMatches(answer, word.pinyin);
      const na = normalizePinyin(answer);
      const ne = normalizePinyin(word.pinyin);
      synonym =
        !correct && word.hanzi.length > 1 && lastNeutralToneMismatch(na, ne);
      break;
    }
    case 'english2hanzi': {
      const isExactMatch = hanziMatches(answer, word.hanzi);
      correct = isExactMatch;
      synonym =
        !correct &&
        (isAmbiguousTranslation(word.english) || isHanziSynonym(answer, word.hanzi));
      break;
    }
    case 'english2pinyin': {
      const normalizedAnswer = normalizePinyin(answer);
      const normalizedExpected = normalizePinyin(word.pinyin);
      correct = normalizedAnswer === normalizedExpected;
      if (!correct) {
        if (word.hanzi.length > 1 && lastNeutralToneMismatch(normalizedAnswer, normalizedExpected)) {
          synonym = true;
        } else {
          // Check if the typed pinyin matches a registered hanzi synonym
          const synonymHanzis = getHanziSynonymHanzis(word.hanzi);
          for (const sh of synonymHanzis) {
            const synWord = getWordByHanzi(sh);
            if (synWord && normalizePinyin(synWord.pinyin) === normalizedAnswer) {
              synonym = true;
              break;
            }
          }
          // Check if the typed pinyin matches another word with the same English translation
          if (!synonym && isAmbiguousTranslation(word.english)) {
            for (const w of getWordsWithSameEnglish(word.hanzi, word.english)) {
              if (normalizePinyin(w.pinyin) === normalizedAnswer) {
                synonym = true;
                break;
              }
            }
          }
        }
      }
      break;
    }
  }

  const response: AnswerResponse = {
    correct,
    correctAnswers:
      mode === 'english2hanzi'
        ? [word.hanzi]
        : mode === 'hanzi2pinyin' || mode === 'english2pinyin'
          ? [toNumberedPinyin(word.pinyin)]
          : word.english,
    synonym,
  };
  res.json(response);
});

router.post('/hanzi-synonym', (req, res) => {
  const { hanzi, synonymHanzi } = req.body as { hanzi: string; synonymHanzi: string };

  if (!hanzi || !synonymHanzi) {
    return res.status(400).json({ error: 'hanzi and synonymHanzi are required' });
  }

  const word = getWordByHanzi(hanzi);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }

  const synWord = getWordByHanzi(synonymHanzi);
  if (!synWord) {
    return res.status(404).json({ error: 'Synonym word not found' });
  }

  addHanziSynonym(hanzi, synonymHanzi);
  res.json({ ok: true });
});

router.post('/complete', (req, res) => {
  const { mode, results, characterMode } = req.body as CompleteRequest;

  let newWordsLearned = 0;

  for (const result of results) {
    updateProgress(result.hanzi, mode, result.correctFirstTry, characterMode ?? false);
    incrementAnswerCounts(result.hanzi, mode, 1, result.incorrectCount);
    if (result.correctFirstTry) {
      newWordsLearned++;
    }
  }
  saveDb();

  const progress = results.map((r) => {
    const p = getProgress(r.hanzi, mode);
    return { hanzi: r.hanzi, bucket: p?.bucket ?? 0, nextEligible: p?.nextEligible ?? '' };
  });

  const response: CompleteResponse = {
    wordsReviewed: results.length,
    newWordsLearned,
    progress,
  };
  res.json(response);
});

router.get('/preview', (req, res) => {
  const mode = req.query.mode as PracticeMode;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const categories = req.query.categories ? (req.query.categories as string).split(',') : [];
  const characterMode = req.query.characterMode === 'true';
  const reverse = req.query.reverse === 'true';

  if (
    !mode ||
    !['hanzi2pinyin', 'english2hanzi', 'english2pinyin'].includes(mode)
  ) {
    return res.status(400).json({ error: 'Valid mode is required' });
  }

  const words = getNewWords(mode, limit, categories, characterMode, offset, reverse).map(enrichWord);
  const total = getNewWordsCount(mode, categories, characterMode);
  const learnedElsewhere = getLearnedElsewhere(mode, categories, characterMode);
  res.json({ words, total, learnedElsewhere });
});

router.get('/due-count', (req, res) => {
  const mode = req.query.mode as PracticeMode;
  const categories = req.query.categories ? (req.query.categories as string).split(',') : [];
  const characterMode = req.query.characterMode === 'true';

  if (
    !mode ||
    !['hanzi2pinyin', 'english2hanzi', 'english2pinyin'].includes(mode)
  ) {
    return res.status(400).json({ error: 'Valid mode is required' });
  }

  const count = getDueCount(mode, categories, characterMode);
  res.json({ count });
});

router.get('/stats', (req, res) => {
  const categories = req.query.categories ? (req.query.categories as string).split(',') : [];
  const modes: PracticeMode[] = [
    'hanzi2pinyin',
    'english2hanzi',
    'english2pinyin',
  ];
  const stats = modes.flatMap((mode) =>
    [false, true].map((characterMode) => ({
      mode,
      characterMode,
      ...getStats(mode, categories, characterMode),
      newWordsCount: getNewWordsCount(mode, categories, characterMode),
    }))
  );
  res.json(stats);
});

router.post('/speech-assess', express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (req, res) => {
  if (!isSpeechAssessAvailable()) {
    return res.status(501).json({ error: 'Speech assessment not configured' });
  }

  const hanzi = req.query.hanzi as string;
  const pcmBuffer = req.body as Buffer;
  if (!hanzi || !pcmBuffer?.length) {
    return res.status(400).json({ error: 'hanzi query param and audio body are required' });
  }

  try {
    const synonymHanzis = getHanziSynonymHanzis(hanzi);

    const [result, ...synResults] = await Promise.all([
      assessPronunciation(pcmBuffer, hanzi),
      ...synonymHanzis.map((syn) => assessPronunciation(pcmBuffer, syn)),
    ]);

    // Check if a synonym scored higher
    let bestSyn: { accuracyScore: number; synonym: string } | null = null;
    for (let i = 0; i < synResults.length; i++) {
      if (synResults[i].accuracyScore > result.accuracyScore &&
          (!bestSyn || synResults[i].accuracyScore > bestSyn.accuracyScore)) {
        bestSyn = { accuracyScore: synResults[i].accuracyScore, synonym: synonymHanzis[i] };
      }
    }

    if (bestSyn && result.accuracyScore < 50) {
      res.json(bestSyn);
    } else {
      res.json(result);
    }
  } catch (error) {
    console.error('Speech assessment failed:', error);
    res.status(500).json({ error: 'Speech assessment failed' });
  }
});

router.get('/unqueued', (req, res) => {
  const mode = req.query.mode as PracticeMode;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const categories = req.query.categories ? (req.query.categories as string).split(',') : [];
  const characterMode = req.query.characterMode === 'true';

  if (
    !mode ||
    !['hanzi2pinyin', 'english2hanzi', 'english2pinyin'].includes(mode)
  ) {
    return res.status(400).json({ error: 'Valid mode is required' });
  }

  const words = getUnqueuedWords(mode, categories, characterMode, limit, offset).map(enrichWord);
  const total = getUnqueuedWordsCount(mode, categories, characterMode);
  res.json({ words, total });
});

router.post('/queue-words', (req, res) => {
  const { hanzis, characterMode } = req.body as { hanzis: string[]; characterMode: boolean };
  if (!Array.isArray(hanzis) || hanzis.length === 0) {
    return res.status(400).json({ error: 'hanzis array is required' });
  }
  for (const hanzi of hanzis) {
    if (characterMode) {
      setCharQueuedAt(hanzi);
    } else {
      setQueuedAt(hanzi);
      for (const char of hanzi) {
        if (getWordByHanzi(char)) {
          setCharQueuedAt(char);
        }
      }
    }
  }
  saveDb();
  res.json({ ok: true });
});

router.post('/learn-now', (req, res) => {
  const { hanzis, mode, characterMode } = req.body as {
    hanzis: string[];
    mode: PracticeMode;
    characterMode: boolean;
  };
  if (!Array.isArray(hanzis) || hanzis.length === 0) {
    return res.status(400).json({ error: 'hanzis array is required' });
  }
  if (!mode || !['hanzi2pinyin', 'english2hanzi', 'english2pinyin'].includes(mode)) {
    return res.status(400).json({ error: 'Valid mode is required' });
  }
  for (const hanzi of hanzis) {
    if (characterMode) {
      setCharQueuedAt(hanzi);
    } else {
      setQueuedAt(hanzi);
      for (const char of hanzi) {
        if (getWordByHanzi(char)) {
          setCharQueuedAt(char);
        }
      }
    }
    upsertProgress(hanzi, mode, 0, calculateNextEligible(0), characterMode);
  }
  saveDb();
  res.json({ ok: true });
});

export default router;
