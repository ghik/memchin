import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Router } from 'express';
import {
  getAllWords,
  getWordByHanzi,
  getWordCount,
  insertWords,
  updateWord,
  upsertProgress,
  saveDb,
  invalidateWordCache,
  deleteProgress,
} from '../db.js';
import { lookupFiltered } from '../services/cedict.js';
import { numberedToToneMarked, splitPinyin } from '../services/pinyin.js';
import { generateExamples } from '../../scripts/generate-examples.js';
import { generateSpeech } from '../services/tts.js';
import type { Example, PracticeMode } from '../../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const freqPath = path.join(__dirname, '../../../sources/internet-zh.num.txt');

let freqMap: Map<string, number> | null = null;

function loadFrequencyData(): Map<string, number> {
  if (freqMap) return freqMap;
  freqMap = new Map();
  if (fs.existsSync(freqPath)) {
    const data = fs.readFileSync(freqPath, 'utf-8');
    for (const line of data.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        freqMap.set(parts[2], parseInt(parts[0]));
      }
    }
  }
  return freqMap;
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
  res.json({ entries, existing });
});

router.post('/', async (req, res) => {
  try {
    const { hanzi, pinyin, english, categories } = req.body;

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
      // Numbered format like "ge4ren2" — split and convert
      normalizedPinyin = numberedToToneMarked(splitPinyin(pinyin));
    } else {
      // Already tone-marked — just split
      normalizedPinyin = splitPinyin(pinyin);
    }

    // Generate examples
    let examples: Example[] = [];
    try {
      const exampleMap = await generateExamples([
        { hanzi, pinyin: normalizedPinyin, english, hskLevel: 0 },
      ]);
      examples = exampleMap.get(hanzi) || [];
    } catch (error) {
      console.error(`Failed to generate examples for "${hanzi}":`, error);
    }

    // Look up frequency rank
    const freq = loadFrequencyData();
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
        examples,
        translatable: true,
        categories: categories || [],
        manual: true,
      },
    ]);

    // Initialize progress to bucket 0 for all modes so word is immediately eligible
    const now = new Date()
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z$/, '');
    const modes: PracticeMode[] = [
      'hanzi2pinyin',
      'hanzi2english',
      'english2hanzi',
      'english2pinyin',
    ];
    for (const mode of modes) {
      upsertProgress(hanzi, mode, 0, now, false);
    }
    saveDb();

    // Generate audio in the background
    generateSpeech(
      hanzi,
      examples.map((ex) => ex.hanzi)
    ).catch((error) => {
      console.error(`Failed to generate audio for "${hanzi}":`, error);
    });

    // Invalidate word cache
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
    const { pinyin, english, categories } = req.body;

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
      normalizedPinyin = numberedToToneMarked(splitPinyin(pinyin));
    } else {
      normalizedPinyin = splitPinyin(pinyin);
    }

    updateWord(hanzi, normalizedPinyin, english, categories || []);

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
