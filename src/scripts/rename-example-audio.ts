import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getAllWords } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '../../data/audio');

async function renameExampleAudioFiles(): Promise<void> {
  await initDb();
  const words = getAllWords();

  console.log(`Loaded ${words.size} words from database`);

  if (!fs.existsSync(audioDir)) {
    console.log('No audio directory found');
    return;
  }

  let renamed = 0;
  let skipped = 0;
  let notFound = 0;

  for (const word of words.values()) {
    for (let i = 0; i < word.examples.length; i++) {
      const oldName = `${word.hanzi}-ex${i}.mp3`;
      const newName = `${word.examples[i].hanzi}.mp3`;
      const oldPath = path.join(audioDir, oldName);
      const newPath = path.join(audioDir, newName);

      if (!fs.existsSync(oldPath)) {
        notFound++;
        continue;
      }

      if (fs.existsSync(newPath)) {
        // Already renamed or duplicate, delete old file
        fs.unlinkSync(oldPath);
        console.log(`Deleted duplicate: ${oldName}`);
        skipped++;
        continue;
      }

      fs.renameSync(oldPath, newPath);
      console.log(`Renamed: ${oldName} -> ${newName}`);
      renamed++;
    }
  }

  console.log(`\nDone: renamed ${renamed}, skipped ${skipped}, not found ${notFound}`);
}

renameExampleAudioFiles().catch(console.error);
