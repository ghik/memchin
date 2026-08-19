/**
 * Refreshing learned entries — asking the AI for translations, labels and usage notes, and
 * regenerating example sentences — runs here, inside the server, rather than in a script.
 * The server owns the database file, so a job and ordinary practice can no longer overwrite
 * each other, and starting one needs no restart.
 *
 * One job at a time; it reports progress through `getRefreshStatus` and stops on request.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getLearnedWordsByReviewOrder,
  saveDb,
  updateWord,
  updateWordExamples,
} from '../db.js';
import { inferWord } from './infer-word.js';
import { generateExamples } from '../../scripts/generate-examples.js';
import { generateSpeech } from './tts.js';
import type { PracticeMode, Word } from '../../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '../../../data/audio');

const EXAMPLE_BATCH_SIZE = 25;
const MAX_LOG_LINES = 500;

export interface RefreshOptions {
  mode: PracticeMode;
  characterMode: boolean;
  limit: number | null;
  force: boolean;
  skipInfer: boolean;
  skipExamples: boolean;
  concurrency: number;
}

export type RefreshStage =
  | 'idle'
  | 'inferring'
  | 'examples'
  | 'audio'
  | 'done'
  | 'stopped'
  | 'failed';

export interface RefreshStatus {
  running: boolean;
  stage: RefreshStage;
  options: RefreshOptions | null;
  queueSize: number;
  total: number;
  processed: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** Index of the first line in `log`, so a client can ask for what it has not seen */
  logOffset: number;
  log: string[];
}

interface JobState {
  running: boolean;
  stage: RefreshStage;
  options: RefreshOptions | null;
  queueSize: number;
  total: number;
  processed: number;
  failed: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  stopRequested: boolean;
  logOffset: number;
  log: string[];
}

const state: JobState = {
  running: false,
  stage: 'idle',
  options: null,
  queueSize: 0,
  total: 0,
  processed: 0,
  failed: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  stopRequested: false,
  logOffset: 0,
  log: [],
};

function log(line: string): void {
  state.log.push(line);
  if (state.log.length > MAX_LOG_LINES) {
    state.logOffset += state.log.length - MAX_LOG_LINES;
    state.log = state.log.slice(-MAX_LOG_LINES);
  }
  console.log(`[refresh] ${line}`);
}

export const DEFAULT_REFRESH_OPTIONS: RefreshOptions = {
  mode: 'english2pinyin',
  characterMode: false,
  limit: null,
  force: false,
  skipInfer: false,
  skipExamples: false,
  concurrency: 4,
};

function audioExists(hanzi: string): boolean {
  return fs.existsSync(path.join(audioDir, `${hanzi}.mp3`));
}

function isDone(word: Word, options: RefreshOptions): boolean {
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

/** The entries a job with these options would work through, in the order it would take them */
export function selectWords(options: RefreshOptions): { queue: Word[]; pending: Word[] } {
  const queue = getLearnedWordsByReviewOrder(options.mode, options.characterMode);
  let pending = options.force ? [...queue] : queue.filter((word) => !isDone(word, options));
  if (options.limit !== null) {
    pending = pending.slice(0, options.limit);
  }
  return { queue, pending };
}

/** Runs `task` over `items`, `concurrency` at a time */
async function forEachConcurrent<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length && !state.stopRequested) {
      await task(items[next++]);
    }
  });
  await Promise.all(workers);
}

async function inferAll(words: Word[], options: RefreshOptions): Promise<void> {
  state.stage = 'inferring';
  let sinceSave = 0;

  await forEachConcurrent(words, options.concurrency, async (word) => {
    try {
      const result = await inferWord(word.hanzi);
      // Pinyin, curated English and the user's own categories stay as they are: the inferred
      // English lands in its own column, so the two can be compared before anything is merged
      updateWord(
        word.hanzi,
        {
          pinyin: word.pinyin,
          english: word.english,
          polish: mergeValues(word.polish ?? [], result.polish),
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
      state.processed++;
      log(
        `[${state.processed + state.failed}/${words.length}] ${word.hanzi} ${result.verdict} ` +
          `${result.categories.join(', ')} | ${result.english.join('; ')} | ${result.polish.join('; ')}`
      );
    } catch (error) {
      state.failed++;
      log(`[${state.processed + state.failed}/${words.length}] ${word.hanzi} FAILED: ${error}`);
    }
  });

  saveDb();
}

async function regenerateExamplesFor(words: Word[]): Promise<void> {
  state.stage = 'examples';
  const batchCount = Math.ceil(words.length / EXAMPLE_BATCH_SIZE);

  for (let i = 0; i < words.length && !state.stopRequested; i += EXAMPLE_BATCH_SIZE) {
    const batch = words.slice(i, i + EXAMPLE_BATCH_SIZE);
    log(
      `examples batch ${Math.floor(i / EXAMPLE_BATCH_SIZE) + 1}/${batchCount}: ` +
        batch.map((w) => w.hanzi).join(' ')
    );
    try {
      const exampleMap = await generateExamples(batch);
      for (const word of batch) {
        const examples = exampleMap.get(word.hanzi) ?? [];
        if (examples.length === 0) {
          log(`  no examples returned for ${word.hanzi}`);
          continue;
        }
        updateWordExamples(word.hanzi, examples);
      }
      saveDb();
    } catch (error) {
      log(`  examples batch failed: ${error}`);
    }
  }
}

/** Words are spoken in practice, example sentences are only read, so only words get audio */
async function generateMissingAudio(words: Word[]): Promise<void> {
  state.stage = 'audio';
  const missing = words.filter((word) => !audioExists(word.hanzi));
  if (missing.length === 0) {
    return;
  }
  log(`generating audio for ${missing.length} word(s)`);
  for (const word of missing) {
    if (state.stopRequested) {
      return;
    }
    try {
      await generateSpeech(word.hanzi, word.pinyin);
    } catch (error) {
      log(`  audio failed for ${word.hanzi}: ${error}`);
    }
  }
}

async function run(words: Word[], options: RefreshOptions): Promise<void> {
  try {
    if (!options.skipInfer) {
      await inferAll(words, options);
    }
    if (!options.skipExamples && !state.stopRequested) {
      await regenerateExamplesFor(words);
    }
    if (!state.stopRequested) {
      await generateMissingAudio(words);
    }
    state.stage = state.stopRequested ? 'stopped' : 'done';
    log(state.stopRequested ? 'stopped' : 'done');
  } catch (error) {
    state.stage = 'failed';
    state.error = error instanceof Error ? error.message : String(error);
    log(`job failed: ${state.error}`);
  } finally {
    state.running = false;
    state.finishedAt = new Date().toISOString();
  }
}

export function getRefreshStatus(since = 0): RefreshStatus {
  const from = Math.max(0, since - state.logOffset);
  return {
    running: state.running,
    stage: state.stage,
    options: state.options,
    queueSize: state.queueSize,
    total: state.total,
    processed: state.processed,
    failed: state.failed,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    error: state.error,
    logOffset: state.logOffset + from,
    log: state.log.slice(from),
  };
}

export function startRefresh(options: RefreshOptions): RefreshStatus {
  if (state.running) {
    throw new Error('A refresh job is already running');
  }
  const { queue, pending } = selectWords(options);

  Object.assign(state, {
    running: true,
    stage: 'inferring' as RefreshStage,
    options,
    queueSize: queue.length,
    total: pending.length,
    processed: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    stopRequested: false,
    logOffset: 0,
    log: [],
  });

  log(
    `${queue.length} entries in the ${options.mode} ` +
      `${options.characterMode ? 'character' : 'word'}-mode queue; ${pending.length} to process` +
      (options.force ? ' (forced)' : ' (already-processed entries skipped)')
  );

  if (pending.length === 0) {
    state.running = false;
    state.stage = 'done';
    state.finishedAt = new Date().toISOString();
    return getRefreshStatus();
  }

  // Deliberately not awaited: the job outlives the request that started it
  void run(pending, options);
  return getRefreshStatus();
}

export function stopRefresh(): RefreshStatus {
  if (state.running) {
    state.stopRequested = true;
    log('stop requested, finishing the item in flight');
  }
  return getRefreshStatus();
}
