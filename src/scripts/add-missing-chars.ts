import { getAllWords, getWordByHanzi, initDb, insertWords, saveDb, updateWordExamples } from '../server/db.js';
import { lookupChar, loadWordFrequencyData } from '../server/services/hanzi-freq.js';
import { generateExamples } from './generate-examples.js';
import { generateSpeech } from '../server/services/tts.js';
import type { Example } from '../shared/types.js';

async function main() {
  await initDb();
  const freq = loadWordFrequencyData();
  const allWords = getAllWords();

  const charsToAdd = new Map<string, {
    hanzi: string;
    pinyin: string;
    english: string[];
    hskLevel: number;
    wordFrequencyRank?: number;
    hanziFrequencyRank?: number;
    examples: Example[];
    translatable: boolean;
    categories: string[];
    manual: boolean;
  }>();

  for (const [hanzi] of allWords) {
    const chars = [...hanzi];
    if (chars.length <= 1) {
      continue;
    }
    for (const char of chars) {
      if (charsToAdd.has(char) || getWordByHanzi(char)) {
        continue;
      }
      const charInfo = lookupChar(char);
      if (!charInfo) {
        continue;
      }
      charsToAdd.set(char, {
        hanzi: char,
        pinyin: charInfo.pinyin,
        english: charInfo.english,
        hskLevel: 0,
        wordFrequencyRank: freq.get(char),
        hanziFrequencyRank: charInfo.rank,
        examples: [],
        translatable: true,
        categories: [],
        manual: true,
      });
    }
  }

  if (charsToAdd.size === 0) {
    console.log('No missing characters found.');
    return;
  }

  const words = [...charsToAdd.values()];
  insertWords(words);
  saveDb();

  console.log(`Added ${words.length} missing characters. Generating examples and audio...`);

  for (const w of words) {
    console.log(`  ${w.hanzi} (${w.pinyin}) — ${w.english[0]}`);
    try {
      if (w.wordFrequencyRank) {
        const exampleMap = await generateExamples([
          { hanzi: w.hanzi, pinyin: w.pinyin, english: w.english, hskLevel: 0 },
        ]);
        const examples = exampleMap.get(w.hanzi) || [];
        updateWordExamples(w.hanzi, examples);
        for (const ex of examples) {
          await generateSpeech(ex.hanzi, ex.pinyin);
        }
      }
      await generateSpeech(w.hanzi, w.pinyin);
    } catch (error) {
      console.error(`  Failed for ${w.hanzi}:`, error);
    }
  }

  saveDb();
  console.log('Done.');
}

main().catch(console.error);
