import { initDb, getAllWords } from '../server/db.js';
import { generateSpeech, hasAudio } from '../server/services/tts.js';

async function generateAudioForAllWords(): Promise<void> {
  await initDb();
  const words = getAllWords();

  console.log(`Found ${words.size} words in database`);

  let generated = 0;
  let skipped = 0;

  for (const word of words.values()) {
    if (hasAudio(word.hanzi)) {
      skipped++;
      continue;
    }

    try {
      console.log(`Generating audio for "${word.hanzi}"...`);
      await generateSpeech(word.hanzi, word.examples.map((ex) => ex.hanzi));
      generated++;
    } catch (error) {
      console.error(`Failed to generate audio for "${word.hanzi}":`, error);
    }
  }

  console.log(`\nDone: generated ${generated}, skipped ${skipped} (already had audio)`);
}

generateAudioForAllWords().catch(console.error);
