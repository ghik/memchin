/**
 * Refresh every learned or queued word: ask the AI for translations and labels, and
 * regenerate the example sentences (with audio for anything new).
 *
 *   npm run reinfer-words -- [--limit N] [--force] [--dry-run]
 *                            [--skip-infer] [--skip-examples] [--concurrency N]
 *
 * Words already carrying AI labels and examples are skipped, so an interrupted run can
 * simply be started again. --force redoes them.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getAllWords,
  getMaxBucket,
  initDb,
  saveDb,
  updateWord,
  updateWordExamples,
} from '../server/db.js';
import { inferWord } from '../server/services/infer-word.js';
import { generateExamples } from './generate-examples.js';
import { generateSpeech } from '../server/services/tts.js';
import type { Word } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '../../data/audio');

const EXAMPLE_BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 4;

interface Options {
  limit: number | null;
  force: boolean;
  dryRun: boolean;
  skipInfer: boolean;
  skipExamples: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    limit: null,
    force: false,
    dryRun: false,
    skipInfer: false,
    skipExamples: false,
    concurrency: DEFAULT_CONCURRENCY,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') {
      options.force = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--skip-infer') {
      options.skipInfer = true;
    } else if (arg === '--skip-examples') {
      options.skipExamples = true;
    } else if (arg === '--limit') {
      options.limit = Number(argv[++i]);
    } else if (arg === '--concurrency') {
      options.concurrency = Number(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.limit !== null && !Number.isFinite(options.limit)) {
    throw new Error('--limit needs a number');
  }
  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency needs a positive number');
  }
  return options;
}

function audioExists(hanzi: string): boolean {
  return fs.existsSync(path.join(audioDir, `${hanzi}.mp3`));
}

/** Every word that is learned in some mode, or queued to be learned */
function selectWords(): Word[] {
  const selected: Word[] = [];
  for (const word of getAllWords().values()) {
    if (word.queuedAt || word.charQueuedAt || getMaxBucket(word.hanzi) !== null) {
      selected.push(word);
    }
  }
  return selected;
}

function isDone(word: Word, options: Options): boolean {
  const inferDone = options.skipInfer || word.aiCategories.length > 0;
  const examplesDone = options.skipExamples || word.examples.length > 0;
  return inferDone && examplesDone;
}

function mergeValues(existing: string[], inferred: string[]): string[] {
  const merged = [...existing];
  for (const value of inferred) {
    if (!merged.includes(value)) {
      merged.push(value);
    }
  }
  return merged;
}

/** Runs `task` over `items`, `concurrency` at a time, in order */
async function forEachConcurrent<T>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function inferAll(words: Word[], options: Options): Promise<number> {
  let done = 0;
  let failed = 0;
  let sinceSave = 0;

  await forEachConcurrent(words, options.concurrency, async (word) => {
    try {
      const result = await inferWord(word.hanzi);
      const english = mergeValues(word.english, result.english);
      const polish = mergeValues(word.polish ?? [], result.polish);
      // The pinyin and the user's own categories stay as they are — only the AI-owned
      // fields and the new translations are written back
      updateWord(word.hanzi, word.pinyin, english, polish, word.categories, result.categories, false);
      sinceSave++;
      if (sinceSave >= EXAMPLE_BATCH_SIZE) {
        saveDb();
        sinceSave = 0;
      }
      done++;
      console.log(
        `  [${done + failed}/${words.length}] ${word.hanzi} ${result.verdict} ` +
          `${result.categories.join(', ')} | ${result.english.join('; ')} | ${result.polish.join('; ')}`
      );
      if (result.verdict !== 'ok') {
        console.log(`      ^ ${result.notes}`);
      }
    } catch (error) {
      failed++;
      console.error(`  [${done + failed}/${words.length}] ${word.hanzi} FAILED:`, error);
    }
  });

  saveDb();
  if (failed > 0) {
    console.log(`  ${failed} word(s) failed to infer`);
  }
  return done;
}

async function regenerateExamplesFor(words: Word[]): Promise<Map<string, string>> {
  const needAudio = new Map<string, string>(); // hanzi -> pinyin

  for (let i = 0; i < words.length; i += EXAMPLE_BATCH_SIZE) {
    const batch = words.slice(i, i + EXAMPLE_BATCH_SIZE);
    const batchNumber = Math.floor(i / EXAMPLE_BATCH_SIZE) + 1;
    const batchCount = Math.ceil(words.length / EXAMPLE_BATCH_SIZE);
    console.log(`  Batch ${batchNumber}/${batchCount}: ${batch.map((w) => w.hanzi).join(' ')}`);
    try {
      const exampleMap = await generateExamples(batch);
      for (const word of batch) {
        const examples = exampleMap.get(word.hanzi) ?? [];
        if (examples.length === 0) {
          console.warn(`    no examples returned for ${word.hanzi}`);
          continue;
        }
        updateWordExamples(word.hanzi, examples);
        for (const example of examples) {
          if (!audioExists(example.hanzi)) {
            needAudio.set(example.hanzi, example.pinyin);
          }
        }
      }
      saveDb();
    } catch (error) {
      console.error(`    batch failed:`, error);
    }
  }
  return needAudio;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await initDb();

  let words = selectWords();
  const total = words.length;
  if (!options.force) {
    words = words.filter((word) => !isDone(word, options));
  }
  if (options.limit !== null) {
    words = words.slice(0, options.limit);
  }

  console.log(
    `${total} learned or queued word(s); ${words.length} to process` +
      (options.force ? ' (--force)' : ' (already-processed words skipped)')
  );

  if (options.dryRun) {
    console.log(words.map((w) => w.hanzi).join(' '));
    console.log('\nDry run, nothing written.');
    return;
  }
  if (words.length === 0) {
    return;
  }

  if (!options.skipInfer) {
    console.log(`\nInferring translations and labels (${options.concurrency} at a time)...`);
    await inferAll(words, options);
  }

  const needAudio = new Map<string, string>();
  if (!options.skipExamples) {
    console.log('\nRegenerating examples...');
    for (const [hanzi, pinyin] of await regenerateExamplesFor(words)) {
      needAudio.set(hanzi, pinyin);
    }
  }
  for (const word of words) {
    if (!audioExists(word.hanzi)) {
      needAudio.set(word.hanzi, word.pinyin);
    }
  }

  if (needAudio.size > 0) {
    console.log(`\nGenerating audio for ${needAudio.size} item(s)...`);
    for (const [hanzi, pinyin] of needAudio) {
      try {
        await generateSpeech(hanzi, pinyin);
      } catch (error) {
        console.error(`  Failed to generate audio for ${hanzi}:`, error);
      }
    }
  }

  console.log('\nDone.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
