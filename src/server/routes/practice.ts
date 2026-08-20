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

/**
 * Does the answer, already normalized, read as `candidate`? A word of more than one character
 * gets the same slack on its last syllable wherever it is matched — the tone may be left off,
 * or added to a neutral one, since dictionaries disagree about those themselves. The word being
 * asked about is matched exactly first, so only there does the slack mean "close, try again";
 * for a synonym the question is simply whether the learner typed that word.
 */
function readsAs(normalizedAnswer: string, candidate: Word): boolean {
  const expected = normalizePinyin(candidate.pinyin);
  return (
    normalizedAnswer === expected ||
    ([...candidate.hanzi].length > 1 && lastNeutralToneMismatch(normalizedAnswer, expected))
  );
}

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
  const { count, mode, wordSelection, categories, excludedCategories, characterMode, hanziList } =
    req.body as StartRequest;
  const excluded = excludedCategories ?? [];

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
        words = getWordsForReview(mode, count, categories, excluded, characterMode, false);
        break;
      case 'random':
        words = getWordsForReview(mode, count, categories, excluded, characterMode, true);
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
      synonym = !correct && readsAs(normalizePinyin(answer), word);
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
        if (readsAs(normalizedAnswer, word)) {
          synonym = true;
        } else {
          // Check if the typed pinyin matches a registered hanzi synonym
          const synonymHanzis = getHanziSynonymHanzis(word.hanzi);
          for (const sh of synonymHanzis) {
            const synWord = getWordByHanzi(sh);
            if (synWord && readsAs(normalizedAnswer, synWord)) {
              synonym = true;
              break;
            }
          }
          // Check if the typed pinyin matches another word with the same English translation
          if (!synonym && isAmbiguousTranslation(word.english)) {
            for (const w of getWordsWithSameEnglish(word.hanzi, word.english)) {
              if (readsAs(normalizedAnswer, w)) {
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

function parseCategoryList(value: unknown): string[] {
  return typeof value === 'string' && value.length > 0 ? value.split(',') : [];
}

router.get('/preview', (req, res) => {
  const mode = req.query.mode as PracticeMode;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const categories = parseCategoryList(req.query.categories);
  const excludedCategories = parseCategoryList(req.query.excludedCategories);
  const characterMode = req.query.characterMode === 'true';
  const reverse = req.query.reverse === 'true';

  if (
    !mode ||
    !['hanzi2pinyin', 'english2hanzi', 'english2pinyin'].includes(mode)
  ) {
    return res.status(400).json({ error: 'Valid mode is required' });
  }

  const words = getNewWords(mode, limit, categories, excludedCategories, characterMode, offset, reverse).map(enrichWord);
  const total = getNewWordsCount(mode, categories, excludedCategories, characterMode);
  const learnedElsewhere = getLearnedElsewhere(mode, categories, excludedCategories, characterMode);
  res.json({ words, total, learnedElsewhere });
});

router.get('/due-count', (req, res) => {
  const mode = req.query.mode as PracticeMode;
  const categories = parseCategoryList(req.query.categories);
  const excludedCategories = parseCategoryList(req.query.excludedCategories);
  const characterMode = req.query.characterMode === 'true';

  if (
    !mode ||
    !['hanzi2pinyin', 'english2hanzi', 'english2pinyin'].includes(mode)
  ) {
    return res.status(400).json({ error: 'Valid mode is required' });
  }

  const count = getDueCount(mode, categories, excludedCategories, characterMode);
  res.json({ count });
});

router.get('/stats', (req, res) => {
  const categories = parseCategoryList(req.query.categories);
  const excludedCategories = parseCategoryList(req.query.excludedCategories);
  const modes: PracticeMode[] = [
    'hanzi2pinyin',
    'english2hanzi',
    'english2pinyin',
  ];
  const stats = modes.flatMap((mode) =>
    [false, true].map((characterMode) => ({
      mode,
      characterMode,
      ...getStats(mode, categories, excludedCategories, characterMode),
      newWordsCount: getNewWordsCount(mode, categories, excludedCategories, characterMode),
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
  const categories = parseCategoryList(req.query.categories);
  const excludedCategories = parseCategoryList(req.query.excludedCategories);
  const characterMode = req.query.characterMode === 'true';

  if (
    !mode ||
    !['hanzi2pinyin', 'english2hanzi', 'english2pinyin'].includes(mode)
  ) {
    return res.status(400).json({ error: 'Valid mode is required' });
  }

  const words = getUnqueuedWords(mode, categories, excludedCategories, characterMode, limit, offset).map(enrichWord);
  const total = getUnqueuedWordsCount(mode, categories, excludedCategories, characterMode);
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
