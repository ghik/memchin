/**
 * What the AI calls cost in tokens, and how much of that OpenAI served from its prompt cache.
 * Caching is automatic — no flag turns it on — but it only applies to prompts past ~1k tokens
 * and only to the part of the prefix a request repeats verbatim, so whether it happens at all
 * is a property of how the prompts are put together. This is how we find out that it does.
 */
interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
}

interface Tally {
  calls: number;
  prompt: number;
  cached: number;
  completion: number;
}

/** Kept per kind of call: each has its own prompt, and they cache independently */
const tallies = new Map<string, Tally>();

function tallyFor(kind: string): Tally {
  const existing = tallies.get(kind);
  if (existing) {
    return existing;
  }
  const fresh: Tally = { calls: 0, prompt: 0, cached: 0, completion: 0 };
  tallies.set(kind, fresh);
  return fresh;
}

export function recordUsage(kind: string, usage: Usage | undefined): void {
  if (!usage) {
    return;
  }
  const tally = tallyFor(kind);
  tally.calls++;
  tally.prompt += usage.prompt_tokens ?? 0;
  tally.cached += usage.prompt_tokens_details?.cached_tokens ?? 0;
  tally.completion += usage.completion_tokens ?? 0;
}

export function resetUsage(): void {
  tallies.clear();
}

function thousands(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 100) / 10}k` : String(tokens);
}

function hitRate(tally: Tally): number {
  return tally.prompt > 0 ? Math.round((tally.cached / tally.prompt) * 100) : 0;
}

function describe(tally: Tally): string {
  return (
    `${tally.calls} calls, ${thousands(tally.prompt)} prompt tokens ` +
    `(${hitRate(tally)}% from cache), ${thousands(tally.completion)} completion`
  );
}

export function usageSummary(): string {
  if (tallies.size === 0) {
    return 'no AI calls';
  }
  const total: Tally = { calls: 0, prompt: 0, cached: 0, completion: 0 };
  for (const tally of tallies.values()) {
    total.calls += tally.calls;
    total.prompt += tally.prompt;
    total.cached += tally.cached;
    total.completion += tally.completion;
  }
  const breakdown = [...tallies].map(([kind, tally]) => `${kind} ${describe(tally)}`).join('; ');
  return `${describe(total)} — ${breakdown}`;
}
