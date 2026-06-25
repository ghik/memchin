import { Router } from 'express';
import {
  getAllWords,
  getMaxBucket,
  getWordByHanzi,
  getWordCount,
  insertWords,
  updateWord,
  saveDb,
  invalidateWordCache,
  deleteProgress,
  resetProgressBucket,
  searchLearnedWords,
  searchQueuedWords,
  setAllProgressCharacterOnly,
  setAllProgressWordMode,
  setQueuedAt,
  setCharQueuedAt,
  clearQueuedAt,
  clearCharQueuedAt,
  updateWordExamples,
} from '../db.js';
import { lookupFiltered } from '../services/cedict.js';
import { normalizePinyinInput, splitPinyin } from '../../shared/pinyin.js';
import { generateExamples } from '../../scripts/generate-examples.js';
import { deleteAudio, generateSpeech } from '../services/tts.js';
import { decomposeWord } from '../services/ids.js';
import { lookupChar, loadWordFrequencyData } from '../services/hanzi-freq.js';
import type { Example } from '../../shared/types.js';

function resetCharsForWord(hanzi: string): void {
  const chars = [...hanzi];
  if (chars.length <= 1) {
    return;
  }
  for (const char of chars) {
    if (!getWordByHanzi(char)) {
      continue;
    }
    setCharQueuedAt(char);
  }
}

const router = Router();

router.get('/', (req, res) => {
  const words = getAllWords();
  res.json({ words, total: words.size });
});

router.get('/count', (req, res) => {
  const count = getWordCount();
  res.json({ count });
});

router.get('/search', (req, res) => {
  const validMode = (v: unknown) =>
    ['prefix', 'contains', 'suffix', 'exact'].includes(v as string) ? (v as import('../../shared/types.js').MatchMode) : undefined;
  const query = {
    hanzi: (req.query.hanzi as string ?? '').trim(),
    hanziMode: validMode(req.query.hanziMode),
    pinyin: (req.query.pinyin as string ?? '').trim(),
    pinyinMode: validMode(req.query.pinyinMode),
    english: (req.query.english as string ?? '').trim(),
  };
  const learned = searchLearnedWords(query).map(({ word, progress }) => {
    const pinyin = splitPinyin(word.pinyin);
    return {
      word: { ...word, pinyin, breakdown: decomposeWord(word.hanzi, word.pinyin) },
      progress,
      queued: false,
    };
  });
  const queued = searchQueuedWords(query).map(({ word }) => {
    const pinyin = splitPinyin(word.pinyin);
    return {
      word: { ...word, pinyin, breakdown: decomposeWord(word.hanzi, word.pinyin) },
      progress: [],
      queued: true,
    };
  });
  res.json([...learned, ...queued]);
});

router.get('/lookup/:hanzi', (req, res) => {
  const hanzi = decodeURIComponent(req.params.hanzi);
  const entries = lookupFiltered(hanzi);
  const existing = getWordByHanzi(hanzi) ?? null;
  const maxBucket = existing ? getMaxBucket(hanzi) : 0;
  const breakdown = decomposeWord(hanzi, existing?.pinyin);
  const freq = loadWordFrequencyData();
  const wordRank = freq.get(hanzi) ?? null;
  const charRank = [...hanzi].length === 1 ? wordRank : null;
  res.json({ entries, existing, maxBucket, breakdown, wordRank, charRank });
});

router.post('/', async (req, res) => {
  try {
    const { hanzi, pinyin, english, polish, categories } = req.body;

    if (!hanzi || !pinyin || !english || !Array.isArray(english) || english.length === 0) {
      return res
        .status(400)
        .json({ error: 'hanzi, pinyin, english (array), and categories are required' });
    }
    const polishArr: string[] = Array.isArray(polish) ? polish : [];

    // Check for duplicate
    if (getWordByHanzi(hanzi)) {
      return res.status(409).json({ error: `Word "${hanzi}" already exists` });
    }

    const normalizedPinyin = normalizePinyinInput(pinyin);

    // Look up frequency rank
    const freq = loadWordFrequencyData();
    const wordFrequencyRank = freq.get(hanzi);

    // For single-char words, hanzi rank = word rank
    const hanziFrequencyRank = [...hanzi].length === 1 ? wordFrequencyRank : undefined;

    // Insert word
    insertWords([
      {
        hanzi,
        pinyin: normalizedPinyin,
        english,
        polish: polishArr,
        hskLevel: 0,
        wordFrequencyRank,
        hanziFrequencyRank,
        examples: [],
        translatable: true,
        categories: categories || [],
        manual: true,
      },
    ]);

    setQueuedAt(hanzi);

    // Auto-add individual characters for multi-character words
    const chars = [...hanzi];
    const charsAdded: { hanzi: string; pinyin: string; english: string[]; wordFrequencyRank?: number }[] = [];
    if (chars.length > 1) {
      const wordSyllables = normalizedPinyin.split(/\s+/);
      const cjkRegex = /[一-鿿㐀-䶿]/;
      const charsToAdd = [];
      let syllableIdx = 0;
      for (const char of chars) {
        if (!cjkRegex.test(char)) {
          continue;
        }
        const charPinyin = wordSyllables[syllableIdx++];
        if (getWordByHanzi(char)) {
          continue;
        }
        const charInfo = lookupChar(char);
        if (!charInfo) {
          continue;
        }
        charsToAdd.push({
          hanzi: char,
          pinyin: charPinyin ?? charInfo.pinyin,
          english: charInfo.english,
          hskLevel: 0,
          wordFrequencyRank: freq.get(char),
          hanziFrequencyRank: charInfo.rank,
          examples: [] as Example[],
          translatable: true,
          categories: [] as string[],
          manual: true,
        });
      }
      if (charsToAdd.length > 0) {
        insertWords(charsToAdd);
        charsAdded.push(...charsToAdd);
      }
      resetCharsForWord(hanzi);
    }

    saveDb();

    // Generate examples and audio for main word
    const exampleMap = await generateExamples([
      { hanzi, pinyin: normalizedPinyin, english, hskLevel: 0 },
    ]);
    const examples = exampleMap.get(hanzi) || [];
    updateWordExamples(hanzi, examples);
    await generateSpeech(hanzi, normalizedPinyin);
    for (const ex of examples) {
      await generateSpeech(ex.hanzi, ex.pinyin);
    }

    // Generate examples and audio for auto-added characters
    for (const w of charsAdded) {
      if (w.wordFrequencyRank) {
        const charExampleMap = await generateExamples([
          { hanzi: w.hanzi, pinyin: w.pinyin, english: w.english, hskLevel: 0 },
        ]);
        const charExamples = charExampleMap.get(w.hanzi) || [];
        updateWordExamples(w.hanzi, charExamples);
        for (const ex of charExamples) {
          await generateSpeech(ex.hanzi, ex.pinyin);
        }
      }
      await generateSpeech(w.hanzi, w.pinyin);
    }

    invalidateWordCache();

    const word = getWordByHanzi(hanzi);
    res.json(word);
  } catch (error) {
    console.error('Failed to add word:', error);
    res.status(500).json({ error: 'Failed to add word' });
  }
});

router.put('/:hanzi', (req, res) => {
  try {
    const hanzi = decodeURIComponent(req.params.hanzi);
    const { pinyin, english, polish, categories, queueAsNew } = req.body;

    if (!pinyin || !english || !Array.isArray(english) || english.length === 0) {
      return res
        .status(400)
        .json({ error: 'pinyin, english (array), and categories are required' });
    }
    const polishArr: string[] = Array.isArray(polish) ? polish : [];

    const existing = getWordByHanzi(hanzi);
    if (!existing) {
      return res.status(404).json({ error: `Word "${hanzi}" not found` });
    }

    const normalizedPinyin = normalizePinyinInput(pinyin);

    updateWord(hanzi, normalizedPinyin, english, polishArr, categories || []);
    if (queueAsNew) {
      setQueuedAt(hanzi);
      resetCharsForWord(hanzi);
    }

    const word = getWordByHanzi(hanzi);
    res.json(word);
  } catch (error) {
    console.error('Failed to update word:', error);
    res.status(500).json({ error: 'Failed to update word' });
  }
});

router.delete('/:hanzi/progress', (req, res) => {
  const hanzi = decodeURIComponent(req.params.hanzi);
  const existing = getWordByHanzi(hanzi);
  if (!existing) {
    return res.status(404).json({ error: `Word "${hanzi}" not found` });
  }
  const mode = req.query.mode as string | undefined;
  deleteProgress(hanzi, mode);
  res.json({ ok: true });
});

router.post('/:hanzi/reset-bucket', (req, res) => {
  const hanzi = decodeURIComponent(req.params.hanzi);
  const { mode, toCharacterModeOnly } = req.body as { mode: string; toCharacterModeOnly?: boolean };
  if (!mode) {
    return res.status(400).json({ error: 'mode is required' });
  }
  const existing = getWordByHanzi(hanzi);
  if (!existing) {
    return res.status(404).json({ error: `Word "${hanzi}" not found` });
  }
  resetProgressBucket(hanzi, mode, toCharacterModeOnly);
  res.json({ ok: true });
});

router.post('/:hanzi/make-char-only', (req, res) => {
  try {
    const hanzi = decodeURIComponent(req.params.hanzi);
    const existing = getWordByHanzi(hanzi);
    if (!existing) {
      return res.status(404).json({ error: `Word "${hanzi}" not found` });
    }
    if ([...hanzi].length !== 1) {
      return res.status(400).json({ error: 'Only single-character entries can be marked character-only' });
    }
    const changed = setAllProgressCharacterOnly(hanzi);
    invalidateWordCache();
    res.json({ ok: true, changed });
  } catch (error) {
    console.error('Failed to mark progress char-only:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to mark progress char-only' });
  }
});

router.post('/:hanzi/make-word-mode', (req, res) => {
  try {
    const hanzi = decodeURIComponent(req.params.hanzi);
    const existing = getWordByHanzi(hanzi);
    if (!existing) {
      return res.status(404).json({ error: `Word "${hanzi}" not found` });
    }
    if ([...hanzi].length !== 1) {
      return res.status(400).json({ error: 'Only single-character entries can be promoted to word mode' });
    }
    const changed = setAllProgressWordMode(hanzi);
    invalidateWordCache();
    res.json({ ok: true, changed });
  } catch (error) {
    console.error('Failed to promote progress to word mode:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to promote progress to word mode' });
  }
});

router.post('/:hanzi/regenerate-audio', async (req, res) => {
  try {
    const hanzi = decodeURIComponent(req.params.hanzi);
    const existing = getWordByHanzi(hanzi);
    if (!existing) {
      return res.status(404).json({ error: `Word "${hanzi}" not found` });
    }
    deleteAudio(existing.hanzi);
    await generateSpeech(existing.hanzi, existing.pinyin);
    for (const ex of existing.examples ?? []) {
      deleteAudio(ex.hanzi);
      await generateSpeech(ex.hanzi, ex.pinyin);
    }
    res.json(existing);
  } catch (error) {
    console.error('Failed to regenerate audio:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to regenerate audio' });
  }
});

router.post('/:hanzi/regenerate-examples', async (req, res) => {
  try {
    const hanzi = decodeURIComponent(req.params.hanzi);
    const existing = getWordByHanzi(hanzi);
    if (!existing) {
      return res.status(404).json({ error: `Word "${hanzi}" not found` });
    }
    const exampleMap = await generateExamples([
      { hanzi: existing.hanzi, pinyin: existing.pinyin, english: existing.english, hskLevel: existing.hskLevel },
    ]);
    const examples = exampleMap.get(existing.hanzi) ?? [];
    updateWordExamples(existing.hanzi, examples);
    invalidateWordCache();
    for (const ex of examples) {
      await generateSpeech(ex.hanzi, ex.pinyin);
    }
    const word = getWordByHanzi(hanzi);
    res.json(word);
  } catch (error) {
    console.error('Failed to regenerate examples:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to regenerate examples' });
  }
});

router.post('/:hanzi/clear-queued', (req, res) => {
  const hanzi = decodeURIComponent(req.params.hanzi);
  const { characterMode } = req.body as { characterMode: boolean };
  if (!getWordByHanzi(hanzi)) {
    return res.status(404).json({ error: `Word "${hanzi}" not found` });
  }
  if (characterMode) {
    clearCharQueuedAt(hanzi);
  } else {
    clearQueuedAt(hanzi);
  }
  saveDb();
  res.json({ ok: true });
});

router.get('/:hanzi', (req, res) => {
  const hanzi = decodeURIComponent(req.params.hanzi);
  const word = getWordByHanzi(hanzi);
  if (!word) {
    return res.status(404).json({ error: 'Word not found' });
  }
  res.json(word);
});

export default router;
