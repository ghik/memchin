import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllWords, initDb, saveDb, updateWordExamples } from '../server/db.js';
import { generateExamples } from './generate-examples.js';
import { generateSpeech } from '../server/services/tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '../../data/audio');

function audioExists(hanzi: string): boolean {
  return fs.existsSync(path.join(audioDir, `${hanzi}.mp3`));
}

async function main() {
  await initDb();
  const allWords = getAllWords();

  const needExamples: { hanzi: string; pinyin: string; english: string[]; hskLevel: number }[] = [];
  const needAudio = new Set<string>();

  for (const [, word] of allWords) {
    if (!word.examples || word.examples.length === 0) {
      needExamples.push({ hanzi: word.hanzi, pinyin: word.pinyin, english: word.english, hskLevel: word.hskLevel });
    }
    if (!audioExists(word.hanzi)) {
      needAudio.add(word.hanzi);
    }
    for (const ex of word.examples || []) {
      if (!audioExists(ex.hanzi)) {
        needAudio.add(ex.hanzi);
      }
    }
  }

  console.log(`${needExamples.length} words missing examples, ${needAudio.size} missing audio.`);

  if (needExamples.length > 0) {
    console.log('\nGenerating examples...');
    const batchSize = 25;
    for (let i = 0; i < needExamples.length; i += batchSize) {
      const batch = needExamples.slice(i, i + batchSize);
      console.log(`  Batch ${Math.floor(i / batchSize) + 1}: ${batch.map((w) => w.hanzi).join(' ')}`);
      try {
        const exampleMap = await generateExamples(batch);
        for (const w of batch) {
          const examples = exampleMap.get(w.hanzi) || [];
          if (examples.length > 0) {
            updateWordExamples(w.hanzi, examples);
            for (const ex of examples) {
              if (!audioExists(ex.hanzi)) {
                needAudio.add(ex.hanzi);
              }
            }
          }
        }
        saveDb();
      } catch (error) {
        console.error(`  Failed to generate examples for batch:`, error);
      }
    }
  }

  if (needAudio.size > 0) {
    console.log(`\nGenerating audio for ${needAudio.size} items...`);
    for (const hanzi of needAudio) {
      try {
        await generateSpeech(hanzi);
        console.log(`  ${hanzi}`);
      } catch (error) {
        console.error(`  Failed to generate audio for ${hanzi}:`, error);
      }
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
