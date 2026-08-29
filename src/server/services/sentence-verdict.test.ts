import { describe, it, expect } from 'vitest';
import { parseSentenceGrading } from './sentence-verdict.js';

const answer = '我买了两个书';
const reference = '我买了两本书';

describe('parseSentenceGrading', () => {
  it('accepts each verdict in the closed set', () => {
    for (const verdict of ['correct', 'acceptable', 'wrong']) {
      const parsed = parseSentenceGrading(
        JSON.stringify({ verdict, explanation: 'Because.', suggestion: null }),
        answer,
        reference
      );
      expect(parsed?.verdict).toBe(verdict);
    }
  });

  it('rejects a verdict outside the set, so the caller retries', () => {
    expect(
      parseSentenceGrading('{"verdict":"partially correct","explanation":"x"}', answer, reference)
    ).toBe(null);
    expect(parseSentenceGrading('{"verdict":"CORRECT","explanation":"x"}', answer, reference)).toBe(
      null
    );
  });

  it('rejects an unusable reply without throwing', () => {
    expect(parseSentenceGrading('not json at all', answer, reference)).toBe(null);
    expect(parseSentenceGrading('["correct"]', answer, reference)).toBe(null);
    expect(parseSentenceGrading('null', answer, reference)).toBe(null);
    expect(parseSentenceGrading('{}', answer, reference)).toBe(null);
  });

  it('rejects a verdict with nothing to say for itself', () => {
    expect(parseSentenceGrading('{"verdict":"wrong","explanation":"   "}', answer, reference)).toBe(
      null
    );
    expect(parseSentenceGrading('{"verdict":"wrong"}', answer, reference)).toBe(null);
  });

  it('drops a suggestion that only differs from the answer by punctuation', () => {
    const parsed = parseSentenceGrading(
      JSON.stringify({ verdict: 'wrong', explanation: 'x', suggestion: '我买了两个书。' }),
      answer,
      reference
    );
    expect(parsed?.suggestion).toBeUndefined();
  });

  it('keeps a real correction, trimmed', () => {
    const parsed = parseSentenceGrading(
      JSON.stringify({ verdict: 'wrong', explanation: ' Use 本. ', suggestion: ' 我买了两本书 ' }),
      answer,
      reference
    );
    expect(parsed).toEqual({
      verdict: 'wrong',
      explanation: 'Use 本.',
      suggestion: '我买了两本书',
    });
  });
});

describe('parseSentenceGrading, on other ways to say it', () => {
  it('keeps them, trimmed and in order', () => {
    const parsed = parseSentenceGrading(
      JSON.stringify({
        verdict: 'wrong',
        explanation: 'x',
        alternatives: [' 书我买了两本 ', '我一共买了两本书'],
      }),
      answer,
      reference
    );
    expect(parsed?.alternatives).toEqual(['书我买了两本', '我一共买了两本书']);
  });

  it('drops what is not another way of saying it', () => {
    const parsed = parseSentenceGrading(
      JSON.stringify({
        verdict: 'wrong',
        explanation: 'x',
        // In order: the reference, the learner's own sentence, a repeat, and nothing at all
        alternatives: ['我买了两本书。', '我买了两个书', '书我买了两本', '书我买了两本', '  '],
      }),
      answer,
      reference
    );
    expect(parsed?.alternatives).toEqual(['书我买了两本']);
  });

  it('says nothing rather than nothing useful', () => {
    for (const alternatives of [[], ['', ' '], 'not a list', null]) {
      const parsed = parseSentenceGrading(
        JSON.stringify({ verdict: 'correct', explanation: 'x', alternatives }),
        answer,
        reference
      );
      expect(parsed).not.toHaveProperty('alternatives');
    }
  });
});

describe('parseSentenceGrading, on whether the word was used', () => {
  it('keeps a plain boolean either way', () => {
    const yes = parseSentenceGrading(
      '{"verdict":"correct","explanation":"x","usesWord":true}',
      answer,
      reference
    );
    const no = parseSentenceGrading(
      '{"verdict":"correct","explanation":"x","usesWord":false}',
      answer,
      reference
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
      expect(parseSentenceGrading(raw, answer, reference)).not.toHaveProperty('usesWord');
    }
  });
});
