import { describe, it, expect } from 'vitest';
import { parseSentenceGrading } from './sentence-verdict.js';

const answer = '我买了两个书';

describe('parseSentenceGrading', () => {
  it('accepts each verdict in the closed set', () => {
    for (const verdict of ['correct', 'acceptable', 'wrong']) {
      const parsed = parseSentenceGrading(
        JSON.stringify({ verdict, explanation: 'Because.', suggestion: null }),
        answer
      );
      expect(parsed?.verdict).toBe(verdict);
    }
  });

  it('rejects a verdict outside the set, so the caller retries', () => {
    expect(parseSentenceGrading('{"verdict":"partially correct","explanation":"x"}', answer)).toBe(
      null
    );
    expect(parseSentenceGrading('{"verdict":"CORRECT","explanation":"x"}', answer)).toBe(null);
  });

  it('rejects an unusable reply without throwing', () => {
    expect(parseSentenceGrading('not json at all', answer)).toBe(null);
    expect(parseSentenceGrading('["correct"]', answer)).toBe(null);
    expect(parseSentenceGrading('null', answer)).toBe(null);
    expect(parseSentenceGrading('{}', answer)).toBe(null);
  });

  it('rejects a verdict with nothing to say for itself', () => {
    expect(parseSentenceGrading('{"verdict":"wrong","explanation":"   "}', answer)).toBe(null);
    expect(parseSentenceGrading('{"verdict":"wrong"}', answer)).toBe(null);
  });

  it('drops a suggestion that only differs from the answer by punctuation', () => {
    const parsed = parseSentenceGrading(
      JSON.stringify({ verdict: 'wrong', explanation: 'x', suggestion: '我买了两个书。' }),
      answer
    );
    expect(parsed?.suggestion).toBeUndefined();
  });

  it('keeps a real correction, trimmed', () => {
    const parsed = parseSentenceGrading(
      JSON.stringify({ verdict: 'wrong', explanation: ' Use 本. ', suggestion: ' 我买了两本书 ' }),
      answer
    );
    expect(parsed).toEqual({
      verdict: 'wrong',
      explanation: 'Use 本.',
      suggestion: '我买了两本书',
    });
  });
});

describe('parseSentenceGrading, on whether the word was used', () => {
  it('keeps a plain boolean either way', () => {
    const yes = parseSentenceGrading(
      '{"verdict":"correct","explanation":"x","usesWord":true}',
      answer
    );
    const no = parseSentenceGrading(
      '{"verdict":"correct","explanation":"x","usesWord":false}',
      answer
    );
    expect(yes?.usesWord).toBe(true);
    expect(no?.usesWord).toBe(false);
  });

  it('leaves it unsaid rather than guessing, so containment decides', () => {
    // Nagging a learner about a word they did use is worse than missing one they skipped
    for (const raw of [
      '{"verdict":"correct","explanation":"x"}',
      '{"verdict":"correct","explanation":"x","usesWord":"yes"}',
      '{"verdict":"correct","explanation":"x","usesWord":null}',
    ]) {
      expect(parseSentenceGrading(raw, answer)).not.toHaveProperty('usesWord');
    }
  });
});
