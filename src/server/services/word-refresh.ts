/**
 * Refreshing learned entries — asking the AI for translations, labels and usage notes, and
 * regenerating example sentences — runs here, inside the server, rather than in a script.
 * The server owns the database file, so a job and ordinary practice can no longer overwrite
 * each other, and starting one needs no restart.
 *
 * One job at a time; it reports progress through `getRefreshStatus` and stops on request.
 *
 * A job can also be abandoned rather than finished — Ctrl-C in the script, or the server going
 * down under it — and then nothing it wrote is kept: every entry it touched goes back the way
 * it was.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import {
  getLearnedWordsByReviewOrder,
  restoreWords,
  saveDb,
  snapshotWord,
  updateWord,
  updateWordExamples,
} from '../db.js';
import type { WordSnapshot } from '../db.js';
import { inferWord } from './infer-word.js';
import { generateExamples } from '../../scripts/generate-examples.js';
import { takesExamples } from '../../shared/labels.js';
import { resetUsage, usageSummary } from './ai-usage.js';
import { generateSpeech } from './tts.js';
import type { PracticeMode, Word } from '../../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const audioDir = path.join(__dirname, '../../../data/audio');

const EXAMPLE_BATCH_SIZE = 25;
const MAX_LOG_LINES = 500;

/**
 * Identifies this process to the script following a job. A restarted server is a different
 * one, and the job the script was watching no longer exists.
 */
const instanceId = randomUUID();

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
  | 'aborted'
  | 'failed';

export interface RefreshStatus {
  /** Changes when the server restarts, so a client can tell its job was not merely finished */
  instanceId: string;
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
  abortRequested: boolean;
  /** Cancels the AI calls in flight, so an abort does not have to wait for them */
  controller: AbortController | null;
  /** What the entries the job has written to looked like before it touched them */
  originals: Map<string, WordSnapshot>;
  /** The job itself, so an abort can wait for it to unwind before rolling back */
  job: Promise<void> | null;
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
  abortRequested: false,
  controller: null,
  originals: new Map(),
  job: null,
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
  // Inferred English is stored with anything the curated glosses already say stripped out, so a
  // word the model simply agreed with ends up with an empty column and looks untouched. The
  // note is kept whole and always written, which makes it the honest record that a word was done
  const inferDone = options.skipInfer || word.aiEnglish.length > 0 || Boolean(word.aiNotes);
  // A sentence is never getting examples, so waiting for them would queue it up forever
  const examplesDone = options.skipExamples || word.examples.length > 0 || !takesExamples(word);
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

/** Records what `hanzi` looked like, the first time the job is about to write to it */
function rememberOriginal(hanzi: string): void {
  if (state.originals.has(hanzi)) {
    return;
  }
  const snapshot = snapshotWord(hanzi);
  if (snapshot) {
    state.originals.set(hanzi, snapshot);
  }
}

/** Puts every entry the job wrote back the way it was. Generated audio is left alone. */
function rollBack(): void {
  const originals = [...state.originals.values()];
  restoreWords(originals);
  saveDb();
  state.stage = 'aborted';
  // The calls were paid for even though nothing was kept
  log(usageSummary());
  log(`aborted, rolled back ${originals.length} ${originals.length === 1 ? 'entry' : 'entries'}`);
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
      const result = await inferWord(word.hanzi, state.controller?.signal);
      // Pinyin, curated English and the user's own categories stay as they are: the inferred
      // English lands in its own column, so the two can be compared before anything is merged
      rememberOriginal(word.hanzi);
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
      // An abort cancels the call in flight; that is not a failure worth counting or reporting
      if (state.abortRequested) {
        return;
      }
      state.failed++;
      log(`[${state.processed + state.failed}/${words.length}] ${word.hanzi} FAILED: ${error}`);
    }
  });

  saveDb();
}

async function regenerateExamplesFor(selected: Word[]): Promise<void> {
  state.stage = 'examples';
  const words = selected.filter(takesExamples);
  const skipped = selected.length - words.length;
  if (skipped > 0) {
    log(`${skipped} labelled a sentence, so no examples for them`);
  }
  const batchCount = Math.ceil(words.length / EXAMPLE_BATCH_SIZE);

  for (let i = 0; i < words.length && !state.stopRequested; i += EXAMPLE_BATCH_SIZE) {
    const batch = words.slice(i, i + EXAMPLE_BATCH_SIZE);
    log(
      `examples batch ${Math.floor(i / EXAMPLE_BATCH_SIZE) + 1}/${batchCount}: ` +
        batch.map((w) => w.hanzi).join(' ')
    );
    try {
      const exampleMap = await generateExamples(batch, state.controller?.signal);
      for (const word of batch) {
        const examples = exampleMap.get(word.hanzi) ?? [];
        if (examples.length === 0) {
          log(`  no examples returned for ${word.hanzi}`);
          continue;
        }
        rememberOriginal(word.hanzi);
        updateWordExamples(word.hanzi, examples);
      }
      saveDb();
    } catch (error) {
      if (state.abortRequested) {
        return;
      }
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
    log(usageSummary());
    log(state.stopRequested ? 'stopped' : 'done');
  } catch (error) {
    state.stage = 'failed';
    state.error = error instanceof Error ? error.message : String(error);
    log(`job failed: ${state.error}`);
  } finally {
    if (state.abortRequested) {
      rollBack();
    }
    state.running = false;
    state.finishedAt = new Date().toISOString();
  }
}

export function getRefreshStatus(since = 0): RefreshStatus {
  const from = Math.max(0, since - state.logOffset);
  return {
    instanceId,
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
    abortRequested: false,
    controller: new AbortController(),
    originals: new Map(),
    job: null,
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

  resetUsage();
  // Deliberately not awaited: the job outlives the request that started it
  state.job = run(pending, options);
  return getRefreshStatus();
}

export function stopRefresh(): RefreshStatus {
  if (state.running) {
    state.stopRequested = true;
    log('stop requested, finishing the item in flight');
  }
  return getRefreshStatus();
}

/**
 * Stops the job at once — the calls in flight are cancelled rather than awaited — and undoes
 * every database write it made, so the entries are as they were before it started. Resolves
 * once the job has unwound and the rollback is on disk.
 */
export async function abortRefresh(): Promise<RefreshStatus> {
  if (!state.running) {
    return getRefreshStatus();
  }
  state.abortRequested = true;
  state.stopRequested = true;
  log('abort requested, cancelling the calls in flight');
  state.controller?.abort();
  await state.job;
  return getRefreshStatus();
}
