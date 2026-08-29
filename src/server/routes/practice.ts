import express, { Router } from 'express';
import type {
  AnswerRequest,
  AnswerResponse,
  CompleteRequest,
  CompleteResponse,
  PracticeAttempt,
  PracticeAttemptOutcome,
  PracticeAttemptReport,
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
  recordPracticeAttempts,
  getWordsWithSameEnglish,
  isAmbiguousTranslation,
  isHanziSynonym,
  saveDb,
} from '../db.js';
import { getLearnedElsewhere, setQueuedAt, setCharQueuedAt, upsertProgress } from '../db.js';
import { calculateNextEligible, updateProgress } from '../services/srs.js';
import { pickWords } from '../services/pick-words.js';
import { toStamp } from '../../shared/time.js';
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

/** The closed set, so a client sending nonsense cannot put nonsense in the history */
const PRACTICE_ATTEMPT_OUTCOMES: PracticeAttemptOutcome[] = [
  'correct',
  'incorrect',
  'synonym',
  'skipped',
];

router.post('/complete', (req, res) => {
  const { mode, results, characterMode, attempts } = req.body as CompleteRequest;

  // Read before anything is written: the history says what state each word was answered in,
  // and updateProgress below is about to move it on
  const bucketBefore = new Map<string, number | null>();
  for (const attempt of attempts ?? []) {
    if (!bucketBefore.has(attempt.hanzi)) {
      bucketBefore.set(attempt.hanzi, getProgress(attempt.hanzi, mode)?.bucket ?? null);
    }
  }

  let newWordsLearned = 0;

  for (const result of results) {
    updateProgress(result.hanzi, mode, result.correctFirstTry, characterMode ?? false);
    incrementAnswerCounts(result.hanzi, mode, 1, result.incorrectCount);
    if (result.correctFirstTry) {
      newWordsLearned++;
    }
  }

  const progress = results.map((r) => {
    const p = getProgress(r.hanzi, mode);
    return { hanzi: r.hanzi, bucket: p?.bucket ?? 0, nextEligible: p?.nextEligible ?? '' };
  });

  recordPracticeAttempts(practiceAttemptsToStore(mode, attempts, bucketBefore));
  saveDb();

  const response: CompleteResponse = {
    wordsReviewed: results.length,
    newWordsLearned,
    progress,
  };
  res.json(response);
});

/**
 * Turns the round's answers into rows, once the marking has been applied so the scheduling each
 * one led to is known.
 *
 * The answers arrive together at the end of the round rather than one by one, because that is
 * when a word's next date exists: practice marks a whole round at once, and until it does an
 * answer has not yet moved anything. A round abandoned halfway is therefore not recorded — it
 * never reached the server, and it never changed the schedule either.
 */
function practiceAttemptsToStore(
  mode: PracticeMode,
  attempts: PracticeAttemptReport[] | undefined,
  bucketBefore: Map<string, number | null>
): PracticeAttempt[] {
  const stored: PracticeAttempt[] = [];
  for (const attempt of attempts ?? []) {
    if (
      typeof attempt?.hanzi !== 'string' ||
      typeof attempt.answer !== 'string' ||
      !PRACTICE_ATTEMPT_OUTCOMES.includes(attempt.outcome)
    ) {
      continue;
    }
    // A word taken out of the round by a reset has no result of its own, so its answers keep
    // whatever the reset left it with
    const nextEligible = getProgress(attempt.hanzi, mode)?.nextEligible ?? '';
    const at = new Date(attempt.at);
    stored.push({
      at: toStamp(Number.isNaN(at.getTime()) ? new Date() : at),
      mode,
      hanzi: attempt.hanzi,
      bucket: bucketBefore.get(attempt.hanzi) ?? null,
      answer: attempt.answer,
      outcome: attempt.outcome,
      nextEligible,
    });
  }
  return stored;
}

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

/**
 * Which of the queued words to learn next, chosen by the AI from the same queue the preview
 * shows. The candidates are read here rather than posted up, so this cannot be asked about words
 * that are not really waiting, and the reply comes back as whole words the caller can display.
 *
 * Capped: one mode's queue runs past a thousand entries, and a list that long costs more to send
 * than the choice is worth. The cap bites in queue order, which is the order on screen.
 */
const PICK_CANDIDATE_CAP = 400;

const PRACTICE_MODES: PracticeMode[] = ['hanzi2pinyin', 'english2hanzi', 'english2pinyin'];

router.post('/pick-new', async (req, res) => {
  const { mode, categories, excludedCategories, characterMode, count, reverse } = req.body as {
    mode: PracticeMode;
    categories?: string[];
    excludedCategories?: string[];
    characterMode?: boolean;
    count?: number;
    reverse?: boolean;
  };

  if (!mode || !PRACTICE_MODES.includes(mode)) {
    return res.status(400).json({ error: 'Valid mode is required' });
  }
  const wanted = Number(count);
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > 50) {
    return res.status(400).json({ error: 'count must be a whole number between 1 and 50' });
  }

  const candidates = getNewWords(
    mode,
    PICK_CANDIDATE_CAP,
    categories ?? [],
    excludedCategories ?? [],
    characterMode ?? false,
    0,
    reverse ?? false
  );
  const total = getNewWordsCount(
    mode,
    categories ?? [],
    excludedCategories ?? [],
    characterMode ?? false
  );

  try {
    const byHanzi = new Map(candidates.map((word) => [word.hanzi, word]));
    const picked = await pickWords(candidates, wanted);
    res.json({
      // In the order they were picked, which is best first
      words: picked.map((hanzi) => enrichWord(byHanzi.get(hanzi)!)),
      considered: candidates.length,
      total,
    });
  } catch (error) {
    console.error('Picking words failed:', error);
    res.status(500).json({ error: 'Could not pick words' });
  }
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
