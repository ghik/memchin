import textToSpeech from '@google-cloud/text-to-speech';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toSsmlPinyin } from '../../shared/pinyin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '../../../data/audio');
const credentialsPath = path.join(__dirname, '../../../gcp-service-account-key.json');

const client = new textToSpeech.TextToSpeechClient({
  keyFilename: credentialsPath,
});

if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

/**
 * Generate speech audio for a hanzi string if it doesn't already exist.
 * When `pinyin` is supplied, the request uses an SSML <phoneme alphabet="pinyin">
 * tag so the TTS voice pronounces the exact reading instead of guessing.
 */
export async function generateSpeech(hanzi: string, pinyin?: string): Promise<void> {
  const filePath = path.join(audioDir, `${hanzi}.mp3`);
  if (fs.existsSync(filePath)) {
    return;
  }
  await synthesizeToFile(hanzi, pinyin, filePath);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

async function synthesizeToFile(text: string, pinyin: string | undefined, outputPath: string): Promise<void> {
  const input = pinyin
    ? { ssml: `<speak><phoneme alphabet="pinyin" ph="${escapeXml(toSsmlPinyin(pinyin))}">${escapeXml(text)}</phoneme></speak>` }
    : { text };
  const [response] = await client.synthesizeSpeech({
    input,
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

/**
 * Delete the cached audio file for a hanzi string, if any.
 */
export function deleteAudio(hanzi: string): void {
  const filePath = path.join(audioDir, `${hanzi}.mp3`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
