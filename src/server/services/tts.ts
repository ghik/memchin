import textToSpeech from '@google-cloud/text-to-speech';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '../../../data/audio');
const credentialsPath = path.join(__dirname, '../../../gcp-service-account-key.json');

const client = new textToSpeech.TextToSpeechClient({
  keyFilename: credentialsPath,
});

// Ensure audio directory exists
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

/**
 * Generate speech audio for a hanzi string if it doesn't already exist
 */
export async function generateSpeech(hanzi: string): Promise<void> {
  const filePath = path.join(audioDir, `${hanzi}.mp3`);
  if (fs.existsSync(filePath)) {
    return;
  }
  await synthesizeToFile(hanzi, filePath);
}

async function synthesizeToFile(text: string, outputPath: string): Promise<void> {
  const [response] = await client.synthesizeSpeech({
    input: { text },
    voice: {
      languageCode: 'cmn-CN',
      name: 'cmn-CN-Wavenet-C', // Female voice, good quality
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 0.9, // Slightly slower for learners
    },
  });

  if (response.audioContent) {
    fs.writeFileSync(outputPath, response.audioContent, 'binary');
  }
}

/**
 * Check if audio files exist for a word
 */
export function hasAudio(hanzi: string): boolean {
  const wordPath = path.join(audioDir, `${hanzi}.mp3`);
  return fs.existsSync(wordPath);
}
