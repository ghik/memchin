/**
 * Reading back the model's choice of which queued words are worth learning next, kept apart from
 * the call so it can be tested without an API key — `new OpenAI()` throws at module load when the
 * key is missing, which is why sentence-verdict.ts sits outside grade-sentence.ts too.
 */

/**
 * Never throws: an unusable reply is an empty list, and the caller retries.
 *
 * Anything the model returns that was not among the candidates is dropped rather than trusted.
 * The picks go straight into a selection the learner then practises, so a hallucinated word would
 * either fail to select or, worse, queue something that is not in the deck at all.
 */
export function parseWordPicks(raw: string, candidates: string[], limit: number): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return [];
  }

  const allowed = new Set(candidates);
  const taken = new Set<string>();
  const picks: string[] = [];
  for (const entry of Array.isArray((parsed as Record<string, unknown>).hanzi)
    ? ((parsed as Record<string, unknown>).hanzi as unknown[])
    : []) {
    const hanzi = typeof entry === 'string' ? entry.trim() : '';
    if (!allowed.has(hanzi) || taken.has(hanzi)) {
      continue;
    }
    taken.add(hanzi);
    picks.push(hanzi);
    if (picks.length === limit) {
      break;
    }
  }
  return picks;
}
