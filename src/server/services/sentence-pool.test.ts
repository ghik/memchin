import { describe, it, expect } from 'vitest';
import { buildPool } from './sentence-pool.js';
import type { Example, Word } from '../../shared/types.js';

function example(hanzi: string, english: string): Example {
  return { hanzi, pinyin: 'pinyin', english };
}

/** Only the fields buildPool reads; the rest of Word is irrelevant here */
function word(hanzi: string, rank: number | undefined, examples: Example[]): Word {
  return {
    hanzi,
    pinyin: '',
    english: [],
    hskLevel: 0,
    wordFrequencyRank: rank,
    examples,
    translatable: true,
    categories: [],
    aiCategories: [],
    aiEnglish: [],
    manual: false,
  };
}

const three = [example('一', 'phrase'), example('二', 'sentence'), example('三', 'long sentence')];

describe('buildPool', () => {
  it('takes the middle example, not the phrase or the long one', () => {
    const [question] = buildPool([word('猫', 1, three)]);
    expect(question.reference.hanzi).toBe('二');
    expect(question.english).toBe('sentence');
  });

  it('carries the owning word, so the reference can be found again', () => {
    const [question] = buildPool([word('猫', 1, three)]);
    expect(question.hanzi).toBe('猫');
  });

  it('carries what the prompt shows about the word, and nothing more', () => {
    const cat = word('猫', 7, three);
    cat.english = ['cat'];
    cat.aiEnglish = ['feline'];
    cat.categories = ['noun'];
    const [question] = buildPool([cat]);
    expect(question.word).toEqual({
      english: ['cat'],
      aiEnglish: ['feline'],
      categories: ['noun'],
      aiCategories: [],
      rank: 7,
    });
    // The word's own hanzi is not part of the prompt, as it is not in the english→X modes
    expect(question.word).not.toHaveProperty('hanzi');
  });

  it('includes rank 500 and excludes what lies beyond it', () => {
    expect(buildPool([word('a', 500, three)])).toHaveLength(1);
    expect(buildPool([word('b', 501, three)])).toHaveLength(0);
  });

  it('excludes a word with no frequency rank at all', () => {
    expect(buildPool([word('c', undefined, three)])).toHaveLength(0);
  });

  it('skips a word whose middle example is missing or malformed', () => {
    expect(buildPool([word('d', 1, [example('一', 'phrase')])])).toHaveLength(0);
    expect(buildPool([word('e', 1, [three[0], example('', 'sentence')])])).toHaveLength(0);
    expect(buildPool([word('f', 1, [three[0], example('二', '  ')])])).toHaveLength(0);
  });

  it('asks the same English only once, however many words illustrate it', () => {
    const shared = [three[0], example('我有一个弟弟', 'I have a younger brother.')];
    const other = [three[0], example('我有一个弟弟', 'I have a younger brother')];
    expect(buildPool([word('有', 1, shared), word('弟弟', 2, other)])).toHaveLength(1);
  });
});
