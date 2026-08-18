/**
 * Refresh learned entries in review order, soonest first: ask the AI for translations and
 * labels, and regenerate the example sentences (with audio for anything new).
 *
 * Two separate runs, each mirroring one practice queue:
 *   --words       (default) the english2pinyin word-mode queue, in review order
 *   --characters  the hanzi2pinyin character-mode queue, in review order
 *
 * They overlap wherever a character is learned both ways; the resume check keeps the second
 * run from redoing what the first already covered.
 *
 *   npm run reinfer-words -- [--words | --characters] [--limit N] [--force] [--dry-run]
 *                            [--skip-infer] [--skip-examples] [--concurrency N]
 *
 * Words already carrying AI labels and examples are skipped, so an interrupted run can
 * simply be started again. --force redoes them.
 */
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getLearnedWordsByReviewOrder,
  initDb,
  saveDb,
  updateWord,
  updateWordExamples,
} from '../server/db.js';
import { inferWord } from '../server/services/infer-word.js';
import { generateExamples } from './generate-examples.js';
import { generateSpeech } from '../server/services/tts.js';
import type { Word } from '../shared/types.js';
import type { LearnedSelection } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '../../data/audio');

const EXAMPLE_BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 4;

interface Options {
  selection: LearnedSelection;
  limit: number | null;
  force: boolean;
  dryRun: boolean;
  skipInfer: boolean;
  skipExamples: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    selection: 'words',
    limit: null,
    force: false,
    dryRun: false,
    skipInfer: false,
    skipExamples: false,
    concurrency: DEFAULT_CONCURRENCY,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--words') {
      options.selection = 'words';
    } else if (arg === '--characters') {
      options.selection = 'characters';
    } else if (arg === '--force') {
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

/**
 * The dev server keeps the whole database in memory and writes it back whole on every save,
 * so anything this script writes while it runs is erased the next time the server saves.
 */
function devServerRunning(): Promise<boolean> {
  const port = Number(process.env.PORT) || 3000;
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const finish = (running: boolean) => {
      socket.destroy();
      resolve(running);
    };
    socket.setTimeout(500);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

function audioExists(hanzi: string): boolean {
  return fs.existsSync(path.join(audioDir, `${hanzi}.mp3`));
}

function isDone(word: Word, options: Options): boolean {
  const inferDone = options.skipInfer || word.aiEnglish.length > 0;
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
      const polish = mergeValues(word.polish ?? [], result.polish);
      // Pinyin, curated English and the user's own categories stay as they are: the inferred
      // English lands in its own column, so the two can be compared before anything is merged
      updateWord(
        word.hanzi,
        {
          pinyin: word.pinyin,
          english: word.english,
          polish,
          categories: word.categories,
          aiCategories: result.categories,
          aiEnglish: result.english,
          aiNotes: result.notes,
        },
        false
      );
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

  if (!options.dryRun && (await devServerRunning())) {
    console.error(
      'The app server is running on port ' +
        (Number(process.env.PORT) || 3000) +
        '. It holds the whole database in memory and would overwrite this run.\n' +
        'Stop it first, then start it again once this finishes.'
    );
    process.exit(1);
  }

  await initDb();

  let words = getLearnedWordsByReviewOrder(options.selection);
  const total = words.length;
  if (!options.force) {
    words = words.filter((word) => !isDone(word, options));
  }
  if (options.limit !== null) {
    words = words.slice(0, options.limit);
  }

  console.log(
    `${total} learned ${options.selection === 'words' ? 'word' : 'character'}(s) in review ` +
      `order; ${words.length} to process` +
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
