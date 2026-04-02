import { Router } from 'express';
import {
  getAllWords,
  getMaxBucket,
  getWordByHanzi,
  getWordCount,
  insertWords,
  updateWord,
  upsertProgress,
  saveDb,
  invalidateWordCache,
  deleteProgress,
  setResetAt,
  updateWordExamples,
} from '../db.js';
import { lookupFiltered } from '../services/cedict.js';
import { numberedToToneMarked, splitPinyin } from '../services/pinyin.js';
import { generateExamples } from '../../scripts/generate-examples.js';
import { generateSpeech } from '../services/tts.js';
import { decomposeWord } from '../services/ids.js';
import { lookupChar, loadWordFrequencyData } from '../services/hanzi-freq.js';
import type { Example, PracticeMode } from '../../shared/types.js';

const ALL_MODES: PracticeMode[] = [
  'hanzi2pinyin',
  'english2hanzi',
  'english2pinyin',
];

function resetToBucket0(hanzi: string) {
  const hasProgress = getMaxBucket(hanzi) !== null;
  if (hasProgress) {
    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    for (const mode of ALL_MODES) {
      upsertProgress(hanzi, mode, 0, now, false);
    }
  } else {
    setResetAt(hanzi);
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
    const { hanzi, pinyin, english, categories, resetBucket } = req.body;

    if (!hanzi || !pinyin || !english || !Array.isArray(english) || english.length === 0) {
      return res
        .status(400)
        .json({ error: 'hanzi, pinyin, english (array), and categories are required' });
    }

    // Check for duplicate
    if (getWordByHanzi(hanzi)) {
      return res.status(409).json({ error: `Word "${hanzi}" already exists` });
    }

    // Normalize pinyin: detect numbered format (contains digits 1-4) and convert
    const hasDigitTones = /[1-4]/.test(pinyin);
    let normalizedPinyin: string;
    if (hasDigitTones) {
      // Numbered format like "ge4ren2" or "ge4ren2 hao3" — preserve only the spaces
      // that were in the original by converting each space-delimited token independently
      normalizedPinyin = pinyin
        .split(/\s+/)
        .map((token) => numberedToToneMarked(token.replace(/([1-5])(?=[a-zA-Z])/g, '$1 ')).replace(/\s+/g, ''))
        .join(' ');
    } else {
      // Already tone-marked — just split
      normalizedPinyin = splitPinyin(pinyin);
    }

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
        hskLevel: 0,
        wordFrequencyRank,
        hanziFrequencyRank,
        examples: [],
        translatable: true,
        categories: categories || [],
        manual: true,
      },
    ]);

    if (resetBucket) {
      resetToBucket0(hanzi);
    }

    // Auto-add individual characters for multi-character words
    const chars = [...hanzi];
    const charsAdded: { hanzi: string; pinyin: string; english: string[]; wordFrequencyRank?: number }[] = [];
    if (chars.length > 1) {
      const charsToAdd = [];
      for (const char of chars) {
        if (getWordByHanzi(char)) {
          continue;
        }
        const charInfo = lookupChar(char);
        if (!charInfo) {
          continue;
        }
        charsToAdd.push({
          hanzi: char,
          pinyin: charInfo.pinyin,
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
    }

    saveDb();

    // Generate examples and audio for main word
    const exampleMap = await generateExamples([
      { hanzi, pinyin: normalizedPinyin, english, hskLevel: 0 },
    ]);
    const examples = exampleMap.get(hanzi) || [];
    updateWordExamples(hanzi, examples);
    await generateSpeech(hanzi);
    for (const ex of examples) {
      await generateSpeech(ex.hanzi);
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
          await generateSpeech(ex.hanzi);
        }
      }
      await generateSpeech(w.hanzi);
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
    const { pinyin, english, categories, resetBucket } = req.body;

    if (!pinyin || !english || !Array.isArray(english) || english.length === 0) {
      return res
        .status(400)
        .json({ error: 'pinyin, english (array), and categories are required' });
    }

    const existing = getWordByHanzi(hanzi);
    if (!existing) {
      return res.status(404).json({ error: `Word "${hanzi}" not found` });
    }

    // Normalize pinyin
    const hasDigitTones = /[1-4]/.test(pinyin);
    let normalizedPinyin: string;
    if (hasDigitTones) {
      normalizedPinyin = pinyin
        .split(/\s+/)
        .map((token) => numberedToToneMarked(token.replace(/([1-5])(?=[a-zA-Z])/g, '$1 ')).replace(/\s+/g, ''))
        .join(' ');
    } else {
      normalizedPinyin = splitPinyin(pinyin);
    }

    updateWord(hanzi, normalizedPinyin, english, categories || []);
    if (resetBucket) {
      resetToBucket0(hanzi);
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
  deleteProgress(hanzi);
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
