import { describe, it, expect } from 'vitest';
import { parseGeneratedSentences } from './generated-sentences.js';

const one = { hanzi: '我很忙', pinyin: 'wǒ hěn máng', english: 'I am busy' };
const two = { hanzi: '他在看书', pinyin: 'tā zài kàn shū', english: 'He is reading' };

function reply(sentences: unknown[]): string {
  return JSON.stringify({ sentences });
}

describe('parseGeneratedSentences', () => {
  it('keeps what came back, trimmed and in order', () => {
    const parsed = parseGeneratedSentences(
      reply([{ ...one, hanzi: ' 我很忙 ', english: ' I am busy ' }, two]),
      10
    );
    expect(parsed).toEqual([one, two]);
  });

  it('stops at the number asked for', () => {
    expect(parseGeneratedSentences(reply([one, two]), 1)).toEqual([one]);
  });

  it('keeps the usable sentences when one of them is not', () => {
    // One bad sentence out of twenty is not worth another call
    const bad = [
      { hanzi: '我很忙' },
      { hanzi: '', pinyin: 'p', english: 'e' },
      { hanzi: 'h', pinyin: '  ', english: 'e' },
      'not an object',
      null,
    ];
    expect(parseGeneratedSentences(reply([...bad, two]), 10)).toEqual([two]);
  });

  it('drops a sentence that repeats another, in either language', () => {
    const sameHanzi = { ...one, english: 'I am very busy' };
    const sameEnglish = { ...two, hanzi: '他正在看书', pinyin: 'tā zhèngzài kàn shū' };
    expect(
      parseGeneratedSentences(reply([one, sameHanzi, two, sameEnglish]), 10).map((s) => s.hanzi)
    ).toEqual(['我很忙', '他在看书']);
  });

  it('gives nothing back for an unusable reply, so the caller retries', () => {
    for (const raw of ['not json', 'null', '[]', '{}', '{"sentences":"none"}', reply([])]) {
      expect(parseGeneratedSentences(raw, 10)).toEqual([]);
    }
  });
});
