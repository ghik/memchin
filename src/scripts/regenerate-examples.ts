import { initDb, getAllWords, updateWordExamples, saveDb } from '../server/db.js';
import { generateSpeech } from '../server/services/tts.js';
import type { Example, Word } from '../shared/types.js';
import { generateExamples } from './generate-examples.js';

async function regenerate(start?: number, end?: number, skipAudio?: boolean): Promise<void> {
  await initDb();

  // Get all words sorted by frequency rank
  const wordsMap = getAllWords();
  const allWords: Word[] = [...wordsMap.values()].sort(
    (a, b) => (a.frequencyRank ?? 999999) - (b.frequencyRank ?? 999999)
  );

  console.log(`Total words in database: ${allWords.length}`);

  // Apply start/end filtering (1-indexed positions in the sorted list)
  const startIdx = (start ?? 1) - 1;
  const endIdx = end ?? allWords.length;
  const words = allWords.slice(startIdx, endIdx);

  console.log(`Regenerating examples for words ${startIdx + 1}-${startIdx + words.length}`);

  const batchSize = 25;

  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize);
    const batchStart = startIdx + i + 1;
    const batchEnd = startIdx + Math.min(i + batchSize, words.length);
    console.log(`Generating examples for words ${batchStart}-${batchEnd}...`);

    let examples = new Map<string, Example[]>();
    try {
      examples = await generateExamples(
        batch.map((w) => ({
          hanzi: w.hanzi,
          pinyin: w.pinyin,
          english: w.english,
          hskLevel: w.hskLevel,
        }))
      );
    } catch (error) {
      console.error(`Failed to generate examples for batch:`, error);
      continue;
    }

    // Update each word's examples in place
    for (const word of batch) {
      const newExamples = examples.get(word.hanzi);
      if (newExamples) {
        updateWordExamples(word.id, newExamples);
      } else {
        console.warn(`No examples returned for "${word.hanzi}" (id=${word.id})`);
      }
    }
    saveDb();
    console.log(`Updated ${batch.length} words`);

    // Optionally regenerate audio
    if (!skipAudio) {
      console.log(`Generating audio...`);
      for (const word of batch) {
        const newExamples = examples.get(word.hanzi);
        if (newExamples) {
          try {
            await generateSpeech(
              word.hanzi,
              newExamples.map((ex) => ex.hanzi)
            );
          } catch (error) {
            console.error(`Failed to generate audio for "${word.hanzi}":`, error);
          }
        }
      }
      console.log(`Generated audio for ${batch.length} words`);
    }
  }

  console.log(`\nRegeneration complete: ${words.length} words`);
}

// Parse command line arguments
function parseArgs(args: string[]): {
  start?: number;
  end?: number;
  skipAudio: boolean;
} {
  let start: number | undefined;
  let end: number | undefined;
  let skipAudio = false;

  for (const arg of args) {
    if (arg.startsWith('--start=')) {
      start = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--end=')) {
      end = parseInt(arg.split('=')[1]);
    } else if (arg === '--skip-audio') {
      skipAudio = true;
    }
  }

  return { start, end, skipAudio };
}

const { start, end, skipAudio } = parseArgs(process.argv.slice(2));
console.log(
  `Regenerating examples${start || end ? ` for words ${start ?? 1}-${end ?? 'end'}` : ' for all words'}${skipAudio ? ' (skipping audio)' : ''}`
);
regenerate(start, end, skipAudio).catch(console.error);
