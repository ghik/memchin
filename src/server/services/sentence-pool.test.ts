import { describe, it, expect } from 'vitest';
import { buildPool } from './sentence-pool.js';
import type { Example, SentenceQuestion, Word } from '../../shared/types.js';

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
function word(hanzi: string, examples = examplesFor(hanzi)): Word {
  return {
    hanzi,
    pinyin: '',
    english: [],
    hskLevel: 0,
    examples,
    translatable: true,
    categories: [],
    aiCategories: [],
    aiEnglish: [],
    manual: false,
  };
}

/** The usual case: every word given has been learned */
function pool(words: Word[]): SentenceQuestion[] {
  return buildPool(words, new Set(words.map((w) => w.hanzi)));
}

describe('buildPool', () => {
  it('takes both sentences and not the phrase, telling them apart by id', () => {
    const questions = pool([word('看')]);
    expect(questions.map((q) => [q.id, q.reference.hanzi, q.long])).toEqual([
      ['看#1', '我看了', false],
      ['看#2', '我昨天看了很久', true],
    ]);
  });

  it('keeps the middle example when the long one is unusable', () => {
    const half = [example('看啊', 'p'), example('我看了', 'sentence'), example('', 'long')];
    expect(pool([word('看', half)]).map((q) => q.id)).toEqual(['看#1']);
  });

  it('carries the owning word, so the answer can be told what it was for', () => {
    expect(pool([word('看')])[0].hanzi).toBe('看');
  });

  it('carries what the word means, for showing once the answer is in', () => {
    const cat = word('猫');
    cat.english = ['cat'];
    cat.aiEnglish = ['feline'];
    expect(pool([cat])[0].word).toEqual({ english: ['cat'], aiEnglish: ['feline'] });
  });

  it('asks only about words that have been learned', () => {
    const words = [word('看'), word('猫')];
    expect(buildPool(words, new Set(['看'])).map((q) => q.hanzi)).toEqual(['看', '看']);
    expect(buildPool(words, new Set())).toHaveLength(0);
  });

  it('does not care how common the word is, only that it was learned', () => {
    // Most of what gets learned sits outside any reasonable frequency cap
    const rare = word('侃侃而谈');
    rare.wordFrequencyRank = 40000;
    expect(pool([rare])).toHaveLength(2);
  });

  it('skips a word whose middle example is missing or malformed', () => {
    expect(pool([word('看', [example('看啊', 'phrase')])])).toHaveLength(0);
    expect(pool([word('看', [example('看啊', 'p'), example('', 'sentence')])])).toHaveLength(0);
    expect(pool([word('看', [example('看啊', 'p'), example('我看了', ' ')])])).toHaveLength(0);
  });

  it('drops an example that never uses the word it was written for', () => {
    // 起来 illustrated by 他七点起床 — a fine sentence and a useless exercise
    const stray = [example('起来啊', 'phrase'), example('他七点起床', 'He gets up at seven')];
    expect(pool([word('起来', stray)])).toHaveLength(0);
  });

  it('keeps a sentence under every word it illustrates', () => {
    // Answering it twice is answering for a different word each time
    const shared = [example('有啊', 'p'), example('我有一个弟弟', 'I have a younger brother.')];
    const other = [example('弟弟啊', 'p'), example('我有一个弟弟', 'I have a younger brother')];
    expect(pool([word('有', shared), word('弟弟', other)]).map((q) => q.hanzi)).toEqual([
      '有',
      '弟弟',
    ]);
  });
});
