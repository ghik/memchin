/**
 * Moves review times that already sit in the night — 23:00 to 04:00 local — past it, the same
 * way new ones are placed as they are computed. Rows written before that rule existed keep
 * waking the deck up at four in the morning; this is a one-off pass to catch them up.
 *
 *   npm run shift-night-reviews -- --dry-run    list what would move, write nothing
 *   npm run shift-night-reviews
 */
import net from 'net';
import { getDb, initDb, saveDb } from '../server/db.js';
import { shiftOutOfTheNight } from '../server/services/srs.js';
import { fromStamp, toStamp } from '../shared/time.js';

interface Row {
  hanzi: string;
  mode: string;
  nextEligible: string;
}

/**
 * The app server keeps the whole database in memory and writes it back whole on every save, so
 * anything written here while it runs is erased the next time it saves.
 */
function appServerRunning(): Promise<boolean> {
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

function scheduledRows(): Row[] {
  const stmt = getDb().prepare(
    'SELECT hanzi, mode, next_eligible FROM progress WHERE next_eligible IS NOT NULL'
  );
  const rows: Row[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, string>;
    rows.push({ hanzi: row.hanzi, mode: row.mode, nextEligible: row.next_eligible });
  }
  stmt.free();
  return rows;
}

/** Local time, which is what the night window is expressed in */
function localTime(date: Date): string {
  return date.toLocaleString('sv-SE');
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  if (!dryRun && (await appServerRunning())) {
    console.error(
      `The app server is running on port ${Number(process.env.PORT) || 3000}. It holds the ` +
        'whole database in memory and would overwrite this run.\n' +
        'Stop it first, then start it again once this finishes.'
    );
    process.exit(1);
  }

  await initDb();

  const moved: { row: Row; to: string }[] = [];
  for (const row of scheduledRows()) {
    const before = fromStamp(row.nextEligible);
    const after = shiftOutOfTheNight(before);
    if (after.getTime() !== before.getTime()) {
      moved.push({ row, to: toStamp(after) });
    }
  }

  console.log(`${moved.length} of ${scheduledRows().length} scheduled reviews fall in the night.`);
  for (const { row, to } of moved) {
    console.log(
      `  ${row.hanzi} (${row.mode}): ${localTime(fromStamp(row.nextEligible))} -> ${localTime(fromStamp(to))}`
    );
  }

  if (moved.length === 0) {
    return;
  }

  if (dryRun) {
    console.log('\nDry run, nothing written.');
    return;
  }

  const db = getDb();
  for (const { row, to } of moved) {
    db.run('UPDATE progress SET next_eligible = ? WHERE hanzi = ? AND mode = ?', [
      to,
      row.hanzi,
      row.mode,
    ]);
  }
  saveDb();
  console.log(`\nMoved ${moved.length} review(s) out of the night.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
