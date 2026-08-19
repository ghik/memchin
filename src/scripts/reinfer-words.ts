/**
 * Drives the server's refresh job: asks the AI for translations, labels and usage notes for
 * learned entries, and regenerates their example sentences.
 *
 * The work happens inside the running server, which owns the database, so a job and ordinary
 * practice cannot overwrite each other and nothing needs restarting. This is only the client:
 * it starts the job and prints its log until it finishes.
 *
 * Ctrl-C is not just a way out of the log: it aborts the job in the server and rolls back every
 * entry it has written, leaving generated audio in place. Use --stop to keep the work instead.
 * A server restart mid-job — a file save, `tsx watch` respawning — has the same effect: the
 * server rolls the job back on its way down, and this reports that rather than a false "done".
 *
 *   npm run reinfer-words -- [--mode MODE] [--words | --characters] [--limit N] [--force]
 *                            [--dry-run] [--skip-infer] [--skip-examples] [--concurrency N]
 *   npm run reinfer-words -- --status      follow a job that is already running
 *   npm run reinfer-words -- --stop        ask it to stop after the item in flight, keeping it
 *   npm run reinfer-words -- --abort       stop it now and roll back everything it wrote
 *
 * The queue to walk:
 *   --mode <hanzi2pinyin | english2pinyin | english2hanzi>   default english2pinyin
 *   --words | --characters                                   word or character mode, default words
 *
 * Entries already carrying AI translations and examples are skipped, so an interrupted run can
 * simply be started again. --force redoes them.
 */
import https from 'https';
import type { PracticeMode } from '../shared/types.js';

const PRACTICE_MODES: PracticeMode[] = ['hanzi2pinyin', 'english2pinyin', 'english2hanzi'];
const POLL_INTERVAL_MS = 2000;
/** How long a restarting server is given to come back before following gives up */
const SERVER_WAIT_MS = 30000;

interface Options {
  mode: PracticeMode;
  characterMode: boolean;
  limit: number | null;
  force: boolean;
  skipInfer: boolean;
  skipExamples: boolean;
  concurrency: number | null;
}

type Command = 'start' | 'preview' | 'status' | 'stop' | 'abort';

interface RefreshStatus {
  instanceId: string;
  running: boolean;
  stage: string;
  queueSize: number;
  total: number;
  processed: number;
  failed: number;
  error: string | null;
  logOffset: number;
  log: string[];
}

function parseArgs(argv: string[]): { command: Command; options: Options } {
  let command: Command = 'start';
  const options: Options = {
    mode: 'english2pinyin',
    characterMode: false,
    limit: null,
    force: false,
    skipInfer: false,
    skipExamples: false,
    concurrency: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode') {
      const mode = argv[++i] as PracticeMode;
      if (!PRACTICE_MODES.includes(mode)) {
        throw new Error(`--mode must be one of: ${PRACTICE_MODES.join(', ')}`);
      }
      options.mode = mode;
    } else if (arg === '--words') {
      options.characterMode = false;
    } else if (arg === '--characters') {
      options.characterMode = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--dry-run') {
      command = 'preview';
    } else if (arg === '--status') {
      command = 'status';
    } else if (arg === '--stop') {
      command = 'stop';
    } else if (arg === '--abort') {
      command = 'abort';
    } else if (arg === '--skip-infer') {
      options.skipInfer = true;
    } else if (arg === '--skip-examples') {
      options.skipExamples = true;
    } else if (arg === '--limit') {
      options.limit = Number(argv[++i]);
      if (!Number.isFinite(options.limit)) {
        throw new Error('--limit needs a number');
      }
    } else if (arg === '--concurrency') {
      options.concurrency = Number(argv[++i]);
      if (!Number.isFinite(options.concurrency)) {
        throw new Error('--concurrency needs a number');
      }
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { command, options };
}

const baseUrl = `https://localhost:${Number(process.env.PORT) || 3000}/api/refresh`;

/** The dev server serves its own certificate, so verifying it against localhost is pointless */
function request<T>(method: 'GET' | 'POST', urlPath: string, body?: unknown): Promise<T> {
  const url = new URL(baseUrl + urlPath);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        rejectUnauthorized: false,
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            reject(new Error(`Unexpected response: ${data.slice(0, 200)}`));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parsed.error ?? `Request failed (${res.statusCode})`));
            return;
          }
          resolve(parsed as T);
        });
      }
    );
    req.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') {
        reject(new Error(`No app server on ${url.origin} — start it with "npm run dev" first.`));
        return;
      }
      reject(error);
    });
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function requestBody(options: Options) {
  return {
    mode: options.mode,
    characterMode: options.characterMode,
    limit: options.limit,
    force: options.force,
    skipInfer: options.skipInfer,
    skipExamples: options.skipExamples,
    ...(options.concurrency !== null ? { concurrency: options.concurrency } : {}),
  };
}

/** How much of the job log has been printed, so an abort can pick up the tail of it */
let printedThrough = 0;

function printLog(status: RefreshStatus): number {
  for (const line of status.log) {
    console.log(line);
  }
  printedThrough = status.logOffset + status.log.length;
  return printedThrough;
}

/**
 * Ctrl-C tears the job down in the server as well: the calls in flight are cancelled and
 * everything written so far is put back. A second Ctrl-C gives up waiting for that to finish.
 */
function abortJobOnSigint(): void {
  let aborting = false;
  process.on('SIGINT', () => {
    if (aborting) {
      process.exit(130);
    }
    aborting = true;
    console.log('\nAborting the job and rolling it back (Ctrl-C again to stop waiting)...');
    void (async () => {
      try {
        await request<RefreshStatus>('POST', '/abort');
        printLog(await request<RefreshStatus>('GET', `/status?since=${printedThrough}`));
      } catch (error) {
        console.error(`Could not abort the job: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
      }
      process.exit(130);
    })();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prints new log lines as they appear, until the job stops. A server that goes away is given
 * SERVER_WAIT_MS to come back, and one that comes back as a different process is reported: the
 * job went down with the old one, which rolled it back on its way out.
 */
async function follow(since: number, instanceId: string): Promise<RefreshStatus> {
  let next = since;
  let unreachableSince = 0;
  for (;;) {
    let status: RefreshStatus;
    try {
      status = await request<RefreshStatus>('GET', `/status?since=${next}`);
    } catch (error) {
      if (unreachableSince === 0) {
        unreachableSince = Date.now();
        console.log('(the server is not answering — waiting for it to come back)');
      }
      if (Date.now() - unreachableSince > SERVER_WAIT_MS) {
        throw error;
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    unreachableSince = 0;
    if (status.instanceId !== instanceId) {
      throw new Error(
        'The server restarted, so the job went with it. Everything it had written was rolled ' +
          'back, and the entries are as they were — start the job again.'
      );
    }
    next = printLog(status);
    if (!status.running) {
      return status;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === 'preview') {
    const preview = await request<{ queueSize: number; hanzi: string[] }>(
      'POST',
      '/preview',
      requestBody(options)
    );
    console.log(
      `${preview.queueSize} entries in the ${options.mode} ` +
        `${options.characterMode ? 'character' : 'word'}-mode queue; ` +
        `${preview.hanzi.length} to process`
    );
    console.log(preview.hanzi.join(' '));
    console.log('\nDry run, nothing written.');
    return;
  }

  if (command === 'stop') {
    const status = await request<RefreshStatus>('POST', '/stop');
    console.log(status.running ? 'Stop requested.' : 'No job is running.');
    return;
  }

  if (command === 'abort') {
    const status = await request<RefreshStatus>('POST', '/abort');
    console.log(status.stage === 'aborted' ? 'Aborted and rolled back.' : 'No job is running.');
    return;
  }

  if (command === 'status') {
    const status = await request<RefreshStatus>('GET', '/status?since=0');
    if (!status.running) {
      console.log(`No job running (last stage: ${status.stage}).`);
      printLog(status);
      return;
    }
    await follow(0, status.instanceId);
    return;
  }

  const started = await request<RefreshStatus>('POST', '/start', requestBody(options));
  const since = printLog(started);
  if (!started.running) {
    return;
  }
  console.log('(the job runs inside the server — Ctrl-C aborts it and rolls it back)\n');
  abortJobOnSigint();
  const finished = await follow(since, started.instanceId);
  console.log(
    `\n${finished.stage}: ${finished.processed} processed, ${finished.failed} failed` +
      (finished.error ? ` — ${finished.error}` : '')
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
