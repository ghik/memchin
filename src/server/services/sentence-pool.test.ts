import { describe, it, expect } from 'vitest';
import { buildPool } from './sentence-pool.js';
import type { Example, Word } from '../../shared/types.js';

function example(hanzi: string, english: string): Example {
  return { hanzi, pinyin: 'pinyin', english };
}

/** Three examples in the shape the generator produces, each one using `hanzi` */
function examplesFor(hanzi: string): Example[] {
  return [
    example(`${hanzi}啊`, 'phrase'),
    example(`我${hanzi}了`, `sentence about ${hanzi}`),
    example(`我昨天${hanzi}了很久`, `long sentence about ${hanzi}`),
  ];
}

/** Only the fields buildPool reads; the rest of Word is irrelevant here */
function word(hanzi: string, rank: number | undefined, examples = examplesFor(hanzi)): Word {
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

describe('buildPool', () => {
  it('takes the middle example, not the phrase or the long one', () => {
    const [question] = buildPool([word('看', 1)]);
    expect(question.reference.hanzi).toBe('我看了');
    expect(question.english).toBe('sentence about 看');
  });

  it('carries the owning word, so the reference can be found again', () => {
    expect(buildPool([word('看', 1)])[0].hanzi).toBe('看');
  });

  it('carries what the word means, for showing once the answer is in', () => {
    const cat = word('猫', 7);
    cat.english = ['cat'];
    cat.aiEnglish = ['feline'];
    expect(buildPool([cat])[0].word).toEqual({ english: ['cat'], aiEnglish: ['feline'] });
  });

  it('includes rank 1500 and excludes what lies beyond it', () => {
    expect(buildPool([word('看', 1500)])).toHaveLength(1);
    expect(buildPool([word('看', 1501)])).toHaveLength(0);
  });

  it('excludes a word with no frequency rank at all', () => {
    expect(buildPool([word('看', undefined)])).toHaveLength(0);
  });

  it('skips a word whose middle example is missing or malformed', () => {
    expect(buildPool([word('看', 1, [example('看啊', 'phrase')])])).toHaveLength(0);
    expect(
      buildPool([word('看', 1, [example('看啊', 'p'), example('', 'sentence')])])
    ).toHaveLength(0);
    expect(buildPool([word('看', 1, [example('看啊', 'p'), example('我看了', ' ')])])).toHaveLength(
      0
    );
  });

  it('drops an example that never uses the word it was written for', () => {
    // 起来 illustrated by 他七点起床 — a fine sentence and a useless exercise
    const stray = [example('起来啊', 'phrase'), example('他七点起床', 'He gets up at seven')];
    expect(buildPool([word('起来', 1, stray)])).toHaveLength(0);
  });

  it('keeps a sentence under every word it illustrates', () => {
    // Answering it twice is answering for a different word each time
    const shared = [example('有啊', 'p'), example('我有一个弟弟', 'I have a younger brother.')];
    const other = [example('弟弟啊', 'p'), example('我有一个弟弟', 'I have a younger brother')];
    const pool = buildPool([word('有', 1, shared), word('弟弟', 2, other)]);
    expect(pool.map((q) => q.hanzi)).toEqual(['有', '弟弟']);
  });
});
