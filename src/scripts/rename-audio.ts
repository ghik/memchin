import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, getAllWords } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '../../data/audio');

async function renameAudioFiles(): Promise<void> {
  await initDb();
  const words = getAllWords();

  // Build ID to hanzi mapping
  const idToHanzi = new Map<number, string>();
  for (const word of words.values()) {
    idToHanzi.set(word.id, word.hanzi);
  }

  console.log(`Loaded ${idToHanzi.size} words from database`);

  if (!fs.existsSync(audioDir)) {
    console.log('No audio directory found');
    return;
  }

  const files = fs.readdirSync(audioDir);
  let renamed = 0;
  let skipped = 0;

  for (const file of files) {
    // Match ID-based naming: {id}-word.mp3 or {id}-ex{n}.mp3
    const wordMatch = file.match(/^(\d+)-word\.mp3$/);
    const exMatch = file.match(/^(\d+)-ex(\d+)\.mp3$/);

    if (wordMatch) {
      const id = parseInt(wordMatch[1]);
      const hanzi = idToHanzi.get(id);
      if (hanzi) {
        const newName = `${hanzi}.mp3`;
        const oldPath = path.join(audioDir, file);
        const newPath = path.join(audioDir, newName);
        if (!fs.existsSync(newPath)) {
          fs.renameSync(oldPath, newPath);
          console.log(`Renamed: ${file} -> ${newName}`);
          renamed++;
        } else {
          console.log(`Skipped (exists): ${file} -> ${newName}`);
          skipped++;
        }
      } else {
        console.log(`No hanzi found for ID ${id}: ${file}`);
      }
    } else if (exMatch) {
      const id = parseInt(exMatch[1]);
      const exIndex = exMatch[2];
      const hanzi = idToHanzi.get(id);
      if (hanzi) {
        const newName = `${hanzi}-ex${exIndex}.mp3`;
        const oldPath = path.join(audioDir, file);
        const newPath = path.join(audioDir, newName);
        if (!fs.existsSync(newPath)) {
          fs.renameSync(oldPath, newPath);
          console.log(`Renamed: ${file} -> ${newName}`);
          renamed++;
        } else {
          console.log(`Skipped (exists): ${file} -> ${newName}`);
          skipped++;
        }
      } else {
        console.log(`No hanzi found for ID ${id}: ${file}`);
      }
    }
  }

  console.log(`\nDone: renamed ${renamed}, skipped ${skipped}`);
}

renameAudioFiles().catch(console.error);
