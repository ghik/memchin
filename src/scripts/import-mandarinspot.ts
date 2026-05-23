// Fetch translations from mandarinspot.com's getdefs API for every practiced
// or queued word and store them in the new `mandarinspot_translation` column.
//
// Usage:
//   npm run import-mandarinspot                  # only words missing a translation
//   npm run import-mandarinspot -- --force       # refetch everything
//   npm run import-mandarinspot -- --limit=50    # cap how many to fetch this run
//   npm run import-mandarinspot -- --delay=300   # ms between requests (default 200)

import { getDb, initDb, setMandarinspotTranslation, type MandarinspotTranslation } from '../server/db.js';

const API_URL = 'https://api.mandarinspot.com/getdefs';

interface ApiResponse {
  defs?: Record<string, [string[], string[], string]>;
  seg?: string[];
}

async function fetchTranslation(hanzi: string): Promise<MandarinspotTranslation | null> {
  const body = new URLSearchParams({ str: hanzi, phs: 'pinyin' });
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data: ApiResponse = await res.json();
  // The API segments unknown words into smaller pieces. Only accept a result
  // that contains an exact-match key for our hanzi (or its traditional form).
  const entry = data.defs?.[hanzi];
  if (!entry) {
    return null;
  }
  const [pinyin, defs, traditional] = entry;
  return {
    pinyin,
    defs,
    ...(traditional && traditional !== hanzi ? { traditional } : {}),
  };
}

interface Args {
  force: boolean;
  limit?: number;
  delay: number;
}

function parseArgs(argv: string[]): Args {
  let force = false;
  let limit: number | undefined;
  let delay = 200;
  for (const a of argv) {
    if (a === '--force') {
      force = true;
    } else if (a.startsWith('--limit=')) {
      limit = parseInt(a.split('=')[1], 10);
    } else if (a.startsWith('--delay=')) {
      delay = parseInt(a.split('=')[1], 10);
    }
  }
  return { force, limit, delay };
}

function selectTargetHanzis(force: boolean): string[] {
  const db = getDb();
  // Practiced (any progress with bucket NOT NULL) OR queued (queued_at OR char_queued_at).
  const filter = force ? '' : 'AND w.mandarinspot_translation IS NULL';
  const sql = `
    SELECT w.hanzi FROM words w
    WHERE (
      EXISTS (SELECT 1 FROM progress p WHERE p.hanzi = w.hanzi AND p.bucket IS NOT NULL)
      OR w.queued_at IS NOT NULL
      OR w.char_queued_at IS NOT NULL
    )
    ${filter}
  `;
  const stmt = db.prepare(sql);
  const out: string[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { hanzi: string };
    out.push(row.hanzi);
  }
  stmt.free();
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await initDb();

  let targets = selectTargetHanzis(args.force);
  if (args.limit !== undefined) {
    targets = targets.slice(0, args.limit);
  }
  console.log(
    `Fetching translations for ${targets.length} words` +
      (args.force ? ' (force=true, will overwrite existing)' : ' (missing only)') +
      `, ${args.delay}ms between requests`
  );

  let ok = 0;
  let missing = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const hanzi = targets[i];
    try {
      const result = await fetchTranslation(hanzi);
      if (result) {
        setMandarinspotTranslation(hanzi, result);
        ok++;
      } else {
        // Mark NULL (still differentiates "tried, no entry" only if force=true).
        // For non-force runs we keep NULL so re-runs retry these.
        missing++;
      }
      if ((i + 1) % 25 === 0 || i === targets.length - 1) {
        console.log(`  ${i + 1}/${targets.length}: ${ok} ok, ${missing} not in dict, ${failed} failed`);
      }
    } catch (err) {
      failed++;
      console.error(`  ${hanzi}: ${err instanceof Error ? err.message : err}`);
    }
    if (i < targets.length - 1 && args.delay > 0) {
      await sleep(args.delay);
    }
  }

  // Persist the underlying SQLite snapshot to disk.
  const { saveDb } = await import('../server/db.js');
  saveDb();

  console.log(`\nDone: ${ok} stored, ${missing} not in dict, ${failed} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
