import { describe, it, expect } from 'vitest';
import { takesExamples } from './labels.js';

describe('takesExamples', () => {
  it('gives ordinary words their examples', () => {
    expect(takesExamples({ categories: ['noun', 'hsk4'], aiCategories: ['neutral'] })).toBe(true);
  });

  it('refuses them to anything the AI labelled a sentence', () => {
    expect(takesExamples({ categories: ['curated'], aiCategories: ['sentence', 'spoken'] })).toBe(
      false
    );
  });

  it("refuses them when the label is the user's own", () => {
    expect(takesExamples({ categories: ['sentence'], aiCategories: [] })).toBe(false);
  });

  it('copes with either label set being absent', () => {
    expect(takesExamples({})).toBe(true);
    expect(takesExamples({ aiCategories: ['sentence'] })).toBe(false);
  });
});
