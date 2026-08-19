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
  getHanziSynonymHanzis,
  setHanziSynonyms,
} from '../db.js';
import { lookupFiltered } from '../services/cedict.js';
import { normalizePinyinInput, splitPinyin, splitPinyinQuery } from '../../shared/pinyin.js';
import { generateExamples } from '../../scripts/generate-examples.js';
import { deleteAudio, generateSpeech } from '../services/tts.js';
import { inferWord } from '../services/infer-word.js';
import { decomposeWord } from '../services/ids.js';
import { lookupChar, loadWordFrequencyData } from '../services/hanzi-freq.js';
import type { Example, SynonymEntry } from '../../shared/types.js';

function synonymEntries(hanzi: string): SynonymEntry[] {
  const entries: SynonymEntry[] = [];
  for (const synonym of getHanziSynonymHanzis(hanzi)) {
    const word = getWordByHanzi(synonym);
    entries.push({
      hanzi: synonym,
      pinyin: word?.pinyin ?? '',
      english: word?.english ?? [],
    });
  }
  return entries;
}

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

// Autocomplete over learned words: hanzi if the query contains CJK, pinyin otherwise
router.get('/suggest', (req, res) => {
  const query = ((req.query.q as string) ?? '').trim();
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  if (!query) {
    return res.json([]);
  }
  const isHanzi = /[一-鿿㐀-䶿]/.test(query);
  if (!isHanzi && splitPinyinQuery(query).length === 0) {
    // Nothing parseable as pinyin: an empty token list would match every word
    return res.json([]);
  }
  const matches = searchLearnedWords(
    isHanzi ? { hanzi: query, hanziMode: 'prefix' } : { pinyin: query, pinyinMode: 'prefix' },
    limit
  );
  const suggestions: SynonymEntry[] = matches.map(({ word }) => ({
    hanzi: word.hanzi,
    pinyin: word.pinyin,
    english: word.english,
  }));
  res.json(suggestions);
});

// Ask OpenAI for the reading, meaning and naturalness of an arbitrary hanzi string
router.post('/infer', async (req, res) => {
  const hanzi = ((req.body.hanzi as string) ?? '').trim();
  if (!hanzi) {
    return res.status(400).json({ error: 'hanzi is required' });
  }
  try {
    const result = await inferWord(hanzi);
    res.json({ ...result, pinyin: normalizePinyinInput(result.pinyin) });
  } catch (error) {
    console.error(`Inference failed for "${hanzi}":`, error);
    res.status(500).json({ error: 'Inference failed' });
  }
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
  const synonyms = existing ? synonymEntries(hanzi) : [];
  res.json({ entries, existing, maxBucket, breakdown, wordRank, charRank, synonyms });
});

router.post('/', async (req, res) => {
  try {
    const { hanzi, pinyin, english, polish, categories, aiCategories, aiEnglish, aiNotes } =
      req.body;

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
        aiCategories: Array.isArray(aiCategories) ? aiCategories : [],
        aiEnglish: Array.isArray(aiEnglish) ? aiEnglish : [],
        aiNotes: typeof aiNotes === 'string' ? aiNotes.trim() : undefined,
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

    // Examples and audio are best-effort: the word is already stored, so a failure
    // for one entry must not abort the others (run `npm run regenerate-missing` to backfill)
    const warnings: string[] = [];

    const generateFor = async (entry: {
      hanzi: string;
      pinyin: string;
      english: string[];
    }): Promise<void> => {
      try {
        const exampleMap = await generateExamples([{ ...entry, hskLevel: 0 }]);
        const examples = exampleMap.get(entry.hanzi) ?? [];
        if (examples.length === 0) {
          warnings.push(`No examples generated for "${entry.hanzi}"`);
        } else {
          updateWordExamples(entry.hanzi, examples);
        }
      } catch (error) {
        console.error(`Failed to generate examples for ${entry.hanzi}:`, error);
        warnings.push(`Example generation failed for "${entry.hanzi}"`);
      }
      try {
        await generateSpeech(entry.hanzi, entry.pinyin);
      } catch (error) {
        console.error(`Failed to generate audio for ${entry.hanzi}:`, error);
        warnings.push(`Audio generation failed for "${entry.hanzi}"`);
      }
    };

    await generateFor({ hanzi, pinyin: normalizedPinyin, english });
    for (const w of charsAdded) {
      await generateFor({ hanzi: w.hanzi, pinyin: w.pinyin, english: w.english });
    }

    invalidateWordCache();

    const word = getWordByHanzi(hanzi);
    res.json(warnings.length > 0 ? { ...word, warnings } : word);
  } catch (error) {
    console.error('Failed to add word:', error);
    res.status(500).json({ error: 'Failed to add word' });
  }
});

router.put('/:hanzi', (req, res) => {
  try {
    const hanzi = decodeURIComponent(req.params.hanzi);
    const {
      pinyin,
      english,
      polish,
      categories,
      queueAsNew,
      synonyms,
      aiCategories,
      aiEnglish,
      aiNotes,
    } = req.body;

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

    if (synonyms !== undefined) {
      if (!Array.isArray(synonyms)) {
        return res.status(400).json({ error: 'synonyms must be an array' });
      }
      for (const synonym of synonyms) {
        if (synonym === hanzi) {
          return res.status(400).json({ error: 'A word cannot be its own synonym' });
        }
        if (!getWordByHanzi(synonym)) {
          return res.status(404).json({ error: `Synonym word "${synonym}" not found` });
        }
      }
    }

    const normalizedPinyin = normalizePinyinInput(pinyin);

    updateWord(hanzi, {
      pinyin: normalizedPinyin,
      english,
      polish: polishArr,
      categories: categories || [],
      aiCategories: Array.isArray(aiCategories) ? aiCategories : undefined,
      aiEnglish: Array.isArray(aiEnglish) ? aiEnglish : undefined,
      aiNotes: typeof aiNotes === 'string' ? aiNotes.trim() : undefined,
    });
    if (synonyms !== undefined) {
      setHanziSynonyms(hanzi, synonyms);
    }
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
