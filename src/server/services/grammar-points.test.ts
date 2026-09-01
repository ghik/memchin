import { describe, it, expect } from 'vitest';
import { GRAMMAR_POINTS, pickGrammarPoints } from './grammar-points.js';

describe('pickGrammarPoints', () => {
  it('takes only points at the levels asked for', () => {
    const picked = pickGrammarPoints([2, 3], 12);
    expect(picked).toHaveLength(12);
    expect(picked.every((point) => point.level === 2 || point.level === 3)).toBe(true);
  });

  it('gives every point once before giving any twice', () => {
    const atOne = GRAMMAR_POINTS.filter((point) => point.level === 1);
    const picked = pickGrammarPoints([1], atOne.length);
    expect(new Set(picked.map((point) => point.point)).size).toBe(atOne.length);
  });

  it('repeats rather than coming back short when more are asked for than exist', () => {
    const atOne = GRAMMAR_POINTS.filter((point) => point.level === 1).length;
    expect(pickGrammarPoints([1], atOne + 5)).toHaveLength(atOne + 5);
  });

  it('gives nothing back for a level that has none, rather than looping forever', () => {
    expect(pickGrammarPoints([9], 5)).toEqual([]);
  });

  it('carries an example for every point, so the model cannot mistake one', () => {
    expect(GRAMMAR_POINTS.every((point) => point.point !== '' && point.example !== '')).toBe(true);
  });
});
