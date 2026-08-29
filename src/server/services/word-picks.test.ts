import { describe, it, expect } from 'vitest';
import { parseWordPicks } from './word-picks.js';

const candidates = ['电脑', '手机', '桌子', '椅子'];

describe('parseWordPicks', () => {
  it('keeps the picks in the order they were given, which is best first', () => {
    expect(parseWordPicks('{"hanzi":["手机","电脑"]}', candidates, 10)).toEqual(['手机', '电脑']);
  });

  it('drops anything that was not offered', () => {
    // A word not in the deck would either fail to select or queue something that is not there
    expect(parseWordPicks('{"hanzi":["手机","苹果",""]}', candidates, 10)).toEqual(['手机']);
  });

  it('drops a word picked twice', () => {
    expect(parseWordPicks('{"hanzi":["手机","手机","桌子"]}', candidates, 10)).toEqual([
      '手机',
      '桌子',
    ]);
  });

  it('stops at the limit even when more come back', () => {
    expect(parseWordPicks('{"hanzi":["手机","电脑","桌子"]}', candidates, 2)).toEqual([
      '手机',
      '电脑',
    ]);
  });

  it('trims, since the hanzi have to match exactly to be usable', () => {
    expect(parseWordPicks('{"hanzi":[" 手机 "]}', candidates, 10)).toEqual(['手机']);
  });

  it('gives nothing back for an unusable reply, so the caller retries', () => {
    for (const raw of [
      'not json at all',
      'null',
      '["手机"]',
      '{}',
      '{"hanzi":"手机"}',
      '{"hanzi":[1,2]}',
    ]) {
      expect(parseWordPicks(raw, candidates, 10)).toEqual([]);
    }
  });
});
